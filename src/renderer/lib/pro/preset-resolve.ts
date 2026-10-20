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

import type { Chase, CueChannelValue, Cuelist, FixtureDefinition, PatchEntry, Preset } from '@shared/types'
import { canonicalAttributeKey } from '@shared/attribute-families'

/**
 * Value of `preset` for one channel of one fixture, or undefined when the
 * preset has nothing for it. `def` is accepted for WP2 (attribute
 * classification per fixture type); not needed by the basic resolution.
 */
export function resolvePreset(preset: Preset, entry: Pick<PatchEntry, 'id' | 'fixtureDefId'>, def: FixtureDefinition | undefined, channelName: string): number | undefined {
  void def
  const selective = preset.values[entry.id]?.[channelName]
  if (selective !== undefined) return selective
  const global = preset.typeValues?.[entry.fixtureDefId]?.[channelName]
  if (global !== undefined) return global
  if (preset.universal) {
    const universal = preset.universal[canonicalAttributeKey(channelName)]
    if (universal !== undefined) return universal
  }
  return undefined
}

/** Every value a preset gives a fixture (channel name → value), in the fixture mode's channel order when known */
export function resolvePresetForFixture(preset: Preset, entry: PatchEntry, def: FixtureDefinition | undefined): Map<string, number> {
  const out = new Map<string, number>()
  const mode = def?.modes.find(m => m.name === entry.modeName)
  const names = mode ? mode.channels : Object.keys(preset.values[entry.id] ?? {})
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
