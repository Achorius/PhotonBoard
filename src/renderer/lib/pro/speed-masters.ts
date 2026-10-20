// ============================================================
// PhotonBoard — Speed masters (runtime helpers)
//
// WP0 contract with a BASIC implementation (WP3 wires chases / effects
// to their speed master in the playback engines):
//   tapSpeedMaster   tap tempo per master (average of recent taps)
//   effectiveBpm     what a chase plays at (its master's BPM, else its own)
//   effectiveSpeed   what an effect runs at (master BPM / 60 × multiplier)
// ============================================================

import type { Chase, Effect, SpeedMaster } from '@shared/types'
import { usePoolStore } from '@renderer/stores/pool-store'

const TAP_RESET_MS = 2000
const TAP_SAMPLES = 4
const taps = new Map<string, number[]>()

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
  return id ? masters.find(m => m.id === id) : undefined
}

/** BPM a chase plays at */
export function effectiveBpm(chase: Pick<Chase, 'bpm' | 'speedMasterId'>, masters: readonly SpeedMaster[] = usePoolStore.getState().speedMasters): number {
  return masterOf(chase.speedMasterId, masters)?.bpm ?? chase.bpm
}

/** Speed (Hz) an effect runs at */
export function effectiveSpeed(effect: Pick<Effect, 'speed' | 'speedMasterId' | 'speedMultiplier'>, masters: readonly SpeedMaster[] = usePoolStore.getState().speedMasters): number {
  const master = masterOf(effect.speedMasterId, masters)
  if (!master) return effect.speed
  return (master.bpm / 60) * (effect.speedMultiplier ?? 1)
}

/** Test helper */
export function __resetSpeedTapsForTests(): void {
  taps.clear()
}
