// ============================================================
// Three.js objects for one patched fixture.
//
// Geometries come from a shared cache (one copy per shape for the whole
// rig); each fixture owns only its materials, so removing a fixture
// disposes its materials and leaves the cache alone.
//
// Local frame: the group origin is the hanging point; at rest the beam
// leaves `emitter` along its local -Y (straight down for a ceiling mount).
// ============================================================

import * as THREE from 'three'
import { palette, withAlpha } from '@renderer/components/ui/tokens'
import { getGlowTexture, getOpenBeamTexture } from '@renderer/lib/gobo-textures'
import { createBeamMaterial, createPoolMaterial } from './shaders'
import type { FixtureSpec } from './layout-math'
import { disposeObject } from './dispose'

/** Geometry cache shared by every fixture of one engine */
export class GeometryCache {
  private map = new Map<string, THREE.BufferGeometry>()

  get<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.map.get(key) as T | undefined
    if (!g) {
      g = make()
      g.userData.shared = true
      this.map.set(key, g)
    }
    return g
  }

  dispose(): void {
    for (const g of this.map.values()) g.dispose()
    this.map.clear()
  }
}

export interface FixtureObjects {
  spec: FixtureSpec
  /** Root, placed at the fixture position and oriented by its mount */
  group: THREE.Group
  /** Moving heads: pan (local Y) and tilt (local X) pivots */
  yoke: THREE.Object3D | null
  head: THREE.Object3D | null
  /** Beam origin, beam along local -Y */
  emitter: THREE.Object3D
  bodyMaterial: THREE.MeshLambertMaterial
  lensMaterial: THREE.MeshBasicMaterial
  /** One beam per cell (or one) — children of the emitter */
  beams: THREE.Mesh[]
  beamMaterials: THREE.ShaderMaterial[]
  /** Per-cell lens materials (multi-cell fixtures) */
  cellLensMaterials: THREE.MeshBasicMaterial[]
  /** X offset of each beam on the emitter (strips) */
  beamOffsets: number[]
  /** Light pool where the beam lands — world space */
  pool: THREE.Mesh
  poolMaterial: THREE.ShaderMaterial
  /** Lens glare — child of the emitter */
  flare: THREE.Sprite | null
  /** World-space markers: selection ring + drop line + number label */
  marker: THREE.Group
  ring: THREE.Mesh
  dropLine: THREE.Line
  label: THREE.Sprite
  labelCanvas: HTMLCanvasElement
  labelTexture: THREE.CanvasTexture
  labelKey: string
  /** Invisible, generous pick volume (fingers) */
  hit: THREE.Mesh
  /** Outputs of the last update, read by the light pool */
  out: { intensity: number; color: THREE.Color; origin: THREE.Vector3; dir: THREE.Vector3; angle: number; length: number }
}

const BODY_COLOR = new THREE.Color(palette.fgDisabled)
const LENS_IDLE = new THREE.Color(palette.surface2)

function box(cache: GeometryCache, w: number, h: number, d: number) {
  return cache.get(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d))
}

function cylinder(cache: GeometryCache, rt: number, rb: number, h: number, seg: number) {
  return cache.get(`cyl:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg))
}

/** Lens disc facing local -Y */
function lensDisc(cache: GeometryCache, r: number) {
  return cache.get(`lens:${r}`, () => new THREE.CircleGeometry(r, 24).rotateX(Math.PI / 2))
}

/** Lens rectangle facing local -Y */
function lensRect(cache: GeometryCache, w: number, d: number) {
  return cache.get(`lensrect:${w}:${d}`, () => new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2))
}

/** Unit open cone: apex at the origin, base radius 1 at y = -1 */
export function unitCone(cache: GeometryCache, segments: number) {
  return cache.get(`cone:${segments}`, () => new THREE.ConeGeometry(1, 1, segments, 1, true).translate(0, -0.5, 0))
}

export function createFixtureObjects(spec: FixtureSpec, cache: GeometryCache, coneSegments: number): FixtureObjects {
  const group = new THREE.Group()
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: BODY_COLOR, emissive: new THREE.Color(0, 0, 0) })
  const lensMaterial = new THREE.MeshBasicMaterial({ color: LENS_IDLE.clone() })
  const addBody = (parent: THREE.Object3D, geo: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, bodyMaterial)
    m.position.set(x, y, z)
    m.castShadow = true
    parent.add(m)
    return m
  }

  let yoke: THREE.Object3D | null = null
  let head: THREE.Object3D | null = null
  const emitter = new THREE.Object3D()
  const cellLensMaterials: THREE.MeshBasicMaterial[] = []
  let beamOffsets: number[] = [0]
  let hitSize: [number, number, number] = [0.5, 0.5, 0.5]
  let hitY = -0.2

  switch (spec.kind) {
    case 'moving-head': {
      addBody(group, box(cache, 0.34, 0.12, 0.27), 0, -0.06)
      yoke = new THREE.Object3D()
      yoke.position.y = -0.12
      group.add(yoke)
      addBody(yoke, box(cache, 0.4, 0.04, 0.09), 0, -0.02)
      addBody(yoke, box(cache, 0.035, 0.3, 0.08), -0.185, -0.17)
      addBody(yoke, box(cache, 0.035, 0.3, 0.08), 0.185, -0.17)
      head = new THREE.Object3D()
      head.position.y = -0.27
      yoke.add(head)
      if (spec.wash) {
        addBody(head, cylinder(cache, 0.1, 0.15, 0.24, 20), 0, 0)
        const lens = new THREE.Mesh(lensDisc(cache, 0.13), lensMaterial)
        lens.position.y = -0.121
        head.add(lens)
        emitter.position.y = -0.122
      } else {
        addBody(head, cylinder(cache, 0.09, 0.12, 0.34, 20), 0, 0.02)
        const lens = new THREE.Mesh(lensDisc(cache, 0.095), lensMaterial)
        lens.position.y = -0.151
        head.add(lens)
        emitter.position.y = -0.152
      }
      head.add(emitter)
      hitSize = [0.5, 0.6, 0.45]
      hitY = -0.25
      break
    }
    case 'strip': {
      const L = spec.length
      addBody(group, box(cache, L, 0.07, 0.1), 0, -0.035)
      emitter.position.y = -0.0715
      group.add(emitter)
      const n = spec.cellCount > 1 ? spec.cellCount : Math.max(2, Math.round(L * 4))
      const pitch = (L * 0.94) / n
      beamOffsets = Array.from({ length: n }, (_, i) => -((n - 1) * pitch) / 2 + i * pitch)
      for (const x of beamOffsets) {
        const mat = new THREE.MeshBasicMaterial({ color: LENS_IDLE.clone() })
        cellLensMaterials.push(mat)
        const cell = new THREE.Mesh(lensRect(cache, +(pitch * 0.82).toFixed(3), 0.06), mat)
        cell.position.set(x, -0.0705, 0)
        group.add(cell)
      }
      hitSize = [L + 0.1, 0.3, 0.35]
      hitY = -0.05
      break
    }
    case 'strobe':
    case 'blinder': {
      const w = spec.kind === 'blinder' ? 0.5 : 0.42
      const d = spec.kind === 'blinder' ? 0.26 : 0.16
      addBody(group, box(cache, w, 0.16, d), 0, -0.08)
      const lens = new THREE.Mesh(lensRect(cache, w * 0.86, d * 0.7), lensMaterial)
      lens.position.y = -0.161
      group.add(lens)
      emitter.position.y = -0.162
      group.add(emitter)
      hitSize = [w + 0.1, 0.35, 0.4]
      hitY = -0.08
      break
    }
    case 'hazer': {
      addBody(group, box(cache, 0.45, 0.28, 0.3), 0, -0.14)
      addBody(group, cylinder(cache, 0.05, 0.05, 0.08, 12), 0.12, -0.32)
      emitter.position.y = -0.3
      group.add(emitter)
      hitSize = [0.55, 0.45, 0.45]
      hitY = -0.15
      break
    }
    default: {
      // PAR can on a yoke-less hanging clamp
      addBody(group, box(cache, 0.04, 0.08, 0.04), 0, -0.04)
      addBody(group, cylinder(cache, 0.12, 0.14, 0.26, 18), 0, -0.21)
      const lens = new THREE.Mesh(lensDisc(cache, 0.125), lensMaterial)
      lens.position.y = -0.341
      group.add(lens)
      emitter.position.y = -0.342
      group.add(emitter)
      hitSize = [0.45, 0.5, 0.45]
      hitY = -0.2
    }
  }

  // ---- Beams ----
  const beams: THREE.Mesh[] = []
  const beamMaterials: THREE.ShaderMaterial[] = []
  if (spec.emits) {
    const cone = unitCone(cache, coneSegments)
    for (const x of beamOffsets) {
      const mat = createBeamMaterial()
      const beam = new THREE.Mesh(cone, mat)
      beam.position.x = x
      beam.renderOrder = 100
      beam.visible = false
      beam.frustumCulled = false // scaled every frame; bounds of the unit cone are meaningless
      emitter.add(beam)
      beams.push(beam)
      beamMaterials.push(mat)
    }
  }

  // ---- Light pool (world space, managed by the engine) ----
  const poolMaterial = createPoolMaterial(getOpenBeamTexture())
  const pool = new THREE.Mesh(cache.get('pool', () => new THREE.PlaneGeometry(1, 1)), poolMaterial)
  pool.visible = false
  pool.renderOrder = 50
  pool.matrixAutoUpdate = true

  // ---- Lens glare ----
  let flare: THREE.Sprite | null = null
  if (spec.emits) {
    flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }))
    flare.position.y = -0.02
    flare.renderOrder = 120
    flare.visible = false
    emitter.add(flare)
  }

  // ---- Pick volume ----
  const hitMat = new THREE.MeshBasicMaterial()
  hitMat.visible = false
  const hit = new THREE.Mesh(box(cache, ...hitSize), hitMat)
  hit.position.y = hitY
  group.add(hit)

  // ---- Markers: selection ring on the floor, drop line, number label ----
  const marker = new THREE.Group()
  const ring = new THREE.Mesh(
    cache.get('ring', () => new THREE.RingGeometry(0.26, 0.34, 40).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.infoFg), transparent: true, opacity: 0.9, depthWrite: false })
  )
  ring.visible = false
  ring.renderOrder = 60
  marker.add(ring)
  const dropLine = new THREE.Line(
    cache.get('drop', () => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)])),
    new THREE.LineBasicMaterial({ color: new THREE.Color(palette.infoFg), transparent: true, opacity: 0.55, depthWrite: false })
  )
  dropLine.visible = false
  marker.add(dropLine)

  const labelCanvas = document.createElement('canvas')
  labelCanvas.width = 128
  labelCanvas.height = 64
  const labelTexture = new THREE.CanvasTexture(labelCanvas)
  labelTexture.colorSpace = THREE.SRGBColorSpace
  labelTexture.minFilter = THREE.LinearFilter
  labelTexture.generateMipmaps = false
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: labelTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false
  }))
  label.center.set(0.5, 0)
  label.scale.set(0.064, 0.032, 1)
  label.renderOrder = 200
  marker.add(label)

  return {
    spec,
    group,
    yoke,
    head,
    emitter,
    bodyMaterial,
    lensMaterial,
    beams,
    beamMaterials,
    cellLensMaterials,
    beamOffsets,
    pool,
    poolMaterial,
    flare,
    marker,
    ring,
    dropLine,
    label,
    labelCanvas,
    labelTexture,
    labelKey: '',
    hit,
    out: { intensity: 0, color: new THREE.Color(), origin: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), angle: 0.4, length: 5 }
  }
}

/** Redraw the number label (only when number / selection changed) */
export function drawFixtureLabel(objects: FixtureObjects, text: string, selected: boolean): void {
  const key = `${text}|${selected ? 1 : 0}`
  if (objects.labelKey === key) return
  objects.labelKey = key
  const ctx = objects.labelCanvas.getContext('2d')
  if (!ctx) return
  const W = objects.labelCanvas.width, H = objects.labelCanvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.font = '600 34px "JetBrains Mono Variable", ui-monospace, monospace'
  const tw = Math.min(W - 8, ctx.measureText(text).width + 26)
  const x = (W - tw) / 2
  ctx.fillStyle = selected ? palette.info : withAlpha(palette.surface1, 0.85)
  ctx.strokeStyle = selected ? palette.infoFg : palette.lineStrong
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x, 8, tw, H - 16, 10)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = palette.fgPrimary
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, W / 2, H / 2 + 1)
  objects.labelTexture.needsUpdate = true
}

export function setFixtureSelected(objects: FixtureObjects, selected: boolean): void {
  objects.bodyMaterial.emissive.set(selected ? palette.info : palette.surface0)
  objects.bodyMaterial.emissiveIntensity = selected ? 0.55 : 0
  objects.ring.visible = selected
  objects.dropLine.visible = selected
}

/** Free the fixture's own GPU resources (shared geometry / textures survive) */
export function disposeFixtureObjects(objects: FixtureObjects): void {
  objects.group.removeFromParent()
  objects.pool.removeFromParent()
  objects.marker.removeFromParent()
  disposeObject(objects.group)
  disposeObject(objects.pool)
  disposeObject(objects.marker)
}
