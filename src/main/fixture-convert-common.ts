// ============================================================
// PhotonBoard — helpers shared by the fixture converters
// (OFL JSON, QLC+ .qxf) and the offline catalog.
// Pure: no fs / electron, so the build script can bundle them.
// ============================================================

import type { FixtureChannel, FixtureMode, PixelLayout } from '../shared/types'

export function slugify(s: string): string {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Lower-case, accent-free words of a string ("Mégapointe 2.0" → ["megapointe", "2", "0"]) */
export function searchTokens(s: string): string[] {
  return stripAccents(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/** Lower-case alphanumerics only — for comparing names that differ in punctuation / spacing */
export function compactKey(s: string): string {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const MANUFACTURER_NOISE = new Set(['lighting', 'light', 'lights', 'led', 'inc', 'ltd', 'gmbh', 'co', 'the', 'pro', 'professional', 'systems', 'technology', 'electronics', 'international', 'group'])
const MANUFACTURER_ALIASES: Record<string, string> = {
  adj: 'americandj',
  americandj: 'americandj',
  clay: 'claypaky',
  claypaky: 'claypaky',
  highend: 'highendsystems',
  highendsystems: 'highendsystems',
  martinprofessional: 'martin',
  prolights: 'prolights'
}

/** Normalised manufacturer key used to merge the OFL and QLC+ catalogs ("ADJ" ≡ "American DJ") */
export function manufacturerMatchKey(name: string): string {
  const full = compactKey(name)
  if (MANUFACTURER_ALIASES[full]) return MANUFACTURER_ALIASES[full]
  const words = searchTokens(name).filter((w) => !MANUFACTURER_NOISE.has(w))
  const key = words.join('') || full
  return MANUFACTURER_ALIASES[key] ?? key
}

const GROUP_NOISE = new Set(['lighting', 'light', 'lights', 'inc', 'ltd', 'gmbh', 'co', 'the'])

/**
 * Key that decides which manufacturer spellings are listed as ONE manufacturer
 * ("ADJ" ≡ "American DJ", "Showtec Lighting" ≡ "Showtec") — stricter than
 * manufacturerMatchKey: "Chauvet" (QLC+) and "Chauvet Professional" (OFL) stay apart.
 */
export function manufacturerGroupKey(name: string): string {
  const full = compactKey(name)
  if (MANUFACTURER_ALIASES[full]) return MANUFACTURER_ALIASES[full]
  const key = searchTokens(name).filter((w) => !GROUP_NOISE.has(w)).join('') || full
  return MANUFACTURER_ALIASES[key] ?? key
}

/** Normalised model key; the manufacturer name is dropped when the model repeats it */
export function modelMatchKey(model: string, manufacturer: string): string {
  let m = compactKey(model)
  const mk = compactKey(manufacturer)
  if (mk && m.startsWith(mk) && m.length > mk.length) m = m.slice(mk.length)
  return m
}

/** Hex colours for OFL ColorIntensity colour names / QLC+ intensity presets */
export const EMITTER_COLORS: Record<string, string> = {
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  yellow: '#ffff00',
  amber: '#ffbf00',
  white: '#ffffff',
  'warm white': '#ffd9a0',
  'cold white': '#dceeff',
  uv: '#7f00ff',
  lime: '#bfff00',
  indigo: '#4b0082'
}

export function emitterColor(name: string | undefined | null): string | undefined {
  if (!name) return undefined
  if (/^#[0-9a-f]{6}$/i.test(name)) return name.toLowerCase()
  return EMITTER_COLORS[name.toLowerCase()]
}

export function clampByte(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0
}

/** Precedence convention of the console: intensity is HTP, everything else LTP */
export function defaultPrecedence(type: FixtureChannel['type']): 'HTP' | 'LTP' {
  return type === 'intensity' ? 'HTP' : 'LTP'
}

/**
 * Pixel layout of a mode from its cells (lists of channel indexes within the mode).
 * Only emitted when every cell is a contiguous run of channels with the same
 * size (the console addresses cell channels as offset + index).
 */
export function pixelLayoutFromCells(
  mode: Pick<FixtureMode, 'channels'>,
  cells: number[][],
  grid?: { columns: number; rows: number }
): PixelLayout | undefined {
  const usable = cells.filter((c) => c.length > 0)
  if (usable.length < 2) return undefined
  const size = usable[0].length
  for (const cell of usable) {
    if (cell.length !== size) return undefined
    const sorted = [...cell].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return undefined
  }
  const pixelCells = usable.map((cell, index) => {
    const offset = Math.min(...cell)
    return { index, channelOffset: offset, channelNames: mode.channels.slice(offset, offset + size) }
  })
  let orientation: PixelLayout['orientation'] = 'horizontal'
  let gridColumns: number | undefined
  if (grid && grid.columns > 1 && grid.rows > 1 && grid.columns * grid.rows >= pixelCells.length) {
    orientation = 'grid'
    gridColumns = grid.columns
  } else if (grid && grid.columns <= 1 && grid.rows > 1) {
    orientation = 'vertical'
  }
  return { cellCount: pixelCells.length, cells: pixelCells, orientation, ...(gridColumns ? { gridColumns } : {}) }
}

/** Unique, non-empty names for placeholder channels ("No function", "No function 2", …) */
export function uniqueName(base: string, taken: { has(name: string): boolean }): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`
    if (!taken.has(n)) return n
  }
}

/** Drop undefined / empty-array properties so the bundle stays compact (and deterministic) */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as T
}
