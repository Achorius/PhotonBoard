// ============================================================
// PhotonBoard — DMX Store
// Holds the master section FLAGS (grand master, blackout, blinder,
// strobe) and a throttled (~25 Hz) copy of the pre-master mix for
// the UI. It never writes DMX: the mixer's output stage applies the
// masters to intensity channels only and sends the frame.
//
// In remote mode every action is forwarded to the Pi (with an
// optimistic local update for the UI).
// ============================================================

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import { markLocalChange, sendRemoteCommand, sendRemoteCommandThrottled, isRemoteMode, toDmx } from '@renderer/lib/runtime'

/**
 * What the Strobe key flashes: 'white' = every fixture at full open white
 * (like the Blinder — fixtures dark in the current look flash too), 'look'
 * = the current look as it is.
 */
export type StrobeMode = 'white' | 'look'

export const STROBE_RATE_MIN = 1
export const STROBE_RATE_MAX = 25
const STROBE_SETTINGS_KEY = 'photonboard.strobe'

/** Strobe rate / mode are operator preferences of this machine (not in the show) */
function loadStrobeSettings(): { strobeRate: number; strobeMode: StrobeMode } {
  const fallback = { strobeRate: 10, strobeMode: 'white' as StrobeMode }
  try {
    const raw = globalThis.localStorage?.getItem(STROBE_SETTINGS_KEY)
    if (!raw) return fallback
    const o = JSON.parse(raw) as { rate?: unknown; mode?: unknown }
    const rate = typeof o.rate === 'number' && Number.isFinite(o.rate) ? Math.max(STROBE_RATE_MIN, Math.min(STROBE_RATE_MAX, o.rate)) : fallback.strobeRate
    return { strobeRate: rate, strobeMode: o.mode === 'look' ? 'look' : 'white' }
  } catch {
    return fallback
  }
}

function saveStrobeSettings(rate: number, mode: StrobeMode): void {
  if (isRemoteMode()) return // the console keeps its own
  try {
    globalThis.localStorage?.setItem(STROBE_SETTINGS_KEY, JSON.stringify({ rate, mode }))
  } catch {
    // private mode / quota: kept for this session
  }
}

const initialStrobe = loadStrobeSettings()

interface DmxState {
  universeCount: number
  /**
   * Pre-master mix per universe (what playbacks + programmer produce, before
   * GM / blackout / blinder / strobe). Published by the mixer at ~25 Hz;
   * use getOutputBuffer() from dmx-mixer for the post-master frame.
   */
  values: number[][]
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  strobeRate: number // Hz (1-25)
  strobeMode: StrobeMode
  /** Strobe phase as last published (prefer getStrobePhase() from dmx-mixer) */
  _strobePhase: boolean

  setGrandMaster: (value: number) => void
  toggleBlackout: () => void
  setBlackout: (on: boolean) => void
  toggleBlinder: (on?: boolean) => void
  toggleStrobe: (on?: boolean) => void
  setStrobeRate: (rate: number) => void
  setStrobeMode: (mode: StrobeMode) => void
  /** Masters back to defaults (GM full, no blackout/blinder/strobe) and programmer cleared */
  resetAll: () => void
}

function emptyUniverses(count: number): number[][] {
  return Array.from({ length: count }, () => new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0))
}

// Programmer clearing lives in the mixer; injected to avoid an import cycle.
let clearProgrammerFn: (() => void) | null = null
export function setDmxStoreProgrammerReset(fn: () => void): void {
  clearProgrammerFn = fn
}

export const useDmxStore = create<DmxState>()(subscribeWithSelector((set, get) => ({
  universeCount: 3,
  values: emptyUniverses(3),
  grandMaster: 255,
  blackout: false,
  blinder: false,
  strobe: false,
  strobeRate: initialStrobe.strobeRate,
  strobeMode: initialStrobe.strobeMode,
  _strobePhase: true,

  setGrandMaster: (value) => {
    const gm = toDmx(value)
    if (gm !== get().grandMaster) set({ grandMaster: gm })
    markLocalChange('grandMaster')
    sendRemoteCommandThrottled('grandMaster', 'set-grand-master', gm)
  },

  toggleBlackout: () => get().setBlackout(!get().blackout),

  setBlackout: (on) => {
    const blackout = !!on
    if (blackout !== get().blackout) set({ blackout })
    markLocalChange('blackout')
    sendRemoteCommand('set-blackout', blackout)
  },

  toggleBlinder: (on) => {
    const blinder = on !== undefined ? !!on : !get().blinder
    if (blinder !== get().blinder) set({ blinder })
    markLocalChange('blinder')
    sendRemoteCommand('toggle-blinder', blinder)
  },

  toggleStrobe: (on) => {
    const strobe = on !== undefined ? !!on : !get().strobe
    if (strobe !== get().strobe) set({ strobe })
    markLocalChange('strobe')
    sendRemoteCommand('toggle-strobe', strobe)
  },

  setStrobeRate: (rate) => {
    const r = Number.isFinite(rate) ? Math.max(STROBE_RATE_MIN, Math.min(STROBE_RATE_MAX, rate)) : 10
    if (r !== get().strobeRate) {
      set({ strobeRate: r })
      saveStrobeSettings(r, get().strobeMode)
    }
    markLocalChange('strobeRate')
    sendRemoteCommandThrottled('strobeRate', 'set-strobe-rate', r)
  },

  setStrobeMode: (mode) => {
    const m: StrobeMode = mode === 'look' ? 'look' : 'white'
    if (m !== get().strobeMode) {
      set({ strobeMode: m })
      saveStrobeSettings(get().strobeRate, m)
    }
    markLocalChange('strobeMode')
    sendRemoteCommand('set-strobe-mode', m)
  },

  resetAll: () => {
    set({ blackout: false, grandMaster: 255, blinder: false, strobe: false })
    if (isRemoteMode()) {
      sendRemoteCommand('reset-all')
      return
    }
    clearProgrammerFn?.()
  }
})))

// ---- Selector hooks (subscribe to just what a component shows) ----

/** Master section flags, re-rendering only when one of them changes. */
export function useDmxMasters() {
  return useDmxStore(useShallow((s) => ({
    grandMaster: s.grandMaster,
    blackout: s.blackout,
    blinder: s.blinder,
    strobe: s.strobe,
    strobeRate: s.strobeRate,
    strobeMode: s.strobeMode
  })))
}

/** Pre-master mix of one universe (re-renders at most at the publish rate, ~25 Hz). */
export function useDmxUniverse(universe: number): number[] {
  return useDmxStore((s) => s.values[universe] ?? EMPTY_UNIVERSE)
}

const EMPTY_UNIVERSE: number[] = new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0)
