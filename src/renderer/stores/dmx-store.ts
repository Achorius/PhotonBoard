import { create } from 'zustand'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'

interface DmxState {
  universeCount: number
  values: number[][]
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  strobeRate: number // Hz (1-25)
  _strobePhase: boolean // internal: current on/off phase for strobe

  setChannel: (universe: number, channel: number, value: number) => void
  setChannels: (universe: number, channels: Record<number, number>) => void
  setGrandMaster: (value: number) => void
  toggleBlackout: () => void
  toggleBlinder: (on?: boolean) => void
  toggleStrobe: (on?: boolean) => void
  setStrobeRate: (rate: number) => void
  resetAll: () => void
  getEffectiveValue: (universe: number, channel: number) => number
}

// Strobe interval handle (module-level to survive re-renders)
let strobeInterval: ReturnType<typeof setInterval> | null = null

function startStrobeLoop() {
  stopStrobeLoop()
  const rate = useDmxStore.getState().strobeRate
  const intervalMs = Math.round(1000 / (rate * 2))

  strobeInterval = setInterval(() => {
    const state = useDmxStore.getState()
    if (!state.strobe) { stopStrobeLoop(); return }

    const newPhase = !state._strobePhase
    useDmxStore.setState({ _strobePhase: newPhase })

    // Send strobe output: active channels flash on/off
    for (let u = 0; u < state.universeCount; u++) {
      const channels: Record<number, number> = {}
      const gm = state.grandMaster / 255
      for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE; ch++) {
        if (state.values[u][ch] > 0) {
          channels[ch] = newPhase ? Math.round(state.values[u][ch] * gm) : 0
        }
      }
      if (Object.keys(channels).length > 0) {
        window.photonboard.dmx.setChannels(u, channels)
      }
    }
  }, intervalMs)
}

function stopStrobeLoop() {
  if (strobeInterval) {
    clearInterval(strobeInterval)
    strobeInterval = null
  }
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
  blinder: false,
  strobe: false,
  strobeRate: 10,
  _strobePhase: false,

  setChannel: (universe, channel, value) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)))
    set((state) => {
      const newValues = [...state.values]
      newValues[universe] = [...newValues[universe]]
      newValues[universe][channel] = clamped
      return { values: newValues }
    })
    const state = get()
    // Blinder overrides everything: always send 255
    if (state.blinder) {
      window.photonboard.dmx.setChannel(universe, channel, 255)
      return
    }
    // Strobe: don't send — the strobe loop handles hardware output
    if (state.strobe) return
    // Blackout: don't send
    if (state.blackout) return
    // Normal output
    const effective = Math.round(clamped * (state.grandMaster / 255))
    window.photonboard.dmx.setChannel(universe, channel, effective)
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
    const state = get()
    // Blinder overrides: send 255 for all
    if (state.blinder) {
      const effective: Record<number, number> = {}
      for (const ch of Object.keys(channels)) {
        effective[parseInt(ch)] = 255
      }
      window.photonboard.dmx.setChannels(universe, effective)
      return
    }
    // Strobe: don't send — the strobe loop handles it
    if (state.strobe) return
    // Blackout: don't send
    if (state.blackout) return
    // Normal output
    const gm = state.grandMaster / 255
    const effective: Record<number, number> = {}
    for (const [ch, val] of Object.entries(channels)) {
      effective[parseInt(ch)] = Math.round(val * gm)
    }
    window.photonboard.dmx.setChannels(universe, effective)
  },

  setGrandMaster: (value) => {
    set({ grandMaster: Math.max(0, Math.min(255, value)) })
    const state = get()
    if (state.blackout || state.blinder || state.strobe) return
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
  },

  toggleBlackout: () => {
    const newBlackout = !get().blackout
    set({ blackout: newBlackout })
    if (newBlackout) {
      window.photonboard.dmx.blackout()
    } else {
      const state = get()
      if (state.blinder || state.strobe) return // let those modes handle output
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

  toggleBlinder: (on?: boolean) => {
    const newBlinder = on !== undefined ? on : !get().blinder
    set({ blinder: newBlinder })
    if (newBlinder) {
      // Immediately send 255 on all channels
      const state = get()
      for (let u = 0; u < state.universeCount; u++) {
        const channels: Record<number, number> = {}
        for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE; ch++) {
          channels[ch] = 255
        }
        window.photonboard.dmx.setChannels(u, channels)
      }
    } else {
      // Restore: let the normal pipeline take over on next setChannel call
      // Force an immediate restore of current values
      const state = get()
      if (state.blackout) {
        window.photonboard.dmx.blackout()
      } else if (!state.strobe) {
        const gm = state.grandMaster / 255
        for (let u = 0; u < state.universeCount; u++) {
          const channels: Record<number, number> = {}
          for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE; ch++) {
            channels[ch] = Math.round(state.values[u][ch] * gm)
          }
          window.photonboard.dmx.setChannels(u, channels)
        }
      }
    }
  },

  toggleStrobe: (on?: boolean) => {
    const newStrobe = on !== undefined ? on : !get().strobe
    set({ strobe: newStrobe, _strobePhase: false })
    if (newStrobe) {
      startStrobeLoop()
    } else {
      stopStrobeLoop()
      // Restore normal output
      const state = get()
      if (state.blackout) {
        window.photonboard.dmx.blackout()
      } else if (!state.blinder) {
        const gm = state.grandMaster / 255
        for (let u = 0; u < state.universeCount; u++) {
          const channels: Record<number, number> = {}
          for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE; ch++) {
            channels[ch] = Math.round(state.values[u][ch] * gm)
          }
          window.photonboard.dmx.setChannels(u, channels)
        }
      }
    }
  },

  setStrobeRate: (rate: number) => {
    set({ strobeRate: Math.max(1, Math.min(25, rate)) })
    // Restart strobe loop with new rate if active
    if (get().strobe) {
      startStrobeLoop()
    }
  },

  resetAll: () => {
    stopStrobeLoop()
    const state = get()
    const freshValues = []
    for (let u = 0; u < state.universeCount; u++) {
      freshValues.push(new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0))
    }
    set({ values: freshValues, blackout: false, grandMaster: 255, blinder: false, strobe: false, _strobePhase: false })
    window.photonboard.dmx.blackout()
  },

  getEffectiveValue: (universe, channel) => {
    const state = get()
    if (state.blackout) return 0
    if (state.blinder) return 255
    return Math.round(state.values[universe][channel] * (state.grandMaster / 255))
  }
}))
