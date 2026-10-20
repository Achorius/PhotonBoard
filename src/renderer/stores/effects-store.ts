import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Effect } from '@shared/types'
import { startEffect, stopEffect, onEffectComplete } from '../lib/effect-engine'
import { clockNow, isRemoteMode, markLocalChange, sendRemoteCommand } from '../lib/runtime'

interface EffectsState {
  effects: Effect[]

  addEffect: (fixtureIds: string[]) => void
  /** Add a fully defined effect (id/name generated when missing); starts it when `isRunning`. Returns its id. */
  createEffect: (init: Partial<Effect> & { fixtureIds: string[] }) => string
  removeEffect: (id: string) => void
  /** Update parameters; a running effect keeps its phase (no restart) */
  updateEffect: (id: string, updates: Partial<Effect>) => void
  /** Start (from phase 0) / stop */
  toggleEffect: (id: string) => void
  setEffectRunning: (id: string, running: boolean) => void
  /**
   * Start / stop with a size fade over `seconds` (0 = instant). The phase is
   * never restarted by the fade itself. Remote browsers start/stop instantly.
   */
  fadeEffect: (id: string, running: boolean, seconds: number) => void
  stopAllEffects: () => void
  /** Replace the list (show load). Never starts anything. */
  setEffects: (effects: Effect[]) => void
  /** @deprecated one-shot completion is now pushed by the engine; kept as a no-op */
  checkOneShotCompleted: () => void
}

/**
 * Run an effect on the engine (local) or on the Pi (remote). A remote only
 * starts / stops the console's effect BY ID: definition edits travel with the
 * content sync (lib/content-sync.ts), which flushes before any command so the
 * console knows the effect by the time 'start-effect' arrives.
 */
function engineStart(effect: Effect, restart: boolean): void {
  if (isRemoteMode()) {
    markLocalChange(`effect:${effect.id}`)
    // After the store update that follows (a new effect is then part of the content flush)
    if (restart) queueMicrotask(() => sendRemoteCommand('start-effect', effect.id))
    return
  }
  startEffect(effect, { restart })
}

function engineStop(id: string): void {
  if (isRemoteMode()) {
    markLocalChange(`effect:${id}`)
    queueMicrotask(() => sendRemoteCommand('stop-effect', id)) // same order as starts
    return
  }
  stopEffect(id)
}

// ------------------------------------------------------------
// Fades: a running effect's size (depth of every channel) is ramped
// between 0 and 1 by re-sending the definition on the update path,
// so the phase keeps running through the fade.
// ------------------------------------------------------------

interface Fade { from: number; to: number; start: number; durationMs: number }
const fades = new Map<string, Fade>()
let fadeTimer: ReturnType<typeof setInterval> | null = null
const FADE_TICK_MS = 25

function fadeLevel(id: string, now = clockNow()): number | null {
  const f = fades.get(id)
  if (!f) return null
  const t = f.durationMs > 0 ? Math.min(1, Math.max(0, (now - f.start) / f.durationMs)) : 1
  return f.from + (f.to - f.from) * t
}

/** The effect with its size scaled by `level` (0..1) */
function scaleEffect(effect: Effect, level: number): Effect {
  if (level >= 1) return effect
  const k = Math.max(0, level)
  const scaled: Effect = { ...effect, depth: Math.round(effect.depth * k) }
  if (effect.channels) scaled.channels = effect.channels.map(ch => ({ ...ch, depth: Math.round(ch.depth * k) }))
  return scaled
}

function tickFades(): void {
  const now = clockNow()
  const { effects } = useEffectsStore.getState()
  const stopped: string[] = []
  for (const [id, f] of fades) {
    const effect = effects.find(e => e.id === id)
    if (!effect || !effect.isRunning) {
      fades.delete(id)
      continue
    }
    if (now - f.start >= f.durationMs) {
      fades.delete(id)
      if (f.to <= 0) stopped.push(id)
      else engineStart(effect, false)
    } else {
      engineStart(scaleEffect(effect, fadeLevel(id, now) ?? 1), false)
    }
  }
  if (stopped.length > 0) {
    for (const id of stopped) engineStop(id)
    const ids = new Set(stopped)
    useEffectsStore.setState({ effects: useEffectsStore.getState().effects.map(e => (ids.has(e.id) ? { ...e, isRunning: false } : e)) })
  }
  if (fades.size === 0 && fadeTimer) {
    clearInterval(fadeTimer)
    fadeTimer = null
  }
}

function ensureFadeTimer(): void {
  if (!fadeTimer) fadeTimer = setInterval(tickFades, FADE_TICK_MS)
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

  createEffect: (init) => {
    const effects = get().effects
    const effect: Effect = {
      name: `Effect ${effects.length + 1}`,
      waveform: 'sine',
      speed: 1,
      depth: 255,
      offset: 0,
      channelType: 'Dimmer',
      fan: 0,
      isRunning: false,
      ...init,
      id: init.id ?? uuidv4()
    }
    if (effect.isRunning) engineStart(effect, true)
    set({ effects: [...effects, effect] })
    return effect.id
  },

  removeEffect: (id) => {
    fades.delete(id)
    engineStop(id)
    set({ effects: get().effects.filter(e => e.id !== id) })
  },

  updateEffect: (id, updates) => {
    const current = get().effects.find(e => e.id === id)
    if (!current) return
    const updated = { ...current, ...updates }
    if (!updated.isRunning) fades.delete(id)
    const level = fadeLevel(id)
    if (updated.isRunning) engineStart(level === null ? updated : scaleEffect(updated, level), !current.isRunning)
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
    fades.delete(id)
    const updated = { ...current, isRunning: running }
    if (running) engineStart(updated, true)
    else engineStop(id)
    set({ effects: get().effects.map(e => (e.id === id ? updated : e)) })
  },

  fadeEffect: (id, running, seconds) => {
    const current = get().effects.find(e => e.id === id)
    if (!current) return
    if (!(seconds > 0) || isRemoteMode()) {
      if (current.isRunning !== running || (running && fades.has(id))) get().setEffectRunning(id, running)
      return
    }
    const now = clockNow()
    const level = fadeLevel(id, now) ?? (current.isRunning ? 1 : 0)
    if (running) {
      if (current.isRunning && !fades.has(id)) return
      fades.set(id, { from: level, to: 1, start: now, durationMs: seconds * 1000 * (1 - level) })
      if (!current.isRunning) {
        const updated = { ...current, isRunning: true }
        engineStart(scaleEffect(updated, 0), true)
        set({ effects: get().effects.map(e => (e.id === id ? updated : e)) })
      }
    } else {
      if (!current.isRunning) return
      fades.set(id, { from: level, to: 0, start: now, durationMs: seconds * 1000 * level })
    }
    ensureFadeTimer()
  },

  stopAllEffects: () => {
    fades.clear()
    for (const e of get().effects) if (e.isRunning) engineStop(e.id)
    set({ effects: get().effects.map(e => (e.isRunning ? { ...e, isRunning: false } : e)) })
  },

  setEffects: (effects) => {
    fades.clear()
    set({ effects: effects.map(e => (e.isRunning ? { ...e, isRunning: false } : e)) })
  },

  checkOneShotCompleted: () => {}
})))

// One-shot effects stop themselves in the engine: reflect it in the store
onEffectComplete((id) => {
  const { effects } = useEffectsStore.getState()
  if (!effects.some(e => e.id === id && e.isRunning)) return
  useEffectsStore.setState({ effects: effects.map(e => (e.id === id ? { ...e, isRunning: false } : e)) })
})
