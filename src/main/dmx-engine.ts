import { DMX_CHANNELS_PER_UNIVERSE, DMX_MAX, DMX_MIN } from '../shared/types'

type FrameCallback = (universes: Uint8Array[]) => void

export class DmxEngine {
  private universes: Uint8Array[]
  private universeCount: number
  private timer: ReturnType<typeof setInterval> | null = null
  private frameCallback: FrameCallback | null = null
  private refreshRate = 25 // ms (~40Hz)
  private dirty = false

  constructor(universeCount: number = 3) {
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
    this.timer = setInterval(() => {
      if (this.frameCallback) {
        this.frameCallback(this.universes)
      }
      this.dirty = false
    }, this.refreshRate)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  setChannel(universe: number, channel: number, value: number): void {
    if (universe < 0 || universe >= this.universeCount) return
    if (channel < 0 || channel >= DMX_CHANNELS_PER_UNIVERSE) return
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
