import { create } from 'zustand'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'

interface DmxState {
  universeCount: number
  // Flat arrays for performance (512 per universe)
  values: number[][]
  // Grand Master 0-255
  grandMaster: number
  // Blackout mode
  blackout: boolean

  // Actions
  setChannel: (universe: number, channel: number, value: number) => void
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
    set((state) => {
      const newValues = [...state.values]
      newValues[universe] = [...newValues[universe]]
      newValues[universe][channel] = clamped
      return { values: newValues }
    })
    // Send to main process
    if (!get().blackout) {
      const effective = Math.round(value * (get().grandMaster / 255))
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
    // Re-send all channels with new GM
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
      // Restore all values
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
