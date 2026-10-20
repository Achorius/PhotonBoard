// ============================================================
// View-local state of the Effects view: which effect is being
// edited, solo, speed unit. Fade times live on the effect (show).
// ============================================================

import { create } from 'zustand'
import type { Effect } from '@shared/types'
import { useEffectsStore } from '@renderer/stores/effects-store'

export type SpeedUnit = 'bpm' | 'hz'

export interface FadeTimes {
  fadeIn: number
  fadeOut: number
}

/** Before fades were saved in the show they were a per-console preference */
const LEGACY_FADES_KEY = 'photonboard.effects.fades'
const UNIT_KEY = 'photonboard.effects.speedUnit'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

interface EffectsUiState {
  editingId: string | null
  speedUnit: SpeedUnit
  /** Effect soloed + the effects it stopped (restarted on un-solo) */
  solo: { id: string; stopped: string[] } | null

  setEditing: (id: string | null) => void
  setSpeedUnit: (unit: SpeedUnit) => void
  toggleSolo: (id: string) => void
}

export const useEffectsUiStore = create<EffectsUiState>()((set, get) => ({
  editingId: null,
  speedUnit: read<SpeedUnit>(UNIT_KEY, 'bpm') === 'hz' ? 'hz' : 'bpm',
  solo: null,

  setEditing: (id) => set({ editingId: id }),

  setSpeedUnit: (unit) => {
    write(UNIT_KEY, unit)
    set({ speedUnit: unit })
  },

  toggleSolo: (id) => {
    const fx = useEffectsStore.getState()
    const solo = get().solo
    if (solo?.id === id) {
      // Un-solo: bring back what solo stopped
      const existing = new Set(fx.effects.map((e) => e.id))
      for (const other of solo.stopped) if (existing.has(other)) fx.setEffectRunning(other, true)
      set({ solo: null })
      return
    }
    const stopped = fx.effects.filter((e) => e.isRunning && e.id !== id).map((e) => e.id)
    for (const other of stopped) fx.setEffectRunning(other, false)
    if (!fx.effects.find((e) => e.id === id)?.isRunning) fx.setEffectRunning(id, true)
    // Solo replacing another solo keeps the original restore list
    set({ solo: { id, stopped: solo ? [...new Set([...solo.stopped, ...stopped])].filter((x) => x !== id) : stopped } })
  }
}))

const legacyFades = read<Record<string, Partial<FadeTimes>>>(LEGACY_FADES_KEY, {})

/** An effect's fade times (older consoles kept them in localStorage: used until edited) */
export function fadeTimesOf(effect: Pick<Effect, 'id' | 'fadeIn' | 'fadeOut'>): FadeTimes {
  const legacy = legacyFades[effect.id]
  return {
    fadeIn: effect.fadeIn ?? legacy?.fadeIn ?? 0,
    fadeOut: effect.fadeOut ?? legacy?.fadeOut ?? 0
  }
}

/** Store fade times in the effect (both, so a legacy value no longer applies) */
export function setFadeTimes(effect: Effect, fade: Partial<FadeTimes>): void {
  useEffectsStore.getState().updateEffect(effect.id, { ...fadeTimesOf(effect), ...fade })
}

/** Start / stop an effect honouring its fade times */
export function runEffect(id: string, running: boolean): void {
  const effect = useEffectsStore.getState().effects.find((e) => e.id === id)
  const f = effect ? fadeTimesOf(effect) : { fadeIn: 0, fadeOut: 0 }
  useEffectsStore.getState().fadeEffect(id, running, running ? f.fadeIn : f.fadeOut)
  if (!running && useEffectsUiStore.getState().solo?.id === id) useEffectsUiStore.setState({ solo: null })
}
