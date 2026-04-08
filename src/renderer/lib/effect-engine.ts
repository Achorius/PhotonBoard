// ============================================================
// PhotonBoard — Effect Engine
// LFO waveform generator that writes directly to DMX store.
// Supports compound multi-channel effects and one-shot mode.
// ============================================================

import type { Effect, EffectChannel, WaveformType } from '@shared/types'
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

// IDs of effects that completed one-shot and need to be stopped externally
const oneShotCompleted: Set<string> = new Set()

export function consumeOneShotCompleted(): string[] {
  const ids = [...oneShotCompleted]
  oneShotCompleted.clear()
  return ids
}

function updateEffects(): void {
  const now = performance.now()
  const dmxStore = useDmxStore.getState()
  const patchStore = usePatchStore.getState()

  for (const [, running] of activeEffects) {
    const { effect, startTime } = running
    if (!effect.isRunning) continue

    const elapsed = (now - startTime) / 1000

    // One-shot: check if one full cycle has completed
    if (effect.oneShot && elapsed * effect.speed >= 1) {
      oneShotCompleted.add(effect.id)
      continue
    }

    const fixtureCount = effect.fixtureIds.length

    // Determine channels to process
    const effectChannels: EffectChannel[] = effect.channels && effect.channels.length > 0
      ? effect.channels
      : [{ channelType: effect.channelType, phaseOffset: 0, depth: effect.depth, frequencyMultiplier: 1 }]

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

      // Process each channel in the effect
      for (const ech of effectChannels) {
        const targetName = CHANNEL_TYPE_TO_NAME[ech.channelType] || ech.channelType.toLowerCase()
        const channelPhaseOffset = ech.phaseOffset / 360
        const freqMul = ech.frequencyMultiplier ?? 1
        const channelWaveform = ech.waveform ?? effect.waveform
        const channelDepth = ech.depth

        // Multi-cell support
        const pixelLayout = mode.pixelLayout
        if (pixelLayout && pixelLayout.cellCount > 1) {
          for (let cellIdx = 0; cellIdx < pixelLayout.cellCount; cellIdx++) {
            const cell = pixelLayout.cells[cellIdx]
            const effectiveCellIdx = entry.pixelInvert
              ? (pixelLayout.cellCount - 1 - cellIdx)
              : cellIdx
            const cellPhaseOffset = pixelLayout.cellCount > 1
              ? (effect.fan / 360) * (effectiveCellIdx / (pixelLayout.cellCount - 1))
              : 0

            const phase = (elapsed * effect.speed * freqMul + baseOffset + fixturePhaseOffset + cellPhaseOffset + channelPhaseOffset) % 1
            const waveValue = getWaveformValue(channelWaveform, phase)

            const cellChIndex = cell.channelNames.findIndex(ch => ch.toLowerCase().includes(targetName))
            if (cellChIndex === -1) continue

            const absChannel = entry.address - 1 + cell.channelOffset + cellChIndex
            const channelName = cell.channelNames[cellChIndex]
            const maxValue = isColorWheelChannel(channelName) ? COLOR_WHEEL_MAX_DMX : channelDepth
            const value = Math.round(((waveValue + 1) / 2) * maxValue)

            if (absChannel >= 0 && absChannel < 512) {
              dmxStore.setChannel(entry.universe, absChannel, value)
            }
          }
        } else {
          // Single-cell fixture
          const phase = (elapsed * effect.speed * freqMul + baseOffset + fixturePhaseOffset + channelPhaseOffset) % 1
          const waveValue = getWaveformValue(channelWaveform, phase)

          const chIndex = mode.channels.findIndex(ch => ch.toLowerCase().includes(targetName))
          if (chIndex === -1) continue

          const channelName = mode.channels[chIndex]
          const maxValue = isColorWheelChannel(channelName) ? COLOR_WHEEL_MAX_DMX : channelDepth
          const value = Math.round(((waveValue + 1) / 2) * maxValue)

          const absChannel = entry.address - 1 + chIndex
          if (absChannel >= 0 && absChannel < 512) {
            dmxStore.setChannel(entry.universe, absChannel, value)
          }
        }
      }
    }
  }

  // Handle one-shot completed effects
  if (oneShotCompleted.size > 0) {
    for (const id of oneShotCompleted) {
      activeEffects.delete(id)
    }
    // The store will be notified via consumeOneShotCompleted()
  }

  if (activeEffects.size > 0) {
    animationFrame = requestAnimationFrame(updateEffects)
  } else {
    animationFrame = null
  }
}

export function getWaveformValue(waveform: WaveformType, phase: number): number {
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
    case 'pulse':
      // Fast attack, slow decay (exponential)
      return Math.exp(-phase * 5) * 2 - 1
    case 'bounce':
      // Ball bounce — abs sine with decay
      return Math.abs(Math.sin(phase * Math.PI * 3)) * Math.exp(-phase * 2) * 2 - 1
    case 'step': {
      // Quantized sawtooth — 4 discrete steps
      const steps = 4
      return Math.floor(phase * steps) / (steps - 1) * 2 - 1
    }
    default:
      return 0
  }
}
