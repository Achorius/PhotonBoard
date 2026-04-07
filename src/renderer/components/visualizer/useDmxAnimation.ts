import { useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { resolveChannels } from '@renderer/lib/dmx-channel-resolver'
import { updateFixtureObjects } from './scene/BeamUpdater'
import type { CellColor } from './scene/BeamUpdater'
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

        // Resolve per-cell colors for multi-cell fixtures
        let cellColors: CellColor[] | undefined
        const mode = def?.modes.find(m => m.name === entry.modeName)
        const pixelLayout = mode?.pixelLayout
        if (pixelLayout && pixelLayout.cellCount > 1 && objects.cellLenses) {
          cellColors = []
          const uniValues = values[entry.universe]
          for (const cell of pixelLayout.cells) {
            let cr = 0, cg = 0, cb = 0, cdim = 255
            for (const chName of cell.channelNames) {
              const n = chName.toLowerCase()
              const absIdx = entry.address - 1 + cell.channelOffset + cell.channelNames.indexOf(chName)
              const v = uniValues?.[absIdx] ?? 0
              if (n.includes('red')) cr = v / 255
              else if (n.includes('green')) cg = v / 255
              else if (n.includes('blue')) cb = v / 255
              else if (n.includes('white')) { cr = Math.max(cr, v / 255); cg = Math.max(cg, v / 255); cb = Math.max(cb, v / 255) }
              else if (n.includes('dimmer') || n.includes('intensity')) cdim = v
            }
            cellColors.push({ r: cr, g: cg, b: cb, dimmer: cdim })
          }
          // Reverse cell order if pixel invert is enabled
          if (entry.pixelInvert) cellColors.reverse()
        }

        updateFixtureObjects(objects, channels, grandMaster, blackout, showBeams, {
          panInvert: entry.panInvert,
          tiltInvert: entry.tiltInvert,
          cellColors
        })
      }

      controls?.update()
      renderer.render(scene, camera)
    }

    animId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animId)
  }, [patch, fixtures])
}
