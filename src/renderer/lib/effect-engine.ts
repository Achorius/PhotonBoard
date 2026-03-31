import type { Effect, WaveformType } from '@shared/types'

const activeEffects: Map<string, RunningEffect> = new Map()
let animationFrame: number | null = null
let onUpdate: ((values: Map<string, number>) => void) | null = null

interface RunningEffect {
  effect: Effect
  startTime: number
}

export function setEffectUpdateCallback(cb: (values: Map<string, number>) => void): void {
  onUpdate = cb
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

function updateEffects(): void {
  const now = performance.now()
  const allValues = new Map<string, number>()

  for (const [, running] of activeEffects) {
    const { effect, startTime } = running
    if (!effect.isRunning) continue

    const elapsed = (now - startTime) / 1000 // seconds
    const fixtureCount = effect.fixtureIds.length

    for (let i = 0; i < fixtureCount; i++) {
      const fixtureId = effect.fixtureIds[i]
      // Phase offset per fixture (fan effect)
      const phaseOffset = fixtureCount > 1
        ? (effect.fan / 360) * (i / (fixtureCount - 1))
        : 0
      const baseOffset = effect.offset / 360

      const phase = (elapsed * effect.speed + baseOffset + phaseOffset) % 1
      const waveValue = getWaveformValue(effect.waveform, phase)

      // Map -1..1 to 0..depth
      const value = Math.round(((waveValue + 1) / 2) * effect.depth)

      const key = `${fixtureId}:${effect.channelType}`
      allValues.set(key, value)
    }
  }

  if (onUpdate && allValues.size > 0) {
    onUpdate(allValues)
  }

  if (activeEffects.size > 0) {
    animationFrame = requestAnimationFrame(updateEffects)
  } else {
    animationFrame = null
  }
}

function getWaveformValue(waveform: WaveformType, phase: number): number {
  // Returns -1 to 1
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

export function getActiveEffects(): Map<string, RunningEffect> {
  return new Map(activeEffects)
}
