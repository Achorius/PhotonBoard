// ============================================================
// PhotonBoard — Store operations (pure)
//
// WP0 contract with a BASIC implementation (WP2 completes it):
//   storeIntoCue   merge / overwrite / remove + feature filter;
//                  'cueonly' and 'block' behave like 'merge' for now
//                  (restore values in cue N+1 / hard tracked state: WP2).
//   storePreset    selective / global / universal, merged into the
//                  existing preset.
//   updateFromProgrammer  updates the values that came from a preset
//                  (meta presetId) in that preset, and the given active
//                  cues' existing values.
// ============================================================

import { v4 as uuidv4 } from 'uuid'
import type { CueChannelValue, CueFeature, Cuelist, PatchEntry, Preset, PresetType } from '@shared/types'
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

/** Values passing the feature filter */
export function filterValues(values: CueChannelValue[], filter: CueFeature[] | undefined, meta: KeyMetaFn): CueChannelValue[] {
  if (!filter || filter.length === 0) return values
  const allowed = new Set(filter)
  return values.filter(v => allowed.has(meta(v.fixtureId, v.channelName).feature))
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
  let next: CueChannelValue[]
  if (opts.mode === 'remove') {
    const remove = new Set(incoming.map(keyOf))
    next = cue.values.filter(v => !remove.has(keyOf(v)))
  } else if (opts.mode === 'overwrite') {
    next = incoming.map(v => ({ ...v }))
  } else {
    // merge (and, for now, cueonly / block)
    const byKey = new Map(cue.values.map(v => [keyOf(v), v]))
    for (const v of incoming) byKey.set(keyOf(v), { ...v })
    next = Array.from(byKey.values())
  }
  const cues = [...cuelist.cues]
  cues[cueIndex] = { ...cue, values: next }
  return { ...cuelist, cues }
}

/**
 * Store values into a preset of family `type` (a new preset when `preset` is
 * null). selective: per fixture · global: per fixture type (patch gives the
 * type) · universal: per canonical attribute.
 */
export function storePreset(preset: Preset | null, type: PresetType, values: CueChannelValue[], scope: Preset['scope'], patch: PatchEntry[]): Preset {
  const base: Preset = preset
    ? { ...preset, values: { ...preset.values } }
    : { id: uuidv4(), name: '', type, values: {} }
  const effective = scope ?? 'selective'
  if (effective !== 'selective') base.scope = effective
  else if (preset?.scope) base.scope = preset.scope
  if (effective === 'selective') {
    for (const v of values) base.values[v.fixtureId] = { ...base.values[v.fixtureId], [v.channelName]: v.value }
  } else if (effective === 'global') {
    const defOf = new Map(patch.map(p => [p.id, p.fixtureDefId]))
    const typeValues = { ...base.typeValues }
    for (const v of values) {
      const defId = defOf.get(v.fixtureId)
      if (!defId) continue
      typeValues[defId] = { ...typeValues[defId], [v.channelName]: v.value }
    }
    base.typeValues = typeValues
  } else {
    const universal = { ...base.universal }
    for (const v of values) universal[canonicalAttributeKey(v.channelName)] = v.value
    base.universal = universal
  }
  return base
}

export interface UpdateInput {
  cuelists: Cuelist[]
  presets: Preset[]
  /** Programmer values with their meta (presetId) */
  values: CueChannelValue[]
  /** Cues to update: active cue of each playing sequence */
  activeCues: { cuelistId: string; cueIndex: number }[]
  patch: PatchEntry[]
}

export interface UpdateResult {
  cues: number
  presets: number
  cuelists: Cuelist[]
  presetList: Preset[]
}

/**
 * Update: programmer values that came from a preset update that preset;
 * the other values update the active cues where those channels already
 * exist (grandMA "Update" default: existing values only).
 */
export function updateFromProgrammer(input: UpdateInput, opts: Partial<StoreOptions> = {}): UpdateResult {
  void opts
  const fromPreset = new Map<string, CueChannelValue[]>()
  const plain: CueChannelValue[] = []
  for (const v of input.values) {
    if (v.presetId) (fromPreset.get(v.presetId) ?? fromPreset.set(v.presetId, []).get(v.presetId)!).push(v)
    else plain.push(v)
  }
  let presetCount = 0
  const presetList = input.presets.map(p => {
    const vals = fromPreset.get(p.id)
    if (!vals) return p
    presetCount++
    return storePreset(p, p.type, vals.map(({ presetId: _p, ...v }) => v), p.scope, input.patch)
  })
  let cueCount = 0
  const byKey = new Map(plain.map(v => [keyOf(v), v]))
  const active = new Map<string, Set<number>>()
  for (const a of input.activeCues) (active.get(a.cuelistId) ?? active.set(a.cuelistId, new Set()).get(a.cuelistId)!).add(a.cueIndex)
  const cuelists = input.cuelists.map(cl => {
    const indexes = active.get(cl.id)
    if (!indexes) return cl
    let changed = false
    const cues = cl.cues.map((cue, i) => {
      if (!indexes.has(i)) return cue
      let cueChanged = false
      const values = cue.values.map(v => {
        const n = byKey.get(keyOf(v))
        if (!n || n.value === v.value) return v
        cueChanged = true
        return { ...v, value: n.value }
      })
      if (!cueChanged) return cue
      cueCount++
      changed = true
      return { ...cue, values }
    })
    return changed ? { ...cl, cues } : cl
  })
  return { cues: cueCount, presets: presetCount, cuelists, presetList }
}
