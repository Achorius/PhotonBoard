// ============================================================
// PhotonBoard — Chase Engine
// BPM-based step sequencer with crossfade support.
// Outputs to the DMX Mixer as named layers.
// ============================================================

import type { Chase, ChaseStep, CueChannelValue } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { setLayer, removeLayer } from './dmx-mixer'

// --------------- Types ---------------

interface RunningChase {
  chaseId: string
  startTime: number
  /** Current step index in the engine (may differ from store during transitions) */
  currentStep: number
  /** Direction tracker for bounce mode */
  bounceForward: boolean
  /** Last random step (to avoid repeats) */
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
  removeLayer(`chase:${id}`)

  if (runningChases.size === 0 && rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

export function stopAllChases(): void {
  for (const id of runningChases.keys()) {
    removeLayer(`chase:${id}`)
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

  for (const [id, running] of runningChases) {
    const chase = playbackStore.chases.find(c => c.id === id)
    if (!chase || !chase.isPlaying || chase.steps.length === 0) {
      // Chase was stopped or deleted
      runningChases.delete(id)
      removeLayer(`chase:${id}`)
      continue
    }

    const stepCount = chase.steps.length
    if (stepCount === 0) continue

    // Calculate timing
    const msPerBeat = 60000 / chase.bpm
    const elapsed = now - running.startTime
    const fadeRatio = chase.fadePercent / 100 // 0-1

    // Total step duration = one beat
    const stepDuration = msPerBeat

    // How far are we into the current step cycle?
    const cycleTime = elapsed % stepDuration
    const progress = cycleTime / stepDuration

    // Determine which step we should be on
    const totalSteps = Math.floor(elapsed / stepDuration)

    // Compute actual step index based on direction
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
          // 0,1,2,...,n-1,n-2,...,1,0,1,2,...
          const bounceLen = (stepCount - 1) * 2
          const pos = totalSteps % bounceLen
          stepIndex = pos < stepCount ? pos : bounceLen - pos
          break
        }
        case 'random':
          // Change step each beat
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

    // Get current and next step
    const currentStepData = chase.steps[stepIndex]
    const nextStepIndex = getNextStepIndex(stepIndex, stepCount, chase.direction)
    const nextStepData = chase.steps[nextStepIndex]

    if (!currentStepData) continue

    // Build DMX output with optional crossfade
    const layerChannels = new Map<number, Map<number, number>>()

    if (fadeRatio > 0 && nextStepData && progress > (1 - fadeRatio)) {
      // In fade zone: crossfade from current to next
      const fadeProgress = (progress - (1 - fadeRatio)) / fadeRatio
      const t = fadeProgress * fadeProgress * (3 - 2 * fadeProgress) // smooth step

      applyStepValues(currentStepData.values, layerChannels, 1 - t)
      applyStepValues(nextStepData.values, layerChannels, t)
    } else {
      // Static: just show current step
      applyStepValues(currentStepData.values, layerChannels, 1)
    }

    // Push to mixer
    setLayer(`chase:${id}`, layerChannels, chase.priority ?? 50, chase.faderLevel)

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
  layerChannels: Map<number, Map<number, number>>,
  weight: number
): void {
  const patchStore = usePatchStore.getState()

  for (const cv of values) {
    const entry = patchStore.patch.find(p => p.id === cv.fixtureId)
    if (!entry) continue

    const def = patchStore.fixtures.find(f => f.id === entry.fixtureDefId)
    if (!def) continue

    const mode = def.modes.find(m => m.name === entry.modeName)
    if (!mode) continue

    const chIndex = mode.channels.findIndex(
      ch => ch.toLowerCase() === cv.channelName.toLowerCase()
    )
    if (chIndex === -1) continue

    const absChannel = entry.address - 1 + chIndex
    if (absChannel < 0 || absChannel >= 512) continue

    let uniMap = layerChannels.get(entry.universe)
    if (!uniMap) {
      uniMap = new Map()
      layerChannels.set(entry.universe, uniMap)
    }

    const existing = uniMap.get(absChannel) ?? 0
    uniMap.set(absChannel, Math.round(existing + cv.value * weight))
  }
}
