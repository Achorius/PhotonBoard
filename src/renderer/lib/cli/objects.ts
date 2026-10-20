// ============================================================
// PhotonBoard — Command line: object numbers → objects
//
// What the user types are NUMBERS: fixture ID (fid), group / sequence /
// macro / chase / effect / speed master `number`, preset family.number
// ("Preset 4.2"), executor page.slot ("Executor 2.5", slot = col*4 +
// row + 1, column-major), DMX universe.address ("DMX 1.101").
// An object without a number answers to its list position (1-based),
// so today's `Fixture 3` / `Group 2` keep working on any show.
//
// Ranges keep the typed order: `Fixture 8 Thru 1` selects 8, 7… 1
// (selection order drives fans and Next / Prev). Everything reads the
// ProApi; nothing here writes.
// ============================================================

import type { Chase, Cue, Cuelist, Effect, Group, Macro, PatchEntry, Preset, PresetType, SpeedMaster } from '@shared/types'
import { PRESET_FAMILY_NUMBER, PRESET_TYPES } from '@shared/types'
import { MAX_EXECUTOR_PAGES } from '@shared/show-format'
import type { ExecutorRef, ProApi } from '@renderer/lib/pro/contracts'
import type { CliId, CliIdRange, CliObjectExpr, CliObjectKind, CliObjectRef } from './ast'
import { OBJECT_KEYWORDS } from './tokenizer'

export const EXECUTOR_COLS = 8
export const EXECUTOR_ROWS = 4
export const EXECUTOR_SLOTS = EXECUTOR_COLS * EXECUTOR_ROWS
export const DMX_UNIVERSE_SIZE = 512
/** Hard cap of a DMX range (16 universes) */
const MAX_DMX_RANGE = 16 * DMX_UNIVERSE_SIZE

// ---------------------------------------------------------------- text

/** `4.2` as typed */
export function idText(id: CliId): string {
  return id.text ?? (id.minor === undefined ? String(id.major) : `${id.major}.${id.minor}`)
}

export function rangeText(r: CliIdRange): string {
  if (r.to === undefined) return idText(r.from)
  if (r.to === 'end') return `${idText(r.from)} Thru`
  if (r.from.major === 0 && r.from.minor === undefined && r.from.text === undefined) return `Thru ${idText(r.to)}`
  return `${idText(r.from)} Thru ${idText(r.to)}`
}

/** "Group 1 Thru 3 + 5" */
export function refText(ref: CliObjectRef): string {
  const ids = ref.ids.map((x, i) => (i === 0 && x.op === '+' ? '' : `${x.op} `) + rangeText(x.range)).join(' ')
  const own = `${OBJECT_KEYWORDS[ref.kind]} ${ids}`
  if (!ref.parent) return own
  return ref.kind === 'cue' ? `${refText(ref.parent)} ${own}` : `${own} ${refText(ref.parent)}`
}

/** Cue number typed: `Cue 1.05` → 1.05 */
export function cueNumberOf(id: CliId): number {
  return parseFloat(idText(id))
}

/** "2.5" for an executor ref (page 1-based, slot column-major) */
export function executorText(ref: ExecutorRef): string {
  return `${ref.page + 1}.${ref.col * EXECUTOR_ROWS + ref.row + 1}`
}

/** "4.2" for a preset */
export function presetText(p: Preset, presets: readonly Preset[]): string {
  return `${PRESET_FAMILY_NUMBER[p.type]}.${presetNumber(p, presets)}`
}

// ---------------------------------------------------------------- generic numbered lookup

export interface Lookup<T> {
  found: T[]
  /** Text of the ids that matched nothing ("Group 7") */
  missing: string[]
}

interface Keyed<T> {
  item: T
  key: number
  explicit: boolean
}

/**
 * Pick items by key: single ids prefer an explicit number over a list
 * position; ranges keep the typed direction. `+` adds, `-` removes.
 */
function pick<T>(
  items: Keyed<T>[],
  ids: CliObjectRef['ids'],
  keyOf: (id: CliId, end: boolean) => number | null,
  label: (r: CliIdRange) => string,
  same: (a: T, b: T) => boolean = (a, b) => a === b
): Lookup<T> {
  let found: T[] = []
  const missing: string[] = []
  for (const { op, range } of ids) {
    let picked: T[] = []
    const lo = keyOf(range.from, false)
    if (range.to === undefined) {
      if (lo !== null) {
        const matches = items.filter(x => x.key === lo)
        const best = matches.find(x => x.explicit) ?? matches[0]
        if (best) picked = [best.item]
      }
    } else {
      const hi = range.to === 'end' ? keyOf(range.from, true) : keyOf(range.to, false)
      if (lo !== null && hi !== null) {
        const asc = lo <= hi
        const [a, b] = asc ? [lo, hi] : [hi, lo]
        const inRange = items.filter(x => x.key >= a && x.key <= b)
        // One item per key, explicit numbers first
        const byKey = new Map<number, Keyed<T>>()
        for (const x of inRange) {
          const cur = byKey.get(x.key)
          if (!cur || (!cur.explicit && x.explicit)) byKey.set(x.key, x)
        }
        picked = Array.from(byKey.values()).sort((x, y) => (asc ? x.key - y.key : y.key - x.key)).map(x => x.item)
      }
    }
    if (picked.length === 0) missing.push(label(range))
    if (op === '+') {
      for (const p of picked) if (!found.some(f => same(f, p))) found.push(p)
    } else {
      found = found.filter(f => !picked.some(p => same(f, p)))
    }
  }
  return { found, missing }
}

function numbered<T>(list: readonly T[], num: (x: T) => number | undefined): Keyed<T>[] {
  return list.map((item, i) => {
    const n = num(item)
    return { item, key: n ?? i + 1, explicit: n !== undefined }
  })
}

/** Plain numbers (no dot); `end` of an open range = everything after */
const plainKey = (id: CliId, end: boolean): number | null => (end ? Infinity : id.minor === undefined ? id.major : null)

function lookupNumbered<T>(kind: CliObjectKind, list: readonly T[], num: (x: T) => number | undefined, ref: CliObjectRef): Lookup<T> {
  return pick(numbered(list, num), ref.ids, plainKey, r => `${OBJECT_KEYWORDS[kind]} ${rangeText(r)}`)
}

// ---------------------------------------------------------------- per kind

export function lookupFixtures(api: ProApi, ref: CliObjectRef): Lookup<PatchEntry> {
  return lookupNumbered('fixture', api.getPatch(), p => p.fid, ref)
}

export function lookupGroups(api: ProApi, ref: CliObjectRef): Lookup<Group> {
  return lookupNumbered('group', api.getGroups(), g => g.number, ref)
}

export function lookupSequences(api: ProApi, ref: CliObjectRef): Lookup<Cuelist> {
  return lookupNumbered('sequence', api.getCuelists(), c => c.number, ref)
}

export function lookupMacros(api: ProApi, ref: CliObjectRef): Lookup<Macro> {
  return lookupNumbered('macro', api.getMacros(), m => m.number, ref)
}

export function lookupChases(api: ProApi, ref: CliObjectRef): Lookup<Chase> {
  return lookupNumbered('chase', api.getChases(), c => c.number, ref)
}

export function lookupEffects(api: ProApi, ref: CliObjectRef): Lookup<Effect> {
  return lookupNumbered('effect', api.getEffects(), e => e.number, ref)
}

export function lookupSpeedMasters(api: ProApi, ref: CliObjectRef): Lookup<SpeedMaster> {
  return lookupNumbered('speed', api.getSpeedMasters(), s => s.number, ref)
}

/** Number of a preset in its family (its `number`, else its position in the family) */
export function presetNumber(p: Preset, presets: readonly Preset[]): number {
  if (p.number !== undefined) return p.number
  return presets.filter(x => x.type === p.type).indexOf(p) + 1
}

const FAMILY_SPAN = 100000

export function presetTypeOfFamily(family: number): PresetType | undefined {
  return PRESET_TYPES.find(t => PRESET_FAMILY_NUMBER[t] === family)
}

/**
 * `Preset 4.2` = family 4 (colour) number 2. `Preset 2` = family 0
 * ("All") number 2, else the only preset numbered 2.
 */
export function lookupPresets(api: ProApi, ref: CliObjectRef): Lookup<Preset> {
  const presets = api.getPresets()
  const counters = new Map<PresetType, number>()
  const items: Keyed<Preset>[] = presets.map(p => {
    const pos = (counters.get(p.type) ?? 0) + 1
    counters.set(p.type, pos)
    return { item: p, key: PRESET_FAMILY_NUMBER[p.type] * FAMILY_SPAN + (p.number ?? pos), explicit: p.number !== undefined }
  })
  const keyOf = (id: CliId, end: boolean): number | null => {
    const family = id.minor === undefined ? 0 : id.major
    const n = id.minor === undefined ? id.major : id.minor
    return end ? family * FAMILY_SPAN + FAMILY_SPAN - 1 : family * FAMILY_SPAN + n
  }
  const res = pick(items, ref.ids, keyOf, r => `Preset ${rangeText(r)}`)
  // `Preset 2` with no "All" preset 2: the only preset numbered 2
  if (res.missing.length) {
    for (const { op, range } of ref.ids) {
      if (op !== '+' || range.to !== undefined || range.from.minor !== undefined) continue
      const label = `Preset ${rangeText(range)}`
      if (!res.missing.includes(label)) continue
      const same = items.filter(x => x.key % FAMILY_SPAN === range.from.major)
      if (same.length === 1) {
        res.missing = res.missing.filter(m => m !== label)
        if (!res.found.includes(same[0].item)) res.found.push(same[0].item)
      }
    }
  }
  return res
}

/** Sequence a cue reference belongs to: its `Sequence n`, else the selected one */
export function cueSequence(api: ProApi, ref: CliObjectRef): { cuelist: Cuelist | null; missing?: string } {
  if (ref.parent) {
    const seq = lookupSequences(api, ref.parent)
    return seq.found[0] ? { cuelist: seq.found[0] } : { cuelist: null, missing: refText(ref.parent) }
  }
  const id = api.getSelectedCuelist()
  return { cuelist: api.getCuelists().find(c => c.id === id) ?? null }
}

export function lookupCues(cuelist: Cuelist, ref: CliObjectRef): Lookup<Cue> {
  const items: Keyed<Cue>[] = cuelist.cues.map(c => ({ item: c, key: c.number, explicit: true }))
  return pick(items, ref.ids, (id, end) => (end ? Infinity : cueNumberOf(id)), r => `Cue ${rangeText(r)}`)
}

/** Executors: `Executor 2.5` = page 2 slot 5; `Executor 5` = current page slot 5. Empty cells count. */
export function lookupExecutors(api: ProApi, ref: CliObjectRef): Lookup<ExecutorRef> {
  const pages = api.getExecutorPages().length
  const current = api.getCurrentExecutorPage()
  const items: Keyed<ExecutorRef>[] = []
  for (let page = 0; page < pages; page++) {
    for (let slot = 0; slot < EXECUTOR_SLOTS; slot++) {
      items.push({ item: { page, col: Math.floor(slot / EXECUTOR_ROWS), row: slot % EXECUTOR_ROWS }, key: page * EXECUTOR_SLOTS + slot, explicit: true })
    }
  }
  const keyOf = (id: CliId, end: boolean): number | null => {
    const page = id.minor === undefined ? current : id.major - 1
    const slot = id.minor === undefined ? id.major : id.minor
    if (end) return page * EXECUTOR_SLOTS + EXECUTOR_SLOTS - 1
    if (slot < 1 || slot > EXECUTOR_SLOTS || page < 0) return null
    return page * EXECUTOR_SLOTS + slot - 1
  }
  return pick(items, ref.ids, keyOf, r => `Executor ${rangeText(r)}`, (a, b) => a.page === b.page && a.col === b.col && a.row === b.row)
}

/** Executor pages (0-based indexes); up to MAX_EXECUTOR_PAGES */
export function lookupPages(ref: CliObjectRef): Lookup<number> {
  const items: Keyed<number>[] = Array.from({ length: MAX_EXECUTOR_PAGES }, (_, i) => ({ item: i, key: i + 1, explicit: true }))
  return pick(items, ref.ids, plainKey, r => `Page ${rangeText(r)}`)
}

export interface DmxAddress {
  /** 0-based */
  universe: number
  /** 0-511 */
  channel: number
}

/** `DMX 1.101` = universe 1 address 101; `DMX 101` = universe 1 */
export function lookupDmx(ref: CliObjectRef): Lookup<DmxAddress> {
  const found: DmxAddress[] = []
  const missing: string[] = []
  const lin = (id: CliId): number | null => {
    const universe = id.minor === undefined ? 1 : id.major
    const address = id.minor === undefined ? id.major : id.minor
    if (universe < 1 || address < 1 || address > DMX_UNIVERSE_SIZE) return null
    return (universe - 1) * DMX_UNIVERSE_SIZE + address - 1
  }
  for (const { op, range } of ref.ids) {
    const a = lin(range.from)
    const b = range.to === undefined ? a : range.to === 'end' ? (a === null ? null : (Math.floor(a / DMX_UNIVERSE_SIZE) + 1) * DMX_UNIVERSE_SIZE - 1) : lin(range.to)
    if (a === null || b === null || Math.abs(b - a) >= MAX_DMX_RANGE) { missing.push(`DMX ${rangeText(range)}`); continue }
    const step = a <= b ? 1 : -1
    const list: number[] = []
    for (let k = a; k !== b + step; k += step) list.push(k)
    for (const k of list) {
      const at = found.findIndex(x => x.universe * DMX_UNIVERSE_SIZE + x.channel === k)
      if (op === '+' && at < 0) found.push({ universe: Math.floor(k / DMX_UNIVERSE_SIZE), channel: k % DMX_UNIVERSE_SIZE })
      if (op === '-' && at >= 0) found.splice(at, 1)
    }
  }
  return { found, missing }
}

// ---------------------------------------------------------------- fixtures of an expression

export interface FixtureSelection {
  /** Fixture ids in selection order */
  ids: string[]
  missing: string[]
  /** Groups named in the expression (preview "Group 'Wash'") */
  groups: Group[]
  /** Items that are not fixtures / groups (handled by the command) */
  others: CliObjectRef[]
}

/** Fixtures an object reference stands for (fixtures, groups, presets, cues, sequences) */
export function fixturesOfRef(api: ProApi, ref: CliObjectRef): { ids: string[]; missing: string[]; groups: Group[] } | null {
  const patchIds = new Set(api.getPatch().map(p => p.id))
  switch (ref.kind) {
    case 'fixture': {
      const r = lookupFixtures(api, ref)
      return { ids: r.found.map(p => p.id), missing: r.missing, groups: [] }
    }
    case 'group': {
      const r = lookupGroups(api, ref)
      const ids: string[] = []
      for (const g of r.found) for (const id of g.fixtureIds) if (patchIds.has(id) && !ids.includes(id)) ids.push(id)
      return { ids, missing: r.missing, groups: r.found }
    }
    case 'preset': {
      const r = lookupPresets(api, ref)
      const ids: string[] = []
      for (const p of r.found) for (const id of Object.keys(p.values)) if (patchIds.has(id) && !ids.includes(id)) ids.push(id)
      return { ids, missing: r.missing, groups: [] }
    }
    case 'sequence':
    case 'cue': {
      const ids: string[] = []
      const missing: string[] = []
      const cues: Cue[] = []
      if (ref.kind === 'sequence') {
        const r = lookupSequences(api, ref)
        missing.push(...r.missing)
        for (const cl of r.found) cues.push(...cl.cues)
      } else {
        const { cuelist, missing: m } = cueSequence(api, ref)
        if (!cuelist) missing.push(m ?? refText(ref))
        else {
          const r = lookupCues(cuelist, ref)
          missing.push(...r.missing)
          cues.push(...r.found)
        }
      }
      for (const c of cues) for (const v of c.values) if (patchIds.has(v.fixtureId) && !ids.includes(v.fixtureId)) ids.push(v.fixtureId)
      return { ids, missing, groups: [] }
    }
    default:
      return null
  }
}

/**
 * Fixtures of a selection expression: `Fixture 1 Thru 4 + Group 2 - 3 If Group 5`.
 * A relative expression (`+ 5`, `- Group 2`) starts from the current selection.
 */
export function resolveFixtureExpr(api: ProApi, expr: CliObjectExpr): FixtureSelection {
  let ids: string[] = expr.relative || expr.items.length === 0 ? [...api.getSelection()] : []
  const missing: string[] = []
  const groups: Group[] = []
  const others: CliObjectRef[] = []
  for (const { op, object } of expr.items) {
    const r = object.kind === 'fixture' || object.kind === 'group' ? fixturesOfRef(api, object) : null
    if (!r) { others.push(object); continue }
    missing.push(...r.missing)
    groups.push(...r.groups)
    if (op === '+') for (const id of r.ids) { if (!ids.includes(id)) ids.push(id) }
    else { const drop = new Set(r.ids); ids = ids.filter(id => !drop.has(id)) }
  }
  if (expr.condition) {
    const r = fixturesOfRef(api, expr.condition)
    if (r) {
      missing.push(...r.missing)
      const keep = new Set(r.ids)
      ids = ids.filter(id => keep.has(id))
    }
  }
  return { ids, missing, groups, others }
}

/** Display name of a fixture: its name, else "Fixture n" */
export function fixtureName(p: PatchEntry, patch: readonly PatchEntry[]): string {
  return p.name || `Fixture ${p.fid ?? patch.indexOf(p) + 1}`
}

/** Number shown for a numbered object (its number, else its list position) */
export function numberOf<T extends { number?: number }>(x: T, list: readonly T[]): number {
  return x.number ?? list.indexOf(x) + 1
}
