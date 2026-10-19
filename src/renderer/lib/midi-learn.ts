// ============================================================
// PhotonBoard — MIDI learn helpers (pure)
// ============================================================

export type CcEncoding = 'absolute' | 'relative'

/** Two's-complement relative encoders: 1..n clockwise, 127..128-n counter-clockwise */
function isTwosComplementDelta(v: number): boolean {
  return (v >= 1 && v <= 15) || (v >= 113 && v <= 127)
}

/** Binary-offset relative encoders: 64 ± n (63/65 pattern) */
function isBinaryOffsetDelta(v: number): boolean {
  return v >= 49 && v <= 79 && v !== 64
}

/**
 * Decide whether a CC learned from `values` (in arrival order) comes from a
 * relative encoder. Defaults to absolute: one message (e.g. a fader touched
 * at its end stop) is never enough. Relative needs several messages that all
 * look like small deltas AND repeat a value back-to-back — an absolute
 * control only sends when its value changes, so it cannot repeat.
 */
export function detectCcEncoding(values: number[]): CcEncoding {
  const vals = values.filter(v => Number.isInteger(v) && v >= 0 && v <= 127)
  if (vals.length < 3) return 'absolute'

  const allTwos = vals.every(isTwosComplementDelta)
  const allOffset = vals.every(isBinaryOffsetDelta)
  if (!allTwos && !allOffset) return 'absolute'

  let repeats = 0
  for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) repeats++
  if (repeats === 0) return 'absolute'

  // Many distinct values = a sweep, not an encoder
  if (new Set(vals).size > 4) return 'absolute'
  return 'relative'
}

/** Signed delta of a relative CC value (two's complement or binary offset). */
export function relativeDelta(value: number): number {
  if (isBinaryOffsetDelta(value) && !isTwosComplementDelta(value)) return value - 64
  return value <= 63 ? value : value - 128
}
