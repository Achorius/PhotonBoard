// ============================================================
// PhotonBoard — Effect Engine
// LFO waveform generator that writes directly to DMX store.
// Effects TAKE OVER the channels they affect while running.
// ============================================================

import type { Effect, WaveformType } from '@shared/types'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { isColorWheelChannel, COLOR_WHEEL_MAX_DMX } from './dmx-channel-resolver'

const activeEffects: Map<string, RunningEffect> = new Map()
let animationFrame: number | null = null

interface RunningEffect {
  effect: Effect
  startTime: number
}

// Channel type name mapping
const CHANNEL_TYPE_TO_NAME: Record<string, string> = {
  Dimmer: 'dimmer',
  Red: 'red',
  Green: 'green',
  Blue: 'blue',
  White: 'white',
  Pan: 'pan',
  Tilt: 'tilt',
  Gobo: 'gobo',
  Zoom: 'zoom',
  Focus: 'focus',
  Shutter: 'shutter',
  'Color Wheel': 'color wheel',
  Cyan: 'cyan',
  Magenta: 'magenta',
  Yellow: 'yellow',
  Prism: 'prism',
  Frost: 'frost',
  Iris: 'iris',
}

export function startEffect(effect: Effect): void {
  activeEffects.set(effect.id, { effect, startTime: performance.now() })
  if (!animationFrame) {
    animationFrame = requestAnimationFrame(updateEffects)
  }
}

export function stopEffect(id: string): void {
  activeEffects.delete(id)
  if (activeEffects.size === 0 && animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

export function stopAllEffects(): void {
  activeEffects.clear()
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

export function getActiveEffects(): Map<string, RunningEffect> {
  return new Map(activeEffects)
}

function updateEffects(): void {
  const now = performance.now()
  const dmxStore = useDmxStore.getState()
  const patchStore = usePatchStore.getState()

  for (const [, running] of activeEffects) {
    const { effect, startTime } = running
    if (!effect.isRunning) continue

    const elapsed = (now - startTime) / 1000
    const fixtureCount = effect.fixtureIds.length

    for (let i = 0; i < fixtureCount; i++) {
      const fixtureId = effect.fixtureIds[i]
      const entry = patchStore.patch.find(p => p.id === fixtureId)
      if (!entry) continue

      const def = patchStore.fixtures.find(f => f.id === entry.fixtureDefId)
      if (!def) continue

      const mode = def.modes.find(m => m.name === entry.modeName)
      if (!mode) continue

      // Phase offset per fixture (fan/spread effect)
      const fixturePhaseOffset = fixtureCount > 1
        ? (effect.fan / 360) * (i / (fixtureCount - 1))
        : 0
      const baseOffset = effect.offset / 360

      // Find the actual DMX channel for this channel type
      const targetName = CHANNEL_TYPE_TO_NAME[effect.channelType] || effect.channelType.toLowerCase()

      // Multi-cell support: if fixture has pixel layout, apply effect per cell with cell phase spread
      const pixelLayout = mode.pixelLayout
      if (pixelLayout && pixelLayout.cellCount > 1) {
        // Apply effect to each cell with progressive phase offset
        for (let cellIdx = 0; cellIdx < pixelLayout.cellCount; cellIdx++) {
          const cell = pixelLayout.cells[cellIdx]
          // Reverse cell phase order when pixelInvert is enabled
          const effectiveCellIdx = entry.pixelInvert
            ? (pixelLayout.cellCount - 1 - cellIdx)
            : cellIdx
          const cellPhaseOffset = pixelLayout.cellCount > 1
            ? (effect.fan / 360) * (effectiveCellIdx / (pixelLayout.cellCount - 1))
            : 0

          // Combined phase: fixture offset + cell offset within fixture
          const phase = (elapsed * effect.speed + baseOffset + fixturePhaseOffset + cellPhaseOffset) % 1
          const waveValue = getWaveformValue(effect.waveform, phase)

          // Find matching channel in this cell
          const cellChIndex = cell.channelNames.findIndex(ch => ch.toLowerCase().includes(targetName))
          if (cellChIndex === -1) continue

          const absChannel = entry.address - 1 + cell.channelOffset + cellChIndex
          const channelName = cell.channelNames[cellChIndex]
          const maxValue = isColorWheelChannel(channelName) ? COLOR_WHEEL_MAX_DMX : effect.depth
          const value = Math.round(((waveValue + 1) / 2) * maxValue)

          if (absChannel >= 0 && absChannel < 512) {
            dmxStore.setChannel(entry.universe, absChannel, value)
          }
        }
      } else {
        // Single-cell fixture: original behavior
        const phase = (elapsed * effect.speed + baseOffset + fixturePhaseOffset) % 1
        const waveValue = getWaveformValue(effect.waveform, phase)

        const chIndex = mode.channels.findIndex(ch => ch.toLowerCase().includes(targetName))
        if (chIndex === -1) continue

        const channelName = mode.channels[chIndex]
        const maxValue = isColorWheelChannel(channelName) ? COLOR_WHEEL_MAX_DMX : effect.depth
        const value = Math.round(((waveValue + 1) / 2) * maxValue)

        const absChannel = entry.address - 1 + chIndex
        if (absChannel >= 0 && absChannel < 512) {
          dmxStore.setChannel(entry.universe, absChannel, value)
        }
      }
    }
  }

  if (activeEffects.size > 0) {
    animationFrame = requestAnimationFrame(updateEffects)
  } else {
    animationFrame = null
  }
}

function getWaveformValue(waveform: WaveformType, phase: number): number {
  switch (waveform) {
    case 'sine':
      return Math.sin(phase * 2 * Math.PI)
    case 'square':
      return phase < 0.5 ? 1 : -1
    case 'sawtooth':
      return 2 * phase - 1
    case 'triangle':
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase
    case 'random':
      return Math.random() * 2 - 1
    default:
      return 0
  }
}
