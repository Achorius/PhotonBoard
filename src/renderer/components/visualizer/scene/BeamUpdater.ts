// ============================================================
// Per-frame fixture update from DMX: colour, intensity, pan/tilt, zoom,
// gobo, strobe → beam cones, lens, glare and the light pool where the
// beam lands. No React, no allocation in the hot path, and never a
// material reconfiguration (gobo = uniform texture swap), so nothing
// recompiles while a show runs.
// ============================================================

import * as THREE from 'three'
import type { FixtureDefinition, PatchEntry, RoomConfig } from '@shared/types'
import type { ResolvedChannels } from '@renderer/lib/dmx-channel-resolver'
import { dmxToPanDeg, dmxToTiltDeg, getEffectiveColor } from '@renderer/lib/dmx-channel-resolver'
import { dmxToGoboIndex, getGoboTexture, getOpenBeamTexture } from '@renderer/lib/gobo-textures'
import type { FixtureObjects } from './FixtureModel'
import { palette } from '@renderer/components/ui/tokens'
import { rayToRoom } from './layout-math'

export interface CellColor {
  r: number // 0-1
  g: number
  b: number
  dimmer: number // 0-255
}

export interface FrameContext {
  /** performance.now() */
  now: number
  /** Grand master 0-1 */
  gm: number
  blackout: boolean
  blinder: boolean
  /** Master strobe currently in its dark phase */
  strobeDark: boolean
  showBeams: boolean
  /** Beam visibility factor: haze on ≈ 1, clean air ≈ 0.3 */
  haze: number
  room: RoomConfig
  /** Walls / ceiling stop beams (room visible) */
  walls: boolean
  boundsMin: THREE.Vector3
  boundsMax: THREE.Vector3
}

export interface FixtureFlags {
  panInvert?: boolean
  tiltInvert?: boolean
}

const LENS_IDLE = new THREE.Color(palette.surface2)
const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _n = new THREE.Vector3()
const _u = new THREE.Vector3()
const _v = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _color = { r: 0, g: 0, b: 0 }

/** Per-cell colours of a pixel fixture (null when the mode has no pixel layout) */
export function resolveCellColors(entry: PatchEntry, def: FixtureDefinition | undefined, values: number[][]): CellColor[] | null {
  const layout = def?.modes.find((m) => m.name === entry.modeName)?.pixelLayout
  if (!layout || layout.cellCount < 2) return null
  const uni = values[entry.universe]
  const cells: CellColor[] = []
  for (const cell of layout.cells) {
    let r = 0, g = 0, b = 0, dim = 255
    cell.channelNames.forEach((name, i) => {
      const n = name.toLowerCase()
      const v = uni?.[entry.address - 1 + cell.channelOffset + i] ?? 0
      if (n.includes('red')) r = v / 255
      else if (n.includes('green')) g = v / 255
      else if (n.includes('blue')) b = v / 255
      else if (n.includes('white')) { r = Math.max(r, v / 255); g = Math.max(g, v / 255); b = Math.max(b, v / 255) }
      else if (n.includes('dimmer') || n.includes('intensity')) dim = v
    })
    cells.push({ r, g, b, dimmer: dim })
  }
  if (entry.pixelInvert) cells.reverse()
  return cells
}

/**
 * Update one fixture. Returns true when it animates on its own (strobe,
 * gobo rotation) and needs frames even if DMX does not change.
 */
export function updateFixture(
  o: FixtureObjects,
  ch: ResolvedChannels,
  cells: CellColor[] | null,
  flags: FixtureFlags,
  ctx: FrameContext
): boolean {
  let animating = false
  const spec = o.spec

  // ---- Colour & intensity ----
  // Colour at full intensity (the dimmer is applied through `master`). Keep the
  // real hasDimmerChannel: a dimmer-less RGB fixture with all emitters at 0 is dark.
  if (ctx.blinder) {
    _color.r = _color.g = _color.b = 1
  } else {
    const c = getEffectiveColor({ ...ch, dimmer: 255 })
    _color.r = c.r; _color.g = c.g; _color.b = c.b
  }

  // Fixture's own strobe / shutter
  let shutterOpen = true
  const strobeValue = ch.strobe > 10 ? ch.strobe : ch.shutter >= 64 && ch.shutter <= 200 ? ch.shutter : 0
  if (strobeValue > 10 && !ctx.blinder) {
    animating = true
    shutterOpen = Math.sin(ctx.now * (strobeValue / 255) * 0.05) > 0
  }
  const master = ctx.blinder ? 1
    : ctx.blackout || ctx.strobeDark || !shutterOpen ? 0
    : ctx.gm * (ch.hasDimmerChannel ? ch.dimmer / 255 : 1)

  // Cells (pixel bars): per-cell colour, overall = weighted average / brightest cell
  let pr = _color.r, pg = _color.g, pb = _color.b
  let intensity = pr + pg + pb > 0.004 ? master : 0
  if (cells) {
    let sr = 0, sg = 0, sb = 0, wsum = 0, peak = 0
    for (const c of cells) {
      const ci = ctx.blinder ? 1 : c.r + c.g + c.b > 0 ? c.dimmer / 255 : 0
      peak = Math.max(peak, ci)
      sr += c.r * ci; sg += c.g * ci; sb += c.b * ci; wsum += ci
    }
    if (ctx.blinder) { pr = pg = pb = 1 } else if (wsum > 0) { pr = sr / wsum; pg = sg / wsum; pb = sb / wsum }
    intensity = peak * master
  }

  // ---- Moving head pan / tilt ----
  if (o.yoke && o.head) {
    let pan = dmxToPanDeg(ch.pan, ch.panFine)
    let tilt = dmxToTiltDeg(ch.tilt, ch.tiltFine)
    if (flags.panInvert) pan = -pan
    if (flags.tiltInvert) tilt = -tilt
    o.yoke.rotation.y = THREE.MathUtils.degToRad(pan)
    o.head.rotation.x = -THREE.MathUtils.degToRad(tilt)
  }

  // ---- Zoom → beam spread ----
  const zoomFactor = ch.zoom !== 128 ? 0.5 + ch.zoom / 255 : 1
  const fullAngle = Math.min(100, spec.beamAngle * zoomFactor)
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fullAngle / 2))

  // ---- Gobo ----
  const goboIndex = dmxToGoboIndex(ch.gobo)
  let goboRot = 0
  if (goboIndex > 0 && ch.goboRotation > 0) {
    animating = true
    goboRot = (ctx.now / 1000) * (ch.goboRotation / 255) * 4
  }

  // ---- World ray of the beam ----
  o.group.updateMatrixWorld(true)
  o.emitter.getWorldPosition(_origin)
  _dir.set(0, -1, 0).transformDirection(o.emitter.matrixWorld)
  const hit = rayToRoom(_origin, _dir, ctx.room, ctx.walls)
  const maxLen = Math.hypot(ctx.room.width, ctx.room.depth, ctx.room.height) * 1.2
  const length = Math.max(0.3, Math.min(maxLen, hit ? hit.t : maxLen))
  const radius = length * tanHalf

  // ---- Beams ----
  // Many parallel cells add up: keep a pixel bar about as bright as one beam
  const beamOpacity = (0.24 * ctx.haze) / (1 + (o.beams.length - 1) * 0.3)
  for (let i = 0; i < o.beams.length; i++) {
    const beam = o.beams[i]
    const mat = o.beamMaterials[i]
    let br = pr, bg = pg, bb = pb, bi = intensity
    if (cells && i < cells.length) {
      const c = cells[i]
      if (!ctx.blinder) { br = c.r; bg = c.g; bb = c.b }
      bi = ctx.blinder ? 1 : br + bg + bb > 0 ? (c.dimmer / 255) * master : 0
    }
    const lm = o.cellLensMaterials[i]
    if (lm) setLens(lm, br, bg, bb, bi)
    const on = ctx.showBeams && bi > 0.004
    beam.visible = on
    if (!on) continue
    beam.scale.set(radius, length, radius)
    mat.uniforms.uColor.value.set(br, bg, bb)
    mat.uniforms.uOpacity.value = bi * beamOpacity * (goboIndex > 0 ? 0.85 : 1)
    mat.uniforms.uLength.value = length
    mat.uniforms.uGoboIndex.value = goboIndex
    mat.uniforms.uGoboRotation.value = goboRot
  }

  // ---- Lens & glare ----
  if (!cells) setLens(o.lensMaterial, pr, pg, pb, intensity)
  if (o.flare) {
    const on = intensity > 0.02
    o.flare.visible = on
    if (on) {
      const fm = o.flare.material
      fm.color.setRGB(pr, pg, pb, THREE.SRGBColorSpace)
      fm.opacity = Math.min(1, 0.25 + intensity * 0.85)
      const s = (spec.wash ? 0.75 : spec.kind === 'strobe' || spec.kind === 'blinder' ? 0.9 : 0.55) * (0.6 + 0.4 * intensity)
      o.flare.scale.set(s, s, 1)
    }
  }

  // ---- Light pool where the beam lands ----
  const pool = o.pool
  if (hit && intensity > 0.004 && spec.emits) {
    _n.set(hit.normal.x, hit.normal.y, hit.normal.z)
    const cosI = Math.max(0.33, Math.abs(_dir.dot(_n)))
    // Stretch axis: the beam direction projected on the surface
    _u.copy(_dir).addScaledVector(_n, -_dir.dot(_n))
    if (_u.lengthSq() < 1e-6) {
      _u.set(1, 0, 0).transformDirection(o.emitter.matrixWorld)
      _u.addScaledVector(_n, -_u.dot(_n))
      if (_u.lengthSq() < 1e-6) _u.set(_n.y, _n.z, _n.x)
    }
    _u.normalize()
    _v.crossVectors(_n, _u)
    _m.makeBasis(_u, _v, _n)
    pool.quaternion.setFromRotationMatrix(_m)
    pool.position.copy(_origin).addScaledVector(_dir, hit.t).addScaledVector(_n, 0.012)
    let sx = (2 * radius) / cosI
    let sy = 2 * radius
    if (spec.kind === 'strip' || spec.kind === 'blinder') {
      _axis.set(1, 0, 0).transformDirection(o.emitter.matrixWorld)
      if (Math.abs(_axis.dot(_u)) > 0.7) sx += spec.length
      else sy += spec.length
    }
    pool.scale.set(sx, sy, 1)
    const mat = o.poolMaterial
    const goboTex = goboIndex > 0 ? getGoboTexture(goboIndex) : null
    mat.uniforms.uMap.value = goboTex ?? getOpenBeamTexture()
    mat.uniforms.uSoftness.value = goboTex ? 0.06 : 0.4
    mat.uniforms.uRotation.value = goboRot
    mat.uniforms.uColor.value.set(pr, pg, pb)
    // Same flux over a bigger area = dimmer pool (full brightness up to ~1.3 m radius)
    const area = radius * radius / cosI
    mat.uniforms.uIntensity.value = (goboTex ? 0.6 : 0.8) * intensity * Math.min(1, Math.max(0.08, 1.8 / (1 + area * 0.45)))
    mat.uniforms.uMin.value.copy(ctx.boundsMin)
    mat.uniforms.uMax.value.copy(ctx.boundsMax)
    pool.visible = true
  } else {
    pool.visible = false
  }

  // ---- Outputs for the real-light pool ----
  o.out.intensity = intensity
  o.out.color.setRGB(pr, pg, pb, THREE.SRGBColorSpace)
  o.out.origin.copy(_origin)
  o.out.dir.copy(_dir)
  o.out.angle = Math.atan(tanHalf)
  o.out.length = length
  return animating
}

function setLens(mat: THREE.MeshBasicMaterial, r: number, g: number, b: number, intensity: number): void {
  if (intensity > 0.004 && r + g + b > 0) {
    const k = 0.3 + 0.7 * Math.min(1, intensity)
    mat.color.setRGB(r * k, g * k, b * k, THREE.SRGBColorSpace)
  } else {
    mat.color.copy(LENS_IDLE)
  }
}
