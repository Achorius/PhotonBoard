import { create } from 'zustand'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'

// Programmer hook — set by the mixer to route manual fader changes
// through the mixing pipeline. Avoids circular import.
let programmerHook: ((universe: number, channel: number, value: number) => void) | null = null

export function setDmxProgrammerHook(hook: typeof programmerHook): void {
  programmerHook = hook
}

interface DmxState {
  universeCount: number
  // Final merged values (output)
  values: number[][]
  // Grand Master 0-255
  grandMaster: number
  // Blackout mode
  blackout: boolean

  // Called by UI faders — routes through programmer layer if mixer is active
  setChannel: (universe: number, channel: number, value: number) => void
  // Called by the mixer to write merged output
  setChannels: (universe: number, channels: Record<number, number>) => void
  setGrandMaster: (value: number) => void
  toggleBlackout: () => void
  getEffectiveValue: (universe: number, channel: number) => number
}

export const useDmxStore = create<DmxState>((set, get) => ({
  universeCount: 3,
  values: [
    new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0),
    new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0),
    new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0)
  ],
  grandMaster: 255,
  blackout: false,

  setChannel: (universe, channel, value) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)))

    // Feed the mixer's programmer layer so it gets merged properly
    if (programmerHook) {
      programmerHook(universe, channel, clamped)
      // Don't write directly — let the mixer handle it on next tick
      return
    }

    // Fallback: no mixer running, write directly (startup / init)
    set((state) => {
      const newValues = [...state.values]
      newValues[universe] = [...newValues[universe]]
      newValues[universe][channel] = clamped
      return { values: newValues }
    })
    if (!get().blackout) {
      const effective = Math.round(clamped * (get().grandMaster / 255))
      window.photonboard.dmx.setChannel(universe, channel, effective)
    }
  },

  setChannels: (universe, channels) => {
    set((state) => {
      const newValues = [...state.values]
      newValues[universe] = [...newValues[universe]]
      for (const [ch, val] of Object.entries(channels)) {
        newValues[universe][parseInt(ch)] = Math.max(0, Math.min(255, Math.round(val)))
      }
      return { values: newValues }
    })
    if (!get().blackout) {
      const gm = get().grandMaster / 255
      const effective: Record<number, number> = {}
      for (const [ch, val] of Object.entries(channels)) {
        effective[parseInt(ch)] = Math.round(val * gm)
      }
      window.photonboard.dmx.setChannels(universe, effective)
    }
  },

  setGrandMaster: (value) => {
    set({ grandMaster: Math.max(0, Math.min(255, value)) })
    const state = get()
    if (!state.blackout) {
      const gm = value / 255
      for (let u = 0; u < state.universeCount; u++) {
        const channels: Record<number, number> = {}
        for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE; ch++) {
          if (state.values[u][ch] > 0) {
            channels[ch] = Math.round(state.values[u][ch] * gm)
          }
        }
        window.photonboard.dmx.setChannels(u, channels)
      }
    }
  },

  toggleBlackout: () => {
    const newBlackout = !get().blackout
    set({ blackout: newBlackout })
    if (newBlackout) {
      window.photonboard.dmx.blackout()
    } else {
      const state = get()
      const gm = state.grandMaster / 255
      for (let u = 0; u < state.universeCount; u++) {
        const channels: Record<number, number> = {}
        for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE; ch++) {
          channels[ch] = Math.round(state.values[u][ch] * gm)
        }
        window.photonboard.dmx.setChannels(u, channels)
      }
    }
  },

  getEffectiveValue: (universe, channel) => {
    const state = get()
    if (state.blackout) return 0
    return Math.round(state.values[universe][channel] * (state.grandMaster / 255))
  }
}))
