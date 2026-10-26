// ============================================================
// PhotonBoard — touch wizards: the step logic, without Electron
//
// IdentifyFlow     "Touch screen N", one screen at a time: the first touch
//                  of a panel (read from its event nodes) assigns it to
//                  screen N. Skip / Cancel are tapped on the overlays: a
//                  touch that lands on the button bar of any overlay within
//                  `settleMs` of the raw touch is a button press, not an
//                  assignment. A step times out (auto-skip). Panels already
//                  assigned are ignored; the wizard ends once every panel is
//                  assigned or every screen was asked.
// CalibrationFlow  4 corner targets → fit (rejected when inconsistent) →
//                  candidate applied → centre check → Save / Retry / Cancel.
// Timers are injectable (tests).
// ============================================================

import { CALIBRATION_CHECK, CALIBRATION_TARGETS, computeCalibration, type Mat3, type Point } from './touch-setup'

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  now(): number
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now()
}

export type TapRegion = 'content' | 'chrome'

// ---------------------------------------------------------------
// Assignment ("identify")
// ---------------------------------------------------------------

export interface IdentifyFlowOptions {
  /** Output names, in screen order */
  outputs: string[]
  /** Panel keys */
  panels: string[]
  /** Auto-skip after this long on one screen */
  stepMs?: number
  /** A raw touch waits this long for a button-bar tap before it assigns */
  settleMs?: number
  /** "✓ assigned" stays on screen this long before the next step */
  confirmMs?: number
  /** No access to the event nodes: taps on the overlays count as touches of this (only) panel */
  fallbackPanel?: string | null
  timers?: Timers
  onChange: () => void
  onFinish: (result: { canceled: boolean; results: (string | null)[] }) => void
}

export type IdentifyPhase = 'touch' | 'assigned' | 'skipped' | 'done'

export class IdentifyFlow {
  step = 0
  phase: IdentifyPhase = 'touch'
  /** Panel key per screen (null = skipped / no panel), filled step by step */
  readonly results: (string | null)[] = []
  stepEndsAt = 0
  private readonly used = new Set<string>()
  private readonly t: Timers
  private stepTimer: unknown = null
  private nextTimer: unknown = null
  private pending: { key: string; handle: unknown } | null = null
  private lastChromeTap = -Infinity
  private readonly stepMs: number
  private readonly settleMs: number
  private readonly confirmMs: number

  constructor(private readonly o: IdentifyFlowOptions) {
    this.t = o.timers ?? realTimers
    this.stepMs = o.stepMs ?? 20_000
    this.settleMs = o.settleMs ?? 300
    this.confirmMs = o.confirmMs ?? 900
  }

  get finished(): boolean { return this.phase === 'done' }

  start(): void {
    if (!this.o.outputs.length || !this.o.panels.length) { this.finish(false); return }
    this.beginStep()
  }

  remainingMs(): number {
    return Math.max(0, this.stepEndsAt - this.t.now())
  }

  /** A touch-down read from a panel's event node */
  rawTouch(key: string): void {
    if (this.phase !== 'touch' || this.pending || this.used.has(key) || !this.o.panels.includes(key)) return
    if (this.t.now() - this.lastChromeTap < this.settleMs) return
    const handle = this.t.setTimeout(() => {
      this.pending = null
      if (this.phase !== 'touch' || this.t.now() - this.lastChromeTap <= this.settleMs) return
      this.assign(key)
    }, this.settleMs)
    this.pending = { key, handle }
  }

  /** A pointer-down on any overlay */
  tap(region: TapRegion, pointerType = ''): void {
    if (this.finished) return
    if (region === 'chrome') {
      this.lastChromeTap = this.t.now()
      if (this.pending) {
        this.t.clearTimeout(this.pending.handle)
        this.pending = null
      }
      return
    }
    if (this.o.fallbackPanel && pointerType !== 'mouse') this.rawTouch(this.o.fallbackPanel)
  }

  button(id: string): void {
    if (this.finished) return
    if (id === 'cancel') this.finish(true)
    else if (id === 'skip' && this.phase === 'touch') this.skip()
  }

  private beginStep(): void {
    this.phase = 'touch'
    this.stepEndsAt = this.t.now() + this.stepMs
    this.stepTimer = this.t.setTimeout(() => { if (this.phase === 'touch') this.skip() }, this.stepMs)
    this.o.onChange()
  }

  private endStep(phase: 'assigned' | 'skipped', delay: number): void {
    this.t.clearTimeout(this.stepTimer)
    if (this.pending) { this.t.clearTimeout(this.pending.handle); this.pending = null }
    this.phase = phase
    this.o.onChange()
    this.nextTimer = this.t.setTimeout(() => this.next(), delay)
  }

  private assign(key: string): void {
    this.results[this.step] = key
    this.used.add(key)
    this.endStep('assigned', this.confirmMs)
  }

  private skip(): void {
    this.results[this.step] = null
    this.endStep('skipped', Math.min(this.confirmMs, 500))
  }

  private next(): void {
    if (this.finished) return
    this.step++
    if (this.step >= this.o.outputs.length || this.used.size >= this.o.panels.length) this.finish(false)
    else this.beginStep()
  }

  private finish(canceled: boolean): void {
    if (this.phase === 'done') return
    this.t.clearTimeout(this.stepTimer)
    this.t.clearTimeout(this.nextTimer)
    if (this.pending) { this.t.clearTimeout(this.pending.handle); this.pending = null }
    this.phase = 'done'
    const results = this.o.outputs.map((_, i) => this.results[i] ?? null)
    this.o.onFinish({ canceled, results })
  }
}

// ---------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------

export type CalibrationPhase = 'busy' | 'targets' | 'check' | 'failed' | 'result' | 'done'

export interface CalibrationFlowOptions {
  /** Output size in pixels (error in px) */
  width: number
  height: number
  /** The panel's orientation (rotation / invert, output rotation) */
  orientation: Mat3
  /** Apply the panel's matrix with this calibration (null = none) */
  apply: (calibration: number[] | null) => Promise<void>
  /** Ignore a second tap this soon after the previous one */
  debounceMs?: number
  /** Give up (cancel) after this long without a touch */
  idleMs?: number
  timers?: Timers
  onChange: () => void
  onFinish: (result: { action: 'save'; calibration: number[]; errorPx: number } | { action: 'cancel' }) => void
}

export class CalibrationFlow {
  phase: CalibrationPhase = 'busy'
  /** Target being asked (0-3) */
  index = 0
  readonly points: Point[] = []
  candidate: number[] | null = null
  fitError: number | null = null
  failure: 'degenerate' | 'inconsistent' | 'implausible' | null = null
  errorPx: number | null = null
  private lastTap = -Infinity
  private idle: unknown = null
  private readonly t: Timers

  constructor(private readonly o: CalibrationFlowOptions) {
    this.t = o.timers ?? realTimers
  }

  get target(): (Point & { check?: boolean }) | null {
    if (this.phase === 'targets') return CALIBRATION_TARGETS[this.index]
    if (this.phase === 'check') return { ...CALIBRATION_CHECK, check: true }
    return null
  }

  /** Error of the centre check in % of the smaller screen side */
  get errorPercent(): number | null {
    return this.errorPx === null ? null : (this.errorPx / Math.max(1, Math.min(this.o.width, this.o.height))) * 100
  }

  start(): Promise<void> {
    return this.restart()
  }

  tap(x: number, y: number, region: TapRegion): void {
    if (region === 'chrome' || !Number.isFinite(x) || !Number.isFinite(y)) return
    if (this.phase !== 'targets' && this.phase !== 'check') return
    const now = this.t.now()
    if (now - this.lastTap < (this.o.debounceMs ?? 350)) return
    this.lastTap = now
    this.armIdle()
    if (this.phase === 'targets') {
      this.points.push({ x, y })
      if (this.points.length < CALIBRATION_TARGETS.length) {
        this.index = this.points.length
        this.o.onChange()
        return
      }
      void this.fit()
      return
    }
    this.errorPx = Math.hypot((x - CALIBRATION_CHECK.x) * this.o.width, (y - CALIBRATION_CHECK.y) * this.o.height)
    this.phase = 'result'
    this.o.onChange()
  }

  button(id: string): void {
    if (this.phase === 'done') return
    if (id === 'cancel') this.finish({ action: 'cancel' })
    else if (id === 'retry' && (this.phase === 'failed' || this.phase === 'result')) void this.restart()
    else if (id === 'save' && this.phase === 'result' && this.candidate) this.finish({ action: 'save', calibration: this.candidate, errorPx: this.errorPx ?? 0 })
  }

  private async restart(): Promise<void> {
    this.phase = 'busy'
    this.points.length = 0
    this.index = 0
    this.candidate = null
    this.fitError = null
    this.failure = null
    this.errorPx = null
    this.o.onChange()
    await this.safeApply(null)
    if (this.phase !== 'busy') return
    this.phase = 'targets'
    this.armIdle()
    this.o.onChange()
  }

  private async fit(): Promise<void> {
    const r = computeCalibration(this.points, CALIBRATION_TARGETS, this.o.orientation)
    this.fitError = r.fitError ?? null
    if (!r.ok) {
      this.failure = r.reason
      this.phase = 'failed'
      this.o.onChange()
      return
    }
    this.candidate = r.calibration
    this.phase = 'busy'
    this.o.onChange()
    await this.safeApply(r.calibration)
    if (this.phase !== 'busy') return
    this.phase = 'check'
    this.o.onChange()
  }

  private async safeApply(calibration: number[] | null): Promise<void> {
    try { await this.o.apply(calibration) } catch { /* reported by the caller's apply */ }
  }

  private armIdle(): void {
    this.t.clearTimeout(this.idle)
    this.idle = this.t.setTimeout(() => this.finish({ action: 'cancel' }), this.o.idleMs ?? 90_000)
  }

  private finish(result: Parameters<CalibrationFlowOptions['onFinish']>[0]): void {
    if (this.phase === 'done') return
    this.t.clearTimeout(this.idle)
    this.phase = 'done'
    this.o.onFinish(result)
  }
}
