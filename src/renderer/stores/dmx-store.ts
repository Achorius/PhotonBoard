import { create } from 'zustand'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'

interface DmxState {
  universeCount: number
  values: number[][]
  grandMaster: number
  blackout: boolean

  setChannel: (universe: number, channel: number, value: number) => void
  setChannels: (universe: number, channels: Record<number, number>) => void
  setGrandMaster: (value: number) => void
  toggleBlackout: () => void
  resetAll: () => void
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

  resetAll: () => {
    const state = get()
    // Zero all channel values
    const freshValues = []
    for (let u = 0; u < state.universeCount; u++) {
      freshValues.push(new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0))
    }
    set({ values: freshValues, blackout: false, grandMaster: 255 })
    // Send blackout to engine to zero all outputs
    window.photonboard.dmx.blackout()
  },

  getEffectiveValue: (universe, channel) => {
    const state = get()
    if (state.blackout) return 0
    return Math.round(state.values[universe][channel] * (state.grandMaster / 255))
  }
}))
