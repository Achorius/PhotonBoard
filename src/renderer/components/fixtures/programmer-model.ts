// ============================================================
// Programmer model — turns the selected fixtures into console
// "attributes" (Dimmer, Pan, Red, Gobo, Zoom…) grouped by feature
// (Intensity / Position / Colour / Beam / Control). One attribute
// drives the matching channel of every selected fixture (and every
// cell of multi-cell fixtures); 16-bit coarse/fine pairs are one
// attribute with a 0…65535 range.
// Pure (no React, no stores) so it can be unit tested.
// ============================================================

import type { FixtureCapability, FixtureChannel, FixtureDefinition, PatchEntry } from '@shared/types'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import { classifyModeChannels, ChannelRole } from '@renderer/lib/channel-classify'
import { getChannelShortLabel, getChannelTypeColor } from '@renderer/lib/fixture-library'
import type { Rgb } from './colour-math'

export type Feature = 'intensity' | 'position' | 'colour' | 'beam' | 'control'

export const FEATURES: { id: Feature; label: string }[] = [
  { id: 'intensity', label: 'Intensity' },
  { id: 'position', label: 'Position' },
  { id: 'colour', label: 'Colour' },
  { id: 'beam', label: 'Beam' },
  { id: 'control', label: 'Control' }
]

/** One channel driven by an attribute */
export interface AttrTarget {
  fixtureId: string
  universe: number
  /** 0-based channel in the universe */
  coarse: number
  /** 16-bit partner (0-based) or -1 */
  fine: number
}

/** A labelled DMX range of a channel (shutter "Open", gobo "Gobo 3", colour slot "Red") */
export interface AttrRange {
  from: number
  to: number
  label: string
  /** Swatch colour for colour-wheel slots, as "rgb(r g b)" */
  swatch?: string
  /** Wheel slot (gobo / colour / prism position) rather than a continuous range */
  slot: boolean
}

export interface Attribute {
  /** Canonical lower-case key ("dimmer", "pan", "red", "gobo", "zoom") */
  key: string
  label: string
  short: string
  feature: Feature
  channelType: FixtureChannel['type']
  /** Channel-type colour (fader fill, labels) */
  color: string
  /** Neutral value in the attribute's range (0…max) */
  defaultValue: number
  /** 16-bit: values are 0…65535 */
  fine: boolean
  max: number
  targets: AttrTarget[]
  /** Distinct fixtures that have this attribute */
  fixtureIds: string[]
  /** Labelled ranges from the fixture definition (≥ 2, else empty) */
  ranges: AttrRange[]
  /** Cells of multi-cell fixtures are merged into this attribute */
  cells: boolean
}

export interface ProgrammerModel {
  entries: PatchEntry[]
  attributes: Attribute[]
  byFeature: Record<Feature, Attribute[]>
  byKey: Map<string, Attribute>
  /** fixtureId → attribute keys it has */
  fixtureKeys: Map<string, Set<string>>
}

// ---------------------------------------------------------------- naming

const ALIASES: Record<string, string> = {
  intensity: 'dimmer', 'master dimmer': 'dimmer', master: 'dimmer', brightness: 'dimmer', dim: 'dimmer',
  r: 'red', g: 'green', b: 'blue', w: 'white', a: 'amber', c: 'cyan', m: 'magenta', y: 'yellow',
  ultraviolet: 'uv', 'ultra violet': 'uv', 'cold white': 'cool white',
  colour: 'color wheel', color: 'color wheel', 'colour wheel': 'color wheel', 'color wheel effect': 'color wheel',
  'colour macro': 'color macro', 'color macros': 'color macro',
  'colour temperature': 'color temperature', cct: 'color temperature',
  'shutter/strobe': 'shutter', 'strobe/shutter': 'shutter',
  'gobo wheel': 'gobo', 'gobo 1': 'gobo', 'gobo selection': 'gobo', 'gobo rot': 'gobo rotation', 'gobo spin': 'gobo rotation',
  'pan/tilt speed': 'speed', 'pt speed': 'speed', 'movement speed': 'speed'
}

const LABELS: Record<string, string> = {
  dimmer: 'Dimmer', pan: 'Pan', tilt: 'Tilt', red: 'Red', green: 'Green', blue: 'Blue', white: 'White', amber: 'Amber',
  uv: 'UV', lime: 'Lime', cyan: 'Cyan', magenta: 'Magenta', yellow: 'Yellow', 'color wheel': 'Colour wheel',
  'color macro': 'Colour macro', 'color temperature': 'Colour temp', cto: 'CTO', ctb: 'CTB', shutter: 'Shutter',
  strobe: 'Strobe', gobo: 'Gobo', 'gobo rotation': 'Gobo rotation', prism: 'Prism', 'prism rotation': 'Prism rotation',
  zoom: 'Zoom', focus: 'Focus', iris: 'Iris', frost: 'Frost', speed: 'Speed'
}

const SHORT: Record<string, string> = {
  'color wheel': 'CWHL', 'color macro': 'CMAC', 'color temperature': 'CCT', 'gobo rotation': 'GROT',
  'prism rotation': 'PROT', zoom: 'ZOOM', focus: 'FOC', iris: 'IRIS', frost: 'FRST', lime: 'L', cto: 'CTO', ctb: 'CTB'
}

/** Order inside a feature (lower first); unknown keys keep the mode order after these */
const PRIORITY: Record<string, number> = {
  dimmer: 0,
  pan: 0, tilt: 1,
  red: 0, green: 1, blue: 2, white: 3, 'warm white': 4, 'cool white': 5, amber: 6, lime: 7, uv: 8, indigo: 9,
  cyan: 10, magenta: 11, yellow: 12, cto: 13, ctb: 14, 'color temperature': 15, 'color wheel': 16, 'color macro': 17,
  shutter: 0, strobe: 1, gobo: 2, 'gobo rotation': 3, 'gobo 2': 4, prism: 5, 'prism rotation': 6, frost: 7, iris: 8,
  zoom: 9, focus: 10
}

const COLOUR_NAME = /(^|\s)(red|green|blue|white|amber|uv|ultra ?violet|lime|indigo|cyan|magenta|yellow|cto|ctb|ctc|hue|saturation|colou?r)(\s|$)/i
const BEAM_NAME = /(shutter|strobe|gobo|prism|zoom|focus|iris|frost|framing|blade|animation|beam|diffusion|edge)/i
const CELL_SUFFIX = /^(.+?)\s+(\d+)$/

export function canonicalKey(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ')
  return ALIASES[n] ?? n
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function attributeLabel(key: string): string {
  if (LABELS[key]) return LABELS[key]
  if (key.endsWith(' cells')) return `${attributeLabel(key.slice(0, -6))} cells`
  return titleCase(key)
}

function attributeShort(key: string, rawName: string): string {
  if (SHORT[key]) return SHORT[key]
  if (key.endsWith(' cells')) return `${attributeShort(key.slice(0, -6), rawName)}·n`
  return getChannelShortLabel(LABELS[key] ?? rawName)
}

function featureOf(key: string, role: ChannelRole, type: FixtureChannel['type'] | undefined): Feature {
  if (role === ChannelRole.Dimmer && !COLOUR_NAME.test(key)) return 'intensity'
  if (role === ChannelRole.Position || type === 'pan' || type === 'tilt') return /speed/.test(key) ? 'control' : 'position'
  if (type === 'speed' || type === 'maintenance' || type === 'fog' || /speed|reset|control|lamp|power|mode|program|sound|auto/.test(key)) {
    return 'control'
  }
  if (role === ChannelRole.Color || role === ChannelRole.ColorIntensity || type === 'color' || COLOUR_NAME.test(key)) return 'colour'
  if (role === ChannelRole.Shutter || type === 'gobo' || type === 'prism' || type === 'shutter' || type === 'strobe' || BEAM_NAME.test(key)) {
    return 'beam'
  }
  return 'control'
}

// ---------------------------------------------------------------- swatches

/** Named colours for wheel slots / capability labels (content colours, not UI chrome) */
const NAMED_RGB: [RegExp, [number, number, number]][] = [
  [/open|white|clear|no colou?r/i, [255, 255, 255]],
  [/deep red|dark red/i, [200, 0, 20]],
  [/red/i, [255, 30, 30]],
  [/orange/i, [255, 130, 0]],
  [/amber/i, [255, 170, 0]],
  [/yellow/i, [255, 230, 0]],
  [/lime/i, [170, 255, 0]],
  [/green/i, [0, 200, 60]],
  [/cyan|turquoise|aqua/i, [0, 220, 230]],
  [/light blue|sky/i, [80, 170, 255]],
  [/congo|dark blue|deep blue/i, [40, 0, 200]],
  [/blue/i, [20, 60, 255]],
  [/lavender|violet|purple|uv/i, [150, 60, 255]],
  [/magenta/i, [255, 0, 200]],
  [/pink|rose/i, [255, 110, 180]],
  [/cto|warm/i, [255, 190, 120]],
  [/ctb|cool/i, [190, 215, 255]]
]

export function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r} ${g} ${b})`
}

export function namedColour(label: string): [number, number, number] | undefined {
  for (const [re, rgb] of NAMED_RGB) if (re.test(label)) return rgb
  return undefined
}

function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Standard 8-slot dichroic wheel (same mapping as the 3D visualiser) */
export const STANDARD_COLOUR_WHEEL: AttrRange[] = ([
  [0, 7, 'Open', [255, 255, 255]],
  [8, 15, 'Red', [255, 50, 50]],
  [16, 23, 'Orange', [255, 166, 0]],
  [24, 31, 'Yellow', [255, 255, 0]],
  [32, 39, 'Green', [0, 204, 0]],
  [40, 47, 'Light blue', [0, 178, 255]],
  [48, 55, 'Blue', [0, 0, 255]],
  [56, 63, 'Magenta', [204, 0, 255]]
] as const).map(([from, to, label, rgb]) => ({ from, to, label, swatch: rgbCss(rgb as unknown as [number, number, number]), slot: true }))

function rangesOf(key: string, chDef: FixtureChannel | undefined): AttrRange[] {
  const caps: FixtureCapability[] = chDef?.capabilities ?? []
  const labelled = caps.filter((c) => Array.isArray(c.dmxRange) && c.dmxRange.length === 2)
  const isColourWheel = key === 'color wheel'
  if (labelled.length < 2) return isColourWheel ? STANDARD_COLOUR_WHEEL : []
  return labelled
    .map((c) => {
      const label = (c.label || c.comment || c.type || '').trim() || `${c.dmxRange[0]}–${c.dmxRange[1]}`
      const slot = /WheelSlot$|^Open$|ShutterOpen|ShutterClose|^Prism$|ColorPreset/i.test(c.type) || c.dmxRange[1] - c.dmxRange[0] <= 15
      const rgb = (c.color ? hexToRgb(c.color) : undefined) ?? (isColourWheel || key === 'color macro' ? namedColour(label) : undefined)
      return { from: c.dmxRange[0], to: c.dmxRange[1], label, swatch: rgb ? rgbCss(rgb) : undefined, slot }
    })
    .sort((a, b) => a.from - b.from)
}

// ---------------------------------------------------------------- build

interface Collected {
  key: string
  rawName: string
  feature: Feature
  type: FixtureChannel['type']
  defaultValue: number
  fine: boolean
  targets: AttrTarget[]
  fixtureIds: Set<string>
  ranges: AttrRange[]
  cells: boolean
  firstSeen: number
}

/**
 * Build the attribute model of a selection. `entries` keep the selection
 * order (first selected fixture = reference for single-value displays).
 */
export function buildProgrammerModel(entries: PatchEntry[], fixtures: FixtureDefinition[]): ProgrammerModel {
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  const collected = new Map<string, Collected>()
  const fixtureKeys = new Map<string, Set<string>>()
  let seen = 0

  for (const entry of entries) {
    const def = defs.get(entry.fixtureDefId)
    const mode = def?.modes.find((m) => m.name === entry.modeName)
    if (!def || !mode) continue
    const classified = classifyModeChannels(def, mode)
    const cellNames = new Set(mode.pixelLayout?.cells.flatMap((c) => c.channelNames) ?? [])
    // keys of the non-cell channels (so cell channels with the same key get their own "… cells" attribute)
    const plainKeys = new Set(
      mode.channels.filter((n, i) => n && !cellNames.has(n) && classified[i].coarseIndex === -1).map((n) => canonicalKey(n))
    )
    const keys = new Set<string>()

    classified.forEach((c, i) => {
      if (!c.name || c.coarseIndex !== -1) return
      const channel = entry.address - 1 + i
      if (channel < 0 || channel >= DMX_CHANNELS_PER_UNIVERSE) return
      const chDef = def.channels[c.name]
      let key = canonicalKey(c.name)
      let cells = false
      if (cellNames.has(c.name)) {
        const m = CELL_SUFFIX.exec(c.name.trim())
        if (m) {
          key = canonicalKey(m[1])
          cells = true
          if (plainKeys.has(key)) key = `${key} cells`
        }
      }
      const fineCh = c.fineIndex !== -1 ? entry.address - 1 + c.fineIndex : -1
      const target: AttrTarget = { fixtureId: entry.id, universe: entry.universe, coarse: channel, fine: fineCh >= 0 && fineCh < DMX_CHANNELS_PER_UNIVERSE ? fineCh : -1 }
      keys.add(key)
      const existing = collected.get(key)
      if (existing) {
        existing.targets.push(target)
        existing.fixtureIds.add(entry.id)
        existing.fine ||= target.fine >= 0
        existing.cells ||= cells
        return
      }
      const type = chDef?.type ?? 'generic'
      collected.set(key, {
        key,
        rawName: cells ? key : c.name,
        feature: featureOf(key, c.role, chDef?.type),
        type,
        defaultValue: c.defaultValue,
        fine: target.fine >= 0,
        targets: [target],
        fixtureIds: new Set([entry.id]),
        ranges: rangesOf(key, chDef),
        cells,
        firstSeen: seen++
      })
    })
    fixtureKeys.set(entry.id, keys)
  }

  const attributes: Attribute[] = [...collected.values()]
    .map((c) => {
      const max = c.fine ? 65535 : 255
      return {
        key: c.key,
        label: attributeLabel(c.key),
        short: attributeShort(c.key, c.rawName),
        feature: c.feature,
        channelType: c.type,
        color: getChannelTypeColor(c.type, LABELS[c.key.replace(/ cells$/, '')] ?? c.rawName),
        defaultValue: c.fine ? c.defaultValue * 257 : c.defaultValue,
        fine: c.fine,
        max,
        targets: c.targets,
        fixtureIds: [...c.fixtureIds],
        ranges: c.ranges,
        cells: c.cells,
        firstSeen: c.firstSeen
      }
    })
    .sort((a, b) => {
      const fa = FEATURES.findIndex((f) => f.id === a.feature)
      const fb = FEATURES.findIndex((f) => f.id === b.feature)
      if (fa !== fb) return fa - fb
      const pa = PRIORITY[a.key.replace(/ cells$/, '')] ?? 100
      const pb = PRIORITY[b.key.replace(/ cells$/, '')] ?? 100
      if (pa !== pb) return pa - pb
      if (a.cells !== b.cells) return a.cells ? 1 : -1
      return a.firstSeen - b.firstSeen
    })
    .map(({ firstSeen: _f, ...a }) => a)

  const byFeature = { intensity: [], position: [], colour: [], beam: [], control: [] } as Record<Feature, Attribute[]>
  for (const a of attributes) byFeature[a.feature].push(a)
  return { entries, attributes, byFeature, byKey: new Map(attributes.map((a) => [a.key, a])), fixtureKeys }
}

// ---------------------------------------------------------------- values

/** Value of one target in the attribute's range (8-bit targets scale up in a 16-bit attribute) */
export function readTarget(values: number[][], t: AttrTarget, fine: boolean): number {
  const row = values[t.universe]
  const c = row?.[t.coarse] ?? 0
  if (!fine) return c
  return t.fine >= 0 ? c * 256 + (row?.[t.fine] ?? 0) : c * 257
}

/** Min / max / first value of an attribute over its targets */
export interface AttrSummary {
  min: number
  max: number
  first: number
}

export function summarize(values: number[][], attr: Pick<Attribute, 'targets' | 'fine'>, fixtureId?: string): AttrSummary {
  let min = Infinity
  let max = -Infinity
  let first = 0
  let any = false
  for (const t of attr.targets) {
    if (fixtureId && t.fixtureId !== fixtureId) continue
    const v = readTarget(values, t, attr.fine)
    if (!any) { first = v; any = true }
    if (v < min) min = v
    if (v > max) max = v
  }
  return any ? { min, max, first } : { min: 0, max: 0, first: 0 }
}

/** Encode a summary as a string (stable zustand selector output) */
export function summaryKey(s: AttrSummary): string {
  return `${s.first}|${s.min}|${s.max}`
}

export function parseSummaryKey(k: string): AttrSummary {
  const [first, min, max] = k.split('|').map(Number)
  return { first, min, max }
}

/** The DMX writes for an attribute value (16-bit split into coarse / fine) */
export function targetWrites(t: AttrTarget, value: number, fine: boolean): [number, number][] {
  if (!fine) return [[t.coarse, Math.round(value)]]
  const v = Math.max(0, Math.min(65535, Math.round(value)))
  if (t.fine >= 0) return [[t.coarse, v >> 8], [t.fine, v & 255]]
  return [[t.coarse, Math.round(v / 257)]]
}

/** Channels of these targets as { universe: [channels] } (coarse + fine) */
export function targetChannels(targets: readonly AttrTarget[]): Record<number, number[]> {
  const out: Record<number, number[]> = {}
  for (const t of targets) {
    const list = (out[t.universe] ??= [])
    list.push(t.coarse)
    if (t.fine >= 0) list.push(t.fine)
  }
  return out
}

// ---------------------------------------------------------------- colour

/** Emitter values a fixture should get for a target colour, by the keys it has */
export function colourWrites(keys: Set<string>, rgb: Rgb, extra?: Partial<Record<string, number>>): Map<string, number> {
  const out = new Map<string, number>()
  let [r, g, b] = rgb
  const has = (k: string) => keys.has(k) || keys.has(`${k} cells`)
  const put = (k: string, v: number) => {
    const val = Math.max(0, Math.min(255, Math.round(v)))
    if (keys.has(k)) out.set(k, val)
    if (keys.has(`${k} cells`)) out.set(`${k} cells`, val)
  }
  if (has('red') && has('green') && has('blue')) {
    if (has('white')) {
      const w = Math.min(r, g, b)
      put('white', extra?.white ?? w)
      r -= w; g -= w; b -= w
    }
    put('red', r); put('green', g); put('blue', b)
    for (const k of ['amber', 'uv', 'lime', 'indigo']) if (has(k)) put(k, extra?.[k] ?? 0)
  } else if (has('cyan') || has('magenta') || has('yellow')) {
    put('cyan', 255 - r); put('magenta', 255 - g); put('yellow', 255 - b)
  } else if (has('color wheel')) {
    // handled by the caller with the wheel's slots (nearestSlot)
  }
  return out
}

/** Nearest colour slot of a wheel for a target colour */
export function nearestSlot(ranges: readonly AttrRange[], rgb: Rgb): AttrRange | undefined {
  let best: AttrRange | undefined
  let bestD = Infinity
  for (const r of ranges) {
    if (!r.swatch) continue
    const m = /rgb\((\d+) (\d+) (\d+)\)/.exec(r.swatch)
    if (!m) continue
    const d = (Number(m[1]) - rgb[0]) ** 2 + (Number(m[2]) - rgb[1]) ** 2 + (Number(m[3]) - rgb[2]) ** 2
    if (d < bestD) { bestD = d; best = r }
  }
  return best
}

/** Centre DMX value of a range */
export function rangeValue(r: AttrRange): number {
  return Math.round((r.from + r.to) / 2)
}
