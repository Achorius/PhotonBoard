// ============================================================
// PhotonBoard — Chase Engine
// BPM-based step sequencer with crossfade support.
// Writes directly to DMX store.
// ============================================================

import type { Chase, CueChannelValue } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { setLayer, removeLayer } from './dmx-mixer'

// --------------- Types ---------------

interface RunningChase {
  chaseId: string
  startTime: number
  currentStep: number
  bounceForward: boolean
  lastRandomStep: number
}

// --------------- State ---------------

const runningChases = new Map<string, RunningChase>()
let rafId: number | null = null

// --------------- Public API ---------------

export function startChase(chase: Chase): void {
  if (chase.steps.length === 0) return

  runningChases.set(chase.id, {
    chaseId: chase.id,
    startTime: performance.now(),
    currentStep: 0,
    bounceForward: true,
    lastRandomStep: -1
  })

  if (!rafId) {
    rafId = requestAnimationFrame(updateChases)
  }
}

export function stopChase(id: string): void {
  runningChases.delete(id)
  removeLayer(`chase_${id}`)
  if (runningChases.size === 0 && rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

export function stopAllChases(): void {
  for (const [id] of runningChases) {
    removeLayer(`chase_${id}`)
  }
  runningChases.clear()
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

// --------------- Engine Loop ---------------

function updateChases(): void {
  const now = performance.now()
  const playbackStore = usePlaybackStore.getState()
  const patchStore = usePatchStore.getState()

  for (const [id, running] of runningChases) {
    const chase = playbackStore.chases.find(c => c.id === id)
    if (!chase || !chase.isPlaying || chase.steps.length === 0) {
      runningChases.delete(id)
      removeLayer(`chase_${id}`)
      continue
    }

    const stepCount = chase.steps.length
    const msPerBeat = 60000 / chase.bpm
    const elapsed = now - running.startTime
    const fadeRatio = chase.fadePercent / 100

    const stepDuration = msPerBeat
    const cycleTime = elapsed % stepDuration
    const progress = cycleTime / stepDuration
    const totalSteps = Math.floor(elapsed / stepDuration)

    // Compute step index based on direction
    let stepIndex: number
    if (stepCount === 1) {
      stepIndex = 0
    } else {
      switch (chase.direction) {
        case 'forward':
          stepIndex = totalSteps % stepCount
          break
        case 'backward':
          stepIndex = (stepCount - 1) - (totalSteps % stepCount)
          break
        case 'bounce': {
          const bounceLen = (stepCount - 1) * 2
          const pos = totalSteps % bounceLen
          stepIndex = pos < stepCount ? pos : bounceLen - pos
          break
        }
        case 'random':
          if (totalSteps !== running.currentStep) {
            let next: number
            do {
              next = Math.floor(Math.random() * stepCount)
            } while (next === running.lastRandomStep && stepCount > 1)
            running.lastRandomStep = next
            running.currentStep = totalSteps
          }
          stepIndex = running.lastRandomStep >= 0 ? running.lastRandomStep : 0
          break
        default:
          stepIndex = totalSteps % stepCount
      }
    }

    const currentStepData = chase.steps[stepIndex]
    if (!currentStepData) continue

    // Build mixer layer for this chase
    const layerChannels = new Map<number, Map<number, number>>()

    // Get next step for crossfade
    const nextStepIndex = getNextStepIndex(stepIndex, stepCount, chase.direction)
    const nextStepData = chase.steps[nextStepIndex]

    // Build output with optional crossfade
    if (fadeRatio > 0 && nextStepData && progress > (1 - fadeRatio)) {
      const fadeProgress = (progress - (1 - fadeRatio)) / fadeRatio
      const t = fadeProgress * fadeProgress * (3 - 2 * fadeProgress) // smooth step

      applyStepValues(currentStepData.values, 1 - t, patchStore, layerChannels, chase.faderLevel)
      applyStepValues(nextStepData.values, t, patchStore, layerChannels, chase.faderLevel)
    } else {
      applyStepValues(currentStepData.values, 1, patchStore, layerChannels, chase.faderLevel)
    }

    setLayer(`chase_${chase.id}`, layerChannels, chase.priority ?? 40)

    // Update store's currentStepIndex for UI
    if (chase.currentStepIndex !== stepIndex) {
      playbackStore.setChaseStep?.(id, stepIndex)
    }
  }

  if (runningChases.size > 0) {
    rafId = requestAnimationFrame(updateChases)
  } else {
    rafId = null
  }
}

function getNextStepIndex(current: number, count: number, direction: string): number {
  if (count <= 1) return 0
  switch (direction) {
    case 'forward': return (current + 1) % count
    case 'backward': return (current - 1 + count) % count
    case 'bounce': return current < count - 1 ? current + 1 : current - 1
    default: return (current + 1) % count
  }
}

function applyStepValues(
  values: CueChannelValue[],
  weight: number,
  patchStore: any,
  layerChannels: Map<number, Map<number, number>>,
  faderLevel: number
): void {
  const masterScale = faderLevel / 255

  for (const cv of values) {
    const entry = patchStore.patch.find((p: any) => p.id === cv.fixtureId)
    if (!entry) continue

    const def = patchStore.fixtures.find((f: any) => f.id === entry.fixtureDefId)
    if (!def) continue

    const mode = def.modes.find((m: any) => m.name === entry.modeName)
    if (!mode) continue

    const chIndex = mode.channels.findIndex(
      (ch: string) => ch.toLowerCase() === cv.channelName.toLowerCase()
    )
    if (chIndex === -1) continue

    const absChannel = entry.address - 1 + chIndex
    if (absChannel < 0 || absChannel >= 512) continue

    const scaledValue = Math.round(cv.value * weight * masterScale)
    // Additive: crossfade blending accumulates weighted values from both steps
    let uniMap = layerChannels.get(entry.universe)
    if (!uniMap) {
      uniMap = new Map()
      layerChannels.set(entry.universe, uniMap)
    }
    const existing = uniMap.get(absChannel) ?? 0
    uniMap.set(absChannel, Math.min(255, existing + scaledValue))
  }
}
