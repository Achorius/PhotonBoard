// ============================================================
// PhotonBoard — Preset resolution (pure)
//
// A preset value for one fixture channel, by scope precedence:
//   selective  preset.values[fixtureId][channelName]
//   global     preset.typeValues[fixtureDefId][channelName]
//   universal  preset.universal[canonicalAttributeKey(channelName)]
// (each level is tried whatever the preset's declared scope, so a
// selective preset with a universal fallback works).
//
// refreshCueValuesFromPresets() keeps every CueChannelValue.value that
// references a preset equal to what the preset gives now — called when
// saving (v2 readers play `value`) and usable after a preset edit.
// ============================================================

import type { Chase, CueChannelValue, Cuelist, FixtureDefinition, PatchEntry, Preset, PresetType } from '@shared/types'
import { canonicalAttributeKey, channelFitsPresetFamily, presetFamilyOf } from '@shared/attribute-families'

function validByte(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)
}

/** Preset family of one channel of a fixture type (channel type / precedence from the definition when known) */
export function presetFamilyOfChannel(def: FixtureDefinition | undefined, channelName: string): Exclude<PresetType, 'full'> {
  const ch = def?.channels[channelName]
  return presetFamilyOf(channelName, ch?.type, ch?.precedence)
}

/** True when the channel belongs in a preset of this family ('full' takes everything) */
export function channelFitsPreset(type: PresetType, def: FixtureDefinition | undefined, channelName: string): boolean {
  const ch = def?.channels[channelName]
  return channelFitsPresetFamily(type, channelName, ch?.type, ch?.precedence)
}

/**
 * Value of `preset` for one channel of one fixture, or undefined when the
 * preset has nothing for it. Precedence: selective (this fixture) → global
 * (this fixture type) → universal (this attribute, any fixture). A
 * universal value only reaches channels of the preset's family when the
 * fixture definition is known (a universal "speed" in a position preset
 * must not drive a gobo-rotation speed). Values are clamped to 0-255.
 */
export function resolvePreset(preset: Preset, entry: Pick<PatchEntry, 'id' | 'fixtureDefId'>, def: FixtureDefinition | undefined, channelName: string): number | undefined {
  const selective = preset.values[entry.id]?.[channelName]
  if (validByte(selective)) return clampByte(selective)
  const global = preset.typeValues?.[entry.fixtureDefId]?.[channelName]
  if (validByte(global)) return clampByte(global)
  if (preset.universal) {
    const universal = preset.universal[canonicalAttributeKey(channelName)]
    if (validByte(universal) && (!def || channelFitsPreset(preset.type, def, channelName))) return clampByte(universal)
  }
  return undefined
}

/** Which scope level gives this channel its value (UI hints), or null */
export function resolvedScope(preset: Preset, entry: Pick<PatchEntry, 'id' | 'fixtureDefId'>, def: FixtureDefinition | undefined, channelName: string): 'selective' | 'global' | 'universal' | null {
  if (validByte(preset.values[entry.id]?.[channelName])) return 'selective'
  if (validByte(preset.typeValues?.[entry.fixtureDefId]?.[channelName])) return 'global'
  const u = preset.universal?.[canonicalAttributeKey(channelName)]
  if (validByte(u) && (!def || channelFitsPreset(preset.type, def, channelName))) return 'universal'
  return null
}

/** Fixtures (of `patch`) the preset gives at least one value to */
export function presetFixtureIds(preset: Preset, patch: readonly PatchEntry[], defs: readonly FixtureDefinition[]): string[] {
  const defMap = new Map(defs.map(d => [d.id, d]))
  return patch.filter(entry => resolvePresetForFixture(preset, entry, defMap.get(entry.fixtureDefId)).size > 0).map(e => e.id)
}

/** Every value a preset gives a fixture (channel name → value), in the fixture mode's channel order when known */
export function resolvePresetForFixture(preset: Preset, entry: PatchEntry, def: FixtureDefinition | undefined): Map<string, number> {
  const out = new Map<string, number>()
  const mode = def?.modes.find(m => m.name === entry.modeName)
  const names = mode
    ? mode.channels
    : Array.from(new Set([...Object.keys(preset.values[entry.id] ?? {}), ...Object.keys(preset.typeValues?.[entry.fixtureDefId] ?? {})]))
  for (const name of names) {
    if (!name) continue
    const v = resolvePreset(preset, entry, def, name)
    if (v !== undefined) out.set(name, v)
  }
  return out
}

function refreshValues(
  values: CueChannelValue[], presets: Map<string, Preset>, patch: Map<string, PatchEntry>, defs: Map<string, FixtureDefinition>
): CueChannelValue[] {
  let changed = false
  const next = values.map(v => {
    if (!v.presetId) return v
    const preset = presets.get(v.presetId)
    const entry = patch.get(v.fixtureId)
    if (!preset || !entry) return v
    const value = resolvePreset(preset, entry, defs.get(entry.fixtureDefId), v.channelName)
    if (value === undefined || value === v.value) return v
    changed = true
    return { ...v, value }
  })
  return changed ? next : values
}

/**
 * Cue lists (and chases) with every preset-referenced value re-resolved.
 * Unchanged lists / cues keep their identity (cheap, no re-render).
 * A value whose preset no longer gives anything keeps its last value.
 */
export function refreshCueValuesFromPresets<T extends Cuelist | Chase>(
  lists: T[], presets: readonly Preset[], patch: readonly PatchEntry[], defs: readonly FixtureDefinition[] = []
): T[] {
  const presetMap = new Map(presets.map(p => [p.id, p]))
  if (presetMap.size === 0) return lists
  const patchMap = new Map(patch.map(p => [p.id, p]))
  const defMap = new Map(defs.map(d => [d.id, d]))
  let changed = false
  const next = lists.map(list => {
    if ('cues' in list) {
      let cuesChanged = false
      const cues = list.cues.map(cue => {
        const values = refreshValues(cue.values, presetMap, patchMap, defMap)
        if (values === cue.values) return cue
        cuesChanged = true
        return { ...cue, values }
      })
      if (!cuesChanged) return list
      changed = true
      return { ...list, cues }
    }
    const chase = list as Chase
    let stepsChanged = false
    const steps = chase.steps.map(step => {
      const values = refreshValues(step.values, presetMap, patchMap, defMap)
      if (values === step.values) return step
      stepsChanged = true
      return { ...step, values }
    })
    if (!stepsChanged) return list
    changed = true
    return { ...chase, steps } as T
  })
  return changed ? next : lists
}
