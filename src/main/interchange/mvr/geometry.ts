// ============================================================
// PhotonBoard — MVR geometry: transforms, axes and fixture aim.
//
// MVR (DIN SPEC 15801): right-handed, Z up, 1 unit = 1 mm. A Matrix
// is written {u}{v}{w}{o}: u, v, w are the images of the local X, Y,
// Z axes (rotation rows) and o the translation, so a local point p
// maps to p.x·u + p.y·v + p.z·w + o. Nested objects compose:
// world = child ∘ parent. The beam of a GDTF fixture leaves along
// its local −Z (hanging straight down when the matrix is identity).
//
// PhotonBoard world (renderer/components/visualizer/scene/layout-math.ts):
// metres, origin = centre of the room floor, +X stage right as seen
// from the audience (screen right in plan), +Y up, +Z upstage.
// MVR stage convention (grandMA3, Vectorworks plans): +X to the
// audience's right, +Y upstage, +Z up — so the mapping is
//   PB.x = MVR.x / 1000, PB.y = MVR.z / 1000, PB.z = MVR.y / 1000.
//
// Fixture orientation becomes the console's static aim:
// mountingLocation (ceiling: beam rest down / floor: up) +
// mountingAngle (tilt from the rest direction, towards upstage) +
// mountingPan (direction around the vertical). The aim maths here
// mirrors layout-math.ts aimDirection() (pinned by a test).
// ============================================================

import type { MountingLocation, PatchEntry, RoomConfig, Rotation3D } from '../../../shared/types'

export type Vec3 = { x: number; y: number; z: number }

/** Row-vector affine transform: rows u, v, w (3×3) + translation o (mm) */
export interface Transform {
  r: [Vec3, Vec3, Vec3]
  o: Vec3
}

export const IDENTITY: Transform = {
  r: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
  o: { x: 0, y: 0, z: 0 }
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z)
export const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const length = (a: Vec3): number => Math.sqrt(dot(a, a))
export function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return l > 1e-12 ? scale(a, 1 / l) : v(0, 0, 0)
}

/** p · R (row vector times the rotation rows) */
function mulRows(p: Vec3, r: [Vec3, Vec3, Vec3]): Vec3 {
  return add(add(scale(r[0], p.x), scale(r[1], p.y)), scale(r[2], p.z))
}

/**
 * Parse an MVR Matrix: "{u1,u2,u3}{v1,v2,v3}{w1,w2,w3}{o1,o2,o3}" (4×3).
 * 4×4 forms (4 numbers per group) and a missing translation are tolerated.
 * Returns null when nothing usable is found.
 */
export function parseMvrMatrix(text: string | undefined | null): Transform | null {
  if (!text) return null
  const groups = [...String(text).matchAll(/\{([^}]*)\}/g)].map((m) => m[1].split(',').map((s) => parseFloat(s.trim())))
  if (groups.length < 3) return null
  const row = (g: number[] | undefined, fallback: Vec3): Vec3 => {
    if (!g || g.length < 3 || g.slice(0, 3).some((n) => !Number.isFinite(n))) return fallback
    return v(g[0], g[1], g[2])
  }
  const r: [Vec3, Vec3, Vec3] = [row(groups[0], IDENTITY.r[0]), row(groups[1], IDENTITY.r[1]), row(groups[2], IDENTITY.r[2])]
  let o = row(groups[3], IDENTITY.o)
  // A 4×4 written column-major (translation in the 4th column) instead of a 4th row
  if (groups.length >= 4 && groups[0].length >= 4 && groups[3].length >= 4 && o.x === 0 && o.y === 0 && o.z === 0) {
    const t = v(groups[0][3], groups[1][3], groups[2][3])
    if ([t.x, t.y, t.z].every(Number.isFinite)) o = t
  }
  return { r, o }
}

/** Local transform `child` inside `parent` → world transform */
export function compose(parent: Transform, child: Transform): Transform {
  return {
    r: [mulRows(child.r[0], parent.r), mulRows(child.r[1], parent.r), mulRows(child.r[2], parent.r)],
    o: add(mulRows(child.o, parent.r), parent.o)
  }
}

function fmt(n: number, decimals: number): string {
  if (!Number.isFinite(n)) return '0'
  let s = n.toFixed(decimals)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** "{u}{v}{w}{o}" with 6 decimals for the rotation and 3 for the translation (mm) */
export function formatMvrMatrix(t: Transform): string {
  const g = (a: Vec3, d: number) => `{${fmt(a.x, d)},${fmt(a.y, d)},${fmt(a.z, d)}}`
  return `${g(t.r[0], 6)}${g(t.r[1], 6)}${g(t.r[2], 6)}${g(t.o, 3)}`
}

// ---------------------------------------------------------------
// Axes
// ---------------------------------------------------------------

/** MVR vector → PhotonBoard axes (same units) */
export function mvrToPb(a: Vec3): Vec3 {
  return v(a.x, a.z, a.y)
}

/** PhotonBoard vector → MVR axes (same units) */
export function pbToMvr(a: Vec3): Vec3 {
  return v(a.x, a.z, a.y)
}

/** World beam direction (MVR axes, unit) of a fixture transform: its local −Z */
export function beamOf(t: Transform): Vec3 {
  return normalize(scale(t.r[2], -1))
}

// ---------------------------------------------------------------
// Static aim (mirrors layout-math.ts)
// ---------------------------------------------------------------

const deg = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

export function restDirection(mount: MountingLocation | undefined): Vec3 {
  switch (mount) {
    case 'floor': return v(0, 1, 0)
    case 'wall-left': return v(1, 0, 0)
    case 'wall-right': return v(-1, 0, 0)
    case 'wall-back': return v(0, 0, -1)
    default: return v(0, -1, 0)
  }
}

export function leanDirection(mount: MountingLocation | undefined): Vec3 {
  switch (mount) {
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return v(0, -1, 0)
    default: return v(0, 0, 1)
  }
}

/** Static aim direction (unit, PB axes) of a patch entry — same maths as layout-math.ts */
export function aimDirection(entry: Pick<PatchEntry, 'mountingLocation' | 'mountingAngle' | 'mountingPan'>): Vec3 {
  const r = restDirection(entry.mountingLocation)
  const l = leanDirection(entry.mountingLocation)
  const t = deg(entry.mountingAngle ?? 0)
  const a = v(r.x * Math.cos(t) + l.x * Math.sin(t), r.y * Math.cos(t) + l.y * Math.sin(t), r.z * Math.cos(t) + l.z * Math.sin(t))
  const p = deg(entry.mountingPan ?? 0)
  const c = Math.cos(p)
  const s = Math.sin(p)
  return v(a.x * c + a.z * s, a.y, -a.x * s + a.z * c)
}

/** Beam direction of a legacy rotation3D (three.js Euler XYZ applied to a model whose beam points down) */
export function beamFromRotation3D(r: Rotation3D): Vec3 {
  // R = Rx · Ry · Rz applied to (0, −1, 0)
  let p = v(0, -1, 0)
  const rz = (q: Vec3, a: number) => v(q.x * Math.cos(a) - q.y * Math.sin(a), q.x * Math.sin(a) + q.y * Math.cos(a), q.z)
  const ry = (q: Vec3, a: number) => v(q.x * Math.cos(a) + q.z * Math.sin(a), q.y, -q.x * Math.sin(a) + q.z * Math.cos(a))
  const rx = (q: Vec3, a: number) => v(q.x, q.y * Math.cos(a) - q.z * Math.sin(a), q.y * Math.sin(a) + q.z * Math.cos(a))
  p = rx(ry(rz(p, r.rz || 0), r.ry || 0), r.rx || 0)
  return normalize(p)
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Mount + tilt + direction that aim a fixture along `beam` (PB axes).
 * Beams pointing down hang from the ceiling, beams pointing up stand on
 * the floor; horizontal beams use the height (below 1.2 m: floor).
 */
export function mountFromBeam(beam: Vec3, heightM: number): { mountingLocation: MountingLocation; mountingAngle: number; mountingPan: number } {
  const d = normalize(beam)
  if (length(d) === 0) return { mountingLocation: 'ceiling', mountingAngle: 0, mountingPan: 0 }
  const floor = d.y > 0.02 || (Math.abs(d.y) <= 0.02 && heightM < 1.2)
  const cosT = Math.max(-1, Math.min(1, floor ? d.y : -d.y))
  const tilt = toDeg(Math.acos(cosT))
  let pan = Math.abs(Math.sin(deg(tilt))) < 1e-3 ? 0 : toDeg(Math.atan2(d.x, d.z))
  if (pan <= -180) pan += 360
  const t = round1(tilt)
  const p = t === 0 ? 0 : round1(pan)
  return { mountingLocation: floor ? 'floor' : 'ceiling', mountingAngle: t, mountingPan: (p === -180 ? 180 : p) + 0 /* no -0 */ }
}

/** Rotation rows (MVR axes) of a fixture whose beam (local −Z) points along `beamMvr` */
export function rotationForBeam(beamMvr: Vec3): [Vec3, Vec3, Vec3] {
  const w = normalize(scale(beamMvr, -1))
  if (length(w) === 0) return IDENTITY.r
  let u = cross(v(0, 0, 1), w)
  u = length(u) < 1e-9 ? v(1, 0, 0) : normalize(u)
  const vv = normalize(cross(w, u))
  return [u, vv, w]
}

// ---------------------------------------------------------------
// Auto placement of fixtures that were never positioned (same rule as layout-math.ts)
// ---------------------------------------------------------------

export function defaultHeight(mount: MountingLocation | undefined, roomHeight: number): number {
  switch (mount) {
    case 'floor': return 0.15
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return roomHeight * 0.6
    default: return roomHeight - 0.05
  }
}

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
