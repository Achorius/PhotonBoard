// ============================================================
// PhotonBoard — Chase Engine
// BPM-based step sequencer with crossfade.
//
//  - Step position is accumulated incrementally (phase += dt / step
//    duration), so a BPM change (incl. tap tempo) never jumps steps.
//  - The next step is decided when a step starts: bounce knows its
//    direction, random its pick — the crossfade always heads to the
//    step that will actually play next.
//  - holdTime overrides the step duration; non-looping chases stop on
//    the last step (and hold it).
//  - Output values are raw; the chase fader is applied by the mixer as
//    the layer master (intensity channels only).
//  - Time is injected (`now` in ms).
// ============================================================

import type { Chase, ChaseStep } from '@shared/types'
import { blendValues, smoothstep } from './fade-math'
import { cueKey, type KeyMetaFn } from './fixture-index'

interface RunningChase {
  stepIndex: number
  nextIndex: number
  /** 0..1 position inside the current step */
  phase: number
  lastUpdate: number
  /** bounce: currently moving toward higher indices */
  forward: boolean
  /** bounce: the top step has been reached at least once */
  bounced: boolean
  /** non-looping chase reached its last step */
  finished: boolean
}

export interface ChaseFrame {
  values: Map<string, number>
  stepIndex: number
  finished: boolean
}

export type RandomFn = () => number

function stepValues(step: ChaseStep | undefined): Map<string, number> {
  const map = new Map<string, number>()
  for (const cv of step?.values ?? []) {
    const v = Number(cv?.value)
    if (!cv || !Number.isFinite(v)) continue
    map.set(cueKey(cv.fixtureId, cv.channelName), Math.max(0, Math.min(255, Math.round(v))))
  }
  return map
}

/** Duration of a step in ms (holdTime overrides the BPM). */
export function stepDurationMs(chase: Chase, stepIndex: number): number {
  const hold = Number(chase.steps[stepIndex]?.holdTime)
  if (Number.isFinite(hold) && hold > 0) return hold * 1000
  const bpm = Number(chase.bpm)
  return 60000 / (Number.isFinite(bpm) && bpm > 0 ? Math.min(999, bpm) : 120)
}

export class ChaseEngine {
  private readonly running = new Map<string, RunningChase>()

  constructor(private readonly meta: KeyMetaFn, private readonly random: RandomFn = Math.random) {}

  start(chase: Chase, now: number): void {
    if (chase.steps.length === 0) return
    const first = chase.direction === 'backward' ? chase.steps.length - 1
      : chase.direction === 'random' ? Math.floor(this.random() * chase.steps.length)
        : 0
    const run: RunningChase = {
      stepIndex: first,
      nextIndex: first,
      phase: 0,
      lastUpdate: now,
      forward: true,
      bounced: false,
      finished: false
    }
    run.nextIndex = this.pickNext(chase, run)
    this.running.set(chase.id, run)
  }

  stop(id: string): void {
    this.running.delete(id)
  }

  stopAll(): void {
    this.running.clear()
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  runningIds(): string[] {
    return Array.from(this.running.keys())
  }

  /** Advance a chase to `now` and compute its output. */
  update(chase: Chase, now: number): ChaseFrame | null {
    const run = this.running.get(chase.id)
    if (!run) return null
    const count = chase.steps.length
    if (count === 0) {
      return { values: new Map(), stepIndex: 0, finished: true }
    }
    if (run.stepIndex >= count) run.stepIndex = count - 1
    if (run.nextIndex >= count) run.nextIndex = this.pickNext(chase, run)

    const dt = Math.max(0, now - run.lastUpdate)
    run.lastUpdate = now

    if (!run.finished) {
      run.phase += dt / stepDurationMs(chase, run.stepIndex)
      let guard = 0
      while (run.phase >= 1 && !run.finished && guard++ < 1000) {
        if (this.isLastStep(chase, run) && !chase.isLooping) {
          run.finished = true
          run.phase = 0
          break
        }
        // carry the overshoot into the next step, rescaled to its duration
        const overshootMs = (run.phase - 1) * stepDurationMs(chase, run.stepIndex)
        run.stepIndex = run.nextIndex
        run.nextIndex = this.pickNext(chase, run)
        run.phase = overshootMs / stepDurationMs(chase, run.stepIndex)
      }
    }

    const current = stepValues(chase.steps[run.stepIndex])
    const fadeRatio = Math.max(0, Math.min(100, Number(chase.fadePercent) || 0)) / 100
    const fading = !run.finished && fadeRatio > 0 && run.phase > 1 - fadeRatio &&
      !(this.isLastStep(chase, run) && !chase.isLooping)

    let values = current
    if (fading) {
      const t = smoothstep((run.phase - (1 - fadeRatio)) / fadeRatio)
      const next = stepValues(chase.steps[run.nextIndex])
      // Channels missing in the next step: intensity fades out, LTP holds
      const to = new Map(next)
      for (const [key, value] of current) {
        if (!to.has(key)) to.set(key, this.meta(key).intensity ? 0 : value)
      }
      values = blendValues(current, to, () => t, this.meta, () => 0)
    }

    return { values, stepIndex: run.stepIndex, finished: run.finished }
  }

  private isLastStep(chase: Chase, run: RunningChase): boolean {
    const count = chase.steps.length
    switch (chase.direction) {
      case 'backward': return run.stepIndex === 0
      case 'bounce': return count <= 1 || (run.bounced && run.stepIndex === 0)
      default: return run.stepIndex === count - 1
    }
  }

  /** Decide which step follows the current one (updates bounce direction). */
  private pickNext(chase: Chase, run: RunningChase): number {
    const count = chase.steps.length
    const cur = run.stepIndex
    if (count <= 1) return 0
    switch (chase.direction) {
      case 'backward':
        return (cur - 1 + count) % count
      case 'bounce': {
        if (run.forward && cur >= count - 1) {
          run.forward = false
          run.bounced = true
        } else if (!run.forward && cur <= 0) run.forward = true
        return run.forward ? cur + 1 : cur - 1
      }
      case 'random': {
        let next = Math.floor(this.random() * (count - 1))
        if (next >= cur) next++ // never repeat the current step
        return Math.max(0, Math.min(count - 1, next))
      }
      case 'forward':
      default:
        return (cur + 1) % count
    }
  }
}
