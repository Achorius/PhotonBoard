// ============================================================
// PhotonBoard — Show content diff / merge (pure, no stores)
//
// Remote editing works on SECTIONS of the show (scenes, chases,
// patch…). This module holds the pure parts shared by the console
// and the remote browser:
//   - content equality (runtime state such as a playing scene, a
//     running effect or a chase's current step is NOT content),
//   - the diff a remote sends (upsert / remove / order by id),
//   - merging a diff or a full section into the running show while
//     keeping the runtime state of the items that stay.
// ============================================================

import type { Chase, Cuelist, Effect, Group, PatchEntry, SpeedMaster } from '@shared/types'
import type { ContentItems, ContentSection, ContentValues, ListSection, TimelineContent } from '@shared/show-format'
import { isListSection } from '@shared/show-format'
import type { SectionChange } from '@shared/remote-commands'

export type SectionData = { [K in ListSection]: ContentItems[K][] } & ContentValues
type Item = { id: string }

// ---------------------------------------------------------------
// Content equality
// ---------------------------------------------------------------

export function sameCuelistContent(a: Cuelist, b: Cuelist): boolean {
  return a === b || (
    a.id === b.id && a.name === b.name && a.cues === b.cues && a.isLooping === b.isLooping &&
    a.priority === b.priority && a.effectSnapshots === b.effectSnapshots &&
    // v3 settings
    a.number === b.number && a.tracking === b.tracking && a.mib === b.mib && a.rate === b.rate &&
    a.priorityMode === b.priorityMode && a.speedMasterId === b.speedMasterId
  )
}

export function sameChaseContent(a: Chase, b: Chase): boolean {
  return a === b || (
    a.id === b.id && a.name === b.name && a.steps === b.steps && a.isLooping === b.isLooping &&
    a.fadePercent === b.fadePercent && a.direction === b.direction && a.priority === b.priority &&
    a.number === b.number && a.speedMasterId === b.speedMasterId
  )
}

/** The BPM is a live control (tap, fader), like a chase's: not content */
export function sameSpeedMasterContent(a: SpeedMaster, b: SpeedMaster): boolean {
  return a === b || (a.id === b.id && a.name === b.name && a.number === b.number)
}

/** Every field but isRunning, compared by reference */
export function sameEffectContent(a: Effect, b: Effect): boolean {
  if (a === b) return true
  const ka = Object.keys(a).filter(k => k !== 'isRunning' && (a as any)[k] !== undefined)
  const kb = Object.keys(b).filter(k => k !== 'isRunning' && (b as any)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every(k => (a as any)[k] === (b as any)[k])
}

const same = <T>(a: T, b: T) => a === b

export const ITEM_EQUALS: { [K in ListSection]: (a: ContentItems[K], b: ContentItems[K]) => boolean } = {
  patch: same,
  groups: same,
  presets: same,
  cuelists: sameCuelistContent,
  chases: sameChaseContent,
  effects: sameEffectContent,
  midiMappings: same,
  macros: same,
  speedMasters: sameSpeedMasterContent,
  stagePages: same
}

export function sameTimelineContent(a: TimelineContent, b: TimelineContent): boolean {
  return a === b || (
    a.clips === b.clips && a.markers === b.markers && a.zones === b.zones && a.trackCount === b.trackCount &&
    a.trackNames === b.trackNames && a.length === b.length && a.loop === b.loop
  )
}

/** v3 layouts: the pages are the content (grid / columns / modes only mirror page 1) */
export function sameExecutorContent(a: ContentValues['executor'], b: ContentValues['executor']): boolean {
  if (a === b) return true
  if (a.pages || b.pages) return a.pages === b.pages
  return a.grid === b.grid && a.columns === b.columns && a.modes === b.modes
}

function sameList<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false
  return true
}

/** Same content (runtime state ignored)? */
export function sameSection<S extends ContentSection>(section: S, a: SectionData[S], b: SectionData[S]): boolean {
  if (isListSection(section)) return sameList(a as Item[], b as Item[], ITEM_EQUALS[section] as (x: Item, y: Item) => boolean)
  if (section === 'timeline') return sameTimelineContent(a as TimelineContent, b as TimelineContent)
  if (section === 'executor') return sameExecutorContent(a as ContentValues['executor'], b as ContentValues['executor'])
  return a === b
}

/** Structural equality (object key order ignored) */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]))
  }
  const ka = Object.keys(a).filter(k => (a as any)[k] !== undefined)
  const kb = Object.keys(b).filter(k => (b as any)[k] !== undefined)
  return ka.length === kb.length && ka.every(k => deepEqual((a as any)[k], (b as any)[k]))
}

// ---------------------------------------------------------------
// Diff (remote → console)
// ---------------------------------------------------------------

/** Changes from `base` to `cur` by id, or null when the content is the same. */
export function diffList<T extends Item>(base: T[], cur: T[], eq: (a: T, b: T) => boolean): SectionChange | null {
  if (sameList(base, cur, eq)) return null
  const baseById = new Map(base.map(x => [x.id, x]))
  const curIds = new Set(cur.map(x => x.id))
  const upsert = cur.filter(x => {
    const b = baseById.get(x.id)
    return !b || !eq(b, x)
  })
  const remove = base.filter(x => !curIds.has(x.id)).map(x => x.id)
  const kept = base.filter(x => curIds.has(x.id)).map(x => x.id)
  const added = cur.filter(x => !baseById.has(x.id)).map(x => x.id)
  const expected = [...kept, ...added]
  const order = cur.map(x => x.id)
  const change: SectionChange = {}
  if (upsert.length > 0) change.upsert = upsert
  if (remove.length > 0) change.remove = remove
  if (order.some((id, i) => id !== expected[i])) change.order = order
  return change.upsert || change.remove || change.order ? change : null
}

export function diffSection<S extends ContentSection>(section: S, base: SectionData[S], cur: SectionData[S]): SectionChange | null {
  if (isListSection(section)) {
    return diffList(base as Item[], cur as Item[], ITEM_EQUALS[section] as (x: Item, y: Item) => boolean)
  }
  return sameSection(section, base, cur) ? null : { value: cur }
}

// ---------------------------------------------------------------
// Runtime state kept across a content change
// ---------------------------------------------------------------

function clampIndex(i: number, length: number): number {
  return Math.max(-1, Math.min(i, length - 1))
}

/**
 * The incoming (normalised, runtime-free) item with the runtime state of the
 * item it replaces. Faders and chase tempo are live controls (they have their
 * own commands): the running value wins over the edited copy.
 */
export function keepRuntime<S extends ListSection>(section: S, incoming: ContentItems[S], existing: ContentItems[S]): ContentItems[S] {
  if (section === 'cuelists') {
    const inc = incoming as Cuelist
    const ex = existing as Cuelist
    const playing = ex.isPlaying && inc.cues.length > 0
    const out: Cuelist = {
      ...inc,
      isPlaying: playing,
      currentCueIndex: ex.currentCueIndex < 0 ? -1 : clampIndex(ex.currentCueIndex, inc.cues.length),
      flash: ex.flash,
      faderLevel: ex.faderLevel
    }
    if (ex.goGeneration !== undefined) out.goGeneration = ex.goGeneration
    return out as ContentItems[S]
  }
  if (section === 'chases') {
    const inc = incoming as Chase
    const ex = existing as Chase
    return {
      ...inc,
      isPlaying: ex.isPlaying && inc.steps.length > 0,
      currentStepIndex: Math.max(0, Math.min(ex.currentStepIndex, Math.max(0, inc.steps.length - 1))),
      bpm: ex.bpm,
      faderLevel: ex.faderLevel
    } as ContentItems[S]
  }
  if (section === 'effects') {
    return { ...(incoming as Effect), isRunning: (existing as Effect).isRunning } as ContentItems[S]
  }
  if (section === 'speedMasters') {
    return { ...(incoming as SpeedMaster), bpm: (existing as SpeedMaster).bpm } as ContentItems[S]
  }
  return incoming
}

/** The merged item, or `existing` itself when nothing actually changed (no re-render, no revision bump). */
function mergeItem<S extends ListSection>(section: S, incoming: ContentItems[S], existing: ContentItems[S] | undefined): ContentItems[S] {
  if (!existing) return incoming
  const merged = keepRuntime(section, incoming, existing)
  return deepEqual(merged, existing) ? existing : merged
}

function reorder<T extends Item>(list: T[], order: string[]): T[] {
  const pos = new Map(order.map((id, i) => [id, i]))
  const known = list.filter(x => pos.has(x.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
  const unknown = list.filter(x => !pos.has(x.id))
  return [...known, ...unknown]
}

/**
 * Apply a diff (upserts already normalised) to the current list. Items the
 * diff does not name are kept untouched (another client's concurrent edits).
 */
export function applyListChange<S extends ListSection>(
  section: S,
  current: ContentItems[S][],
  upsert: ContentItems[S][],
  remove: string[] = [],
  order?: string[]
): ContentItems[S][] {
  const removed = new Set(remove)
  const byId = new Map(current.map(x => [x.id, x]))
  const incoming = new Map(upsert.map(x => [x.id, x]))
  let next = current
    .filter(x => !removed.has(x.id))
    .map(x => (incoming.has(x.id) ? mergeItem(section, incoming.get(x.id)!, x) : x))
  for (const x of upsert) if (!byId.has(x.id) && !removed.has(x.id)) next.push(x)
  if (order) next = reorder(next, order)
  const unchanged = next.length === current.length && next.every((x, i) => x === current[i])
  return unchanged ? current : next
}

/** Replace a whole list (console → remote fetch), keeping the runtime state of items that stay. */
export function replaceList<S extends ListSection>(section: S, current: ContentItems[S][], incoming: ContentItems[S][]): ContentItems[S][] {
  const byId = new Map(current.map(x => [x.id, x]))
  const next = incoming.map(x => mergeItem(section, x, byId.get(x.id)))
  const unchanged = next.length === current.length && next.every((x, i) => x === current[i])
  return unchanged ? current : next
}

/** A whole-value section: the incoming value, or the current one when equal. */
export function replaceValue<T>(current: T, incoming: T): T {
  return deepEqual(current, incoming) ? current : incoming
}

// ---------------------------------------------------------------
// Cross-section consistency
// ---------------------------------------------------------------

/** Groups only list patched fixtures, fixtures only list existing groups. Same arrays when consistent. */
export function reconcilePatchGroups(patch: PatchEntry[], groups: Group[]): { patch: PatchEntry[]; groups: Group[] } {
  const fixtureIds = new Set(patch.map(p => p.id))
  const groupIds = new Set(groups.map(g => g.id))
  let groupsChanged = false
  const nextGroups = groups.map(g => {
    const ids = Array.from(new Set(g.fixtureIds.filter(id => fixtureIds.has(id))))
    const parentOk = !g.parentGroupId || groupIds.has(g.parentGroupId)
    if (ids.length === g.fixtureIds.length && parentOk) return g
    groupsChanged = true
    const out: Group = { ...g, fixtureIds: ids }
    if (!parentOk) delete out.parentGroupId
    return out
  })
  let patchChanged = false
  const nextPatch = patch.map(p => {
    const ids = p.groupIds.filter(id => groupIds.has(id))
    if (ids.length === p.groupIds.length) return p
    patchChanged = true
    return { ...p, groupIds: ids }
  })
  return { patch: patchChanged ? nextPatch : patch, groups: groupsChanged ? nextGroups : groups }
}
