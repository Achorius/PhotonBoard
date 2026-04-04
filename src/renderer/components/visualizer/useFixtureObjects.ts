import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { PatchEntry, FixtureDefinition, RoomConfig } from '@shared/types'
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

    // Create new fixtures
    for (const entry of patch) {
      if (map.has(entry.id)) continue
      const def = fixtures.find((f) => f.id === entry.fixtureDefId)
      const shape = getFixtureShape(def?.categories || [])
      const beamAngle = def?.physical?.lens?.degreesMinMax?.[1] ?? 25
      const objects = createFixtureObjects(shape, beamAngle)
      objects.group.name = `fixture-${entry.id}`
      map.set(entry.id, objects)
      scene.add(objects.group)
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

    if (entry.position3D) {
      x = entry.position3D.x
      y = entry.position3D.y
      z = entry.position3D.z
    } else {
      const col = i % cols
      const row = Math.floor(i / cols)
      x = cols > 1 ? (col / (cols - 1) - 0.5) * width * 0.8 : 0
      z = rows > 1 ? (row / (rows - 1) - 0.5) * depth * 0.6 : 0
      y = height - 0.05
    }

    objects.group.position.set(x, y, z)

    if (entry.rotation3D) {
      objects.group.rotation.set(entry.rotation3D.rx, entry.rotation3D.ry, entry.rotation3D.rz)
    } else {
      objects.group.rotation.set(THREE.MathUtils.degToRad(entry.mountingAngle ?? 0), 0, 0)
    }
  })
}
