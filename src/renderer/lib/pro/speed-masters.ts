// ============================================================
// PhotonBoard — Speed masters (runtime helpers)
//
//   tapSpeedMaster   tap tempo per master (average of recent taps)
//   effectiveBpm     what a chase plays at (its master's BPM, else its
//                    own) × an optional rate (rate fader)
//   effectiveSpeed   what an effect runs at (master BPM / 60 ×
//                    speedMultiplier, else its own speed)
//   fader mappings   column faders of kind 'speed' (BPM) and 'rate'
//
// The engines read these every frame without allocating: the chase
// engine gets the BPM from the playback controller, the effect engine
// gets effectiveSpeed as its speed source (installed below). Both
// accumulate their phase, so a tempo change never jumps.
// ============================================================

import type { Chase, Effect, SpeedMaster } from '@shared/types'
import { usePoolStore } from '@renderer/stores/pool-store'
import { setEffectSpeedSource } from '@renderer/lib/effect-engine'

const TAP_RESET_MS = 2000
const TAP_SAMPLES = 4
const taps = new Map<string, number[]>()

/** Speed-fader range: level 0 → MIN, 255 → SPEED_FADER_MAX_BPM */
export const SPEED_FADER_MAX_BPM = 240
export const SPEED_FADER_MIN_BPM = 1
/** Rate range (cuelist rate, rate faders) */
export const MIN_RATE = 0.25
export const MAX_RATE = 4

/** Tap tempo on a speed master; returns the new BPM (or null until 2 taps). `now` injectable for tests. */
export function tapSpeedMaster(id: string, now: number = Date.now()): number | null {
  const list = (taps.get(id) ?? []).filter(t => now - t < TAP_RESET_MS)
  list.push(now)
  while (list.length > TAP_SAMPLES + 1) list.shift()
  taps.set(id, list)
  if (list.length < 2) return null
  const intervals = list.slice(1).map((t, i) => t - list[i])
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
  if (avg <= 0) return null
  const bpm = Math.max(1, Math.min(999, Math.round((60000 / avg) * 10) / 10))
  usePoolStore.getState().setSpeedMasterBpm(id, bpm)
  return bpm
}

function masterOf(id: string | undefined, masters: readonly SpeedMaster[]): SpeedMaster | undefined {
  if (!id) return undefined
  for (let i = 0; i < masters.length; i++) if (masters[i].id === id) return masters[i]
  return undefined
}

/** BPM a chase plays at (× `rate`, default 1) */
export function effectiveBpm(
  chase: Pick<Chase, 'bpm' | 'speedMasterId'>,
  masters: readonly SpeedMaster[] = usePoolStore.getState().speedMasters,
  rate = 1
): number {
  const bpm = masterOf(chase.speedMasterId, masters)?.bpm ?? chase.bpm
  return rate === 1 || !(rate > 0) ? bpm : bpm * rate
}

/** Speed (Hz) an effect runs at */
export function effectiveSpeed(effect: Pick<Effect, 'speed' | 'speedMasterId' | 'speedMultiplier'>, masters: readonly SpeedMaster[] = usePoolStore.getState().speedMasters): number {
  const master = masterOf(effect.speedMasterId, masters)
  if (!master) return effect.speed
  const mult = Number(effect.speedMultiplier ?? 1)
  return (master.bpm / 60) * (Number.isFinite(mult) && mult > 0 ? mult : 1)
}

function level01(level: number): number {
  return Number.isFinite(level) ? Math.max(0, Math.min(255, level)) / 255 : 0
}

/** Speed column fader: level 0-255 → BPM (linear, SPEED_FADER_MIN_BPM..SPEED_FADER_MAX_BPM) */
export function speedFaderToBpm(level: number): number {
  return Math.max(SPEED_FADER_MIN_BPM, Math.round(level01(level) * SPEED_FADER_MAX_BPM))
}

/** BPM → speed fader level (inverse of speedFaderToBpm, for pickup) */
export function bpmToSpeedFader(bpm: number): number {
  return Math.max(0, Math.min(255, Math.round((bpm / SPEED_FADER_MAX_BPM) * 255)))
}

/**
 * Rate column fader: level 0-255 → rate, logarithmic with the centre
 * (128) = 1×, bottom = 0.25×, top = 4×.
 */
export function rateFaderToRate(level: number): number {
  const x = (Math.max(0, Math.min(255, Number.isFinite(level) ? level : 128)) - 128) / 127
  const rate = Math.pow(MAX_RATE, x)
  return Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(rate * 1000) / 1000))
}

/** Rate → fader level (inverse of rateFaderToRate) */
export function rateToFader(rate: number): number {
  if (!(rate > 0)) return 128
  return Math.max(0, Math.min(255, Math.round(128 + (Math.log(rate) / Math.log(MAX_RATE)) * 127)))
}

/** A cuelist / runtime rate clamped to MIN_RATE..MAX_RATE (invalid → 1) */
export function clampRate(rate: number | undefined): number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? Math.max(MIN_RATE, Math.min(MAX_RATE, rate)) : 1
}

/** Test helper */
export function __resetSpeedTapsForTests(): void {
  taps.clear()
}

// Effects follow their speed master (read per frame, no allocation)
setEffectSpeedSource((effect) => effectiveSpeed(effect))
