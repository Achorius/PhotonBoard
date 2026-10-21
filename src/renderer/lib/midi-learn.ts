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
  if (slammedToEndStop(vals)) return 'absolute'
  return 'relative'
}

/**
 * A fader pushed to its end stop: a strictly monotonic approach (at least two
 * distinct values) then the end value repeated (hardware often re-sends 127 /
 * 0 when the fader hits the stop). 120, 124, 127, 127 is a fader; 127, 127,
 * 126, 127 (an encoder turned counter-clockwise) is not.
 */
function slammedToEndStop(vals: number[]): boolean {
  const last = vals[vals.length - 1]
  if (last !== 0 && last !== 127) return false
  let k = vals.length - 1
  while (k > 0 && vals[k - 1] === last) k--
  const head = vals.slice(0, k)
  if (head.length < 2) return false
  const up = last === 127
  const path = [...head, last]
  for (let i = 1; i < path.length; i++) {
    if (up ? path[i] <= path[i - 1] : path[i] >= path[i - 1]) return false
  }
  return true
}

/**
 * Canonical MIDI port name, for matching a mapping's device against the port
 * a message came from. The same device shows up under different names on
 * different systems and sessions (a show prepared on a Mac, played on the
 * Pi): Linux ALSA prefixes the port with its client name and cuts it at
 * 31-32 characters ("APC mini mk2 APC mini mk2 Contro" = macOS "APC mini mk2
 * Control"), may add " MIDI 1" ("APC MINI MIDI 1") or a "client:port"
 * suffix that moves with the plug order ("… 20:0"). Case and spacing vary.
 * A Windows instance prefix ("2- APC MINI") is KEPT: it tells two identical
 * controllers apart.
 */
export function normalizeMidiPortName(name: string): string {
  const cached = normalizedNames.get(name)
  if (cached !== undefined) return cached
  const words = name
    .trim()
    .replace(/\s+\d+:\d+$/, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  // "<client> <client> <port>" (ALSA): drop the repeated client name
  for (let k = 1; k * 2 <= words.length; k++) {
    if (words.slice(0, k).join(' ') === words.slice(k, 2 * k).join(' ')) {
      words.splice(0, k)
      break
    }
  }
  const out = words.join(' ').replace(/ midi \d+$/, '')
  if (normalizedNames.size > 256) normalizedNames.clear()
  normalizedNames.set(name, out)
  return out
}

/** Port names are few and matched on every message: cache their canonical form */
const normalizedNames = new Map<string, string>()

/** ALSA cuts port names around 32 characters */
const ALSA_TRUNCATED_LENGTH = 30

/**
 * Same device? Exact name, equal canonical names, or one name is an
 * ALSA-truncated form of the other ("… Contro" / "… Control").
 */
export function sameMidiPort(a: string, b: string): boolean {
  if (a === b) return true
  const na = normalizeMidiPortName(a)
  const nb = normalizeMidiPortName(b)
  if (na === nb) return na.length > 0
  const [short, shortRaw, long] = na.length <= nb.length ? [na, a, nb] : [nb, b, na]
  return shortRaw.trim().length >= ALSA_TRUNCATED_LENGTH && short.length >= 4 && long.startsWith(short)
}

/** Signed delta of a relative CC value (two's complement or binary offset). */
export function relativeDelta(value: number): number {
  if (isBinaryOffsetDelta(value) && !isTwosComplementDelta(value)) return value - 64
  return value <= 63 ? value : value - 128
}
