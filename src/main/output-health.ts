// ============================================================
// PhotonBoard — Per-output health bookkeeping
// Frame counter, measured fps, last error, and rate-limited error
// logging (an unplugged network cable must not print 40 lines/s).
// ============================================================

const ERROR_LOG_INTERVAL_MS = 10_000
const FPS_WINDOW_MS = 1_000

export class OutputHealth {
  framesSent = 0
  lastError: string | undefined
  lastErrorAt: number | undefined
  /** True while the most recent operation failed */
  failing = false

  private fps = 0
  private windowStart = 0
  private windowFrames = 0
  private lastLogAt = 0
  private suppressed = 0

  constructor(private name: string) {}

  frameSent(now: number): void {
    this.framesSent++
    this.windowFrames++
    this.rollWindow(now)
  }

  getFps(now: number): number {
    this.rollWindow(now)
    // No frame for 2 windows → the measured rate is stale
    if (now - this.windowStart > 2 * FPS_WINDOW_MS) return 0
    return this.fps
  }

  private rollWindow(now: number): void {
    if (this.windowStart === 0) { this.windowStart = now; return }
    const elapsed = now - this.windowStart
    if (elapsed >= FPS_WINDOW_MS) {
      this.fps = Math.round((this.windowFrames * 1000) / elapsed * 10) / 10
      this.windowFrames = 0
      this.windowStart = now
    }
  }

  /** Record a failure; logs at most once every 10 s per output. */
  fail(err: unknown, now: number): void {
    const message = err instanceof Error ? err.message : String(err)
    this.lastError = message
    this.lastErrorAt = now
    this.failing = true
    if (now - this.lastLogAt >= ERROR_LOG_INTERVAL_MS) {
      const extra = this.suppressed > 0 ? ` (+${this.suppressed} similar errors)` : ''
      console.error(`[DMX-Out] ${this.name}: ${message}${extra}`)
      this.lastLogAt = now
      this.suppressed = 0
    } else {
      this.suppressed++
    }
  }

  /** Record a success after failures (lastError is kept for the UI). */
  ok(): void {
    if (this.failing) {
      console.log(`[DMX-Out] ${this.name}: recovered`)
      this.failing = false
      this.suppressed = 0
      this.lastLogAt = 0
    }
  }
}
