// ============================================================
// PhotonBoard — LED colours with a meaning (feedback engine ↔ profiles)
//
// RGB controllers show these colours; tri-colour controllers (APC mini
// mk1: green / red / yellow) recognise HELD and LEARN to pick red /
// yellow blink instead of their default mapping. Colour meaning follows
// the app: green = playing / GO, red = blackout, amber = blinder,
// violet = MIDI learn, orange = programmer.
// ============================================================

import type { LedMode, LedState } from './controller-types'

/** Held flash / momentary executor: white 100 % */
export const LED_HELD = '#ffffff'
/** MIDI learn armed: violet blink */
export const LED_LEARN = '#8b00ff'
export const LED_GO = '#00ff00'
export const LED_BACK = '#00a9ff'
export const LED_RELEASE = '#ffbd6c'
export const LED_BLACKOUT = '#ff0000'
export const LED_BLINDER = '#ffbd00'
export const LED_STROBE = '#e0ffff'
export const LED_TAP = '#ff5400'
/** Programmer (Clear): brand orange */
export const LED_PROGRAMMER = '#ff7f00'
/** Executor page buttons */
export const LED_PAGE = '#0055ff'
/** Group / preset / macro without a colour of its own */
export const LED_NEUTRAL = '#7f7f7f'

const OFF_STATE: LedState = Object.freeze({ mode: 'off', color: '#000000' }) as LedState

const ledCache = new Map<string, LedState>()

/**
 * Shared, frozen LedState objects: the feedback engine builds a full map at
 * up to 30 Hz — reusing states keeps it allocation-free once warm and makes
 * diffing an identity check.
 */
export function led(mode: LedMode, color = '#000000'): LedState {
  if (mode === 'off') return OFF_STATE
  const key = mode + color
  let s = ledCache.get(key)
  if (!s) {
    s = Object.freeze({ mode, color: color.toLowerCase() }) as LedState
    if (ledCache.size > 2048) ledCache.clear()
    ledCache.set(key, s)
  }
  return s
}

export const LED_OFF = OFF_STATE

export function sameLed(a: LedState | undefined, b: LedState | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.mode === b.mode && (a.mode === 'off' || a.color.toLowerCase() === b.color.toLowerCase())
}
