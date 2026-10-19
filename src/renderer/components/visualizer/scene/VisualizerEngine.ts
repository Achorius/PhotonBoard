// ============================================================
// VisualizerEngine — the one WebGL renderer of the app.
//
// A single engine (renderer, scene, camera, fixtures) is kept alive across
// tab switches: the 3D view attaches its canvas on mount and detaches on
// unmount. After KEEP_ALIVE_MS without a view the engine disposes every
// geometry / material / texture and releases the WebGL context — so
// revisiting the tab never leaks contexts and the Pi gets its GPU memory
// back when the 3D view is not used.
//
// Rendering is on demand: a frame is drawn only when DMX, the patch, the
// room, the selection or the camera changed (or a fixture animates on its
// own: strobe, gobo rotation), capped by the quality's frame rate, and
// never while the window is hidden.
// ============================================================

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FixtureDefinition, PatchEntry, RoomConfig } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useVisualizerStore, type VisualizerQuality } from '@renderer/stores/visualizer-store'
import { getDeviceProfile } from '@renderer/lib/device-detect'
import { resolveChannels } from '@renderer/lib/dmx-channel-resolver'
import { disposeGoboTextures } from '@renderer/lib/gobo-textures'
import { palette } from '@renderer/components/ui/tokens'
import { buildRoom, setRoomVisibility } from './RoomGeometry'
import {
  GeometryCache, createFixtureObjects, disposeFixtureObjects, drawFixtureLabel, setFixtureSelected, type FixtureObjects
} from './FixtureModel'
import { resolveCellColors, updateFixture, type FrameContext } from './BeamUpdater'
import { describeFixture, fixturePosition, leanDirection, restDirection, type Vec3 } from './layout-math'
import { disposeObject } from './dispose'

export type CameraPreset = 'perspective' | 'front' | 'top' | 'side'
export type EngineStatus = 'running' | 'lost'

interface QualityProfile {
  fps: number
  /** Cap on devicePixelRatio */
  pixelRatio: number
  /** Real spot lights (spill on fixtures / truss / walls), shared by the brightest beams */
  lights: number
  shadowSize: number
  coneSegments: number
}

export const QUALITY_PROFILES: Record<VisualizerQuality, QualityProfile> = {
  low: { fps: 20, pixelRatio: 0.75, lights: 0, shadowSize: 512, coneSegments: 16 },
  medium: { fps: 30, pixelRatio: 1, lights: 4, shadowSize: 512, coneSegments: 24 },
  high: { fps: 60, pixelRatio: 2, lights: 10, shadowSize: 1024, coneSegments: 40 }
}

const KEEP_ALIVE_MS = 45_000
const DOWN = new THREE.Vector3(0, -1, 0)
const UP = new THREE.Vector3(0, 1, 0)

interface FixtureRecord {
  objects: FixtureObjects
  signature: string
  entry: PatchEntry
  def: FixtureDefinition | undefined
  number: number
}

let instance: VisualizerEngine | null = null

/** The live engine, created on first use. Throws when WebGL is unavailable. */
export function getVisualizerEngine(): VisualizerEngine {
  if (!instance || instance.disposed) instance = new VisualizerEngine()
  return instance
}

/** Dispose the engine now (e.g. to recover from a lost context) */
export function destroyVisualizerEngine(): void {
  instance?.dispose()
  instance = null
}

export class VisualizerEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
  readonly controls: OrbitControls
  status: EngineStatus = 'running'
  disposed = false
  /** Frames actually rendered per second (0 when idle) */
  fps = 0

  private cache = new GeometryCache()
  private room: THREE.Group | null = null
  private fixtureLayer = new THREE.Group()
  private worldLayer = new THREE.Group()
  private hemi: THREE.HemisphereLight
  private lights: THREE.SpotLight[] = []
  private records = new Map<string, FixtureRecord>()
  private hitMeshes: THREE.Object3D[] = []
  private ranked: FixtureRecord[] = []
  private container: HTMLElement | null = null
  private ro: ResizeObserver | null = null
  private unsubs: Array<() => void> = []
  private statusListeners = new Set<(s: EngineStatus) => void>()
  private raf = 0
  private keepAlive = 0
  private lastRender = 0
  private frames = 0
  private fpsStart = 0
  private needsRender = true
  private dmxDirty = true
  private structureDirty = true
  private selectionDirty = true
  private roomDirty = true
  private animating = false
  private cameraPlaced = false
  private profile: QualityProfile
  private transition: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number } | null = null
  private pointer: { x: number; y: number; t: number; id: number } | null = null
  private lastPick = { id: '', t: 0 }
  private raycaster = new THREE.Raycaster()
  private ctx: FrameContext

  constructor() {
    const dev = getDeviceProfile()
    const vis = useVisualizerStore.getState()
    this.profile = QUALITY_PROFILES[vis.quality]
    const weak = dev.isLowEnd || dev.isMidRange
    // Throws when WebGL cannot be created — the caller shows the fallback
    this.renderer = new THREE.WebGLRenderer({
      antialias: !weak,
      alpha: false,
      powerPreference: weak ? 'low-power' : 'high-performance',
      failIfMajorPerformanceCaveat: false
    })
    const r = this.renderer
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatio))
    r.setClearColor(palette.surface0, 1)
    r.toneMapping = THREE.NoToneMapping
    r.shadowMap.enabled = vis.shadowsEnabled
    r.shadowMap.type = THREE.PCFShadowMap
    const el = r.domElement
    Object.assign(el.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%', outline: 'none' })
    el.addEventListener('webglcontextlost', this.onContextLost)
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointerup', this.onPointerUp)

    // Scene
    this.hemi = new THREE.HemisphereLight(palette.fgSecondary, palette.surface0, 1)
    this.applyAmbient(vis.ambientIntensity)
    this.scene.add(this.hemi, this.fixtureLayer, this.worldLayer)
    this.ensureLights()

    // Camera + controls (one finger orbits, two fingers pinch-zoom / pan)
    this.controls = new OrbitControls(this.camera, el)
    const c = this.controls
    c.enableDamping = true
    c.dampingFactor = 0.12
    c.rotateSpeed = 0.75
    c.screenSpacePanning = true
    c.maxPolarAngle = Math.PI / 2 - 0.01
    c.minDistance = 1
    c.maxDistance = 120
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    c.addEventListener('change', this.invalidate)

    const bounds = { min: new THREE.Vector3(), max: new THREE.Vector3() }
    this.ctx = {
      now: 0, gm: 1, blackout: false, blinder: false, strobeDark: false, showBeams: true, haze: 1,
      room: vis.roomConfig, walls: vis.showRoom, boundsMin: bounds.min, boundsMax: bounds.max
    }

    // Store subscriptions (narrow selectors; they only raise flags)
    const vs = useVisualizerStore
    this.unsubs.push(
      usePatchStore.subscribe((s) => s.patch, () => { this.structureDirty = true }),
      usePatchStore.subscribe((s) => s.fixtures, () => { this.structureDirty = true }),
      usePatchStore.subscribe((s) => s.selectedFixtureIds, () => { this.selectionDirty = true }),
      vs.subscribe((s) => s.roomConfig, () => { this.roomDirty = true; this.structureDirty = true }),
      vs.subscribe((s) => s.showRoom, () => { this.roomDirty = true; this.dmxDirty = true }),
      vs.subscribe((s) => s.showGrid, (v) => { if (this.room) setRoomVisibility(this.room, { walls: vs.getState().showRoom, grid: v }); this.invalidate() }),
      vs.subscribe((s) => s.showBeams, () => { this.dmxDirty = true }),
      vs.subscribe((s) => s.hazeEnabled, () => { this.dmxDirty = true }),
      vs.subscribe((s) => s.showLabels, () => { this.selectionDirty = true }),
      vs.subscribe((s) => s.ambientIntensity, (v) => { this.applyAmbient(v); this.invalidate() }),
      vs.subscribe((s) => s.quality, (q) => this.applyQuality(q)),
      vs.subscribe((s) => s.shadowsEnabled, (v) => this.applyShadows(v)),
      useDmxStore.subscribe(() => { this.dmxDirty = true })
    )
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  // ---------------------------------------------------------------- lifecycle

  attach(container: HTMLElement): void {
    if (this.disposed) return
    window.clearTimeout(this.keepAlive)
    if (this.container && this.container !== container) this.detach(this.container)
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.ro?.disconnect()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.needsRender = true
    this.start()
  }

  detach(container: HTMLElement): void {
    if (this.container !== container) return
    this.stop()
    this.ro?.disconnect()
    this.ro = null
    if (this.renderer.domElement.parentElement === container) container.removeChild(this.renderer.domElement)
    this.container = null
    this.pointer = null
    window.clearTimeout(this.keepAlive)
    this.keepAlive = window.setTimeout(() => { if (!this.container) this.dispose() }, KEEP_ALIVE_MS)
  }

  /** Release everything: geometries, materials, textures, render targets and the WebGL context */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    window.clearTimeout(this.keepAlive)
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.ro?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    const el = this.renderer.domElement
    el.removeEventListener('webglcontextlost', this.onContextLost)
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointerup', this.onPointerUp)
    for (const rec of this.records.values()) disposeFixtureObjects(rec.objects)
    this.records.clear()
    this.hitMeshes = []
    if (this.room) disposeObject(this.room)
    this.room = null
    for (const l of this.lights) { l.dispose(); l.removeFromParent(); l.target.removeFromParent() }
    this.lights = []
    this.cache.dispose()
    disposeGoboTextures()
    this.controls.dispose()
    this.scene.clear()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    el.remove()
    this.container = null
    this.statusListeners.clear()
    if (instance === this) instance = null
  }

  onStatus(fn: (s: EngineStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  /** Request a frame (camera moved, size changed…) */
  invalidate = (): void => {
    this.needsRender = true
  }

  // ---------------------------------------------------------------- camera

  setCameraPreset(preset: CameraPreset, animate = true): void {
    const { width: w, depth: d, height: h } = useVisualizerStore.getState().roomConfig
    const vfov = THREE.MathUtils.degToRad(this.camera.fov)
    const aspect = Math.max(0.3, this.camera.aspect)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    const fit = (across: number, high: number) => Math.max(across / 2 / Math.tan(hfov / 2), high / 2 / Math.tan(vfov / 2))
    const target = new THREE.Vector3()
    const pos = new THREE.Vector3()
    switch (preset) {
      case 'front': {
        target.set(0, h * 0.42, 0)
        pos.set(0, h * 0.48, -Math.max(d / 2 + 1, fit(w, h) * 1.06))
        break
      }
      case 'top': {
        // Frame the rig (at ceiling height), the floor then fits too
        target.set(0, 0, 0)
        pos.set(0, h + fit(w, d) * 1.12, -0.02)
        break
      }
      case 'side': {
        target.set(0, h * 0.42, 0)
        pos.set(-Math.max(w / 2 + 1, fit(d, h) * 1.08), h * 0.48, 0)
        break
      }
      default: {
        // Front-of-house, slightly off centre, under the rig
        target.set(0, h * 0.4, d * 0.1)
        const dist = fit(w, h)
        pos.set(-w * 0.2, h * 0.42, -d / 2 - Math.max(2, dist * 0.72))
      }
    }
    this.cameraPlaced = true
    if (!animate) {
      this.transition = null
      this.camera.position.copy(pos)
      this.controls.target.copy(target)
      this.controls.update()
      this.invalidate()
      return
    }
    this.transition = {
      fromPos: this.camera.position.clone(), toPos: pos,
      fromTarget: this.controls.target.clone(), toTarget: target,
      start: performance.now(), duration: 520
    }
  }

  /** Orbit around a fixture (double-tap) */
  focusFixture(id: string): void {
    const rec = this.records.get(id)
    if (!rec) return
    const p = new THREE.Vector3()
    rec.objects.group.getWorldPosition(p)
    const target = p.clone().setY(Math.max(0.5, p.y - 1.5))
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(Math.min(9, this.camera.position.distanceTo(this.controls.target)))
    this.transition = {
      fromPos: this.camera.position.clone(), toPos: target.clone().add(offset),
      fromTarget: this.controls.target.clone(), toTarget: target,
      start: performance.now(), duration: 480
    }
  }

  zoomBy(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const len = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance)
    this.transition = {
      fromPos: this.camera.position.clone(), toPos: this.controls.target.clone().add(offset.setLength(len)),
      fromTarget: this.controls.target.clone(), toTarget: this.controls.target.clone(),
      start: performance.now(), duration: 220
    }
  }

  // ---------------------------------------------------------------- loop

  private start(): void {
    if (this.raf || this.disposed || this.status !== 'running' || document.hidden) return
    this.raf = requestAnimationFrame(this.tick)
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.fps = 0
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick)
    if (now - this.lastRender < 1000 / this.profile.fps - 2) return

    let changed = this.needsRender
    if (this.roomDirty) { this.rebuildRoom(); changed = true }
    if (this.structureDirty) { this.syncFixtures(); changed = true }
    if (this.selectionDirty) { this.syncSelection(); changed = true }
    if (this.transition) { this.stepTransition(now); changed = true }
    if (this.controls.update()) changed = true
    if (this.dmxDirty || this.animating) { this.updateFixtures(now); changed = true }

    if (now - this.fpsStart >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsStart))
      this.frames = 0
      this.fpsStart = now
    }
    if (!changed) return
    const size = this.renderer.getSize(_size)
    if (size.x < 2 || size.y < 2) return
    this.renderer.render(this.scene, this.camera)
    this.needsRender = false
    this.lastRender = now
    this.frames++
  }

  private stepTransition(now: number): void {
    const t = this.transition!
    const k = Math.min(1, (now - t.start) / t.duration)
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
    this.camera.position.lerpVectors(t.fromPos, t.toPos, e)
    this.controls.target.lerpVectors(t.fromTarget, t.toTarget, e)
    if (k >= 1) this.transition = null
  }

  private resize(): void {
    const el = this.container
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight
    if (w < 2 || h < 2) return
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatio))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (!this.cameraPlaced) this.setCameraPreset('perspective', false)
    this.needsRender = true
  }

  // ---------------------------------------------------------------- scene sync

  private rebuildRoom(): void {
    const vis = useVisualizerStore.getState()
    if (this.room) {
      this.scene.remove(this.room)
      disposeObject(this.room)
    }
    const room = buildRoom(vis.roomConfig)
    setRoomVisibility(room, { walls: vis.showRoom, grid: vis.showGrid })
    this.scene.add(room)
    this.room = room
    const { width: w, depth: d, height: h } = vis.roomConfig
    this.ctx.boundsMin.set(-w / 2 - 0.03, -0.05, -d / 2 - 0.03)
    this.ctx.boundsMax.set(w / 2 + 0.03, h + 0.03, d / 2 + 0.03)
    this.roomDirty = false
    this.dmxDirty = true
  }

  private syncFixtures(): void {
    const { patch, fixtures } = usePatchStore.getState()
    const room = useVisualizerStore.getState().roomConfig
    const defs = new Map(fixtures.map((f) => [f.id, f]))
    const seen = new Set<string>()
    patch.forEach((entry, i) => {
      const def = defs.get(entry.fixtureDefId)
      const spec = describeFixture(entry, def)
      const signature = `${spec.kind}|${spec.wash}|${spec.cellCount}|${spec.length}|${spec.emits}|${this.profile.coneSegments}`
      let rec = this.records.get(entry.id)
      if (rec && rec.signature !== signature) {
        // Mode / definition changed (cell count, shape…): rebuild
        disposeFixtureObjects(rec.objects)
        this.records.delete(entry.id)
        rec = undefined
      }
      if (!rec) {
        const objects = createFixtureObjects(spec, this.cache, this.profile.coneSegments)
        objects.hit.userData.fixtureId = entry.id
        this.fixtureLayer.add(objects.group)
        this.worldLayer.add(objects.pool, objects.marker)
        rec = { objects, signature, entry, def, number: i + 1 }
        this.records.set(entry.id, rec)
        this.selectionDirty = true
      }
      rec.objects.spec = spec // beam angle etc. apply without a rebuild
      if (rec.number !== i + 1) this.selectionDirty = true
      rec.entry = entry
      rec.def = def
      rec.number = i + 1
      this.place(rec, fixturePosition(entry, i, patch.length, room))
      seen.add(entry.id)
    })
    for (const [id, rec] of this.records) {
      if (!seen.has(id)) {
        disposeFixtureObjects(rec.objects)
        this.records.delete(id)
      }
    }
    this.hitMeshes = [...this.records.values()].map((r) => r.objects.hit)
    this.structureDirty = false
    this.dmxDirty = true
  }

  private place(rec: FixtureRecord, pos: Vec3): void {
    const { entry, objects } = rec
    const g = objects.group
    g.position.set(pos.x, pos.y, pos.z)
    if (entry.rotation3D) {
      g.rotation.set(entry.rotation3D.rx, entry.rotation3D.ry, entry.rotation3D.rz)
    } else {
      const rest = restDirection(entry.mountingLocation)
      const lean = leanDirection(entry.mountingLocation)
      _v1.set(rest.x, rest.y, rest.z)
      _v2.set(lean.x, lean.y, lean.z)
      _q1.setFromUnitVectors(DOWN, _v1)
      _q2.setFromAxisAngle(_v3.crossVectors(_v1, _v2).normalize(), THREE.MathUtils.degToRad(entry.mountingAngle ?? 0))
      _q3.setFromAxisAngle(UP, THREE.MathUtils.degToRad(entry.mountingPan ?? 0))
      g.quaternion.copy(_q3).multiply(_q2).multiply(_q1)
    }
    const floorMount = entry.mountingLocation === 'floor'
    objects.marker.position.set(pos.x, 0, pos.z)
    objects.ring.position.y = 0.02
    objects.dropLine.scale.set(1, Math.max(0.01, pos.y), 1)
    objects.label.position.y = floorMount ? pos.y + 0.55 : pos.y + 0.16
  }

  private syncSelection(): void {
    const ids = new Set(usePatchStore.getState().selectedFixtureIds)
    const showLabels = useVisualizerStore.getState().showLabels
    for (const [id, rec] of this.records) {
      const sel = ids.has(id)
      setFixtureSelected(rec.objects, sel)
      drawFixtureLabel(rec.objects, String(rec.number), sel)
      rec.objects.label.visible = showLabels || sel
    }
    this.selectionDirty = false
  }

  private updateFixtures(now: number): void {
    const dmx = useDmxStore.getState()
    const vis = useVisualizerStore.getState()
    const ctx = this.ctx
    ctx.now = now
    ctx.gm = dmx.grandMaster / 255
    ctx.blackout = dmx.blackout
    ctx.blinder = dmx.blinder
    ctx.strobeDark = dmx.strobe && !dmx._strobePhase
    ctx.showBeams = vis.showBeams
    ctx.haze = vis.hazeEnabled ? 1 : 0.3
    ctx.room = vis.roomConfig
    ctx.walls = vis.showRoom
    let animating = false
    for (const rec of this.records.values()) {
      const ch = resolveChannels(rec.entry, rec.def, dmx.values)
      const cells = rec.objects.spec.cellCount > 1 ? resolveCellColors(rec.entry, rec.def, dmx.values) : null
      if (updateFixture(rec.objects, ch, cells, rec.entry, ctx)) animating = true
    }
    this.assignLights()
    this.animating = animating
    this.dmxDirty = false
  }

  // ---------------------------------------------------------------- lights

  private applyAmbient(level: number): void {
    // House lights: 0 = dark room (beams only), 1 = work lights.
    // ×π: a Lambert surface under intensity π shows its own colour.
    this.hemi.intensity = Math.PI * (0.3 + level * 2.2)
  }

  /** A fixed pool of real spot lights (fixed count → no shader recompiles while running) */
  private ensureLights(): void {
    const want = this.profile.lights
    const shadows = useVisualizerStore.getState().shadowsEnabled
    while (this.lights.length > want) {
      const l = this.lights.pop()!
      l.dispose()
      l.removeFromParent()
      l.target.removeFromParent()
    }
    while (this.lights.length < want) {
      const l = new THREE.SpotLight(0xffffff, 0, 0, 0.5, 0.85, 2)
      l.castShadow = shadows
      l.shadow.mapSize.set(this.profile.shadowSize, this.profile.shadowSize)
      l.shadow.bias = -0.0006
      l.shadow.camera.near = 0.2
      this.scene.add(l, l.target)
      this.lights.push(l)
    }
    for (const l of this.lights) {
      if (l.shadow.mapSize.x !== this.profile.shadowSize) {
        l.shadow.mapSize.set(this.profile.shadowSize, this.profile.shadowSize)
        l.shadow.map?.dispose()
        l.shadow.map = null
      }
    }
  }

  private assignLights(): void {
    if (this.lights.length === 0) return
    const ranked = this.ranked
    ranked.length = 0
    for (const rec of this.records.values()) if (rec.objects.out.intensity > 0.02) ranked.push(rec)
    ranked.sort((a, b) => b.objects.out.intensity - a.objects.out.intensity)
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i]
      const rec = ranked[i]
      if (!rec) { l.intensity = 0; continue }
      const out = rec.objects.out
      l.position.copy(out.origin)
      l.target.position.copy(out.origin).addScaledVector(out.dir, out.length)
      l.target.updateMatrixWorld()
      l.angle = Math.min(Math.PI / 2.2, out.angle * 1.6 + 0.1)
      l.color.copy(out.color)
      l.intensity = out.intensity * 2.2 * out.length * out.length
    }
  }

  private applyShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on
    for (const l of this.lights) l.castShadow = on
    this.invalidate()
  }

  private applyQuality(q: VisualizerQuality): void {
    const prev = this.profile
    this.profile = QUALITY_PROFILES[q]
    this.ensureLights()
    if (prev.coneSegments !== this.profile.coneSegments) this.structureDirty = true
    this.resize()
    this.dmxDirty = true
    this.invalidate()
  }

  // ---------------------------------------------------------------- input

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.pointer = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
    this.transition = null
  }

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointer
    this.pointer = null
    if (!p || p.id !== e.pointerId) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.t > 600) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(_ndc, this.camera)
    const hit = this.raycaster.intersectObjects(this.hitMeshes, false)[0]
    const id = hit?.object.userData.fixtureId as string | undefined
    if (!id) return
    const now = performance.now()
    if (this.lastPick.id === id && now - this.lastPick.t < 350) {
      this.focusFixture(id)
      this.lastPick = { id: '', t: 0 }
      return
    }
    this.lastPick = { id, t: now }
    const touch = useUiStore.getState().density === 'touch' || e.pointerType === 'touch'
    usePatchStore.getState().selectFixture(id, touch || e.ctrlKey || e.metaKey || e.shiftKey)
  }

  private onVisibility = (): void => {
    if (document.hidden) this.stop()
    else if (this.container) {
      this.needsRender = true
      this.start()
    }
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault()
    this.stop()
    this.status = 'lost'
    for (const fn of this.statusListeners) fn('lost')
  }

  /** Room-config helper for UI code */
  get roomConfig(): RoomConfig {
    return useVisualizerStore.getState().roomConfig
  }
}

const _size = new THREE.Vector2()
const _ndc = new THREE.Vector2()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()
