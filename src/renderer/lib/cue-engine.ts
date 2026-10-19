// ============================================================
// PhotonBoard — Cue Engine
// Tracking crossfades for cuelists.
//
//  - Each cuelist keeps a persistent "current output" map. A GO
//    crossfades from the CURRENT output (also mid-fade) to the new
//    cue's tracked state (all cues up to it, later values win).
//  - Intensity going up uses the cue's fade-in time, going down its
//    fade-out time; non-intensity (LTP) channels use fade-in.
//  - Intensity channels no longer in the tracked state fade to 0 and
//    are then released; LTP channels hold their value.
//  - The delay holds the current output (nothing is dropped) before
//    the fade starts. Zero times snap.
//  - Time is injected (`now` in ms) — no rAF, no performance.now().
// ============================================================

import type { Cue } from '@shared/types'
import { blendValues, segmentProgress, smoothstep } from './fade-math'
import { cueKey, type KeyMetaFn } from './fixture-index'

export interface CueTiming {
  /** seconds */
  fadeIn: number
  /** seconds */
  fadeOut: number
  /** seconds */
  delay: number
}

export interface CueEngineOptions {
  /** How a key behaves (intensity / 16-bit pair). */
  meta: KeyMetaFn
  /**
   * Value a channel has right now when this cuelist does not control it yet
   * (e.g. the live mix). Intensity channels always start from 0.
   * Undefined → the channel snaps to its target.
   */
  startValue?: (key: string) => number | undefined
}

interface FadeRun {
  /** Output of the cuelist when the GO happened (held during the delay) */
  held: Map<string, number>
  /** Start value of every faded key */
  from: Map<string, number>
  to: Map<string, number>
  /** keys to drop from the output once the fade completes (released intensity) */
  release: Set<string>
  start: number
  delayMs: number
  upMs: number
  downMs: number
  ltpMs: number
  endMs: number
}

interface CuelistRun {
  /** Output computed at the last update (or at the last GO) */
  current: Map<string, number>
  fade: FadeRun | null
}

export interface CueUpdateResult {
  /** Cuelists whose output changed this frame */
  changed: Map<string, Map<string, number>>
  /** Cuelists whose fade finished this frame */
  completed: string[]
}

/** Tracked state of cue `index`: every value of cues 0..index, later cues win. */
export function computeTrackedState(cues: Cue[], index: number): Map<string, number> {
  const state = new Map<string, number>()
  const last = Math.min(index, cues.length - 1)
  for (let i = 0; i <= last; i++) {
    for (const cv of cues[i]?.values ?? []) {
      if (!cv || typeof cv.fixtureId !== 'string' || typeof cv.channelName !== 'string') continue
      const v = Number(cv.value)
      if (!Number.isFinite(v)) continue
      state.set(cueKey(cv.fixtureId, cv.channelName), Math.max(0, Math.min(255, Math.round(v))))
    }
  }
  return state
}

function seconds(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export class CueEngine {
  private readonly runs = new Map<string, CuelistRun>()

  constructor(private readonly opts: CueEngineOptions) {}

  /**
   * Crossfade a cuelist to `target` (its new tracked state), starting from
   * whatever it outputs at `now`.
   */
  go(cuelistId: string, target: Map<string, number>, timing: CueTiming, now: number): void {
    const run = this.runs.get(cuelistId)
    const from = run ? this.valuesAt(run, now) : new Map<string, number>()

    const to = new Map(target)
    const release = new Set<string>()
    for (const [key, value] of from) {
      if (to.has(key)) continue
      if (this.opts.meta(key).intensity) {
        to.set(key, 0)
        release.add(key)
      } else {
        to.set(key, value) // LTP tracks: hold
      }
    }

    const delayMs = seconds(timing.delay) * 1000
    const upMs = seconds(timing.fadeIn) * 1000
    const downMs = seconds(timing.fadeOut) * 1000
    const ltpMs = upMs
    const fade: FadeRun = {
      held: from,
      from,
      to,
      release,
      start: now,
      delayMs,
      upMs,
      downMs,
      ltpMs,
      endMs: delayMs + Math.max(upMs, downMs, ltpMs)
    }

    // Initial values for channels this cuelist did not drive yet
    const startFrom = new Map(from)
    for (const key of to.keys()) {
      if (startFrom.has(key)) continue
      const m = this.opts.meta(key)
      if (m.coarseKey && to.has(m.coarseKey)) continue // handled with its coarse key
      const s = m.intensity ? 0 : this.opts.startValue?.(key)
      if (s !== undefined) {
        startFrom.set(key, s)
        if (m.fineKey && !startFrom.has(m.fineKey)) {
          const sf = m.intensity ? 0 : this.opts.startValue?.(m.fineKey)
          if (sf !== undefined) startFrom.set(m.fineKey, sf)
        }
      }
    }
    fade.from = startFrom

    const next: CuelistRun = { current: from, fade }
    next.current = this.valuesAt(next, now)
    this.runs.set(cuelistId, next)
  }

  /** Forget a cuelist (its layer is released by the caller). */
  stop(cuelistId: string): void {
    this.runs.delete(cuelistId)
  }

  stopAll(): void {
    this.runs.clear()
  }

  has(cuelistId: string): boolean {
    return this.runs.has(cuelistId)
  }

  isFading(cuelistId: string): boolean {
    return !!this.runs.get(cuelistId)?.fade
  }

  /** Last computed output of a cuelist. */
  getOutput(cuelistId: string): Map<string, number> | undefined {
    return this.runs.get(cuelistId)?.current
  }

  /** Advance every running fade to `now`. */
  update(now: number): CueUpdateResult {
    const changed = new Map<string, Map<string, number>>()
    const completed: string[] = []
    for (const [id, run] of this.runs) {
      if (!run.fade) continue
      const values = this.valuesAt(run, now)
      run.current = values
      changed.set(id, values)
      if (now - run.fade.start >= run.fade.endMs) {
        for (const key of run.fade.release) values.delete(key)
        run.fade = null
        completed.push(id)
      }
    }
    return { changed, completed }
  }

  private valuesAt(run: CuelistRun, now: number): Map<string, number> {
    const fade = run.fade
    if (!fade) return new Map(run.current)
    const t = now - fade.start - fade.delayMs
    if (t < 0) {
      // Delay: hold the output of the GO moment — nothing dropped, nothing new yet
      return new Map(fade.held)
    }
    const meta = this.opts.meta
    return blendValues(
      fade.from,
      fade.to,
      (key, fromValue, toValue) => {
        const m = meta(key)
        const ms = !m.intensity ? fade.ltpMs : toValue >= fromValue ? fade.upMs : fade.downMs
        return smoothstep(segmentProgress(t, ms))
      },
      meta
    )
  }
}
