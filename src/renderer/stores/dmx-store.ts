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
  /** Strobe phase as last published (prefer getStrobePhase() from dmx-mixer) */
  _strobePhase: boolean

  setGrandMaster: (value: number) => void
  toggleBlackout: () => void
  setBlackout: (on: boolean) => void
  toggleBlinder: (on?: boolean) => void
  toggleStrobe: (on?: boolean) => void
  setStrobeRate: (rate: number) => void
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
  strobeRate: 10,
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
    const r = Number.isFinite(rate) ? Math.max(1, Math.min(25, rate)) : 10
    if (r !== get().strobeRate) set({ strobeRate: r })
    markLocalChange('strobeRate')
    sendRemoteCommandThrottled('strobeRate', 'set-strobe-rate', r)
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
    strobeRate: s.strobeRate
  })))
}

/** Pre-master mix of one universe (re-renders at most at the publish rate, ~25 Hz). */
export function useDmxUniverse(universe: number): number[] {
  return useDmxStore((s) => s.values[universe] ?? EMPTY_UNIVERSE)
}

const EMPTY_UNIVERSE: number[] = new Array(DMX_CHANNELS_PER_UNIVERSE).fill(0)
