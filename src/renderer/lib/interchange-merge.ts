// ============================================================
// PhotonBoard — Merge an imported show fragment into a show (pure)
//
// An importer (src/main/interchange) turns a foreign file into an
// ImportedShowFragment with its own ids. This module brings the parts
// the operator chose (MergeOptions.include) into the current show
// content — or into an empty show ("open as a new show"):
//
//   - fixture types: the library's when it has every mode the patch
//     uses, else the file's definition (installed; renamed when the
//     library holds another definition under that id); identical
//     definitions are not installed twice,
//   - patch: new ids, universe offset, address conflicts shifted to
//     the next free addresses / kept overlapping / skipped (a skipped
//     fixture maps onto the show's fixture at that address when it is
//     the same type, so imported presets and cues still apply to it),
//   - groups, presets, sequences, chases, effects, macros, MIDI, speed
//     masters, executor pages, stage pages, timeline: new ids and every
//     reference remapped (values on fixtures that were not imported are
//     dropped, with a warning),
//   - placeholders (fixtures an importer invented because cues / groups
//     name them by fixture ID while the file has no patch for them) bind
//     to the show's fixture with that fixture ID: nothing is patched,
//     the imported values follow, channel names matched by attribute,
//   - object numbers (fixture ID, group, sequence, preset slot…): the
//     file's numbers are kept when free, else the next free numbers;
//     macro text ("Go Sequence 3") and stage widgets ("page.col.row")
//     follow the new numbers / pages (lib/interchange-macros),
//   - everything is normalised by the show-format normalisers first.
//
// The show's own items are returned by reference (only patch entries
// that join an imported group change): diffing the result against the
// stores yields a minimal change, applied as ONE undo step.
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import {
  DMX_CHANNELS_PER_UNIVERSE, MAX_UNIVERSES, PRESET_FAMILY_NUMBER,
  type Chase, type Cue, type CueChannelValue, type Cuelist, type Effect, type ExecutorCell, type ExecutorPage, type FixtureDefinition, type Group,
  type Macro, type MidiMapping, type PatchEntry, type Preset, type RoomConfig, type ShowExecutorLayout, type ShowFile, type ShowTimeline,
  type SpeedMaster, type StagePage
} from '@shared/types'
import {
  DEFAULT_TIMELINE_LENGTH, MAX_EXECUTOR_PAGES, MAX_OBJECT_NUMBER, createEmptyShow, executorLayoutFromPages, normalizeShow
} from '@shared/show-format'
import type { ImportWarning, ImportedShowFragment, InterchangeContent, MergeOptions } from '@shared/interchange'
import { attributeRoleOf, canonicalAttributeKey } from '@shared/attribute-families'
import { decodeColumnRef, decodeExecRef, encodeColumnRef, encodeExecRef } from '@renderer/components/stage/executor-surface'
import { renumberMacroLine, type MacroNumberMaps, type NumberMap } from './interchange-macros'

/** The show content a merge reads and writes */
export interface MergeContent {
  patch: PatchEntry[]
  groups: Group[]
  presets: Preset[]
  cuelists: Cuelist[]
  chases: Chase[]
  effects: Effect[]
  midiMappings: MidiMapping[]
  macros: Macro[]
  speedMasters: SpeedMaster[]
  stagePages: StagePage[]
  executor: ShowExecutorLayout
  timeline: Omit<ShowTimeline, 'timecode'>
  roomConfig: RoomConfig
}

/** Content kinds in the order the wizard lists them */
export const MERGE_CONTENT_KINDS: InterchangeContent[] = [
  'fixtures', 'patch', 'positions', 'groups', 'presets', 'cues', 'chases', 'effects', 'executors', 'timeline', 'midi', 'macros'
]

export type FixtureTypeOrigin = 'library' | 'catalog' | 'file' | 'generic' | 'missing'

export interface FixtureTypeSummary {
  id: string
  name: string
  manufacturer: string
  origin: FixtureTypeOrigin
  /** Patched fixtures of this type in the fragment */
  count: number
}

export interface MergeReport {
  /** Items added per content kind (fixtures = fixture types installed) */
  added: Partial<Record<InterchangeContent, number>>
  /** Imported fixtures moved to free addresses */
  shifted: number
  /** Imported fixtures not patched (conflict 'skip', universe out of range, no free address) */
  skipped: number
  /** Skipped fixtures matched onto the show's fixture at that address (same type) */
  matched: number
  /** Placeholder fixtures bound to the show's fixture with the same fixture ID */
  bound: number
  /** Objects whose number was taken and got the next free one */
  renumbered: number
  warnings: ImportWarning[]
}

export interface MergeResult {
  content: MergeContent
  /** Fixture definitions to save into the user library before applying the content */
  install: FixtureDefinition[]
  report: MergeReport
}

export interface MergeDeps {
  /** Id generator (tests: deterministic) */
  newId?: () => string
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function compact(s: string | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Content of an empty show (a "new show" import merges into this) */
export function emptyMergeContent(name = 'Imported Show'): MergeContent {
  return contentOfShow(createEmptyShow(name))
}

/** The merge view of a whole show */
export function contentOfShow(show: ShowFile): MergeContent {
  const { timecode: _tc, ...timeline } = show.timeline ?? { clips: [], markers: [], zones: [], trackCount: 3 }
  return {
    patch: show.patch,
    groups: show.groups,
    presets: show.presets,
    cuelists: show.cuelists,
    chases: show.chases,
    effects: show.effects,
    midiMappings: show.midiMappings,
    macros: show.macros ?? [],
    speedMasters: show.speedMasters ?? [],
    stagePages: show.stagePages ?? [],
    executor: show.executor ?? executorLayoutFromPages([]),
    timeline,
    roomConfig: show.roomConfig!
  }
}

function pageHasCells(page: ExecutorPage): boolean {
  return page.cells.some((col) => col.some((c) => c !== null))
}

/** How much of each content kind a fragment carries (the wizard's preview and default checkboxes) */
export function fragmentContents(f: ImportedShowFragment): Partial<Record<InterchangeContent, number>> {
  const out: Partial<Record<InterchangeContent, number>> = {}
  const set = (k: InterchangeContent, n: number) => { if (n > 0) out[k] = n }
  const usedTypes = new Set(f.patch.map((p) => p.fixtureDefId))
  for (const d of f.fixtures) usedTypes.add(d.id)
  set('fixtures', usedTypes.size)
  set('patch', f.patch.length)
  set('positions', f.patch.filter((p) => p.position3D || p.rotation3D || p.mountingLocation).length + (f.roomConfig ? 1 : 0))
  set('groups', f.groups.length)
  set('presets', f.presets.length)
  set('cues', f.cuelists.length)
  set('chases', f.chases.length)
  set('effects', f.effects.length)
  set('executors', (f.executor?.pages ?? []).filter(pageHasCells).length + (f.executor && !f.executor.pages && f.executor.grid?.some((c) => c.some(Boolean)) ? 1 : 0) + (f.stagePages?.length ?? 0))
  set('timeline', (f.timeline?.clips.length ?? 0) + (f.timeline?.markers.length ?? 0))
  set('midi', f.midiMappings.length)
  set('macros', f.macros.length)
  return out
}

/** Default options: everything the fragment carries */
export function defaultMergeOptions(f: ImportedShowFragment, mode: MergeOptions['mode']): MergeOptions {
  const include: MergeOptions['include'] = {}
  for (const k of Object.keys(fragmentContents(f)) as InterchangeContent[]) include[k] = true
  return { mode, include, addressConflicts: 'shift', universeOffset: 0 }
}

function hasModes(def: FixtureDefinition, modes: Set<string>): boolean {
  return [...modes].every((m) => def.modes.some((dm) => dm.name === m))
}

const CATALOG_ID = /^(ofl|qlc)\//

/** Where each fixture type the fragment uses comes from */
export function summarizeFixtureTypes(f: ImportedShowFragment, library: FixtureDefinition[]): FixtureTypeSummary[] {
  const lib = new Map(library.map((d) => [d.id, d]))
  const emb = new Map(f.fixtures.map((d) => [d.id, d]))
  const counts = new Map<string, number>()
  for (const p of f.patch) counts.set(p.fixtureDefId, (counts.get(p.fixtureDefId) ?? 0) + 1)
  for (const d of f.fixtures) if (!counts.has(d.id)) counts.set(d.id, 0)
  const out: FixtureTypeSummary[] = []
  for (const [id, count] of counts) {
    const l = lib.get(id)
    const e = emb.get(id)
    const def = l ?? e
    let origin: FixtureTypeOrigin
    if (l) origin = 'library'
    else if (e?.catalog || CATALOG_ID.test(id)) origin = 'catalog'
    else if (e && (e.source === 'gdtf' || e.source === 'qlcplus' || e.source === 'ofl')) origin = 'file'
    else if (e) origin = 'generic'
    else origin = 'missing'
    out.push({ id, name: def?.name ?? id, manufacturer: def?.manufacturer ?? '', origin, count })
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Numbers: keep the item's number when free, else the next free one (base numbers are never touched) */
function assignNumbers<T>(
  base: T[], added: T[], get: (x: T) => number | undefined, set: (x: T, n: number) => void, familyOf: (x: T) => string = () => ''
): number {
  const used = new Map<string, Set<number>>()
  const fam = (x: T) => { const k = familyOf(x); let s = used.get(k); if (!s) { s = new Set(); used.set(k, s) } return s }
  for (const b of base) { const n = get(b); if (n !== undefined) fam(b).add(n) }
  let renumbered = 0
  const missing: T[] = []
  for (const a of added) {
    const n = get(a)
    const s = fam(a)
    if (n !== undefined && Number.isInteger(n) && n >= 1 && n <= MAX_OBJECT_NUMBER && !s.has(n)) s.add(n)
    else { if (n !== undefined) renumbered++; missing.push(a) }
  }
  for (const a of missing) {
    const s = fam(a)
    let n = s.size > 0 ? Math.max(...s) + 1 : 1
    if (n > MAX_OBJECT_NUMBER) { n = 1; while (s.has(n) && n < MAX_OBJECT_NUMBER) n++ }
    s.add(n)
    set(a, n)
  }
  return renumbered
}

/** Free-channel map of the 16 universes */
class Occupancy {
  private readonly used: Uint8Array[] = Array.from({ length: MAX_UNIVERSES }, () => new Uint8Array(DMX_CHANNELS_PER_UNIVERSE + 1))

  mark(universe: number, address: number, count: number): void {
    const u = this.used[universe]
    if (!u) return
    for (let a = address; a < address + count && a <= DMX_CHANNELS_PER_UNIVERSE; a++) u[a] = 1
  }

  isFree(universe: number, address: number, count: number): boolean {
    const u = this.used[universe]
    if (!u || address < 1 || address + count - 1 > DMX_CHANNELS_PER_UNIVERSE) return false
    for (let a = address; a < address + count; a++) if (u[a]) return false
    return true
  }

  /** First free range of `count` channels at or after (universe, address) */
  findFree(universe: number, address: number, count: number): { universe: number; address: number } | null {
    for (let u = universe; u < MAX_UNIVERSES; u++) {
      for (let a = u === universe ? address : 1; a + count - 1 <= DMX_CHANNELS_PER_UNIVERSE; a++) {
        if (this.isFree(u, a, count)) return { universe: u, address: a }
      }
    }
    return null
  }
}

// ---------------------------------------------------------------
// The merge
// ---------------------------------------------------------------

export function mergeFragment(
  fragment: ImportedShowFragment,
  base: MergeContent,
  library: FixtureDefinition[],
  options: MergeOptions,
  deps: MergeDeps = {}
): MergeResult {
  const newId = deps.newId ?? uuidv4
  const inc = (k: InterchangeContent) => options.include[k] === true
  const isNew = options.mode === 'new'
  const warnings: ImportWarning[] = []
  const warn = (w: ImportWarning) => { warnings.push(w) }
  const report: MergeReport = { added: {}, shifted: 0, skipped: 0, matched: 0, bound: 0, renumbered: 0, warnings }
  const offset = Math.max(0, Math.min(MAX_UNIVERSES - 1, Math.round(options.universeOffset || 0)))

  // -- 1. Normalise the fragment like a show file (references checked, numbers filled) --
  const numbered = (list: unknown[] | undefined, key: 'number' | 'fid') =>
    new Set((Array.isArray(list) ? list : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter((x) => typeof x[key] === 'number' && typeof x.id === 'string').map((x) => x.id as string))
  const hadNumber = {
    patch: numbered(fragment.patch, 'fid'),
    groups: numbered(fragment.groups, 'number'),
    presets: numbered(fragment.presets, 'number'),
    cuelists: numbered(fragment.cuelists, 'number'),
    chases: numbered(fragment.chases, 'number'),
    effects: numbered(fragment.effects, 'number'),
    macros: numbered(fragment.macros, 'number'),
    speedMasters: numbered(fragment.speedMasters, 'number')
  }
  let frag: ShowFile
  try {
    const normalized = normalizeShow({
      version: '3',
      name: fragment.name,
      patch: fragment.patch,
      groups: fragment.groups,
      presets: fragment.presets,
      cuelists: fragment.cuelists,
      chases: fragment.chases,
      effects: fragment.effects,
      midiMappings: fragment.midiMappings,
      macros: fragment.macros,
      speedMasters: fragment.speedMasters ?? [],
      stagePages: fragment.stagePages ?? [],
      timeline: fragment.timeline,
      executor: fragment.executor,
      roomConfig: fragment.roomConfig
    })
    frag = normalized.show
    if (normalized.warnings.length > 0) warn({ level: 'info', code: 'normalized', params: { count: normalized.warnings.length }, message: normalized.warnings.slice(0, 5).join(' · ') })
  } catch (e) {
    warn({ level: 'error', code: 'invalidFragment', message: (e as Error).message })
    return { content: base, install: [], report }
  }

  const libById = new Map(library.map((d) => [d.id, d]))
  const embById = new Map(fragment.fixtures.filter((d) => d && typeof d.id === 'string').map((d) => [d.id, d]))

  // -- 2a. Placeholders: the show's fixture with the same fixture ID (merge only; a new show has none) --
  const baseByFid = new Map(base.patch.filter((p) => p.fid !== undefined).map((p) => [p.fid!, p]))
  const placeholderIds = new Set(Array.isArray(fragment.placeholderFixtureIds) ? fragment.placeholderFixtureIds : [])
  const boundTo = new Map<string, PatchEntry>()
  if (!isNew) {
    for (const p of frag.patch) {
      if (!placeholderIds.has(p.id) || p.fid === undefined || !hadNumber.patch.has(p.id)) continue
      const target = baseByFid.get(p.fid)
      if (target) boundTo.set(p.id, target)
    }
  }
  /** Channel names of a bound placeholder → the show fixture's channel (null = no such attribute) */
  const channelOf = new Map<string, (name: string) => string | null>()
  for (const [pid, target] of boundTo) {
    const p = frag.patch.find((x) => x.id === pid)!
    const src = embById.get(p.fixtureDefId) ?? libById.get(p.fixtureDefId)
    const dst = libById.get(target.fixtureDefId)
    const mode = dst?.modes.find((m) => m.name === target.modeName)
    if (!dst || !mode) continue // type unknown here: names kept
    const coarse = mode.channels.filter((c) => !dst.channels[c]?.fineOf)
    const cache = new Map<string, string | null>()
    channelOf.set(pid, (name) => {
      let hit = cache.get(name)
      if (hit !== undefined) return hit
      const key = canonicalAttributeKey(name)
      const ch = src?.channels[name]
      hit = mode.channels.includes(name) ? name
        : coarse.find((c) => canonicalAttributeKey(c) === key)
          ?? (attributeRoleOf(name, ch?.type, ch?.precedence) === 'dimmer'
            ? coarse.find((c) => attributeRoleOf(c, dst.channels[c]?.type, dst.channels[c]?.precedence) === 'dimmer') ?? null
            : null)
      cache.set(name, hit)
      return hit
    })
  }

  // -- 2. Fixture types --
  const install: FixtureDefinition[] = []
  const installedIds = new Set<string>()
  const defMap = new Map<string, string>()
  const usedModes = new Map<string, Set<string>>()
  if (inc('patch')) {
    for (const p of frag.patch) {
      if (boundTo.has(p.id)) continue // nothing patched: its type is not needed
      const s = usedModes.get(p.fixtureDefId) ?? new Set<string>()
      s.add(p.modeName)
      usedModes.set(p.fixtureDefId, s)
    }
  }
  const uniqueId = (wanted: string) => {
    let id = wanted
    for (let i = 2; libById.has(id) || installedIds.has(id); i++) id = `${wanted}-${i}`
    return id
  }
  const sameDefinition = (a: FixtureDefinition, b: FixtureDefinition, modes: Set<string>) =>
    compact(a.manufacturer) === compact(b.manufacturer) && compact(a.name) === compact(b.name) &&
    [...modes].every((m) => {
      const ma = a.modes.find((x) => x.name === m)
      const mb = b.modes.find((x) => x.name === m)
      return !!ma && !!mb && ma.channels.join('|') === mb.channels.join('|')
    })
  const installDef = (def: FixtureDefinition, id: string) => {
    install.push({ ...structuredClone(def), id })
    installedIds.add(id)
  }
  const missingTypes: string[] = []
  const resolveType = (id: string, modes: Set<string>) => {
    if (defMap.has(id)) return
    const lib = libById.get(id)
    const emb = embById.get(id)
    if (lib && hasModes(lib, modes)) { defMap.set(id, id); return }
    if (lib && emb) {
      // Another definition under that id: keep the library's (other shows use it), install the file's beside it
      const twin = library.find((d) => d.id !== id && sameDefinition(d, emb, modes))
      if (twin) { defMap.set(id, twin.id); return }
      const renamed = uniqueId(`${id}-import`)
      installDef(emb, renamed)
      defMap.set(id, renamed)
      warn({ level: 'info', code: 'fixtureTypeRenamed', params: { type: emb.name, id: renamed } })
      return
    }
    if (lib) {
      defMap.set(id, id)
      warn({ level: 'warning', code: 'modeMissing', params: { type: lib.name, modes: [...modes].filter((m) => !lib.modes.some((x) => x.name === m)).join(', ') } })
      return
    }
    if (emb) {
      const twin = library.find((d) => sameDefinition(d, emb, modes.size ? modes : new Set(emb.modes.map((m) => m.name))))
      if (twin) { defMap.set(id, twin.id); return }
      installDef(emb, id)
      defMap.set(id, id)
      return
    }
    defMap.set(id, id)
    missingTypes.push(id)
  }
  for (const [id, modes] of usedModes) resolveType(id, modes)
  if (inc('fixtures')) {
    // Fixture types the file carries without patching them (a GDTF, a fixture library export),
    // except the placeholder types whose fixtures all bound to the show's
    const boundOnly = new Set([...boundTo.keys()].map((id) => frag.patch.find((p) => p.id === id)!.fixtureDefId))
    for (const p of frag.patch) if (!boundTo.has(p.id)) boundOnly.delete(p.fixtureDefId)
    for (const d of embById.values()) if (!defMap.has(d.id) && !boundOnly.has(d.id)) resolveType(d.id, new Set())
  }
  if (missingTypes.length > 0) warn({ level: 'warning', code: 'fixtureTypesMissing', params: { count: missingTypes.length, types: missingTypes.slice(0, 5).join(', ') } })
  report.added.fixtures = install.length
  const defOf = (id: string) => libById.get(id) ?? install.find((d) => d.id === id) ?? embById.get(id)
  const footprint = (defId: string, mode: string) => defOf(defId)?.modes.find((m) => m.name === mode)?.channelCount ?? 1

  // -- 3. Patch --
  const occupancy = new Occupancy()
  const baseAt = new Map<string, PatchEntry>()
  for (const p of base.patch) {
    occupancy.mark(p.universe, p.address, footprint(p.fixtureDefId, p.modeName))
    baseAt.set(`${p.universe}:${p.address}`, p)
  }
  const patchMap = new Map<string, string>()
  const newPatch: PatchEntry[] = []
  const newPatchIds = new Set<string>()
  const POSITION_KEYS = ['position3D', 'rotation3D', 'mountingAngle', 'mountingPan', 'mountingLocation', 'stagePosition'] as const
  for (const p of frag.patch) {
    const bound = boundTo.get(p.id)
    if (bound) {
      patchMap.set(p.id, bound.id)
      report.bound++
      continue
    }
    const defId = defMap.get(p.fixtureDefId) ?? p.fixtureDefId
    const n = footprint(defId, p.modeName)
    let universe = p.universe + offset
    let address = p.address
    const sameAt = baseAt.get(`${universe}:${address}`)
    const matchExisting = () => {
      // The show's fixture at that address, else the one with that fixture ID — when it is the same type
      const byFid = p.fid !== undefined && hadNumber.patch.has(p.id) ? baseByFid.get(p.fid) : undefined
      const same = [sameAt, byFid].find((b) => b && b.fixtureDefId === defId && b.modeName === p.modeName)
      if (same) {
        patchMap.set(p.id, same.id)
        report.matched++
      }
    }
    if (!inc('patch')) { matchExisting(); continue }
    if (universe >= MAX_UNIVERSES) {
      report.skipped++
      warn({ level: 'warning', code: 'universeOutOfRange', params: { name: p.name, universe: universe + 1, max: MAX_UNIVERSES } })
      continue
    }
    if (!occupancy.isFree(universe, address, n) && options.addressConflicts !== 'keep') {
      if (options.addressConflicts === 'skip') {
        report.skipped++
        matchExisting()
        continue
      }
      const free = occupancy.findFree(universe, address, n)
      if (!free) {
        report.skipped++
        warn({ level: 'warning', code: 'noFreeAddress', params: { name: p.name } })
        continue
      }
      universe = free.universe
      address = free.address
      report.shifted++
    }
    const entry: PatchEntry = { ...p, id: newId(), fixtureDefId: defId, universe, address, groupIds: [] }
    if (!hadNumber.patch.has(p.id)) delete entry.fid
    if (!inc('positions')) for (const k of POSITION_KEYS) delete entry[k]
    occupancy.mark(universe, address, n)
    patchMap.set(p.id, entry.id)
    newPatchIds.add(entry.id)
    newPatch.push(entry)
  }
  if (report.bound > 0) warn({ level: 'info', code: 'placeholdersBound', params: { count: report.bound } })
  if (report.matched > 0) warn({ level: 'info', code: 'fixturesMatched', params: { count: report.matched } })
  if (report.shifted > 0) warn({ level: 'info', code: 'fixturesShifted', params: { count: report.shifted } })
  report.renumbered += assignNumbers(base.patch, newPatch, (p) => p.fid, (p, n) => { p.fid = n })
  report.added.patch = newPatch.length

  let droppedValues = 0
  /** Channel name on the merged fixture (a bound placeholder's names follow the show fixture's) */
  const renameChannel = (fragFixtureId: string, name: string): string | null => {
    const f = channelOf.get(fragFixtureId)
    return f ? f(name) : name
  }
  const mapValues = (values: CueChannelValue[], presetMap: Map<string, string>): CueChannelValue[] => {
    const out: CueChannelValue[] = []
    // Two placeholder channels may land on one channel of the show's fixture: the last value wins
    const at = new Map<string, number>()
    for (const v of values) {
      const fixtureId = patchMap.get(v.fixtureId)
      const channelName = fixtureId ? renameChannel(v.fixtureId, v.channelName) : null
      if (!fixtureId || !channelName) { droppedValues++; continue }
      const next: CueChannelValue = { ...v, fixtureId, channelName }
      if (v.presetId) {
        const pid = presetMap.get(v.presetId)
        if (pid) next.presetId = pid
        else delete next.presetId
      }
      const key = `${fixtureId}\u0000${channelName}\u0000${v.part ?? ''}`
      const i = at.get(key)
      if (i === undefined) { at.set(key, out.length); out.push(next) } else out[i] = next
    }
    return out
  }
  const mapFixtureIds = (ids: string[]) => Array.from(new Set(ids.map((id) => patchMap.get(id)).filter((x): x is string => !!x)))

  // -- 4. Groups --
  const groupMap = new Map<string, string>()
  const newGroups: Group[] = []
  let emptyGroups = 0
  if (inc('groups')) {
    for (const g of frag.groups) {
      const fixtureIds = mapFixtureIds(g.fixtureIds)
      if (fixtureIds.length === 0 && g.fixtureIds.length > 0) { emptyGroups++; continue }
      const group: Group = { ...g, id: newId(), fixtureIds }
      if (!hadNumber.groups.has(g.id)) delete group.number
      groupMap.set(g.id, group.id)
      newGroups.push(group)
    }
    for (const g of newGroups) {
      if (g.parentGroupId) {
        const parent = groupMap.get(g.parentGroupId)
        if (parent) g.parentGroupId = parent
        else delete g.parentGroupId
      }
    }
    report.renumbered += assignNumbers(base.groups, newGroups, (g) => g.number, (g, n) => { g.number = n })
    if (emptyGroups > 0) warn({ level: 'info', code: 'groupsEmptyDropped', params: { count: emptyGroups } })
  }
  report.added.groups = newGroups.length
  // Group membership on the fixtures (imported ones, and the show's fixtures an imported group now lists)
  const memberOf = new Map<string, string[]>()
  for (const g of newGroups) for (const fid of g.fixtureIds) memberOf.set(fid, [...(memberOf.get(fid) ?? []), g.id])
  for (const p of newPatch) p.groupIds = memberOf.get(p.id) ?? []
  const patchOut = base.patch.map((p) => {
    const extra = memberOf.get(p.id)
    return extra ? { ...p, groupIds: Array.from(new Set([...p.groupIds, ...extra])) } : p
  }).concat(newPatch)

  // -- 5. Presets --
  const presetMap = new Map<string, string>()
  const newPresets: Preset[] = []
  let emptyPresets = 0
  if (inc('presets')) {
    for (const pr of frag.presets) {
      const values: Preset['values'] = {}
      for (const [fid, chans] of Object.entries(pr.values)) {
        const id = patchMap.get(fid)
        if (!id) { droppedValues += Object.keys(chans).length; continue }
        const out: Record<string, number> = {}
        for (const [ch, v] of Object.entries(chans)) {
          const name = renameChannel(fid, ch)
          if (name) out[name] = v
          else droppedValues++
        }
        if (Object.keys(out).length > 0) values[id] = { ...(values[id] ?? {}), ...out }
      }
      const preset: Preset = { ...pr, id: newId(), values }
      if (pr.typeValues) {
        preset.typeValues = {}
        for (const [defId, chans] of Object.entries(pr.typeValues)) preset.typeValues[defMap.get(defId) ?? defId] = { ...chans }
      }
      const empty = Object.keys(values).length === 0 && Object.keys(preset.typeValues ?? {}).length === 0 && Object.keys(preset.universal ?? {}).length === 0
      if (empty && (Object.keys(pr.values).length > 0)) { emptyPresets++; continue }
      if (!hadNumber.presets.has(pr.id)) delete preset.number
      presetMap.set(pr.id, preset.id)
      newPresets.push(preset)
    }
    report.renumbered += assignNumbers(base.presets, newPresets, (p) => p.number, (p, n) => { p.number = n }, (p) => p.type)
    if (emptyPresets > 0) warn({ level: 'info', code: 'presetsEmptyDropped', params: { count: emptyPresets } })
  }
  report.added.presets = newPresets.length

  // -- 6. Speed masters (whatever plays may follow one) --
  const speedMap = new Map<string, string>()
  const newSpeed: SpeedMaster[] = []
  if (inc('cues') || inc('chases') || inc('effects') || inc('executors')) {
    for (const m of frag.speedMasters ?? []) {
      const sm: SpeedMaster = { ...m, id: newId() }
      if (!hadNumber.speedMasters.has(m.id)) sm.number = 0
      speedMap.set(m.id, sm.id)
      newSpeed.push(sm)
    }
    report.renumbered += assignNumbers(base.speedMasters, newSpeed, (m) => m.number || undefined, (m, n) => { m.number = n })
  }
  const speedRef = <T extends { speedMasterId?: string }>(x: T): T => {
    if (!x.speedMasterId) return x
    const id = speedMap.get(x.speedMasterId)
    const out = { ...x }
    if (id) out.speedMasterId = id
    else delete out.speedMasterId
    return out
  }

  // -- 7. Effects (before sequences: cue effect snapshots point at fixtures, not effects) --
  const effectMap = new Map<string, string>()
  const newEffects: Effect[] = []
  let emptyEffects = 0
  if (inc('effects')) {
    for (const e of frag.effects) {
      const fixtureIds = mapFixtureIds(e.fixtureIds)
      if (fixtureIds.length === 0 && e.fixtureIds.length > 0) { emptyEffects++; continue }
      const effect: Effect = speedRef({ ...e, id: newId(), fixtureIds, isRunning: false })
      if (!hadNumber.effects.has(e.id)) delete effect.number
      effectMap.set(e.id, effect.id)
      newEffects.push(effect)
    }
    report.renumbered += assignNumbers(base.effects, newEffects, (e) => e.number, (e, n) => { e.number = n })
    if (emptyEffects > 0) warn({ level: 'info', code: 'effectsEmptyDropped', params: { count: emptyEffects } })
  }
  report.added.effects = newEffects.length

  // -- 8. Sequences --
  const cuelistMap = new Map<string, string>()
  const newCuelists: Cuelist[] = []
  if (inc('cues')) {
    for (const cl of frag.cuelists) {
      const cues: Cue[] = cl.cues.map((c) => ({ ...c, id: newId(), values: mapValues(c.values, presetMap) }))
      const cuelist: Cuelist = speedRef({ ...cl, id: newId(), cues, currentCueIndex: -1, isPlaying: false, flash: false })
      if (cl.effectSnapshots) {
        cuelist.effectSnapshots = cl.effectSnapshots
          .map((e) => ({ ...e, id: newId(), fixtureIds: mapFixtureIds(e.fixtureIds), isRunning: false }))
          .filter((e) => e.fixtureIds.length > 0)
          .map((e) => speedRef(e))
      }
      if (!hadNumber.cuelists.has(cl.id)) delete cuelist.number
      cuelistMap.set(cl.id, cuelist.id)
      newCuelists.push(cuelist)
    }
    report.renumbered += assignNumbers(base.cuelists, newCuelists, (c) => c.number, (c, n) => { c.number = n })
  }
  report.added.cues = newCuelists.length

  // -- 9. Chases --
  const chaseMap = new Map<string, string>()
  const newChases: Chase[] = []
  if (inc('chases')) {
    for (const ch of frag.chases) {
      const chase: Chase = speedRef({
        ...ch, id: newId(), steps: ch.steps.map((s) => ({ ...s, id: newId(), values: mapValues(s.values, presetMap) })),
        currentStepIndex: 0, isPlaying: false
      })
      if (!hadNumber.chases.has(ch.id)) delete chase.number
      chaseMap.set(ch.id, chase.id)
      newChases.push(chase)
    }
    report.renumbered += assignNumbers(base.chases, newChases, (c) => c.number, (c, n) => { c.number = n })
  }
  report.added.chases = newChases.length
  if (droppedValues > 0) warn({ level: 'warning', code: 'valuesDropped', params: { count: droppedValues } })

  // -- 10. Macros --
  const macroMap = new Map<string, string>()
  const newMacros: Macro[] = []
  if (inc('macros')) {
    for (const m of frag.macros ?? []) {
      const macro: Macro = { ...m, id: newId(), lines: m.lines.map((l) => ({ ...l })) }
      if (!hadNumber.macros.has(m.id)) macro.number = 0
      macroMap.set(m.id, macro.id)
      newMacros.push(macro)
    }
    report.renumbered += assignNumbers(base.macros, newMacros, (m) => m.number || undefined, (m, n) => { m.number = n })
    // (their text follows the new numbers once the executor pages are placed, step 14)
  }
  report.added.macros = newMacros.length

  // -- 11. Timeline --
  const markerMap = new Map<string, string>()
  const zoneMap = new Map<string, string>()
  let timeline = base.timeline
  const fragTimeline = fragment.timeline ? frag.timeline : undefined
  if (inc('timeline') && fragTimeline) {
    const clips = fragTimeline.clips
      .filter((c) => cuelistMap.has(c.cuelistId))
      .map((c) => ({ ...c, id: newId(), cuelistId: cuelistMap.get(c.cuelistId)! }))
    const droppedClips = fragTimeline.clips.length - clips.length
    if (droppedClips > 0) warn({ level: 'info', code: 'clipsDropped', params: { count: droppedClips } })
    const markers = fragTimeline.markers.map((m) => { const id = newId(); markerMap.set(m.id, id); return { ...m, id } })
    const zones = fragTimeline.zones.map((z, i) => { const id = newId(); zoneMap.set(z.id, id); return { ...z, id, order: base.timeline.zones.length + i } })
    const trackCount = Math.max(base.timeline.trackCount, fragTimeline.trackCount, ...clips.map((c) => c.trackIndex + 1))
    timeline = isNew
      ? { ...fragTimeline, clips, markers, zones, trackCount }
      : {
        ...base.timeline,
        clips: [...base.timeline.clips, ...clips],
        markers: [...base.timeline.markers, ...markers].sort((a, b) => a.time - b.time),
        zones: [...base.timeline.zones, ...zones],
        trackCount,
        length: Math.max(base.timeline.length ?? DEFAULT_TIMELINE_LENGTH, fragTimeline.length ?? 0)
      }
    report.added.timeline = clips.length + markers.length
  }

  // -- 12. MIDI mappings --
  const newMidi: MidiMapping[] = []
  if (inc('midi')) {
    let dropped = 0
    for (const m of frag.midiMappings) {
      const t = m.target
      let id = t.id
      if (t.id) {
        const map = t.type === 'channel' ? patchMap
          : t.type === 'cuelist_go' || t.type === 'cuelist_fader' || t.type === 'flash' ? cuelistMap
            : t.type === 'chase_toggle' || t.type === 'chase_bpm' ? chaseMap
              : t.type === 'effect_toggle' ? effectMap
                : t.type === 'timeline_goto_marker' ? markerMap
                  : t.type === 'timeline_goto_zone' ? zoneMap
                    : null
        if (map) {
          id = map.get(t.id)
          if (!id) { dropped++; continue }
        }
      }
      newMidi.push({ ...m, id: newId(), source: { ...m.source }, target: { ...t, ...(id ? { id } : {}) }, options: { ...m.options } })
    }
    if (dropped > 0) warn({ level: 'info', code: 'midiDropped', params: { count: dropped } })
  }
  report.added.midi = newMidi.length

  // -- 13. Executor pages and stage pages --
  let executor = base.executor
  const newStagePages: StagePage[] = []
  /** Executor page of the file (0-based) → its index in the merged show (null = not imported) */
  const pageMap = new Map<number, number | null>()
  let unresolvedStageRefs = 0
  if (!inc('executors')) for (const p of frag.executor?.pages?.keys() ?? []) pageMap.set(p, null)
  if (inc('executors')) {
    const cellMap: Record<ExecutorCell['kind'], Map<string, string>> = {
      cuelist: cuelistMap, chase: chaseMap, effect: effectMap, macro: macroMap, group: groupMap, speed: speedMap
    }
    // Pages of the file (index in frag.executor.pages) → their index in the merged layout
    const fileIndex: number[] = []
    const imported: ExecutorPage[] = []
    if (fragment.executor) {
      (frag.executor?.pages ?? []).forEach((page, index) => {
        const out: ExecutorPage = {
          id: newId(),
          name: page.name,
          cells: page.cells.map((col) => col.map((cell) => {
            if (!cell) return null
            const id = cellMap[cell.kind]?.get(cell.id)
            return id ? { ...cell, id } : null
          })),
          columns: page.columns.map((c) => {
            const col = { ...c }
            if (c.fader && (c.fader.kind === 'speed' || c.fader.kind === 'group')) {
              const id = (c.fader.kind === 'speed' ? speedMap : groupMap).get(c.fader.id)
              if (id) col.fader = { kind: c.fader.kind, id }
              else delete col.fader
            }
            return col
          })
        }
        if (!pageHasCells(out)) return
        fileIndex.push(index)
        imported.push(out)
      })
    }
    const basePages = executor.pages ?? []
    const replaceBase = isNew || (basePages.length <= 1 && !basePages.some(pageHasCells))
    let pages = replaceBase ? imported : [...basePages, ...imported]
    if (pages.length > MAX_EXECUTOR_PAGES) {
      warn({ level: 'warning', code: 'executorPagesDropped', params: { count: pages.length - MAX_EXECUTOR_PAGES, max: MAX_EXECUTOR_PAGES } })
      pages = pages.slice(0, MAX_EXECUTOR_PAGES)
    }
    if (imported.length > 0) {
      executor = executorLayoutFromPages(pages.length > 0 ? pages : basePages)
      const first = replaceBase ? 0 : basePages.length
      fileIndex.forEach((from, i) => { if (first + i < MAX_EXECUTOR_PAGES) pageMap.set(from, first + i) })
    }
    for (const p of frag.executor?.pages?.keys() ?? []) if (!pageMap.has(p)) pageMap.set(p, null)
    report.added.executors = imported.length
    // Stage widgets: object ids, executor "page.col.row" and column "page.col" references
    const all = [patchMap, groupMap, presetMap, cuelistMap, chaseMap, effectMap, macroMap, speedMap]
    for (const sp of frag.stagePages ?? []) {
      newStagePages.push({
        ...sp,
        id: newId(),
        widgets: sp.widgets.map((w) => {
          let ref = w.ref
          if (ref) {
            const exec = w.kind === 'executor' ? decodeExecRef(ref) : null
            const column = !exec && w.kind === 'fader' && w.options?.target === 'column' ? decodeColumnRef(ref) : null
            const page = exec ?? column
            if (page) {
              // page 'current' follows the executor page shown: nothing to remap
              const to = page.page === 'current' ? 'current' : pageMap.get(page.page)
              if (to === undefined || to === null) unresolvedStageRefs++
              else ref = exec ? encodeExecRef({ ...exec, page: to }) : encodeColumnRef(to, column!.col)
            } else {
              const id = all.map((m) => m.get(ref!)).find(Boolean)
              if (id) ref = id
              else unresolvedStageRefs++
            }
          }
          return { ...w, id: newId(), ...(ref ? { ref } : {}) }
        })
      })
    }
    if (unresolvedStageRefs > 0) warn({ level: 'warning', code: 'stageRefsUnresolved', params: { count: unresolvedStageRefs } })
    report.added.executors += newStagePages.length
  }

  // -- 14. Macro text: object numbers of the file → their numbers in the merged show --
  const macroNumberMaps = (): MacroNumberMaps => {
    /** Number in the file → number of what it became (null: not imported) */
    const numbers = <T extends { id: string }>(
      list: T[], idMap: Map<string, string>, merged: T[], numberOf: (x: T) => number | undefined
    ): NumberMap => {
      const byId = new Map(merged.map((x) => [x.id, x]))
      const out: NumberMap = new Map()
      for (const x of list) {
        const n = numberOf(x)
        if (n === undefined || !Number.isFinite(n) || out.has(n)) continue
        const id = idMap.get(x.id)
        const to = id ? byId.get(id) : undefined
        out.set(n, to ? numberOf(to) ?? null : null)
      }
      return out
    }
    const preset = new Map<number, NumberMap>()
    for (const [type, family] of Object.entries(PRESET_FAMILY_NUMBER)) {
      preset.set(family, numbers(frag.presets.filter((p) => p.type === type), presetMap, newPresets, (p) => p.number))
    }
    return {
      fixture: numbers(frag.patch, patchMap, patchOut, (p) => p.fid),
      group: numbers(frag.groups, groupMap, newGroups, (g) => g.number),
      sequence: numbers(frag.cuelists, cuelistMap, newCuelists, (c) => c.number),
      chase: numbers(frag.chases, chaseMap, newChases, (c) => c.number),
      effect: numbers(frag.effects, effectMap, newEffects, (e) => e.number),
      macro: numbers(frag.macros ?? [], macroMap, newMacros, (m) => m.number || undefined),
      speed: numbers(frag.speedMasters ?? [], speedMap, newSpeed, (m) => m.number || undefined),
      page: new Map([...pageMap].map(([from, to]) => [from + 1, to === null ? null : to + 1])),
      preset
    }
  }
  if (newMacros.length > 0) {
    const maps = macroNumberMaps()
    let rewritten = 0
    const unresolved: string[] = []
    for (const m of newMacros) {
      let changed = false
      const refs: string[] = []
      m.lines = m.lines.map((l) => {
        const r = renumberMacroLine(l.command, maps)
        refs.push(...r.unresolved)
        if (!r.changed) return l
        changed = true
        return { ...l, command: r.text }
      })
      if (changed) rewritten++
      if (refs.length > 0) unresolved.push(`${m.name || `Macro ${m.number}`} (${[...new Set(refs)].slice(0, 3).join(', ')})`)
    }
    if (rewritten > 0) warn({ level: 'info', code: 'macrosRenumbered', params: { count: rewritten } })
    if (unresolved.length > 0) {
      warn({ level: 'warning', code: 'macroRefsUnresolved', params: { count: unresolved.length, macros: unresolved.slice(0, 5).join(' · ') } })
    }
  }

  // -- 15. Room --
  let roomConfig = base.roomConfig
  if (inc('positions') && fragment.roomConfig) {
    const r = frag.roomConfig!
    if (isNew) roomConfig = r
    else {
      const bars = [...base.roomConfig.trussBars]
      for (const b of r.trussBars) {
        if (bars.some((x) => x.name === b.name && Math.abs(x.z - b.z) < 0.01 && Math.abs(x.y - b.y) < 0.01)) continue
        bars.push({ ...b, id: `truss-${newId()}` })
      }
      roomConfig = {
        ...base.roomConfig,
        width: Math.max(base.roomConfig.width, r.width),
        depth: Math.max(base.roomConfig.depth, r.depth),
        height: Math.max(base.roomConfig.height, r.height),
        trussBars: bars
      }
    }
  }

  if (report.renumbered > 0) warn({ level: 'info', code: 'objectsRenumbered', params: { count: report.renumbered } })

  return {
    content: {
      patch: newPatch.length > 0 || patchOut.some((p, i) => p !== base.patch[i]) ? patchOut : base.patch,
      groups: newGroups.length ? [...base.groups, ...newGroups] : base.groups,
      presets: newPresets.length ? [...base.presets, ...newPresets] : base.presets,
      cuelists: newCuelists.length ? [...base.cuelists, ...newCuelists] : base.cuelists,
      chases: newChases.length ? [...base.chases, ...newChases] : base.chases,
      effects: newEffects.length ? [...base.effects, ...newEffects] : base.effects,
      midiMappings: newMidi.length ? [...base.midiMappings, ...newMidi] : base.midiMappings,
      macros: newMacros.length ? [...base.macros, ...newMacros] : base.macros,
      speedMasters: newSpeed.length ? [...base.speedMasters, ...newSpeed] : base.speedMasters,
      stagePages: newStagePages.length ? [...base.stagePages, ...newStagePages] : base.stagePages,
      executor,
      timeline,
      roomConfig
    },
    install,
    report
  }
}

/** A whole show from merged content ("open as a new show") */
export function showFromContent(content: MergeContent, name: string): ShowFile {
  const show = createEmptyShow(name)
  return normalizeShow({
    ...show,
    ...content,
    timeline: { ...content.timeline, timecode: show.timeline?.timecode },
    name
  }).show
}

/** Ids of fixture types the fragment's patch uses that neither the library nor the fragment defines */
export function missingFixtureTypes(f: ImportedShowFragment, library: FixtureDefinition[]): string[] {
  const have = new Set([...library.map((d) => d.id), ...f.fixtures.map((d) => d.id)])
  return Array.from(new Set(f.patch.map((p) => p.fixtureDefId).filter((id) => id && !have.has(id))))
}
