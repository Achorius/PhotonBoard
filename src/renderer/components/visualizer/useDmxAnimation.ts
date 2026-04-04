import { useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { resolveChannels } from '@renderer/lib/dmx-channel-resolver'
import { updateFixtureObjects } from './scene/BeamUpdater'
import type { FixtureObjectMap } from './useFixtureObjects'
import type { PatchEntry, FixtureDefinition } from '@shared/types'

const TARGET_FPS = 40
const FRAME_MS = 1000 / TARGET_FPS

export function useDmxAnimation(
  sceneRef: React.MutableRefObject<THREE.Scene | null>,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
  controlsRef: React.MutableRefObject<OrbitControls | null>,
  objectMapRef: React.MutableRefObject<FixtureObjectMap>,
  patch: PatchEntry[],
  fixtures: FixtureDefinition[]
): void {
  useEffect(() => {
    let animId: number
    let lastTime = 0

    const animate = (time: number) => {
      animId = requestAnimationFrame(animate)

      const renderer = rendererRef.current
      const scene    = sceneRef.current
      const camera   = cameraRef.current
      const controls = controlsRef.current
      if (!renderer || !scene || !camera) return

      if (time - lastTime < FRAME_MS) {
        // Still update controls for smooth damping
        controls?.update()
        renderer.render(scene, camera)
        return
      }
      lastTime = time

      // Imperative store reads — no React re-renders
      const { values, grandMaster, blackout } = useDmxStore.getState()
      const { showBeams } = useVisualizerStore.getState()

      for (const entry of patch) {
        const objects = objectMapRef.current.get(entry.id)
        if (!objects) continue
        const def = fixtures.find((f) => f.id === entry.fixtureDefId)
        const channels = resolveChannels(entry, def, values)
        updateFixtureObjects(objects, channels, grandMaster, blackout, showBeams)
      }

      controls?.update()
      renderer.render(scene, camera)
    }

    animId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animId)
  }, [patch, fixtures])
}
