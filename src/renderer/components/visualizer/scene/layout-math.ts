// ============================================================
// Pure layout maths shared by the 3D scene, the 2D plan, the
// section view and the PDF plot — one source of truth for where a
// fixture is and where it points.
//
// World axes (metres): origin = centre of the room floor.
//   +X = stage right as seen from the audience (screen right in plan)
//   +Y = up
//   +Z = upstage (towards the back wall); the audience is at -Z.
//
// Static fixture aim (PatchEntry.mountingAngle / mountingPan):
//   tilt (mountingAngle) 0° = rest direction of the mount (ceiling: straight
//   down, floor: straight up, walls: horizontal into the room).
//   Positive tilt leans the beam towards upstage (+Z) for ceiling/floor
//   mounts and downwards for wall mounts. Direction (mountingPan) then
//   rotates the aim around the vertical axis.
// ============================================================

import type { FixtureDefinition, MountingLocation, PatchEntry, RoomConfig, TrussBar } from '@shared/types'

export type Vec3 = { x: number; y: number; z: number }

/** Visual family used by the 3D models and plan symbols */
export type FixtureKind = 'moving-head' | 'strip' | 'strobe' | 'hazer' | 'blinder' | 'par'

export interface FixtureSpec {
  kind: FixtureKind
  /** Moving-head sub-style */
  wash: boolean
  /** Beam spread in degrees (patch override, else lens max, else 25) */
  beamAngle: number
  /** Number of individually coloured cells (1 = single source) */
  cellCount: number
  /** Long dimension in metres for strips / blinders */
  length: number
  /** Emits a beam at all (hazers do not) */
  emits: boolean
}

export function fixtureKind(def: FixtureDefinition | undefined): FixtureKind {
  const c = def?.categories ?? []
  if (c.includes('Moving Head') || c.includes('Scanner')) return 'moving-head'
  if (c.some((x) => x === 'Pixel Bar' || x === 'Batten' || x === 'Strip' || x === 'Matrix')) return 'strip'
  if (c.includes('Fog') || c.includes('Hazer') || c.includes('Smoke')) return 'hazer'
  if (c.includes('Strobe')) return 'strobe'
  if (c.includes('Blinder')) return 'blinder'
  return 'par'
}

export function describeFixture(entry: PatchEntry, def: FixtureDefinition | undefined): FixtureSpec {
  const kind = fixtureKind(def)
  const mode = def?.modes.find((m) => m.name === entry.modeName)
  const lensMax = def?.physical?.lens?.degreesMinMax?.[1]
  const defaultAngle = kind === 'strobe' || kind === 'blinder' ? 60 : kind === 'strip' ? 35 : 25
  const dims = def?.physical?.dimensions
  const length = kind === 'strip'
    ? clamp((dims?.[0] ?? 1000) / 1000, 0.3, 3)
    : kind === 'blinder' ? 0.5 : 0
  return {
    kind,
    wash: kind === 'moving-head' && /wash|aura|beam/i.test(def?.name ?? ''),
    beamAngle: clamp(entry.beamAngle ?? lensMax ?? defaultAngle, 1, 120),
    cellCount: Math.max(1, mode?.pixelLayout?.cellCount ?? 1),
    length,
    emits: kind !== 'hazer'
  }
}

export function defaultHeight(mount: MountingLocation | undefined, roomHeight: number): number {
  switch (mount) {
    case 'floor': return 0.15
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return roomHeight * 0.6
    default: return roomHeight - 0.05
  }
}

/** Grid placement for fixtures that were never positioned (same rule everywhere) */
export function autoPosition(index: number, count: number, room: Pick<RoomConfig, 'width' | 'depth' | 'height'>, mount?: MountingLocation): Vec3 {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.5)))
  const rows = Math.max(1, Math.ceil(count / cols))
  const colCount = Math.min(cols, count)
  const col = index % cols
  const row = Math.floor(index / cols)
  let x = colCount > 1 ? (col / (colCount - 1) - 0.5) * room.width * 0.8 : 0
  let z = rows > 1 ? (row / (rows - 1) - 0.5) * room.depth * 0.6 : 0
  const y = defaultHeight(mount, room.height)
  if (mount === 'wall-left') x = -room.width / 2 + 0.1
  else if (mount === 'wall-right') x = room.width / 2 - 0.1
  else if (mount === 'wall-back') z = room.depth / 2 - 0.1
  return { x, y, z }
}

/** Effective world position of a patched fixture (explicit position or auto grid) */
export function fixturePosition(entry: PatchEntry, index: number, count: number, room: Pick<RoomConfig, 'width' | 'depth' | 'height'>): Vec3 {
  if (entry.position3D) return entry.position3D
  return autoPosition(index, count, room, entry.mountingLocation)
}

/** Rest beam direction of a mount (unit vector) */
export function restDirection(mount: MountingLocation | undefined): Vec3 {
  switch (mount) {
    case 'floor': return { x: 0, y: 1, z: 0 }
    case 'wall-left': return { x: 1, y: 0, z: 0 }
    case 'wall-right': return { x: -1, y: 0, z: 0 }
    case 'wall-back': return { x: 0, y: 0, z: -1 }
    default: return { x: 0, y: -1, z: 0 }
  }
}

/** Direction a positive tilt leans the beam towards */
export function leanDirection(mount: MountingLocation | undefined): Vec3 {
  switch (mount) {
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return { x: 0, y: -1, z: 0 }
    default: return { x: 0, y: 0, z: 1 }
  }
}

/** Static aim direction (unit) from mount + tilt + direction, ignoring pan/tilt motors */
export function aimDirection(entry: Pick<PatchEntry, 'mountingLocation' | 'mountingAngle' | 'mountingPan'>): Vec3 {
  const r = restDirection(entry.mountingLocation)
  const l = leanDirection(entry.mountingLocation)
  const t = deg(entry.mountingAngle ?? 0)
  // Rotate r towards l by t (they are orthogonal)
  const v = { x: r.x * Math.cos(t) + l.x * Math.sin(t), y: r.y * Math.cos(t) + l.y * Math.sin(t), z: r.z * Math.cos(t) + l.z * Math.sin(t) }
  // Then around world Y by direction
  const p = deg(entry.mountingPan ?? 0)
  const c = Math.cos(p), s = Math.sin(p)
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }
}

/**
 * Distance along a ray (origin inside the room) to the first room surface.
 * Returns the hit, or null when the ray leaves through the open audience side.
 * `walls` false: only the floor counts (room hidden).
 */
export type RoomSurface = 'floor' | 'ceiling' | 'wall-left' | 'wall-right' | 'wall-back'
export interface RoomHit { t: number; normal: Vec3; surface: RoomSurface }

export function rayToRoom(o: Vec3, d: Vec3, room: Pick<RoomConfig, 'width' | 'depth' | 'height'>, walls = true): RoomHit | null {
  const hw = room.width / 2, hd = room.depth / 2
  const EPS = 1e-6
  let t = Infinity
  let hit: RoomHit | null = null
  const test = (tc: number, normal: Vec3, surface: RoomSurface | 'open') => {
    if (tc > 1e-3 && tc < t) {
      t = tc
      hit = surface === 'open' ? null : { t: tc, normal, surface }
    }
  }
  if (d.y < -EPS) test(-o.y / d.y, { x: 0, y: 1, z: 0 }, 'floor')
  if (walls) {
    if (d.y > EPS) test((room.height - o.y) / d.y, { x: 0, y: -1, z: 0 }, 'ceiling')
    if (d.x < -EPS) test((-hw - o.x) / d.x, { x: 1, y: 0, z: 0 }, 'wall-left')
    if (d.x > EPS) test((hw - o.x) / d.x, { x: -1, y: 0, z: 0 }, 'wall-right')
    if (d.z > EPS) test((hd - o.z) / d.z, { x: 0, y: 0, z: -1 }, 'wall-back')
    // The audience side (-Z) is open: the beam leaves the room there
    if (d.z < -EPS) test((-hd - o.z) / d.z, { x: 0, y: 0, z: 1 }, 'open')
  }
  return hit
}

/** Truss bar a fixture hangs on (same depth, just under the pipe) */
export function barForFixture(pos: Vec3, mount: MountingLocation | undefined, bars: TrussBar[]): TrussBar | null {
  if (mount && mount !== 'ceiling') return null
  let best: TrussBar | null = null
  let bestD = Infinity
  for (const bar of bars) {
    const dz = Math.abs(pos.z - bar.z)
    const dy = bar.y - pos.y
    if (dz < 0.08 && dy > -0.1 && dy < 0.9 && Math.abs(pos.x) <= bar.width / 2 + 0.3 && dz < bestD) {
      best = bar
      bestD = dz
    }
  }
  return best
}

/** Height of a fixture hung on a bar (hanging point just under the pipe) */
export function hangHeight(bar: TrussBar): number {
  return Math.max(0.2, bar.y - 0.05)
}

/** X positions that spread `count` fixtures evenly along a bar */
export function distributeOnBar(bar: TrussBar, count: number): number[] {
  if (count <= 0) return []
  const usable = Math.max(0, bar.width - 1)
  if (count === 1) return [0]
  return Array.from({ length: count }, (_, i) => -usable / 2 + (usable * i) / (count - 1))
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function snap(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v
}

/** Round to centimetres (keeps stored positions tidy) */
export function cm(v: number): number {
  return Math.round(v * 100) / 100
}

function deg(d: number): number {
  return (d * Math.PI) / 180
}
