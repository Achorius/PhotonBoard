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
//
// Pro additions (all opt-in, the fast path is unchanged without them):
//  - Per-key timing (`CueTiming.perKey`) built ONCE per GO by
//    buildCueTiming(): value fade/delay → cue part → feature timing →
//    cue timing, every time divided by the cuelist rate.
//  - computeTrackedState options: tracking off (a cue plays only its own
//    values), block cues (tracking restarts at the last block cue),
//    preset references resolved at GO time.
//  - applyMoveInBlack(): pre-position fixtures that are dark in this
//    cue and lit in the next one (mibTiming() times those moves).
//  - pause / resume of a running fade, manual (X-fade fader) fades,
//    retarget (live preset update while a fade runs).
// ============================================================

import type { Cue, CueChannelValue, CueFeature, MibSettings } from '@shared/types'
import { blendValues, segmentProgress, smoothstep } from './fade-math'
import { cueKey, splitCueKey, type KeyMeta, type KeyMetaFn } from './fixture-index'

/** Per-key timing of one GO (milliseconds, rate already applied) */
export interface KeyTiming {
  delayMs: number
  upMs: number
  downMs: number
}

export interface CueTiming {
  /** seconds */
  fadeIn: number
  /** seconds */
  fadeOut: number
  /** seconds */
  delay: number
  /**
   * Per-key timing (ms). Keys missing here use the cue-level times above.
   * Undefined → every key uses the cue-level times (fast path).
   */
  perKey?: Map<string, KeyTiming>
}

/** KeyMeta plus the attribute feature of the key (per-feature timing) */
export interface CueKeyMeta extends KeyMeta {
  feature?: CueFeature
}

export type CueKeyMetaFn = (key: string) => CueKeyMeta

/** Value of a preset-referenced cue value right now (undefined → keep `value`) */
export type CueValueResolver = (cv: CueChannelValue) => number | undefined

export interface TrackOptions {
  /** Default true. false: a cue plays only its own values */
  tracking?: boolean
  /** Resolves preset references at GO time */
  resolve?: CueValueResolver
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

export interface CueGoOptions {
  /** The fade is driven by setManualProgress() (X-fade fader) instead of the clock */
  manual?: boolean
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
  /** Per-key timing (pro); null = fast path */
  perKey: Map<string, KeyTiming> | null
  /** Keys this GO starts to output (not in `held`): hidden until their own delay ends */
  newKeys: string[]
  /** Clock time the fade was paused at (null = running) */
  pausedAt: number | null
  /** Manual progress 0..1 (X-fade fader), null = clock driven */
  manual: number | null
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

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** First cue whose values count for cue `last` (tracking off → itself; block cue → the last block). */
function trackingStart(cues: Cue[], last: number, tracking: boolean | undefined): number {
  if (tracking === false) return last
  for (let i = last; i > 0; i--) if (cues[i]?.block) return i
  return 0
}

/**
 * Tracked state of cue `index`: every value of cues 0..index, later cues win.
 * `opts.tracking === false`: only the cue's own values. A block cue stops
 * tracking (values before it are ignored). `opts.resolve` gives preset
 * references their current value.
 */
export function computeTrackedState(cues: Cue[], index: number, opts?: TrackOptions): Map<string, number> {
  const state = new Map<string, number>()
  const last = Math.min(index, cues.length - 1)
  if (last < 0) return state
  const first = trackingStart(cues, last, opts?.tracking)
  const resolve = opts?.resolve
  for (let i = first; i <= last; i++) {
    for (const cv of cues[i]?.values ?? []) {
      if (!cv || typeof cv.fixtureId !== 'string' || typeof cv.channelName !== 'string') continue
      let v = Number(cv.value)
      if (resolve && cv.presetId) {
        const r = resolve(cv)
        if (r !== undefined && Number.isFinite(r)) v = r
      }
      if (!Number.isFinite(v)) continue
      state.set(cueKey(cv.fixtureId, cv.channelName), clampByte(v))
    }
  }
  return state
}

function seconds(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A time override (seconds) when set and valid, else the fallback */
function override(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

function validRate(rate: number | undefined): number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1
}

/** Does the cue use any per-key timing (feature timing, parts, value fade / delay)? */
export function cueHasPerKeyTiming(cue: Cue): boolean {
  if (cue.featureTiming && Object.keys(cue.featureTiming).length > 0) return true
  if (cue.parts && cue.parts.length > 0) {
    for (const cv of cue.values) if (cv && cv.part !== undefined) return true
  }
  for (const cv of cue.values) {
    if (cv && (cv.fade !== undefined || cv.delay !== undefined)) return true
  }
  return false
}

/**
 * Timing of one GO. Precedence per key: value fade/delay → cue part →
 * feature timing → cue timing; every time divided by `rate` (cuelist rate).
 * Feature fade replaces the cue's fade-in (intensity going down keeps the
 * fade-out); a part / value fade applies both ways. `keys` = every key the
 * GO moves (target + current output). Without any per-key data the result
 * has no `perKey` (engine fast path).
 */
export function buildCueTiming(cue: Cue, keys: Iterable<string>, meta: CueKeyMetaFn, rate = 1): CueTiming {
  const r = validRate(rate)
  const base: CueTiming = { fadeIn: seconds(cue.fadeIn) / r, fadeOut: seconds(cue.fadeOut) / r, delay: seconds(cue.delay) / r }
  if (!cueHasPerKeyTiming(cue)) return base

  const byKey = new Map<string, CueChannelValue>()
  for (const cv of cue.values) {
    if (cv && typeof cv.fixtureId === 'string' && typeof cv.channelName === 'string') byKey.set(cueKey(cv.fixtureId, cv.channelName), cv)
  }
  const parts = cue.parts ?? []
  const perKey = new Map<string, KeyTiming>()
  const k = 1000 / r
  for (const key of keys) {
    if (perKey.has(key)) continue
    let delay = seconds(cue.delay)
    let up = seconds(cue.fadeIn)
    let down = seconds(cue.fadeOut)
    const m = meta(key)
    const ft = m.feature ? cue.featureTiming?.[m.feature] : undefined
    if (ft) {
      up = override(ft.fade, up)
      delay = override(ft.delay, delay)
    }
    const cv = byKey.get(key)
    if (cv && cv.part !== undefined) {
      const part = parts.find(p => p.index === cv.part)
      if (part) {
        up = override(part.fade, up)
        down = override(part.fadeOut, override(part.fade, down))
        delay = override(part.delay, delay)
      }
    }
    if (cv) {
      if (cv.fade !== undefined) {
        up = override(cv.fade, up)
        down = override(cv.fade, down)
      }
      delay = override(cv.delay, delay)
    }
    perKey.set(key, { delayMs: delay * k, upMs: up * k, downMs: down * k })
  }
  return { ...base, perKey }
}

export interface MoveInBlackOptions extends TrackOptions {
  /** Cue that follows `index` (default index + 1; -1 = none) */
  nextIndex?: number
}

/**
 * Move-In-Black (pure): non-intensity values of the NEXT cue for every
 * fixture that is dark in cue `index` (no intensity above 0) and lit in
 * the next cue. The caller merges them into cue `index`'s target and
 * times them with mibTiming(). Empty when there is no next cue.
 */
export function applyMoveInBlack(cues: Cue[], index: number, meta: KeyMetaFn, opts: MoveInBlackOptions = {}): Map<string, number> {
  const out = new Map<string, number>()
  const next = opts.nextIndex ?? index + 1
  if (index < 0 || index >= cues.length || next < 0 || next >= cues.length || next === index) return out
  const cur = computeTrackedState(cues, index, opts)
  const nxt = computeTrackedState(cues, next, opts)

  const litIn = (state: Map<string, number>): Set<string> => {
    const lit = new Set<string>()
    for (const [key, value] of state) {
      if (value > 0 && meta(key).intensity) lit.add(splitCueKey(key)[0])
    }
    return lit
  }
  const litNow = litIn(cur)
  const litNext = litIn(nxt)
  for (const [key, value] of nxt) {
    const fixtureId = splitCueKey(key)[0]
    if (litNow.has(fixtureId) || !litNext.has(fixtureId)) continue
    if (meta(key).intensity) continue
    if (cur.get(key) === value) continue
    out.set(key, value)
  }
  return out
}

/**
 * Timing of the Move-In-Black moves of one GO: each pre-positioned key
 * waits until its fixture's intensity has finished fading out in this GO,
 * plus the MIB delay, then moves in the MIB fade (both divided by `rate`).
 * `keys` = every key the GO moves (to find the fixture's intensity keys).
 */
export function mibTiming(
  timing: CueTiming, mibKeys: Iterable<string>, mib: Pick<MibSettings, 'delay' | 'fade'>, keys: Iterable<string>, meta: KeyMetaFn, rate = 1
): CueTiming {
  const r = validRate(rate)
  const perKey = new Map(timing.perKey ?? [])
  // When the fixtures' intensity finishes going dark
  const darkAt = new Map<string, number>()
  for (const key of keys) {
    if (!meta(key).intensity) continue
    const kt = timing.perKey?.get(key)
    const end = kt ? kt.delayMs + kt.downMs : (timing.delay + timing.fadeOut) * 1000
    const f = splitCueKey(key)[0]
    darkAt.set(f, Math.max(darkAt.get(f) ?? 0, end))
  }
  const delayMs = seconds(mib.delay) * 1000 / r
  const fadeMs = seconds(mib.fade) * 1000 / r
  for (const key of mibKeys) {
    const f = splitCueKey(key)[0]
    perKey.set(key, { delayMs: (darkAt.get(f) ?? 0) + delayMs, upMs: fadeMs, downMs: fadeMs })
  }
  return { ...timing, perKey }
}

const NO_KEYS: string[] = []

export class CueEngine {
  private readonly runs = new Map<string, CuelistRun>()

  constructor(private readonly opts: CueEngineOptions) {}

  /**
   * Crossfade a cuelist to `target` (its new tracked state), starting from
   * whatever it outputs at `now`.
   */
  go(cuelistId: string, target: Map<string, number>, timing: CueTiming, now: number, goOpts?: CueGoOptions): void {
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
    const perKey = timing.perKey && timing.perKey.size > 0 ? timing.perKey : null
    let endMs = delayMs + Math.max(upMs, downMs, ltpMs)
    let newKeys = NO_KEYS
    if (perKey) {
      endMs = 0
      newKeys = []
      for (const key of to.keys()) {
        const kt = perKey.get(key)
        const end = kt ? kt.delayMs + Math.max(kt.upMs, kt.downMs) : delayMs + Math.max(upMs, downMs, ltpMs)
        if (end > endMs) endMs = end
        if (!from.has(key)) newKeys.push(key)
      }
    }
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
      endMs,
      perKey,
      newKeys,
      pausedAt: null,
      manual: goOpts?.manual ? 0 : null
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

  /** Freeze a running fade at `now` (output held). False when nothing is fading. */
  pause(cuelistId: string, now: number): boolean {
    const fade = this.runs.get(cuelistId)?.fade
    if (!fade || fade.manual !== null) return false
    if (fade.pausedAt === null) fade.pausedAt = now
    return true
  }

  /** Continue a paused fade from where it stopped. */
  resume(cuelistId: string, now: number): void {
    const fade = this.runs.get(cuelistId)?.fade
    if (!fade || fade.pausedAt === null) return
    fade.start += Math.max(0, now - fade.pausedAt)
    fade.pausedAt = null
  }

  isPaused(cuelistId: string): boolean {
    const fade = this.runs.get(cuelistId)?.fade
    return !!fade && fade.pausedAt !== null
  }

  /** The running fade is driven by setManualProgress() */
  isManual(cuelistId: string): boolean {
    const fade = this.runs.get(cuelistId)?.fade
    return !!fade && fade.manual !== null
  }

  /** Position (0..1) of a manual fade; completes on the next update() at 1. */
  setManualProgress(cuelistId: string, progress: number): void {
    const fade = this.runs.get(cuelistId)?.fade
    if (!fade || fade.manual === null) return
    fade.manual = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  }

  /**
   * New target values for a playing cuelist (live preset update): a running
   * fade keeps its timing and heads to the new values; an idle cuelist snaps.
   */
  retarget(cuelistId: string, target: Map<string, number>, now: number): void {
    const run = this.runs.get(cuelistId)
    if (!run) return
    const fade = run.fade
    if (!fade) {
      this.go(cuelistId, target, { fadeIn: 0, fadeOut: 0, delay: 0 }, now)
      return
    }
    for (const [key, value] of target) {
      fade.to.set(key, value)
      fade.release.delete(key)
    }
  }

  /** Advance every running fade to `now`. */
  update(now: number): CueUpdateResult {
    const changed = new Map<string, Map<string, number>>()
    const completed: string[] = []
    for (const [id, run] of this.runs) {
      const fade = run.fade
      if (!fade) continue
      const values = this.valuesAt(run, now)
      run.current = values
      changed.set(id, values)
      const done = fade.manual !== null ? fade.manual >= 1 : fade.pausedAt === null && now - fade.start >= fade.endMs
      if (done) {
        for (const key of fade.release) values.delete(key)
        run.fade = null
        completed.push(id)
      }
    }
    return { changed, completed }
  }

  /** Time elapsed in the fade (paused / manual aware) */
  private elapsed(fade: FadeRun, now: number): number {
    if (fade.manual !== null) return fade.manual * fade.endMs
    return (fade.pausedAt ?? now) - fade.start
  }

  private valuesAt(run: CuelistRun, now: number): Map<string, number> {
    const fade = run.fade
    if (!fade) return new Map(run.current)
    const elapsed = this.elapsed(fade, now)
    const meta = this.opts.meta
    const perKey = fade.perKey
    if (!perKey) {
      const t = elapsed - fade.delayMs
      if (t < 0) {
        // Delay: hold the output of the GO moment — nothing dropped, nothing new yet
        return new Map(fade.held)
      }
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

    // Per-key timing: every key runs its own delay and fade
    const out = blendValues(
      fade.from,
      fade.to,
      (key, fromValue, toValue) => {
        const kt = perKey.get(key)
        const t = elapsed - (kt ? kt.delayMs : fade.delayMs)
        if (t < 0) return 0
        const m = meta(key)
        const ms = !m.intensity
          ? (kt ? kt.upMs : fade.ltpMs)
          : toValue >= fromValue ? (kt ? kt.upMs : fade.upMs) : (kt ? kt.downMs : fade.downMs)
        return smoothstep(segmentProgress(t, ms))
      },
      meta
    )
    // Keys new to this cuelist are not output before their delay ends (as the cue-level delay does)
    for (let i = 0; i < fade.newKeys.length; i++) {
      const key = fade.newKeys[i]
      const m = meta(key)
      const timedBy = m.coarseKey && fade.to.has(m.coarseKey) ? m.coarseKey : key
      const kt = perKey.get(timedBy)
      if (elapsed < (kt ? kt.delayMs : fade.delayMs)) out.delete(key)
    }
    return out
  }
}
