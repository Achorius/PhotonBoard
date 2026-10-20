// ============================================================
// PhotonBoard — Store operations (pure)
//
//   storeIntoCue   grandMA store modes, with a feature filter:
//                  merge      programmer values added / replaced
//                  overwrite  the cue becomes the programmer (with a
//                             filter: only the filtered features are
//                             replaced, the others kept)
//                  remove     the programmer's channels leave the cue
//                  cueonly    merge, and cue N+1 gets "restore" values
//                             so the change does not track on (the
//                             value cue N+1 tracked before, or 0 for an
//                             intensity that had none)
//                  block      the cue hard-stores the FULL tracked state
//                             (+ the programmer) and becomes a block cue
//   storePreset    selective / global / universal; merge / overwrite /
//                  remove
//   updateFromProgrammer  values that came from a preset (meta
//                  presetId) update that preset; the others update the
//                  active cues where those channels already exist
//                  (mode 'merge': also added to them)
// Inputs are never modified; unchanged objects keep their identity.
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { Cue, CueChannelValue, CueFeature, Cuelist, PatchEntry, Preset, PresetType } from '@shared/types'
import { canonicalAttributeKey } from '@shared/attribute-families'

export type StoreMode = 'merge' | 'overwrite' | 'remove' | 'cueonly' | 'block'

export interface StoreOptions {
  mode: StoreMode
  /** Only store attributes of these features (all when omitted / empty) */
  filter?: CueFeature[]
  /** Presets: only selective values (no global / universal fallback) */
  selectiveOnly?: boolean
}

/** What a store operation needs to know about one fixture channel */
export interface KeyMeta {
  feature: CueFeature
  presetId?: string
}

export type KeyMetaFn = (fixtureId: string, channelName: string) => KeyMeta

const keyOf = (v: { fixtureId: string; channelName: string }) => `${v.fixtureId}\u0000${v.channelName}`

function clampByte(v: number): number {
  return Number.isFinite(v) ? (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)) : 0
}

/** Values passing the feature filter */
export function filterValues(values: CueChannelValue[], filter: CueFeature[] | undefined, meta: KeyMetaFn): CueChannelValue[] {
  if (!filter || filter.length === 0) return values
  const allowed = new Set(filter)
  return values.filter(v => allowed.has(meta(v.fixtureId, v.channelName).feature))
}

/**
 * Tracked state of cue `index` as cue values (cues 0..index, later wins;
 * the value objects keep their preset refs / timing). Without tracking:
 * the cue's own values.
 */
export function trackedValues(cues: readonly Cue[], index: number, tracking = true): Map<string, CueChannelValue> {
  const out = new Map<string, CueChannelValue>()
  const last = Math.min(index, cues.length - 1)
  for (let i = tracking ? 0 : last; i <= last; i++) {
    for (const v of cues[i]?.values ?? []) out.set(keyOf(v), v)
  }
  return out
}

/** Just the value + preset ref of a cue value (restore values carry no timing / part) */
function bareValue(v: CueChannelValue): CueChannelValue {
  return v.presetId ? { fixtureId: v.fixtureId, channelName: v.channelName, value: v.value, presetId: v.presetId } : { fixtureId: v.fixtureId, channelName: v.channelName, value: v.value }
}

/**
 * Store values into cue `cueIndex` of a cuelist (returns a new cuelist; the
 * input is not modified). An index past the end is ignored (create the cue
 * first).
 */
export function storeIntoCue(cuelist: Cuelist, cueIndex: number, values: CueChannelValue[], opts: StoreOptions, meta: KeyMetaFn): Cuelist {
  const cue = cuelist.cues[cueIndex]
  if (!cue) return cuelist
  const incoming = filterValues(values, opts.filter, meta)
  const tracking = cuelist.tracking !== false
  let next: CueChannelValue[]
  let block = cue.block
  switch (opts.mode) {
    case 'remove': {
      const remove = new Set(incoming.map(keyOf))
      next = cue.values.filter(v => !remove.has(keyOf(v)))
      break
    }
    case 'overwrite': {
      if (opts.filter && opts.filter.length > 0) {
        const replaced = new Set(opts.filter)
        next = cue.values.filter(v => !replaced.has(meta(v.fixtureId, v.channelName).feature)).concat(incoming.map(v => ({ ...v })))
      } else {
        next = incoming.map(v => ({ ...v }))
      }
      break
    }
    case 'block': {
      const byKey = new Map(trackedValues(cuelist.cues, cueIndex, tracking))
      for (const v of incoming) byKey.set(keyOf(v), { ...v })
      next = Array.from(byKey.values())
      block = true
      break
    }
    default: {
      // merge, cueonly
      const byKey = new Map(cue.values.map(v => [keyOf(v), v]))
      for (const v of incoming) byKey.set(keyOf(v), { ...v })
      next = Array.from(byKey.values())
    }
  }
  const cues = [...cuelist.cues]
  const stored: Cue = { ...cue, values: next }
  if (block) stored.block = true
  cues[cueIndex] = stored

  if (opts.mode === 'cueonly' && tracking && cueIndex + 1 < cues.length) {
    const before = trackedValues(cuelist.cues, cueIndex, true)
    const following = cues[cueIndex + 1]
    const followingKeys = new Set(following.values.map(keyOf))
    const restore: CueChannelValue[] = []
    for (const v of incoming) {
      const key = keyOf(v)
      if (followingKeys.has(key)) continue
      const prev = before.get(key)
      if (prev) {
        if (prev.value !== v.value || prev.presetId !== v.presetId) restore.push(bareValue(prev))
      } else if (meta(v.fixtureId, v.channelName).feature === 'intensity') {
        restore.push({ fixtureId: v.fixtureId, channelName: v.channelName, value: 0 })
      }
    }
    if (restore.length > 0) cues[cueIndex + 1] = { ...following, values: [...following.values, ...restore] }
  }
  return { ...cuelist, cues }
}

/** Next free whole cue number after the last cue */
export function nextCueNumber(cuelist: Pick<Cuelist, 'cues'>): number {
  const last = cuelist.cues.reduce((m, c) => Math.max(m, Number.isFinite(c.number) ? c.number : 0), 0)
  return Math.floor(last) + 1
}

/**
 * Insert a cue in number order (a playing cue keeps playing: the current
 * index follows). Returns the new cuelist and the cue's index.
 */
export function insertCue(cuelist: Cuelist, cue: Cue): { cuelist: Cuelist; index: number } {
  let index = cuelist.cues.findIndex(c => c.number > cue.number)
  if (index === -1) index = cuelist.cues.length
  const cues = [...cuelist.cues]
  cues.splice(index, 0, cue)
  const currentCueIndex = cuelist.currentCueIndex >= index ? cuelist.currentCueIndex + 1 : cuelist.currentCueIndex
  return { cuelist: { ...cuelist, cues, currentCueIndex }, index }
}

/**
 * Store values into a preset of family `type` (a new preset when `preset` is
 * null). selective: per fixture · global: per fixture type (patch gives the
 * type) · universal: per canonical attribute. `mode`: merge (default),
 * overwrite (the preset's old content is dropped, every scope), remove (these
 * channels leave the preset at that scope).
 */
export function storePreset(
  preset: Preset | null, type: PresetType, values: CueChannelValue[], scope: Preset['scope'], patch: PatchEntry[],
  mode: 'merge' | 'overwrite' | 'remove' = 'merge'
): Preset {
  const base: Preset = preset
    ? { ...preset, values: mode === 'overwrite' ? {} : { ...preset.values } }
    : { id: uuidv4(), name: '', type, values: {} }
  if (mode === 'overwrite') {
    delete base.typeValues
    delete base.universal
  }
  const effective = scope ?? 'selective'
  if (effective !== 'selective') base.scope = effective
  else if (preset?.scope && mode !== 'overwrite') base.scope = preset.scope
  else delete base.scope
  const remove = mode === 'remove'

  if (effective === 'selective') {
    for (const v of values) {
      const cur = { ...base.values[v.fixtureId] }
      if (remove) delete cur[v.channelName]
      else cur[v.channelName] = clampByte(v.value)
      if (Object.keys(cur).length === 0) delete base.values[v.fixtureId]
      else base.values[v.fixtureId] = cur
    }
  } else if (effective === 'global') {
    const defOf = new Map(patch.map(p => [p.id, p.fixtureDefId]))
    const typeValues = { ...base.typeValues }
    for (const v of values) {
      const defId = defOf.get(v.fixtureId)
      if (!defId) continue
      const cur = { ...typeValues[defId] }
      if (remove) delete cur[v.channelName]
      else cur[v.channelName] = clampByte(v.value)
      if (Object.keys(cur).length === 0) delete typeValues[defId]
      else typeValues[defId] = cur
    }
    base.typeValues = typeValues
  } else {
    const universal = { ...base.universal }
    for (const v of values) {
      const key = canonicalAttributeKey(v.channelName)
      if (remove) delete universal[key]
      else universal[key] = clampByte(v.value)
    }
    base.universal = universal
  }
  return base
}

/**
 * Update the active cues with programmer values (preset refs included):
 * channels the cue already holds take the programmer value (and its preset
 * ref, or lose theirs for a hand-set value; the cue value's timing / part
 * are kept); mode 'merge' also adds the other channels. Returns the new
 * cuelists and how many cues changed.
 */
export function updateCueValues(
  cuelists: Cuelist[], activeCues: { cuelistId: string; cueIndex: number }[], values: CueChannelValue[],
  opts: Partial<StoreOptions> = {}, meta?: KeyMetaFn
): { cuelists: Cuelist[]; cues: number } {
  const incoming = opts.filter && opts.filter.length > 0 && meta ? filterValues(values, opts.filter, meta) : values
  const byKey = new Map(incoming.map(v => [keyOf(v), v]))
  const addNew = opts.mode === 'merge'
  const active = new Map<string, Set<number>>()
  for (const a of activeCues) (active.get(a.cuelistId) ?? active.set(a.cuelistId, new Set()).get(a.cuelistId)!).add(a.cueIndex)
  let count = 0
  const next = cuelists.map(cl => {
    const indexes = active.get(cl.id)
    if (!indexes) return cl
    let changed = false
    const cues = cl.cues.map((cue, i) => {
      if (!indexes.has(i)) return cue
      let cueChanged = false
      const seen = new Set<string>()
      const vals = cue.values.map(v => {
        const key = keyOf(v)
        seen.add(key)
        const n = byKey.get(key)
        if (!n || (n.value === v.value && n.presetId === v.presetId)) return v
        cueChanged = true
        const { presetId: _p, ...rest } = v
        return n.presetId ? { ...rest, value: n.value, presetId: n.presetId } : { ...rest, value: n.value }
      })
      if (addNew) {
        for (const [key, v] of byKey) {
          if (seen.has(key)) continue
          vals.push({ ...v })
          cueChanged = true
        }
      }
      if (!cueChanged) return cue
      count++
      changed = true
      return { ...cue, values: vals }
    })
    return changed ? { ...cl, cues } : cl
  })
  return { cuelists: next, cues: count }
}

export interface UpdateInput {
  cuelists: Cuelist[]
  presets: Preset[]
  /** Programmer values with their meta (presetId) */
  values: CueChannelValue[]
  /** Cues to update: active cue of each playing sequence */
  activeCues: { cuelistId: string; cueIndex: number }[]
  patch: PatchEntry[]
  /** Feature of a channel (needed for `filter`) */
  meta?: KeyMetaFn
}

export interface UpdateResult {
  cues: number
  presets: number
  cuelists: Cuelist[]
  presetList: Preset[]
}

/** Scope a preset stores a channel at (the level it already has it at, else the preset's scope) */
function scopeOfValue(p: Preset, v: CueChannelValue, defOf: Map<string, string>): Preset['scope'] {
  if (p.values[v.fixtureId]?.[v.channelName] !== undefined) return 'selective'
  const defId = defOf.get(v.fixtureId)
  if (defId && p.typeValues?.[defId]?.[v.channelName] !== undefined) return 'global'
  if (p.universal?.[canonicalAttributeKey(v.channelName)] !== undefined) return 'universal'
  return p.scope
}

/**
 * Update: programmer values that came from a preset update that preset (at
 * the level the preset holds them); the other values update the active
 * cues where those channels already exist (grandMA "Update" default:
 * existing values only; mode 'merge' also adds the new ones). `filter`
 * limits both to some features.
 */
export function updateFromProgrammer(input: UpdateInput, opts: Partial<StoreOptions> = {}): UpdateResult {
  const values = opts.filter && opts.filter.length > 0 && input.meta ? filterValues(input.values, opts.filter, input.meta) : input.values
  const fromPreset = new Map<string, CueChannelValue[]>()
  const plain: CueChannelValue[] = []
  for (const v of values) {
    if (v.presetId) (fromPreset.get(v.presetId) ?? fromPreset.set(v.presetId, []).get(v.presetId)!).push(v)
    else plain.push(v)
  }
  const defOf = new Map(input.patch.map(p => [p.id, p.fixtureDefId]))
  let presetCount = 0
  const presetList = input.presets.map(p => {
    const vals = fromPreset.get(p.id)
    if (!vals) return p
    let next = p
    const byScope = new Map<Preset['scope'], CueChannelValue[]>()
    for (const v of vals) {
      const s = scopeOfValue(p, v, defOf)
      ;(byScope.get(s) ?? byScope.set(s, []).get(s)!).push({ fixtureId: v.fixtureId, channelName: v.channelName, value: v.value })
    }
    for (const [s, list] of byScope) next = storePreset(next, p.type, list, s, input.patch)
    if (p.scope === undefined) delete next.scope
    else next.scope = p.scope
    if (JSON.stringify(next) === JSON.stringify(p)) return p
    presetCount++
    return next
  })
  let cueCount = 0
  const byKey = new Map(plain.map(v => [keyOf(v), v]))
  const addNew = opts.mode === 'merge'
  const active = new Map<string, Set<number>>()
  for (const a of input.activeCues) (active.get(a.cuelistId) ?? active.set(a.cuelistId, new Set()).get(a.cuelistId)!).add(a.cueIndex)
  const cuelists = input.cuelists.map(cl => {
    const indexes = active.get(cl.id)
    if (!indexes) return cl
    let changed = false
    const cues = cl.cues.map((cue, i) => {
      if (!indexes.has(i)) return cue
      let cueChanged = false
      const seen = new Set<string>()
      const vals = cue.values.map(v => {
        const key = keyOf(v)
        seen.add(key)
        const n = byKey.get(key)
        if (!n || (n.value === v.value && !v.presetId)) return v
        cueChanged = true
        // A hand-set value replaces a preset reference
        const { presetId: _p, ...rest } = v
        return { ...rest, value: n.value }
      })
      if (addNew) {
        for (const [key, v] of byKey) {
          if (seen.has(key)) continue
          vals.push({ ...v })
          cueChanged = true
        }
      }
      if (!cueChanged) return cue
      cueCount++
      changed = true
      return { ...cue, values: vals }
    })
    return changed ? { ...cl, cues } : cl
  })
  return { cues: cueCount, presets: presetCount, cuelists, presetList }
}
