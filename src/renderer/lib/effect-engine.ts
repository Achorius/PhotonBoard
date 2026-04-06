// ============================================================
// PhotonBoard — Effect Engine
// LFO waveform generator that outputs to the DMX Mixer.
// Effects are ADDITIVE: they modulate on top of base values
// (from cuelists/chases/programmer) rather than replacing them.
// ============================================================

import type { Effect, WaveformType } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { setLayer, removeLayer } from './dmx-mixer'

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
}

export function startEffect(effect: Effect): void {
  activeEffects.set(effect.id, { effect, startTime: performance.now() })
  if (!animationFrame) {
    animationFrame = requestAnimationFrame(updateEffects)
  }
}

export function stopEffect(id: string): void {
  activeEffects.delete(id)
  removeLayer(`effect:${id}`)
  if (activeEffects.size === 0 && animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

export function stopAllEffects(): void {
  for (const id of activeEffects.keys()) {
    removeLayer(`effect:${id}`)
  }
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
  const patchStore = usePatchStore.getState()

  for (const [, running] of activeEffects) {
    const { effect, startTime } = running
    if (!effect.isRunning) continue

    const elapsed = (now - startTime) / 1000
    const fixtureCount = effect.fixtureIds.length
    const layerChannels = new Map<number, Map<number, number>>()

    for (let i = 0; i < fixtureCount; i++) {
      const fixtureId = effect.fixtureIds[i]
      const entry = patchStore.patch.find(p => p.id === fixtureId)
      if (!entry) continue

      const def = patchStore.fixtures.find(f => f.id === entry.fixtureDefId)
      if (!def) continue

      const mode = def.modes.find(m => m.name === entry.modeName)
      if (!mode) continue

      // Phase offset per fixture (fan effect)
      const phaseOffset = fixtureCount > 1
        ? (effect.fan / 360) * (i / (fixtureCount - 1))
        : 0
      const baseOffset = effect.offset / 360
      const phase = (elapsed * effect.speed + baseOffset + phaseOffset) % 1
      const waveValue = getWaveformValue(effect.waveform, phase)

      // Map -1..1 to 0..depth
      const value = Math.round(((waveValue + 1) / 2) * effect.depth)

      // Find the actual DMX channel for this channel type
      const targetName = CHANNEL_TYPE_TO_NAME[effect.channelType] || effect.channelType.toLowerCase()
      const chIndex = mode.channels.findIndex(ch => ch.toLowerCase().includes(targetName))
      if (chIndex === -1) continue

      const absChannel = entry.address - 1 + chIndex
      if (absChannel < 0 || absChannel >= 512) continue

      let uniMap = layerChannels.get(entry.universe)
      if (!uniMap) {
        uniMap = new Map()
        layerChannels.set(entry.universe, uniMap)
      }
      uniMap.set(absChannel, value)
    }

    // Push to mixer — effects at priority 40 (below cuelists at 50)
    // This means for LTP channels, cuelists win. For HTP (dimmer), max wins.
    setLayer(`effect:${effect.id}`, layerChannels, 40)
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
