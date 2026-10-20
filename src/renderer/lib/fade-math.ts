// ============================================================
// PhotonBoard — Fade math shared by the cue and chase engines.
// Values are keyed "fixtureId:channelName". 16-bit pairs (e.g.
// Pan + Pan Fine) are interpolated on the combined 16-bit value so
// the fine channel never wraps around mid-fade.
// ============================================================

import type { KeyMetaFn } from './fixture-index'

/** Hermite smooth step, clamped to 0..1 (NaN → 0). */
export function smoothstep(t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/** Linear progress of a timed segment; zero/negative duration snaps (no NaN). */
export function segmentProgress(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return elapsedMs >= 0 ? 1 : 0
  if (!(elapsedMs > 0)) return 0
  return elapsedMs >= durationMs ? 1 : elapsedMs / durationMs
}

function clampByte(v: number): number {
  if (!(v > 0)) return 0
  if (v >= 255) return 255
  return Math.round(v)
}

/**
 * Blend `from` toward `to` for every key of `to`.
 * `progress(key, fromValue, toValue)` returns the eased 0..1 position of that
 * key (lets the caller use different times for up / down / LTP moves).
 * Keys missing from `from` start at `startValue(key)` (default: their target, i.e. snap).
 */
export function blendValues(
  from: Map<string, number>,
  to: Map<string, number>,
  progress: (key: string, fromValue: number, toValue: number) => number,
  meta: KeyMetaFn,
  startValue?: (key: string) => number | undefined
): Map<string, number> {
  const out = new Map<string, number>()
  const handled = new Set<string>()

  const startOf = (key: string, target: number): number => {
    const f = from.get(key)
    if (f !== undefined) return f
    const s = startValue?.(key)
    return s === undefined ? target : s
  }

  for (const [key, target] of to) {
    if (handled.has(key)) continue
    const m = meta(key)

    // 16-bit pair: drive both halves from the coarse key
    const coarseKey = m.coarseKey && to.has(m.coarseKey) ? m.coarseKey : m.fineKey ? key : undefined
    const fineKey = coarseKey === key ? m.fineKey : coarseKey ? key : undefined
    // Only when the fine half is actually driven (a cue may store the coarse channel alone)
    if (coarseKey && fineKey && (to.has(fineKey) || from.has(fineKey))) {
      const toC = to.get(coarseKey) ?? 0
      const toF = to.get(fineKey) ?? (from.get(fineKey) ?? 0)
      const fromC = startOf(coarseKey, toC)
      const fromF = from.get(fineKey) ?? (from.has(coarseKey) ? 0 : toF)
      const from16 = fromC * 256 + fromF
      const to16 = toC * 256 + toF
      const p = progress(coarseKey, fromC, toC)
      const v16 = Math.max(0, Math.min(65535, Math.round(from16 + (to16 - from16) * p)))
      out.set(coarseKey, v16 >> 8)
      out.set(fineKey, v16 & 0xff)
      handled.add(coarseKey)
      handled.add(fineKey)
      continue
    }

    const fromValue = startOf(key, target)
    const p = progress(key, fromValue, target)
    out.set(key, clampByte(fromValue + (target - fromValue) * p))
    handled.add(key)
  }
  return out
}
