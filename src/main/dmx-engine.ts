import { DMX_CHANNELS_PER_UNIVERSE, DMX_MAX, DMX_MIN, MAX_UNIVERSES } from '../shared/types'

/** `changed` is true when a channel was written since the previous tick */
type FrameCallback = (universes: Uint8Array[], changed: boolean) => void

export class DmxEngine {
  private universes: Uint8Array[]
  private universeCount: number
  private timer: ReturnType<typeof setInterval> | null = null
  private frameCallback: FrameCallback | null = null
  private refreshRate = 25 // ms (~40Hz)
  private dirty = false
  private lastCallbackErrorAt = 0
  // Strobe chop (see setStrobeChop)
  private chop: { cycle: number; lit: number; masks: Map<number, Uint16Array>; expiresAt: number } | null = null
  private chopFrame = 0
  private chopWasDark = false
  private chopBuffers: Uint8Array[] = []

  constructor(universeCount: number = MAX_UNIVERSES) {
    this.universeCount = universeCount
    this.universes = []
    for (let i = 0; i < universeCount; i++) {
      this.universes.push(new Uint8Array(DMX_CHANNELS_PER_UNIVERSE))
    }
  }

  onFrame(callback: FrameCallback): void {
    this.frameCallback = callback
  }

  start(): void {
    if (this.timer) return
    // The callback runs on EVERY tick, not only when something changed: USB
    // Open DMX adapters must stream continuously or fixtures lose signal.
    // Outputs that only need changes (Art-Net, ENTTEC Pro) filter themselves.
    this.timer = setInterval(() => {
      if (!this.frameCallback) return
      const changed = this.dirty
      this.dirty = false
      try {
        const frame = this.chopFrameData(Date.now())
        this.frameCallback(frame.universes, changed || frame.changed)
      } catch (e) {
        // Never let one bad frame stop the output loop; log at most every 5 s
        const now = Date.now()
        if (now - this.lastCallbackErrorAt > 5000) {
          this.lastCallbackErrorAt = now
          console.error('[DMX] Output frame failed:', (e as Error).stack || e)
        }
      }
    }, this.refreshRate)
  }

  /**
   * Strobe chop done here, in step with the output frames, so every flash
   * lasts the same number of frames (a chop computed by the renderer is
   * sampled unevenly by this loop). `channels`: universe → channels set to
   * 0 during the dark part of each cycle. One cycle = round(frame rate /
   * rate) frames (at least 2), lit for the first half (at least 1): at
   * 40 fps, 20 Hz = 1 lit + 1 dark, 15 Hz → 1 + 2, 10 Hz = 2 + 2, 5 Hz = 4 + 4.
   * The chop expires after `ttlMs` unless refreshed (renderer gone: no
   * channel stays chopped). null / rate <= 0 = off.
   */
  setStrobeChop(rate: number | null, channels?: Record<number, number[]> | null, now = Date.now(), ttlMs = 2000): void {
    if (rate === null || !(rate > 0) || !channels) {
      this.chop = null
      return
    }
    const fps = 1000 / this.refreshRate
    const cycle = Math.max(2, Math.round(fps / Math.min(rate, fps / 2)))
    const lit = Math.max(1, Math.floor(cycle / 2))
    const masks = new Map<number, Uint16Array>()
    for (const [u, list] of Object.entries(channels)) {
      const universe = Number(u)
      if (!Number.isInteger(universe) || universe < 0 || universe >= this.universeCount || !Array.isArray(list)) continue
      const valid = list.filter((ch) => Number.isInteger(ch) && ch >= 0 && ch < DMX_CHANNELS_PER_UNIVERSE)
      if (valid.length > 0) masks.set(universe, Uint16Array.from(valid))
    }
    const restart = !this.chop || this.chop.cycle !== cycle
    this.chop = { cycle, lit, masks, expiresAt: now + ttlMs }
    if (restart) this.chopFrame = 0
  }

  /** Is a strobe chop active? (tests / diagnostics) */
  getStrobeChop(): { cycle: number; lit: number } | null {
    return this.chop ? { cycle: this.chop.cycle, lit: this.chop.lit } : null
  }

  /**
   * The universes to send this frame: the engine's own buffers, or a copy
   * with the chopped channels at 0 during a dark frame. `changed` is true
   * on every lit / dark transition (change-only outputs must resend).
   */
  chopFrameData(now: number): { universes: Uint8Array[]; changed: boolean } {
    const chop = this.chop
    if (chop && now > chop.expiresAt) this.chop = null
    if (!this.chop || !chop) {
      const changed = this.chopWasDark
      this.chopWasDark = false
      return { universes: this.universes, changed }
    }
    const dark = this.chopFrame % chop.cycle >= chop.lit
    this.chopFrame++
    const changed = dark !== this.chopWasDark
    this.chopWasDark = dark
    if (!dark) return { universes: this.universes, changed }
    for (let u = 0; u < this.universeCount; u++) {
      let buf = this.chopBuffers[u]
      if (!buf) buf = this.chopBuffers[u] = new Uint8Array(DMX_CHANNELS_PER_UNIVERSE)
      buf.set(this.universes[u])
      const mask = chop.masks.get(u)
      if (mask) for (let i = 0; i < mask.length; i++) buf[mask[i]] = 0
    }
    return { universes: this.chopBuffers.slice(0, this.universeCount), changed }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  setChannel(universe: number, channel: number, value: number): void {
    if (!Number.isInteger(universe) || universe < 0 || universe >= this.universeCount) return
    if (!Number.isInteger(channel) || channel < 0 || channel >= DMX_CHANNELS_PER_UNIVERSE) return
    if (typeof value !== 'number' || Number.isNaN(value)) return
    this.universes[universe][channel] = Math.max(DMX_MIN, Math.min(DMX_MAX, Math.round(value)))
    this.dirty = true
  }

  getChannel(universe: number, channel: number): number {
    if (universe < 0 || universe >= this.universeCount) return 0
    if (channel < 0 || channel >= DMX_CHANNELS_PER_UNIVERSE) return 0
    return this.universes[universe][channel]
  }

  getUniverse(universe: number): Uint8Array {
    if (universe < 0 || universe >= this.universeCount) {
      return new Uint8Array(DMX_CHANNELS_PER_UNIVERSE)
    }
    return this.universes[universe]
  }

  setUniverse(universe: number, data: Uint8Array | number[]): void {
    if (universe < 0 || universe >= this.universeCount) return
    const buf = this.universes[universe]
    for (let i = 0; i < Math.min(data.length, DMX_CHANNELS_PER_UNIVERSE); i++) {
      buf[i] = Math.max(DMX_MIN, Math.min(DMX_MAX, Math.round(data[i])))
    }
    this.dirty = true
  }

  blackout(): void {
    for (const universe of this.universes) {
      universe.fill(0)
    }
    this.dirty = true
  }

  /**
   * Merge source values into a universe using HTP (Highest Takes Precedence)
   */
  mergeHTP(universe: number, channels: Record<number, number>): void {
    if (universe < 0 || universe >= this.universeCount) return
    const buf = this.universes[universe]
    for (const [ch, val] of Object.entries(channels)) {
      const idx = parseInt(ch)
      if (idx >= 0 && idx < DMX_CHANNELS_PER_UNIVERSE) {
        buf[idx] = Math.max(buf[idx], Math.max(DMX_MIN, Math.min(DMX_MAX, Math.round(val))))
      }
    }
    this.dirty = true
  }

  /**
   * Merge source values into a universe using LTP (Latest Takes Precedence)
   */
  mergeLTP(universe: number, channels: Record<number, number>): void {
    if (universe < 0 || universe >= this.universeCount) return
    const buf = this.universes[universe]
    for (const [ch, val] of Object.entries(channels)) {
      const idx = parseInt(ch)
      if (idx >= 0 && idx < DMX_CHANNELS_PER_UNIVERSE) {
        buf[idx] = Math.max(DMX_MIN, Math.min(DMX_MAX, Math.round(val)))
      }
    }
    this.dirty = true
  }

  getUniverseCount(): number {
    return this.universeCount
  }

  isDirty(): boolean {
    return this.dirty
  }
}
