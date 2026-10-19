import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Effect } from '@shared/types'
import { startEffect, stopEffect, onEffectComplete } from '../lib/effect-engine'
import { isRemoteMode, sendRemoteCommand, sendRemoteCommandThrottled } from '../lib/runtime'

interface EffectsState {
  effects: Effect[]

  addEffect: (fixtureIds: string[]) => void
  removeEffect: (id: string) => void
  /** Update parameters; a running effect keeps its phase (no restart) */
  updateEffect: (id: string, updates: Partial<Effect>) => void
  /** Start (from phase 0) / stop */
  toggleEffect: (id: string) => void
  setEffectRunning: (id: string, running: boolean) => void
  stopAllEffects: () => void
  /** Replace the list (show load). Never starts anything. */
  setEffects: (effects: Effect[]) => void
  /** @deprecated one-shot completion is now pushed by the engine; kept as a no-op */
  checkOneShotCompleted: () => void
}

/** Run an effect on the engine (local) or on the Pi (remote). */
function engineStart(effect: Effect, restart: boolean): void {
  if (isRemoteMode()) {
    if (restart) sendRemoteCommand('start-effect', effect)
    else sendRemoteCommandThrottled(`effect:${effect.id}`, 'start-effect', effect, 60)
    return
  }
  startEffect(effect, { restart })
}

function engineStop(id: string): void {
  if (isRemoteMode()) {
    sendRemoteCommand('stop-effect', id)
    return
  }
  stopEffect(id)
}

export const useEffectsStore = create<EffectsState>()(subscribeWithSelector((set, get) => ({
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
    engineStop(id)
    set({ effects: get().effects.filter(e => e.id !== id) })
  },

  updateEffect: (id, updates) => {
    const current = get().effects.find(e => e.id === id)
    if (!current) return
    const updated = { ...current, ...updates }
    if (updated.isRunning) engineStart(updated, !current.isRunning)
    else if (current.isRunning) engineStop(id)
    set({ effects: get().effects.map(e => (e.id === id ? updated : e)) })
  },

  toggleEffect: (id) => {
    const current = get().effects.find(e => e.id === id)
    if (current) get().setEffectRunning(id, !current.isRunning)
  },

  setEffectRunning: (id, running) => {
    const current = get().effects.find(e => e.id === id)
    if (!current) return
    const updated = { ...current, isRunning: running }
    if (running) engineStart(updated, true)
    else engineStop(id)
    set({ effects: get().effects.map(e => (e.id === id ? updated : e)) })
  },

  stopAllEffects: () => {
    for (const e of get().effects) if (e.isRunning) engineStop(e.id)
    set({ effects: get().effects.map(e => (e.isRunning ? { ...e, isRunning: false } : e)) })
  },

  setEffects: (effects) => set({ effects: effects.map(e => (e.isRunning ? { ...e, isRunning: false } : e)) }),

  checkOneShotCompleted: () => {}
})))

// One-shot effects stop themselves in the engine: reflect it in the store
onEffectComplete((id) => {
  const { effects } = useEffectsStore.getState()
  if (!effects.some(e => e.id === id && e.isRunning)) return
  useEffectsStore.setState({ effects: effects.map(e => (e.id === id ? { ...e, isRunning: false } : e)) })
})
