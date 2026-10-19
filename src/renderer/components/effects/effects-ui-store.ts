// ============================================================
// View-local state of the Effects view: which effect is being
// edited, solo, speed unit and per-effect fade times. Fade times
// are a per-console preference (localStorage), not part of the show.
// ============================================================

import { create } from 'zustand'
import { useEffectsStore } from '@renderer/stores/effects-store'

export type SpeedUnit = 'bpm' | 'hz'

export interface FadeTimes {
  fadeIn: number
  fadeOut: number
}

const NO_FADE: FadeTimes = { fadeIn: 0, fadeOut: 0 }
const FADES_KEY = 'photonboard.effects.fades'
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
  fades: Record<string, FadeTimes>
  /** Effect soloed + the effects it stopped (restarted on un-solo) */
  solo: { id: string; stopped: string[] } | null

  setEditing: (id: string | null) => void
  setSpeedUnit: (unit: SpeedUnit) => void
  setFade: (id: string, fade: Partial<FadeTimes>) => void
  toggleSolo: (id: string) => void
}

export const useEffectsUiStore = create<EffectsUiState>()((set, get) => ({
  editingId: null,
  speedUnit: read<SpeedUnit>(UNIT_KEY, 'bpm') === 'hz' ? 'hz' : 'bpm',
  fades: read<Record<string, FadeTimes>>(FADES_KEY, {}),
  solo: null,

  setEditing: (id) => set({ editingId: id }),

  setSpeedUnit: (unit) => {
    write(UNIT_KEY, unit)
    set({ speedUnit: unit })
  },

  setFade: (id, fade) => {
    const fades = { ...get().fades, [id]: { ...(get().fades[id] ?? NO_FADE), ...fade } }
    write(FADES_KEY, fades)
    set({ fades })
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

export function fadeTimesOf(fades: Record<string, FadeTimes>, id: string): FadeTimes {
  return fades[id] ?? NO_FADE
}

/** Start / stop an effect honouring its fade times */
export function runEffect(id: string, running: boolean): void {
  const { fades } = useEffectsUiStore.getState()
  const f = fadeTimesOf(fades, id)
  useEffectsStore.getState().fadeEffect(id, running, running ? f.fadeIn : f.fadeOut)
  if (!running && useEffectsUiStore.getState().solo?.id === id) useEffectsUiStore.setState({ solo: null })
}
