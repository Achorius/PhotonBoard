// ============================================================
// Pools — pure model (no React, no stores): slot numbering, preset
// labels ("4.2"), tile previews (colour swatch, position dot, level),
// programmer values per preset family, what "Update" may change,
// speed master links and the "P4.2" chip of programmer values.
// ============================================================

import type {
  Chase, CueChannelValue, Cuelist, Effect, FixtureChannel, FixtureDefinition, PatchEntry, Preset, PresetType
} from '@shared/types'
import { PRESET_FAMILY_NUMBER } from '@shared/types'
import { canonicalAttributeKey, channelFitsPresetFamily } from '@shared/attribute-families'
import { fillObjectNumbers } from '@shared/show-format'

/** Preset pool rows, top to bottom (grandMA order, "All" last) */
export const POOL_FAMILIES: readonly PresetType[] = ['intensity', 'position', 'gobo', 'color', 'beam', 'focus', 'control', 'full']

export interface PoolSlot<T> {
  /** Slot number (1-based) */
  number: number
  item: T | null
}

/**
 * Number of every item (id → number). Valid unique numbers are kept, the
 * others get the next free number in list order (same rule as a show load,
 * so what is shown is what ensureObjectNumbers() will store).
 */
export function numbersOf<T extends { id: string; number?: number }>(list: readonly T[], familyOf?: (item: T) => string): Map<string, number> {
  const copies = list.map((item) => ({ item, n: item.number }))
  fillObjectNumbers(copies, (c) => c.n, (c, n) => { c.n = n }, familyOf ? (c) => familyOf(c.item) : undefined)
  return new Map(copies.map((c) => [c.item.id, c.n as number]))
}

/**
 * Slots 1…count of a pool: count = the highest used number + `spare`
 * empty slots, at least `min`, rounded up to a multiple of `step`.
 */
export function poolSlots<T extends { id: string }>(
  items: readonly T[], numbers: ReadonlyMap<string, number>, opts: { min?: number; spare?: number; step?: number } = {}
): PoolSlot<T>[] {
  const { min = 8, spare = 1, step = 1 } = opts
  const byNumber = new Map<number, T>()
  let max = 0
  for (const item of items) {
    const n = numbers.get(item.id)
    if (n === undefined || byNumber.has(n)) continue
    byNumber.set(n, item)
    if (n > max) max = n
  }
  let count = Math.max(min, max + spare)
  if (step > 1) count = Math.ceil(count / step) * step
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, item: byNumber.get(i + 1) ?? null }))
}

/** "4.2" (family . number) */
export function presetRef(preset: Pick<Preset, 'type' | 'number'>, number = preset.number): string {
  return `${PRESET_FAMILY_NUMBER[preset.type]}.${number ?? '?'}`
}

/** "P4.2" — the chip shown on programmer values that came from a preset */
export function presetChip(preset: Pick<Preset, 'type' | 'number'>): string {
  return `P${presetRef(preset)}`
}

// ---------------------------------------------------------------- previews

export type PresetPreview =
  | { kind: 'colour'; css: string }
  | { kind: 'position'; x: number; y: number }
  | { kind: 'level'; value: number }
  | { kind: 'none' }

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/** Named colours of wheel slots (content colours) */
const NAMED: [RegExp, [number, number, number]][] = [
  [/open|white|clear/i, [255, 255, 255]], [/red/i, [255, 40, 40]], [/orange/i, [255, 140, 0]], [/amber/i, [255, 170, 0]],
  [/yellow/i, [255, 230, 0]], [/lime/i, [170, 255, 0]], [/green/i, [0, 200, 60]], [/cyan|turquoise|aqua/i, [0, 220, 230]],
  [/light blue|sky/i, [80, 170, 255]], [/blue|congo/i, [30, 60, 255]], [/violet|purple|lavender|uv/i, [150, 60, 255]],
  [/magenta|pink/i, [255, 0, 200]], [/cto|warm/i, [255, 190, 120]], [/ctb|cool/i, [190, 215, 255]]
]

/** Standard 8-slot wheel (8 DMX values per slot) when the definition says nothing */
const STANDARD_WHEEL: [number, number, number][] = [
  [255, 255, 255], [255, 50, 50], [255, 166, 0], [255, 255, 0], [0, 204, 0], [0, 178, 255], [0, 0, 255], [204, 0, 255]
]

function hexRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function wheelColour(value: number, def: FixtureDefinition | undefined, channelName: string | undefined): [number, number, number] | undefined {
  const caps = channelName ? def?.channels[channelName]?.capabilities ?? [] : []
  const cap = caps.find((c) => Array.isArray(c.dmxRange) && value >= c.dmxRange[0] && value <= c.dmxRange[1])
  if (cap) {
    const fromHex = cap.color ? hexRgb(cap.color) : undefined
    if (fromHex) return fromHex
    const label = `${cap.label ?? ''} ${cap.comment ?? ''}`
    for (const [re, rgb] of NAMED) if (re.test(label)) return rgb
    return undefined
  }
  if (caps.length > 0) return undefined
  return STANDARD_WHEEL[Math.floor(value / 8)]
}

interface Sampled {
  values: Map<string, number>
  /** canonical key → [definition, channel name] it came from (wheel slot colours) */
  origin: Map<string, [FixtureDefinition | undefined, string | undefined]>
}

/** One value per canonical attribute: selective (first fixture) → global (first type) → universal */
function sample(preset: Preset, patch: readonly PatchEntry[], defs: readonly FixtureDefinition[]): Sampled {
  const values = new Map<string, number>()
  const origin = new Map<string, [FixtureDefinition | undefined, string | undefined]>()
  const defOf = (id: string | undefined) => (id ? defs.find((d) => d.id === id) : undefined)
  const put = (name: string, v: number, def: FixtureDefinition | undefined, channel: string | undefined) => {
    const key = canonicalAttributeKey(name)
    if (values.has(key)) return
    values.set(key, v)
    origin.set(key, [def, channel])
  }
  for (const [fixtureId, chans] of Object.entries(preset.values)) {
    const def = defOf(patch.find((p) => p.id === fixtureId)?.fixtureDefId)
    for (const [name, v] of Object.entries(chans)) put(name, v, def, name)
  }
  for (const [defId, chans] of Object.entries(preset.typeValues ?? {})) {
    for (const [name, v] of Object.entries(chans)) put(name, v, defOf(defId), name)
  }
  for (const [key, v] of Object.entries(preset.universal ?? {})) put(key, v, undefined, undefined)
  return { values, origin }
}

function colourOf(s: Sampled): string | null {
  const v = s.values
  const g = (k: string) => v.get(k) ?? v.get(`${k} cells`)
  if (g('red') !== undefined || g('green') !== undefined || g('blue') !== undefined) {
    const w = g('white') ?? 0
    const a = g('amber') ?? 0
    const r = clamp255((g('red') ?? 0) + w + a)
    const gr = clamp255((g('green') ?? 0) + w + a * 0.6)
    const b = clamp255((g('blue') ?? 0) + w)
    return `rgb(${r} ${gr} ${b})`
  }
  if (g('cyan') !== undefined || g('magenta') !== undefined || g('yellow') !== undefined) {
    return `rgb(${255 - clamp255(g('cyan') ?? 0)} ${255 - clamp255(g('magenta') ?? 0)} ${255 - clamp255(g('yellow') ?? 0)})`
  }
  const wheel = v.get('color wheel')
  if (wheel !== undefined) {
    const [def, ch] = s.origin.get('color wheel') ?? [undefined, undefined]
    const rgb = wheelColour(wheel, def, ch)
    if (rgb) return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
  }
  return null
}

/** What a pool tile shows: a colour swatch, a pan / tilt dot or a level bar */
export function presetPreview(preset: Preset, patch: readonly PatchEntry[], defs: readonly FixtureDefinition[]): PresetPreview {
  const s = sample(preset, patch, defs)
  const position = (): PresetPreview | null => {
    const pan = s.values.get('pan')
    const tilt = s.values.get('tilt')
    if (pan === undefined && tilt === undefined) return null
    return { kind: 'position', x: (pan ?? 128) / 255, y: (tilt ?? 128) / 255 }
  }
  const level = (): PresetPreview | null => {
    const d = s.values.get('dimmer') ?? s.values.get('dimmer cells')
    return d === undefined ? null : { kind: 'level', value: Math.max(0, Math.min(1, d / 255)) }
  }
  const colour = (): PresetPreview | null => {
    const css = colourOf(s)
    return css ? { kind: 'colour', css } : null
  }
  switch (preset.type) {
    case 'intensity': return level() ?? { kind: 'none' }
    case 'position': return position() ?? { kind: 'none' }
    case 'color': return colour() ?? { kind: 'none' }
    case 'full': return colour() ?? position() ?? level() ?? { kind: 'none' }
    default: return { kind: 'none' }
  }
}

/** Number of fixtures / types / attributes a preset holds (tile subtitle) */
export function presetSize(preset: Preset): number {
  return Object.keys(preset.values).length + Object.keys(preset.typeValues ?? {}).length + (preset.universal && Object.keys(preset.universal).length > 0 ? 1 : 0)
}

// ---------------------------------------------------------------- programmer values

export type ChannelLookup = (fixtureId: string, channelName: string) => Pick<FixtureChannel, 'type' | 'precedence'> | undefined

/** Lookup of a fixture channel's definition (type / precedence) */
export function channelLookup(patch: readonly PatchEntry[], defs: readonly FixtureDefinition[]): ChannelLookup {
  const entries = new Map(patch.map((p) => [p.id, p]))
  const defMap = new Map(defs.map((d) => [d.id, d]))
  return (fixtureId, channelName) => {
    const e = entries.get(fixtureId)
    return e ? defMap.get(e.fixtureDefId)?.channels[channelName] : undefined
  }
}

/** Programmer values that belong in a preset of this family ('full' keeps everything) */
export function valuesForFamily(values: readonly CueChannelValue[], type: PresetType, lookup: ChannelLookup): CueChannelValue[] {
  if (type === 'full') return [...values]
  return values.filter((v) => {
    const ch = lookup(v.fixtureId, v.channelName)
    return channelFitsPresetFamily(type, v.channelName, ch?.type, ch?.precedence)
  })
}

/** "Update": only the programmer values for channels the preset already holds (at its scope) */
export function valuesHeldByPreset(preset: Preset, values: readonly CueChannelValue[], patch: readonly PatchEntry[]): CueChannelValue[] {
  const defOf = new Map(patch.map((p) => [p.id, p.fixtureDefId]))
  return values.filter((v) => {
    if (preset.values[v.fixtureId]?.[v.channelName] !== undefined) return true
    const defId = defOf.get(v.fixtureId)
    if (defId && preset.typeValues?.[defId]?.[v.channelName] !== undefined) return true
    return preset.universal?.[canonicalAttributeKey(v.channelName)] !== undefined
  })
}

/** The same preset without values (Store … overwrite) */
export function emptiedPreset(preset: Preset): Preset {
  const { typeValues: _t, universal: _u, ...rest } = preset
  return { ...rest, values: {} }
}

/** Keep only the values of these fixtures (null = all) */
export function valuesOfFixtures(values: readonly CueChannelValue[], fixtureIds: readonly string[] | null): CueChannelValue[] {
  if (!fixtureIds) return [...values]
  const set = new Set(fixtureIds)
  return values.filter((v) => set.has(v.fixtureId))
}

// ---------------------------------------------------------------- groups

export function storeGroupFixtures(existing: readonly string[], selection: readonly string[], mode: 'merge' | 'overwrite'): string[] {
  return mode === 'overwrite' ? [...new Set(selection)] : [...new Set([...existing, ...selection])]
}

// ---------------------------------------------------------------- speed masters

export interface LinkedObject {
  kind: 'cuelist' | 'chase' | 'effect'
  id: string
  name: string
}

/** Scenes, chases and effects following a speed master */
export function linkedToSpeedMaster(
  id: string, cuelists: readonly Pick<Cuelist, 'id' | 'name' | 'speedMasterId'>[], chases: readonly Pick<Chase, 'id' | 'name' | 'speedMasterId'>[],
  effects: readonly Pick<Effect, 'id' | 'name' | 'speedMasterId'>[]
): LinkedObject[] {
  return [
    ...chases.filter((c) => c.speedMasterId === id).map((c) => ({ kind: 'chase' as const, id: c.id, name: c.name })),
    ...effects.filter((e) => e.speedMasterId === id).map((e) => ({ kind: 'effect' as const, id: e.id, name: e.name })),
    ...cuelists.filter((c) => c.speedMasterId === id).map((c) => ({ kind: 'cuelist' as const, id: c.id, name: c.name }))
  ]
}

// ---------------------------------------------------------------- programmer chip

export interface ChipTarget {
  fixtureId: string
  channel?: string
}

/** Programmer meta key of a fixture channel (lib/pro/programmer-engine) */
export const metaKey = (fixtureId: string, channel: string) => `${fixtureId}:${channel}`

/**
 * Programmer values that still come from a preset: meta key → preset id.
 * A value only counts while it equals what the preset gives (a fader moved
 * after the preset was applied is a plain value again).
 */
export function validPresetRefs(
  meta: ReadonlyMap<string, { presetId?: string }>,
  valueOf: (key: string, presetId: string) => { current: number | undefined; expected: number | undefined }
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, m] of meta) {
    if (!m.presetId) continue
    const { current, expected } = valueOf(key, m.presetId)
    if (current === undefined || expected === undefined || Math.round(current) !== Math.round(expected)) continue
    out.set(key, m.presetId)
  }
  return out
}

/**
 * Which preset the programmer values of these targets come from:
 * '' = none (or not all of them from a preset), a preset id, or '*' when
 * they come from several presets. Targets outside the programmer are ignored.
 */
export function presetOfTargets(
  targets: readonly ChipTarget[],
  refs: ReadonlyMap<string, string>,
  inProgrammer: (t: ChipTarget) => boolean
): string {
  let found = ''
  let held = 0
  for (const t of targets) {
    if (!t.channel || !inProgrammer(t)) continue
    held++
    const id = refs.get(metaKey(t.fixtureId, t.channel))
    if (!id) return ''
    if (found === '') found = id
    else if (found !== id) found = '*'
  }
  return held > 0 ? found : ''
}
