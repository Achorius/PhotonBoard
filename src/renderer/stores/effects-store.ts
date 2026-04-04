import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Effect, WaveformType } from '@shared/types'
import { startEffect, stopEffect, stopAllEffects } from '../lib/effect-engine'

interface EffectsState {
  effects: Effect[]

  addEffect: (fixtureIds: string[]) => void
  removeEffect: (id: string) => void
  updateEffect: (id: string, updates: Partial<Effect>) => void
  toggleEffect: (id: string) => void
  setEffects: (effects: Effect[]) => void
}

export const useEffectsStore = create<EffectsState>((set, get) => ({
  effects: [],

  addEffect: (fixtureIds) => {
    const effects = get().effects
    const effect: Effect = {
      id: uuidv4(),
      name: `Effect ${effects.length + 1}`,
      waveform: 'sine',
      speed: 1,
      depth: 255,
      offset: 0,
      channelType: 'Dimmer',
      fixtureIds,
      fan: 0,
      isRunning: false
    }
    set({ effects: [...effects, effect] })
  },

  removeEffect: (id) => {
    stopEffect(id)
    set({ effects: get().effects.filter(e => e.id !== id) })
  },

  updateEffect: (id, updates) => {
    set({
      effects: get().effects.map(e => {
        if (e.id !== id) return e
        const updated = { ...e, ...updates }
        if (updated.isRunning) startEffect(updated)
        return updated
      })
    })
  },

  toggleEffect: (id) => {
    set({
      effects: get().effects.map(e => {
        if (e.id !== id) return e
        const running = !e.isRunning
        const updated = { ...e, isRunning: running }
        if (running) startEffect(updated)
        else stopEffect(id)
        return updated
      })
    })
  },

  setEffects: (effects) => set({ effects })
}))
