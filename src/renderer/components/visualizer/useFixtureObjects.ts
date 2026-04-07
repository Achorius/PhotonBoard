import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { PatchEntry, FixtureDefinition, RoomConfig, MountingLocation } from '@shared/types'
import { getFixtureShape } from '@shared/types'
import { createFixtureObjects, setFixtureSelected, type FixtureObjects } from './scene/FixtureModel'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'

export type FixtureObjectMap = Map<string, FixtureObjects>

export function useFixtureObjects(
  sceneRef: React.MutableRefObject<THREE.Scene | null>,
  patch: PatchEntry[],
  fixtures: FixtureDefinition[],
  roomConfig: RoomConfig
): React.MutableRefObject<FixtureObjectMap> {
  const objectMapRef = useRef<FixtureObjectMap>(new Map())

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const map = objectMapRef.current
    const currentIds = new Set(patch.map((p) => p.id))

    // Remove stale fixtures
    for (const [id, objects] of map.entries()) {
      if (!currentIds.has(id)) {
        scene.remove(objects.group)
        objects.group.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            (obj as THREE.Mesh).geometry?.dispose()
          }
        })
        map.delete(id)
      }
    }

    // Create new fixtures or re-attach to current scene (handles React Strict Mode remount)
    let created = 0
    for (const entry of patch) {
      const existing = map.get(entry.id)
      if (existing) {
        // Re-attach to current scene if orphaned (Strict Mode recreates scene)
        if (existing.group.parent !== scene) {
          scene.add(existing.group)
        }
        continue
      }
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      const shape = getFixtureShape(def?.categories || [])
      const beamAngle = def?.physical?.lens?.degreesMinMax?.[1] ?? 25
      const fixtureY = entry.position3D?.y ?? getDefaultY(entry.mountingLocation, roomConfig.height)
      const roomDiagonal = Math.sqrt(roomConfig.width ** 2 + roomConfig.depth ** 2 + roomConfig.height ** 2)
      // Get cell count for multi-cell fixtures (LED bars, pixel strips)
      const mode = def?.modes.find(m => m.name === entry.modeName)
      const cellCount = mode?.pixelLayout?.cellCount ?? 1
      const objects = createFixtureObjects(shape, beamAngle, fixtureY, roomDiagonal, cellCount)
      objects.group.name = `fixture-${entry.id}`
      map.set(entry.id, objects)
      scene.add(objects.group)
      created++
    }

    // Position all
    positionAll(patch, map, roomConfig)
  }, [patch, fixtures, roomConfig, sceneRef])

  // Selection highlight
  useEffect(() => {
    const unsub = useVisualizerStore.subscribe(
      (s) => s.selectedFixtureId,
      (id, prevId) => {
        const map = objectMapRef.current
        if (prevId) { const o = map.get(prevId); if (o) setFixtureSelected(o, false) }
        if (id)     { const o = map.get(id);     if (o) setFixtureSelected(o, true)  }
      }
    )
    return unsub
  }, [])

  return objectMapRef
}

function positionAll(
  patch: PatchEntry[],
  map: FixtureObjectMap,
  roomConfig: RoomConfig
): void {
  const { width, depth, height } = roomConfig
  const cols = Math.max(1, Math.ceil(Math.sqrt(patch.length * 1.5)))
  const rows = Math.max(1, Math.ceil(patch.length / cols))

  patch.forEach((entry, i) => {
    const objects = map.get(entry.id)
    if (!objects) return

    let x: number, y: number, z: number

    const mount = entry.mountingLocation

    if (entry.position3D) {
      x = entry.position3D.x
      y = entry.position3D.y
      z = entry.position3D.z
    } else {
      const col = i % cols
      const row = Math.floor(i / cols)
      x = cols > 1 ? (col / (cols - 1) - 0.5) * width * 0.8 : 0
      z = rows > 1 ? (row / (rows - 1) - 0.5) * depth * 0.6 : 0
      y = getDefaultY(mount, height)

      // Auto-position wall-mounted fixtures at the wall edge
      if (mount === 'wall-left') x = -width / 2 + 0.1
      else if (mount === 'wall-right') x = width / 2 - 0.1
      else if (mount === 'wall-back') z = depth / 2 - 0.1
    }

    objects.group.position.set(x, y, z)

    if (entry.rotation3D) {
      objects.group.rotation.set(entry.rotation3D.rx, entry.rotation3D.ry, entry.rotation3D.rz)
    } else {
      // Base rotation depends on mounting location
      const base = getMountingBaseRotation(mount)
      const tilt = THREE.MathUtils.degToRad(entry.mountingAngle ?? 0)
      const pan = THREE.MathUtils.degToRad(entry.mountingPan ?? 0)
      objects.group.rotation.set(base.rx + tilt, base.ry + pan, base.rz)
    }
  })
}

function getDefaultY(mount: MountingLocation | undefined, roomHeight: number): number {
  switch (mount) {
    case 'floor': return 0.15
    case 'wall-left':
    case 'wall-right':
    case 'wall-back': return roomHeight * 0.6
    default: return roomHeight - 0.05 // ceiling
  }
}

function getMountingBaseRotation(mount: MountingLocation | undefined): { rx: number; ry: number; rz: number } {
  switch (mount) {
    case 'floor':      return { rx: Math.PI, ry: 0, rz: 0 }           // beam points up
    case 'wall-left':  return { rx: 0, ry: 0, rz: -Math.PI / 2 }      // beam points right (inward)
    case 'wall-right': return { rx: 0, ry: 0, rz: Math.PI / 2 }       // beam points left (inward)
    case 'wall-back':  return { rx: -Math.PI / 2, ry: 0, rz: 0 }      // beam points toward audience
    default:           return { rx: 0, ry: 0, rz: 0 }                  // ceiling: beam points down
  }
}
