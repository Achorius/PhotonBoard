import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { gunzipSync } from 'zlib'
import { resolve } from 'path'
import type { FixtureDefinition, PatchEntry } from './types'
import {
  canonicalAttributeKey, channelFitsPresetFamily, featureOfChannel, featureOfPresetFamily, presetFamilyOf
} from './attribute-families'
import { BUILTIN_FIXTURES } from '../main/fixture-library'
import { buildProgrammerModel, canonicalKey } from '../renderer/components/fixtures/programmer-model'

/** Builtin fixtures + a slice of the offline catalog (thousands of real channel names) */
function sampleDefinitions(): FixtureDefinition[] {
  const dir = resolve(__dirname, '../../resources/fixture-library/fixtures')
  const defs: FixtureDefinition[] = [...BUILTIN_FIXTURES]
  let files: string[] = []
  try { files = readdirSync(dir).filter(f => f.endsWith('.json.gz')).sort() } catch { /* catalog not present */ }
  for (const f of files.filter((_, i) => i % 4 === 0)) {
    const data = JSON.parse(gunzipSync(readFileSync(resolve(dir, f))).toString('utf8')) as Record<string, FixtureDefinition>
    defs.push(...Object.values(data))
  }
  return defs
}

describe('attribute families', () => {
  it('canonical keys are the programmer model ones', () => {
    for (const n of ['Dimmer', 'Intensity', 'R', 'Colour', 'Colour Wheel', 'Gobo 1', 'Shutter/Strobe', 'Pan', 'Zoom', 'CCT', '  Gobo   Rot ']) {
      expect(canonicalAttributeKey(n)).toBe(canonicalKey(n))
    }
  })

  it('feature of every channel = the programmer model classification (same inputs, same result)', () => {
    const defs = sampleDefinitions()
    let checked = 0
    for (const def of defs) {
      for (const mode of def.modes) {
        const entry: PatchEntry = { id: 'x', fixtureDefId: def.id, modeName: mode.name, universe: 0, address: 1, name: 'x', groupIds: [] }
        const model = buildProgrammerModel([entry], [def])
        for (const attr of model.attributes) {
          for (const target of attr.targets) {
            const name = mode.channels[target.coarse]
            const ch = def.channels[name]
            expect(featureOfChannel(name, ch?.type, ch?.precedence), `${def.id} / ${mode.name} / ${name}`).toBe(attr.feature)
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('preset families split beam into gobo / focus / beam', () => {
    expect(presetFamilyOf('Dimmer', 'intensity')).toBe('intensity')
    expect(presetFamilyOf('Pan', 'pan')).toBe('position')
    expect(presetFamilyOf('Pan/Tilt Speed', 'speed')).toBe('control')
    expect(presetFamilyOf('Red', 'color')).toBe('color')
    expect(presetFamilyOf('Color Wheel', 'color')).toBe('color')
    expect(presetFamilyOf('Gobo', 'gobo')).toBe('gobo')
    expect(presetFamilyOf('Gobo Rotation', 'gobo')).toBe('gobo')
    expect(presetFamilyOf('Animation Wheel')).toBe('gobo')
    expect(presetFamilyOf('Zoom', 'generic')).toBe('focus')
    expect(presetFamilyOf('Focus')).toBe('focus')
    expect(presetFamilyOf('Shutter', 'shutter')).toBe('beam')
    expect(presetFamilyOf('Prism', 'prism')).toBe('beam')
    expect(presetFamilyOf('Iris')).toBe('beam')
    expect(presetFamilyOf('Lamp Control', 'maintenance')).toBe('control')
    expect(presetFamilyOf('Master', undefined, 'HTP')).toBe('intensity')
  })

  it('family helpers', () => {
    expect(featureOfPresetFamily('color')).toBe('colour')
    expect(featureOfPresetFamily('gobo')).toBe('beam')
    expect(featureOfPresetFamily('full')).toBeNull()
    expect(channelFitsPresetFamily('full', 'Anything')).toBe(true)
    expect(channelFitsPresetFamily('position', 'Tilt', 'tilt')).toBe(true)
    expect(channelFitsPresetFamily('position', 'Red', 'color')).toBe(false)
  })
})
