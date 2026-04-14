import { useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import { resolveChannels } from '@renderer/lib/dmx-channel-resolver'
import { updateFixtureObjects } from './scene/BeamUpdater'
import { getDeviceProfile } from '@renderer/lib/device-detect'
import type { CellColor } from './scene/BeamUpdater'
import type { FixtureObjectMap } from './useFixtureObjects'
import type { PatchEntry, FixtureDefinition } from '@shared/types'

const TARGET_FPS = getDeviceProfile().visualizerFps
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
      const { values, grandMaster, blackout, blinder, strobe, _strobePhase } = useDmxStore.getState()
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

        // Blinder: override all color/dimmer to max white
        // Strobe: alternate between normal and off
        const effectiveBlackout = blackout || (strobe && !_strobePhase)
        const effectiveGM = blinder ? 255 : grandMaster
        const blinderChannels = blinder ? {
          ...channels,
          dimmer: 255,
          red: 255,
          green: 255,
          blue: 255,
          white: 255,
          amber: 255
        } : channels

        // Override cell colors for blinder
        const effectiveCellColors = blinder && cellColors
          ? cellColors.map(() => ({ r: 1, g: 1, b: 1, dimmer: 255 }))
          : (strobe && !_strobePhase && cellColors)
            ? cellColors.map(() => ({ r: 0, g: 0, b: 0, dimmer: 0 }))
            : cellColors

        updateFixtureObjects(objects, blinderChannels, effectiveGM, effectiveBlackout, showBeams, {
          panInvert: entry.panInvert,
          tiltInvert: entry.tiltInvert,
          cellColors: effectiveCellColors
        })
      }

      controls?.update()
      renderer.render(scene, camera)
    }

    animId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animId)
  }, [patch, fixtures])
}
