// ============================================================
// Room: floor with the stage deck, grid, walls + ceiling, outline and
// the truss bars. Origin = centre of the floor; the audience is at -Z
// (the open side). Rebuilt (and the old one disposed) whenever the
// room config changes — it is a handful of meshes.
// ============================================================

import * as THREE from 'three'
import type { RoomConfig, TrussBar } from '@shared/types'
import { palette } from '@renderer/components/ui/tokens'

// Surfaces are Lambert-shaded, so the UI surface tokens read a touch darker in 3D
const FLOOR = palette.surface1
const STAGE = palette.surface2
const WALL = palette.surface1
const CEILING = palette.surface0
const TRUSS = palette.fgDisabled

export function buildRoom(config: RoomConfig): THREE.Group {
  const { width: w, depth: d, height: h } = config
  const group = new THREE.Group()
  group.name = 'room'
  const stageZ = THREE.MathUtils.clamp(config.stageEdgeZ ?? 0, -d / 2, d / 2)

  // ---- Floor (audience side) + stage deck ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: FLOOR })
  )
  floor.receiveShadow = true
  floor.name = 'floor'
  group.add(floor)

  const deckDepth = d / 2 - stageZ
  if (deckDepth > 0.05) {
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(w, deckDepth).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: STAGE })
    )
    deck.position.set(0, 0.003, stageZ + deckDepth / 2)
    deck.receiveShadow = true
    deck.name = 'stage'
    group.add(deck)
  }

  // Stage edge
  const edge = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-w / 2, 0.012, stageZ), new THREE.Vector3(w / 2, 0.012, stageZ)]),
    new THREE.LineBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.75 })
  )
  edge.name = 'stage-edge'
  group.add(edge)

  // ---- Grid: 1 m, major every 5 m from the centre ----
  const minor: number[] = []
  const major: number[] = []
  for (let x = Math.ceil(-w / 2); x <= Math.floor(w / 2); x++) {
    ;(x % 5 === 0 ? major : minor).push(x, 0.008, -d / 2, x, 0.008, d / 2)
  }
  for (let z = Math.ceil(-d / 2); z <= Math.floor(d / 2); z++) {
    ;(z % 5 === 0 ? major : minor).push(-w / 2, 0.008, z, w / 2, 0.008, z)
  }
  const grid = new THREE.Group()
  grid.name = 'grid'
  grid.add(lines(minor, palette.surface4, 0.7))
  grid.add(lines(major, palette.lineStrong, 0.8))
  group.add(grid)

  // ---- Walls + ceiling (toggle "Room") ----
  const walls = new THREE.Group()
  walls.name = 'walls'
  const wallMat = new THREE.MeshLambertMaterial({ color: WALL })
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat)
  back.position.set(0, h / 2, d / 2)
  back.rotation.y = Math.PI
  const left = new THREE.Mesh(new THREE.PlaneGeometry(d, h), wallMat)
  left.position.set(-w / 2, h / 2, 0)
  left.rotation.y = Math.PI / 2
  const right = new THREE.Mesh(new THREE.PlaneGeometry(d, h), wallMat)
  right.position.set(w / 2, h / 2, 0)
  right.rotation.y = -Math.PI / 2
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: CEILING }))
  ceiling.position.y = h
  for (const m of [back, left, right, ceiling]) {
    m.receiveShadow = true
    walls.add(m)
  }
  group.add(walls)

  // ---- Outline of the room box (reads well when walls are hidden or seen from outside) ----
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0)),
    new THREE.LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.9 })
  )
  outline.name = 'outline'
  group.add(outline)

  // ---- Truss ----
  for (const bar of config.trussBars) group.add(buildTruss(bar, w))

  return group
}

/** Flat ladder truss (two chords + zig-zag lacing), fixtures hang under it */
function buildTruss(bar: TrussBar, roomWidth: number): THREE.Group {
  const len = Math.max(0.5, bar.width ?? roomWidth)
  const g = new THREE.Group()
  g.name = `truss-${bar.id}`
  g.position.set(0, bar.y + 0.03, bar.z)
  const mat = new THREE.MeshLambertMaterial({ color: bar.color ?? TRUSS })
  const chordGeo = new THREE.CylinderGeometry(0.025, 0.025, len, 8).rotateZ(Math.PI / 2)
  for (const z of [-0.13, 0.13]) {
    const chord = new THREE.Mesh(chordGeo, mat)
    chord.position.z = z
    chord.castShadow = true
    g.add(chord)
  }
  const lacing: number[] = []
  const step = 0.4
  const n = Math.max(1, Math.round(len / step))
  for (let i = 0; i < n; i++) {
    const x0 = -len / 2 + (i * len) / n
    const x1 = -len / 2 + ((i + 1) * len) / n
    const z0 = i % 2 === 0 ? -0.13 : 0.13
    lacing.push(x0, 0, z0, x1, 0, -z0)
  }
  const lace = lines(lacing, bar.color ?? TRUSS, 1)
  g.add(lace)
  // Ends
  const endGeo = new THREE.BoxGeometry(0.06, 0.06, 0.32)
  for (const x of [-len / 2, len / 2]) {
    const end = new THREE.Mesh(endGeo, mat)
    end.position.x = x
    g.add(end)
  }
  return g
}

function lines(points: number[], color: string, opacity: number): THREE.LineSegments {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }))
}

export function setRoomVisibility(room: THREE.Group, opts: { walls: boolean; grid: boolean }): void {
  const walls = room.getObjectByName('walls')
  if (walls) walls.visible = opts.walls
  const grid = room.getObjectByName('grid')
  if (grid) grid.visible = opts.grid
}
