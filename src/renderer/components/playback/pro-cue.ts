// ============================================================
// Pro cue / scene editing (pure): what pro data a cue carries (the
// "P" badge), per-feature timing, cue parts, follow mode, the
// "Advanced" scene settings (tracking, MIB, rate, priority mode) and
// the advanced cue-table column preferences.
// Functions return the fields to give playback-store.updateCue /
// updateCuelist (never a mutated cue). Unit-tested in pro-cue.test.ts.
// ============================================================

import type { Cue, CueFeature, CuePart, Cuelist, MibSettings, Preset } from '@shared/types'
import { ATTRIBUTE_FEATURES } from '@shared/attribute-families'

export const CUE_FEATURES: readonly CueFeature[] = ATTRIBUTE_FEATURES

// ---------------------------------------------------------------- pro data on a cue

export interface CueProInfo {
  /** Distinct presets the cue's values reference */
  presetIds: string[]
  /** Features with their own timing */
  timedFeatures: CueFeature[]
  parts: number
  /** Values with their own fade / delay */
  timedValues: number
  followAfterGo: boolean
  block: boolean
}

export function cueProInfo(cue: Cue): CueProInfo {
  const presetIds: string[] = []
  let timedValues = 0
  for (const v of cue.values) {
    if (v.presetId && !presetIds.includes(v.presetId)) presetIds.push(v.presetId)
    if (v.fade !== undefined || v.delay !== undefined) timedValues++
  }
  const timedFeatures = CUE_FEATURES.filter((f) => {
    const ft = cue.featureTiming?.[f]
    return !!ft && (ft.fade !== undefined || ft.delay !== undefined)
  })
  return {
    presetIds,
    timedFeatures,
    parts: cue.parts?.length ?? 0,
    timedValues,
    followAfterGo: cue.followMode === 'after-go',
    block: cue.block === true
  }
}

/** The cue holds something only the Pro view edits (simple view: passive "P" badge) */
export function hasProData(info: CueProInfo): boolean {
  return info.presetIds.length > 0 || info.timedFeatures.length > 0 || info.parts > 0 || info.timedValues > 0 || info.followAfterGo || info.block
}

/** Names of the presets a cue uses (missing presets are skipped) */
export function presetNames(ids: readonly string[], presets: readonly Preset[]): string[] {
  const byId = new Map(presets.map((p) => [p.id, p]))
  const names: string[] = []
  for (const id of ids) {
    const p = byId.get(id)
    if (p) names.push(p.name || (p.number !== undefined ? `#${p.number}` : '?'))
  }
  return names
}

// ---------------------------------------------------------------- timing values

export const MAX_TIME = 600

/** A time typed by the operator: NaN / negative → undefined (= inherit), clamped to MAX_TIME */
export function cleanTime(v: number | null | undefined): number | undefined {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return undefined
  return Math.min(MAX_TIME, Math.round(v * 100) / 100)
}

// ---------------------------------------------------------------- per-feature timing

export type FeatureTiming = NonNullable<Cue['featureTiming']>

/**
 * Set (or clear with undefined) the fade / delay of one feature.
 * Returns the cue's new `featureTiming` (undefined when nothing is left).
 */
export function setFeatureTime(cue: Pick<Cue, 'featureTiming'>, feature: CueFeature, field: 'fade' | 'delay', value: number | undefined): FeatureTiming | undefined {
  const next: FeatureTiming = { ...cue.featureTiming }
  const cur = { ...next[feature] }
  const clean = cleanTime(value)
  if (clean === undefined) delete cur[field]
  else cur[field] = clean
  if (cur.fade === undefined && cur.delay === undefined) delete next[feature]
  else next[feature] = cur
  return Object.keys(next).length > 0 ? next : undefined
}

/** Remove one feature's own timing */
export function clearFeatureTiming(cue: Pick<Cue, 'featureTiming'>, feature: CueFeature): FeatureTiming | undefined {
  if (!cue.featureTiming?.[feature]) return cue.featureTiming
  const next: FeatureTiming = { ...cue.featureTiming }
  delete next[feature]
  return Object.keys(next).length > 0 ? next : undefined
}

/** Count of the cue's values per feature (`featureOf` classifies a channel) */
export function countByFeature(cue: Pick<Cue, 'values'>, featureOf: (fixtureId: string, channelName: string) => CueFeature): Record<CueFeature, number> {
  const counts: Record<CueFeature, number> = { intensity: 0, position: 0, colour: 0, beam: 0, control: 0 }
  for (const v of cue.values) counts[featureOf(v.fixtureId, v.channelName)]++
  return counts
}

// ---------------------------------------------------------------- parts

/** Next free part index (parts are 1-based; values without `part` belong to the cue itself = part 0) */
export function nextPartIndex(parts: readonly CuePart[] | undefined): number {
  let max = 0
  for (const p of parts ?? []) if (p.index > max) max = p.index
  return max + 1
}

/** Add a part (no time = the cue's times until set) */
export function addPart(cue: Pick<Cue, 'parts'>): CuePart[] {
  const parts = [...(cue.parts ?? [])]
  parts.push({ index: nextPartIndex(parts) })
  return parts
}

/** Change a part's name / times (undefined clears a time) */
export function updatePart(cue: Pick<Cue, 'parts'>, index: number, updates: { name?: string; fade?: number; fadeOut?: number; delay?: number }): CuePart[] | undefined {
  if (!cue.parts) return cue.parts
  return cue.parts.map((p) => {
    if (p.index !== index) return p
    const next: CuePart = { ...p }
    if ('name' in updates) {
      const name = updates.name?.slice(0, 64)
      if (name && name.trim()) next.name = name
      else delete next.name
    }
    for (const f of ['fade', 'fadeOut', 'delay'] as const) {
      if (!(f in updates)) continue
      const v = cleanTime(updates[f])
      if (v === undefined) delete next[f]
      else next[f] = v
    }
    return next
  })
}

/** Remove a part: its values go back to the cue (no `part`) */
export function removePart(cue: Pick<Cue, 'parts' | 'values'>, index: number): Pick<Cue, 'parts' | 'values'> {
  const parts = (cue.parts ?? []).filter((p) => p.index !== index)
  const values = cue.values.some((v) => v.part === index)
    ? cue.values.map((v) => {
      if (v.part !== index) return v
      const { part: _part, ...rest } = v
      return rest
    })
    : cue.values
  return { parts: parts.length > 0 ? parts : undefined, values }
}

/**
 * Put values in a part (index 0 / null = back to the cue). `feature` limits
 * it to one feature's channels; null = every channel.
 */
export function assignToPart(
  cue: Pick<Cue, 'values'>,
  partIndex: number | null,
  feature: CueFeature | null,
  featureOf: (fixtureId: string, channelName: string) => CueFeature
): Cue['values'] {
  let changed = false
  const values = cue.values.map((v) => {
    if (feature && featureOf(v.fixtureId, v.channelName) !== feature) return v
    if (!partIndex) {
      if (v.part === undefined) return v
      changed = true
      const { part: _part, ...rest } = v
      return rest
    }
    if (v.part === partIndex) return v
    changed = true
    return { ...v, part: partIndex }
  })
  return changed ? values : cue.values
}

/** Values per part index (0 = the cue itself) */
export function countByPart(cue: Pick<Cue, 'values'>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const v of cue.values) counts.set(v.part ?? 0, (counts.get(v.part ?? 0) ?? 0) + 1)
  return counts
}

// ---------------------------------------------------------------- scene "Advanced"

export const RATE_MIN = 0.25
export const RATE_MAX = 4

export function cleanRate(v: number): number | undefined {
  if (!Number.isFinite(v)) return undefined
  const r = Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(v * 100) / 100))
  return r === 1 ? undefined : r
}

export const DEFAULT_MIB: MibSettings = { enabled: false, delay: 0, fade: 2 }

/** Merge a change into the scene's MIB settings */
export function nextMib(cl: Pick<Cuelist, 'mib'>, updates: Partial<MibSettings>): MibSettings {
  const cur = cl.mib ?? DEFAULT_MIB
  const next: MibSettings = { ...cur, ...updates }
  next.delay = cleanTime(next.delay) ?? 0
  next.fade = cleanTime(next.fade) ?? 0
  return next
}

/** The scene uses an "Advanced" setting (the section opens by itself) */
export function hasAdvancedSettings(cl: Pick<Cuelist, 'tracking' | 'mib' | 'rate' | 'priorityMode' | 'speedMasterId'>): boolean {
  return cl.tracking === false || !!cl.mib?.enabled || (cl.rate !== undefined && cl.rate !== 1) ||
    (cl.priorityMode !== undefined && cl.priorityMode !== 'normal') || !!cl.speedMasterId
}

// ---------------------------------------------------------------- store feature filter (Record popover)

/**
 * Toggle one feature of a store filter. [] = every feature. Unticking a
 * feature from "all" keeps the others; ticking the last missing one goes
 * back to []; the last ticked feature cannot be unticked.
 */
export function toggleFeatureFilter(filter: readonly CueFeature[], feature: CueFeature): CueFeature[] {
  const base = filter.length > 0 ? filter : CUE_FEATURES
  const next = base.includes(feature) ? base.filter((f) => f !== feature) : CUE_FEATURES.filter((f) => f === feature || base.includes(f))
  if (next.length === 0) return [...filter]
  return next.length === CUE_FEATURES.length ? [] : next
}

/** A filter read back from preferences (unknown features dropped) */
export function cleanFeatureFilter(raw: unknown): CueFeature[] {
  if (!Array.isArray(raw)) return []
  const out = CUE_FEATURES.filter((f) => raw.includes(f))
  return out.length === CUE_FEATURES.length ? [] : out
}

// ---------------------------------------------------------------- advanced cue-table columns (Pro)

export interface ProCueColumns {
  featureTiming: boolean
  parts: boolean
  trigger: boolean
  presets: boolean
}

export const PRO_COLUMNS_KEY = 'photonboard.scenes.proColumns'
export const DEFAULT_PRO_COLUMNS: ProCueColumns = { featureTiming: false, parts: false, trigger: false, presets: true }

export function parseProColumns(raw: string | null): ProCueColumns {
  if (!raw) return { ...DEFAULT_PRO_COLUMNS }
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return { ...DEFAULT_PRO_COLUMNS }
    const out = { ...DEFAULT_PRO_COLUMNS }
    for (const k of Object.keys(out) as (keyof ProCueColumns)[]) if (typeof v[k] === 'boolean') out[k] = v[k]
    return out
  } catch {
    return { ...DEFAULT_PRO_COLUMNS }
  }
}
