// ============================================================
// Display formatting — one way to show each kind of value.
// Values in the UI are DMX 0-255 internally; operators read %.
// ============================================================

/** DMX value as an integer string: 0…255 */
export function formatDmx(value: number): string {
  return String(Math.round(clamp(value, 0, 255)))
}

/** DMX (or any 0…max value) as a whole percentage: "0%"…"100%" */
export function formatPercent(value: number, max = 255): string {
  if (max <= 0) return '0%'
  return `${Math.round(clamp(value / max, 0, 1) * 100)}%`
}

/** Percentage without the sign (readouts that print the unit elsewhere) */
export function percentOf(value: number, max = 255): number {
  if (max <= 0) return 0
  return Math.round(clamp(value / max, 0, 1) * 100)
}

/** DMX address "U.AAA" with 1-based universe: (0, 1) → "1.001" */
export function formatAddress(universe: number, address: number): string {
  return `${universe + 1}.${String(address).padStart(3, '0')}`
}

/** Address range of a fixture: "1.001–1.016" (single channel → "1.001") */
export function formatAddressRange(universe: number, address: number, channelCount: number): string {
  const start = formatAddress(universe, address)
  if (channelCount <= 1) return start
  return `${start}–${String(address + channelCount - 1).padStart(3, '0')}`
}

/**
 * Durations (fades, delays): "0s", "0.5s", "2s", "12.5s", "1:05.0", "1:02:03".
 * Seconds keep one decimal only when needed.
 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 60) {
    const r = Math.round(seconds * 10) / 10
    return `${Number.isInteger(r) ? r : r.toFixed(1)}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${pad2(m)}:${pad2(Math.floor(s))}`
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

/** Clock / playhead position "MM:SS.d" (or "H:MM:SS") */
export function formatClock(seconds: number): string {
  const t = Math.max(0, seconds)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`
  return `${pad2(m)}:${pad2(s)}.${Math.floor((t * 10) % 10)}`
}

/** Tempo "120 BPM" (one decimal when not whole) */
export function formatBpm(bpm: number): string {
  const r = Math.round(bpm * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)} BPM`
}

/** Frequency "0.5 Hz" */
export function formatHz(hz: number): string {
  const r = Math.round(hz * 100) / 100
  return `${r} Hz`
}

/** Angle "45°" */
export function formatDegrees(deg: number): string {
  return `${Math.round(deg)}°`
}

/** Cue position in a cuelist: (2, 8) → "3/8"; stopped → "–/8" */
export function formatCuePosition(currentIndex: number, count: number): string {
  return `${currentIndex >= 0 ? currentIndex + 1 : '–'}/${count}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
}
