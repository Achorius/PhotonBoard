// ============================================================
// PhotonBoard — State broadcast throttling for remote clients
// The renderer pushes its state up to ~30 Hz. Each server
// serialises it ONCE per flush, at its own maximum rate, and only
// sends when the JSON actually changed.
// ============================================================

export class ThrottledBroadcaster<T> {
  private latest: T | null = null
  private hasLatest = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastFlushAt = 0
  private lastJson: string | null = null

  constructor(
    private intervalMs: number,
    private serialize: (state: T) => string,
    private deliver: (json: string) => void,
    /** When false (no clients), states are only kept, not serialised */
    private isActive: () => boolean = () => true,
    private now: () => number = Date.now
  ) {}

  push(state: T): void {
    this.latest = state
    this.hasLatest = true
    if (this.timer || !this.isActive()) return
    const delay = Math.max(0, this.lastFlushAt + this.intervalMs - this.now())
    this.timer = setTimeout(() => this.flush(true), delay)
  }

  private flush(deliver: boolean): void {
    this.timer = null
    if (!this.hasLatest) return
    const state = this.latest as T
    this.latest = null
    this.hasLatest = false
    let json: string
    try {
      json = this.serialize(state)
    } catch (e) {
      console.error('[Broadcast] Cannot serialise state:', (e as Error).message)
      return
    }
    if (json === this.lastJson) return
    this.lastJson = json
    if (!deliver) return
    this.lastFlushAt = this.now()
    this.deliver(json)
  }

  /** Latest state as a message — for newly connected clients */
  getLastJson(): string | null {
    if (this.hasLatest && !this.timer) this.flush(false)
    return this.lastJson
  }

  /** Forget the dedup cache so the next push is delivered even if unchanged */
  reset(): void {
    this.lastJson = null
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.latest = null
    this.hasLatest = false
  }
}

function num(v: unknown, dflt = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt
}

function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : dflt
}

/**
 * Companion only needs names/ids/flags/levels: no DMX values, no cue contents.
 * Tolerant of both the full renderer state and an already-slim one.
 */
export function slimStateForCompanion(state: any) {
  const s = state && typeof state === 'object' ? state : {}
  const cuelists = Array.isArray(s.cuelists) ? s.cuelists : []
  const groups = Array.isArray(s.groups) ? s.groups : []
  return {
    grandMaster: num(s.grandMaster, 255),
    blackout: !!s.blackout,
    blinder: !!s.blinder,
    strobe: !!s.strobe,
    timelinePlaying: !!s.timelinePlaying,
    showName: str(s.showName, 'PhotonBoard'),
    fixtureCount: num(s.fixtureCount),
    selectedCount: Array.isArray(s.selectedFixtureIds) ? s.selectedFixtureIds.length : num(s.selectedCount),
    cuelists: cuelists
      .filter((cl: any) => cl && typeof cl.id === 'string')
      .map((cl: any) => {
        const cues = Array.isArray(cl.cues) ? cl.cues : null
        const currentCueIndex = num(cl.currentCueIndex, -1)
        return {
          id: cl.id,
          name: str(cl.name, 'Scene'),
          isPlaying: !!cl.isPlaying,
          faderLevel: num(cl.faderLevel, 255),
          currentCueIndex,
          cueCount: cues ? cues.length : num(cl.cueCount),
          currentCueName: cues && cues[currentCueIndex] ? str(cues[currentCueIndex].name) : str(cl.currentCueName)
        }
      }),
    groups: groups
      .filter((g: any) => g && typeof g.id === 'string')
      .map((g: any) => ({ id: g.id, name: str(g.name), color: str(g.color), fixtureCount: num(g.fixtureCount) }))
  }
}
