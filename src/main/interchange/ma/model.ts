// ============================================================
// PhotonBoard — grandMA intermediate model (pure)
// The grandMA2 and grandMA3 XML readers produce this model; build.ts
// turns it into an ImportedShowFragment (fixture types, patch, values).
// ============================================================

import type { ImportWarning } from '../../../shared/interchange'
import type { CueFeature, CuePart, FixtureDefinition, PresetScope } from '../../../shared/types'

/** grandMA fixture address: ID type + number ("Fixture 101", "Channel 12") */
export interface MaRef {
  /** 'fixture' | 'channel' | 'universal' | other grandMA ID type keyword (lower case) */
  idType: string
  id: number
  /** Sub-fixture / instance (1-based) when the data addresses one */
  sub?: number
}

export function refKey(ref: MaRef): string {
  return `${ref.idType}:${ref.id}`
}

export interface MaFixtureDecl {
  ref: MaRef
  name?: string
  /** Fixture type name as written ("Mac 250+ Mode 2", "Robe@Robin MegaPointe") */
  typeName?: string
  typeManufacturer?: string
  modeName?: string
  /** DMX footprint when known (number of channels) */
  footprint?: number
  /** 0-based universe and 1-based address; undefined = unpatched */
  universe?: number
  address?: number
  /** Metres, grandMA axes (x right, y upstage, z up) */
  position?: { x: number; y: number; z: number }
  /** Degrees, grandMA axes */
  rotation?: { x: number; y: number; z: number }
  layer?: string
  /** More than one DMX break / multipatch: only the first address is used */
  extraBreaks?: number
}

export type MaValueUnit = 'percent' | 'physical' | 'relative'

export interface MaValue {
  ref: MaRef
  attribute: string
  value: number
  unit: MaValueUnit
  fade?: number
  delay?: number
  part?: number
  /** "4.2" (pool.number) when the value references a preset */
  presetRef?: string
}

export interface MaCue {
  number: number
  name?: string
  /** 'go' (manual), 'follow', 'time' or another grandMA trigger keyword (lower case) */
  trig?: string
  trigTime?: number
  fade?: number
  outFade?: number
  delay?: number
  outDelay?: number
  featureTiming?: Partial<Record<CueFeature, { fade?: number; delay?: number }>>
  parts?: CuePart[]
  values: MaValue[]
  block?: boolean
}

export interface MaSequence {
  number?: number
  name: string
  tracking?: boolean
  loop?: boolean
  priority?: number
  cues: MaCue[]
}

export interface MaPreset {
  /** grandMA preset pool (1 Dimmer, 2 Position, 3 Gobo, 4 Color, 5 Beam, 6 Focus, 7 Control, 8 Shapers, 9 Video, 21-25 All) */
  pool?: number
  number?: number
  name: string
  scope: PresetScope
  values: MaValue[]
}

export interface MaGroup {
  number?: number
  name: string
  /** Selection order */
  items: MaRef[]
}

export interface MaMacro {
  number?: number
  name: string
  lines: { command: string; wait?: number }[]
}

export interface MaEffectLine {
  attribute: string
  fixtures: MaRef[]
  form?: string
  low?: number
  high?: number
  phaseFrom?: number
  phaseTo?: number
  rate?: number
  width?: number
}

export interface MaEffect {
  number?: number
  name: string
  lines: MaEffectLine[]
}

export interface MaFixtureTypeChannel {
  attribute: string
  /** 1-based DMX offsets */
  coarse: number
  fine?: number
  default?: number
}

export interface MaFixtureType {
  name: string
  manufacturer?: string
  shortName?: string
  modes: { name: string; channels: MaFixtureTypeChannel[] }[]
}

export interface MaDocument {
  format: 'ma3-xml' | 'ma2-xml'
  showName?: string
  sourceApp?: string
  fixtures: MaFixtureDecl[]
  fixtureTypes: MaFixtureType[]
  /** Definitions found as files next to the XML (GDTF in a zip) */
  embeddedDefinitions: FixtureDefinition[]
  sequences: MaSequence[]
  presets: MaPreset[]
  groups: MaGroup[]
  macros: MaMacro[]
  effects: MaEffect[]
  warnings: ImportWarning[]
}

export function emptyMaDocument(format: MaDocument['format']): MaDocument {
  return {
    format, fixtures: [], fixtureTypes: [], embeddedDefinitions: [], sequences: [], presets: [], groups: [],
    macros: [], effects: [], warnings: []
  }
}

/** Append a warning, merging repeats of the same code + message into a count */
export function addWarning(list: ImportWarning[], w: ImportWarning): void {
  const same = list.find(x => x.code === w.code && x.message === w.message && x.level === w.level)
  if (same) {
    const n = Number(same.params?.count ?? 1) + Number(w.params?.count ?? 1)
    same.params = { ...(same.params ?? {}), count: n }
    return
  }
  list.push(w)
}

/** grandMA numeric ID types (Group / Phaser XML `IDType`) → keyword */
const ID_TYPES = ['fixture', 'channel', 'universal', 'houselights', 'nondim', 'media', 'fog', 'effect', 'pyro', 'marker']

export function idTypeName(v: string | undefined): string {
  if (v === undefined || v.trim() === '') return 'fixture'
  const s = v.trim()
  if (/^\d+$/.test(s)) return ID_TYPES[Number(s)] ?? `idtype${s}`
  const l = s.toLowerCase()
  return l === 'generic' ? 'universal' : l
}

/** "101", "101.2" → { id, sub } */
export function parseMaId(v: string | undefined): { id: number; sub?: number } | null {
  if (v === undefined) return null
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(v)
  if (!m) return null
  const id = Number(m[1])
  const sub = m[2] !== undefined ? Number(m[2]) : undefined
  return { id, sub: sub && sub > 0 ? sub : undefined }
}
