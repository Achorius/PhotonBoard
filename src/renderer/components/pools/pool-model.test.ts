import { describe, expect, it } from 'vitest'
import type { FixtureDefinition, PatchEntry, Preset } from '@shared/types'
import {
  POOL_FAMILIES, channelLookup, emptiedPreset, linkedToSpeedMaster, metaKey, numbersOf, poolSlots, presetChip, presetOfTargets,
  presetPreview, presetRef, presetSize, storeGroupFixtures, validPresetRefs, valuesForFamily, valuesHeldByPreset, valuesOfFixtures
} from './pool-model'

const def: FixtureDefinition = {
  id: 'spot',
  name: 'Spot',
  manufacturer: 'Test',
  categories: [],
  channels: {
    Dimmer: { name: 'Dimmer', type: 'intensity' },
    Pan: { name: 'Pan', type: 'pan' },
    Tilt: { name: 'Tilt', type: 'tilt' },
    Red: { name: 'Red', type: 'color' },
    Green: { name: 'Green', type: 'color' },
    Blue: { name: 'Blue', type: 'color' },
    'Color Wheel': {
      name: 'Color Wheel',
      type: 'color',
      capabilities: [
        { dmxRange: [0, 9], type: 'WheelSlot', label: 'Open' },
        { dmxRange: [10, 19], type: 'WheelSlot', label: 'Deep Red', color: '#c00000' },
        { dmxRange: [20, 29], type: 'WheelSlot', label: 'Blue' }
      ]
    },
    Gobo: { name: 'Gobo', type: 'gobo' },
    Zoom: { name: 'Zoom', type: 'generic' },
    Shutter: { name: 'Shutter', type: 'shutter' }
  },
  modes: [{ name: 'Std', channels: ['Dimmer', 'Pan', 'Tilt', 'Red', 'Green', 'Blue', 'Color Wheel', 'Gobo', 'Zoom', 'Shutter'] }]
} as unknown as FixtureDefinition

const patch: PatchEntry[] = [
  { id: 'f1', fixtureDefId: 'spot', modeName: 'Std', universe: 0, address: 1, name: 'Spot 1', groupIds: [] },
  { id: 'f2', fixtureDefId: 'spot', modeName: 'Std', universe: 0, address: 11, name: 'Spot 2', groupIds: [] }
]

const preset = (p: Partial<Preset> & Pick<Preset, 'type'>): Preset => ({ id: 'p', name: '', values: {}, ...p })

describe('pool slots and numbers', () => {
  it('keeps valid numbers and fills the others in list order', () => {
    const list = [{ id: 'a', number: 3 }, { id: 'b' }, { id: 'c', number: 3 }, { id: 'd', number: 1 }]
    const n = numbersOf(list)
    expect(n.get('a')).toBe(3)
    expect(n.get('d')).toBe(1)
    expect(n.get('b')).toBe(4)
    expect(n.get('c')).toBe(5) // duplicate loses its number
  })

  it('numbers per family', () => {
    const list = [{ id: 'a', type: 'color' }, { id: 'b', type: 'position' }, { id: 'c', type: 'color' }]
    const n = numbersOf(list, (x) => x.type)
    expect([n.get('a'), n.get('b'), n.get('c')]).toEqual([1, 1, 2])
  })

  it('builds slots: at least min, highest + spare, rounded to step', () => {
    const items = [{ id: 'x' }, { id: 'y' }]
    const numbers = new Map([['x', 2], ['y', 13]])
    const slots = poolSlots(items, numbers, { min: 8, spare: 2, step: 8 })
    expect(slots).toHaveLength(16)
    expect(slots[1]).toEqual({ number: 2, item: items[0] })
    expect(slots[12].item).toBe(items[1])
    expect(slots[0].item).toBeNull()
    expect(poolSlots([], new Map(), { min: 12 })).toHaveLength(12)
  })

  it('preset refs and chips use the family number', () => {
    expect(presetRef({ type: 'color', number: 2 })).toBe('4.2')
    expect(presetRef({ type: 'full', number: 7 })).toBe('0.7')
    expect(presetChip({ type: 'position', number: 12 })).toBe('P2.12')
    expect(POOL_FAMILIES[POOL_FAMILIES.length - 1]).toBe('full')
    expect(POOL_FAMILIES).toHaveLength(8)
  })
})

describe('preset previews', () => {
  it('colour from RGB, CMY-free; level; position', () => {
    expect(presetPreview(preset({ type: 'color', values: { f1: { Red: 255, Green: 0, Blue: 0 } } }), patch, [def])).toEqual({ kind: 'colour', css: 'rgb(255 0 0)' })
    expect(presetPreview(preset({ type: 'intensity', values: { f1: { Dimmer: 128 } } }), patch, [def])).toEqual({ kind: 'level', value: 128 / 255 })
    const pos = presetPreview(preset({ type: 'position', universal: { pan: 0, tilt: 255 } }), patch, [def])
    expect(pos).toEqual({ kind: 'position', x: 0, y: 1 })
  })

  it('colour wheel slot colour from the definition (hex, then name)', () => {
    expect(presetPreview(preset({ type: 'color', values: { f1: { 'Color Wheel': 15 } } }), patch, [def])).toEqual({ kind: 'colour', css: 'rgb(192 0 0)' })
    const blue = presetPreview(preset({ type: 'color', typeValues: { spot: { 'Color Wheel': 25 } } }), patch, [def])
    expect(blue.kind).toBe('colour')
    // universal wheel value: standard 8-slot wheel (slot 1 = red)
    expect(presetPreview(preset({ type: 'color', universal: { 'color wheel': 9 } }), patch, [def])).toEqual({ kind: 'colour', css: 'rgb(255 50 50)' })
  })

  it('families without a preview, and "All" picks colour first', () => {
    expect(presetPreview(preset({ type: 'gobo', values: { f1: { Gobo: 20 } } }), patch, [def])).toEqual({ kind: 'none' })
    const all = presetPreview(preset({ type: 'full', values: { f1: { Dimmer: 255, Pan: 10, Blue: 200 } } }), patch, [def])
    expect(all.kind).toBe('colour')
    expect(presetPreview(preset({ type: 'full', values: { f1: { Dimmer: 255 } } }), patch, [def]).kind).toBe('level')
  })

  it('size counts fixtures, types and the universal layer', () => {
    expect(presetSize(preset({ type: 'color' }))).toBe(0)
    expect(presetSize(preset({ type: 'color', values: { f1: { Red: 1 } }, typeValues: { spot: { Red: 1 } }, universal: { red: 1 } }))).toBe(3)
  })
})

describe('programmer values for presets', () => {
  const values = [
    { fixtureId: 'f1', channelName: 'Dimmer', value: 255 },
    { fixtureId: 'f1', channelName: 'Red', value: 10 },
    { fixtureId: 'f1', channelName: 'Gobo', value: 30 },
    { fixtureId: 'f1', channelName: 'Zoom', value: 40 },
    { fixtureId: 'f2', channelName: 'Pan', value: 50 }
  ]
  const lookup = channelLookup(patch, [def])

  it('filters by family (gobo / focus split from beam, All keeps everything)', () => {
    expect(valuesForFamily(values, 'color', lookup).map((v) => v.channelName)).toEqual(['Red'])
    expect(valuesForFamily(values, 'gobo', lookup).map((v) => v.channelName)).toEqual(['Gobo'])
    expect(valuesForFamily(values, 'focus', lookup).map((v) => v.channelName)).toEqual(['Zoom'])
    expect(valuesForFamily(values, 'intensity', lookup).map((v) => v.channelName)).toEqual(['Dimmer'])
    expect(valuesForFamily(values, 'full', lookup)).toHaveLength(5)
  })

  it('filters by fixtures', () => {
    expect(valuesOfFixtures(values, ['f2'])).toEqual([values[4]])
    expect(valuesOfFixtures(values, null)).toHaveLength(5)
  })

  it('Update keeps only what the preset holds, at any scope', () => {
    const p = preset({ type: 'full', values: { f1: { Red: 0 } }, typeValues: { spot: { Pan: 0 } }, universal: { dimmer: 0 } })
    expect(valuesHeldByPreset(p, values, patch).map((v) => `${v.fixtureId}.${v.channelName}`)).toEqual(['f1.Dimmer', 'f1.Red', 'f2.Pan'])
  })

  it('overwrite empties every scope', () => {
    const p = emptiedPreset(preset({ type: 'color', name: 'X', number: 3, values: { f1: { Red: 1 } }, typeValues: { spot: {} }, universal: { red: 1 } }))
    expect(p).toEqual({ id: 'p', name: 'X', type: 'color', number: 3, values: {} })
  })
})

describe('groups and speed masters', () => {
  it('stores groups by merge / overwrite', () => {
    expect(storeGroupFixtures(['a', 'b'], ['b', 'c'], 'merge')).toEqual(['a', 'b', 'c'])
    expect(storeGroupFixtures(['a', 'b'], ['c', 'c'], 'overwrite')).toEqual(['c'])
  })

  it('lists objects following a speed master', () => {
    const linked = linkedToSpeedMaster('s1',
      [{ id: 'q1', name: 'Cue list', speedMasterId: 's1' }],
      [{ id: 'c1', name: 'Chase', speedMasterId: 's1' }, { id: 'c2', name: 'Other', speedMasterId: 's2' }],
      [{ id: 'e1', name: 'Wave', speedMasterId: 's1' }, { id: 'e2', name: 'Free' }])
    expect(linked.map((l) => `${l.kind}:${l.id}`)).toEqual(['chase:c1', 'effect:e1', 'cuelist:q1'])
  })
})

describe('preset chips', () => {
  const meta = new Map([
    [metaKey('f1', 'Red'), { presetId: 'p1' }],
    [metaKey('f2', 'Red'), { presetId: 'p1' }],
    [metaKey('f1', 'Green'), { presetId: 'p2' }],
    [metaKey('f1', 'Blue'), { fade: 2 }]
  ])
  const current: Record<string, number> = { 'f1:Red': 255, 'f2:Red': 100, 'f1:Green': 7 }
  const expected: Record<string, number> = { 'p1|f1:Red': 255, 'p1|f2:Red': 255, 'p2|f1:Green': 7 }
  const refs = validPresetRefs(meta, (key, id) => ({ current: current[key], expected: expected[`${id}|${key}`] }))

  it('keeps refs whose value still equals the preset', () => {
    expect([...refs]).toEqual([['f1:Red', 'p1'], ['f1:Green', 'p2']]) // f2 Red was moved, Blue has no preset
  })

  it('names one preset, several, or none', () => {
    const inProg = () => true
    expect(presetOfTargets([{ fixtureId: 'f1', channel: 'Red' }], refs, inProg)).toBe('p1')
    expect(presetOfTargets([{ fixtureId: 'f1', channel: 'Red' }, { fixtureId: 'f1', channel: 'Green' }], refs, inProg)).toBe('*')
    expect(presetOfTargets([{ fixtureId: 'f1', channel: 'Red' }, { fixtureId: 'f2', channel: 'Red' }], refs, inProg)).toBe('')
    // targets outside the programmer are ignored
    expect(presetOfTargets([{ fixtureId: 'f1', channel: 'Red' }, { fixtureId: 'f2', channel: 'Red' }], refs, (t) => t.fixtureId === 'f1')).toBe('p1')
    expect(presetOfTargets([{ fixtureId: 'f1', channel: 'Red' }], refs, () => false)).toBe('')
  })
})
