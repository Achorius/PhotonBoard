import { describe, expect, it } from 'vitest'
import type { Cue, CueFeature, Preset } from '@shared/types'
import {
  DEFAULT_PRO_COLUMNS, addPart, assignToPart, cleanRate, cleanTime, clearFeatureTiming, countByFeature, countByPart, cueProInfo, hasAdvancedSettings,
  cleanFeatureFilter, hasProData, nextMib, nextPartIndex, parseProColumns, presetNames, removePart, setFeatureTime, toggleFeatureFilter, updatePart
} from './pro-cue'

const cue = (over: Partial<Cue> = {}): Cue => ({
  id: 'c1', name: 'Cue', number: 1, fadeIn: 3, fadeOut: 3, delay: 0, followTime: null,
  values: [
    { fixtureId: 'f1', channelName: 'Dimmer', value: 255 },
    { fixtureId: 'f1', channelName: 'Pan', value: 10 },
    { fixtureId: 'f2', channelName: 'Red', value: 200 }
  ],
  ...over
})

const featureOf = (_f: string, ch: string): CueFeature => (ch === 'Dimmer' ? 'intensity' : ch === 'Pan' ? 'position' : 'colour')

describe('cueProInfo / hasProData', () => {
  it('a plain cue has no pro data', () => {
    expect(hasProData(cueProInfo(cue()))).toBe(false)
  })

  it('detects preset refs, feature timing, parts, value timing, after-go, block', () => {
    const c = cue({
      values: [
        { fixtureId: 'f1', channelName: 'Dimmer', value: 255, presetId: 'p1' },
        { fixtureId: 'f2', channelName: 'Dimmer', value: 255, presetId: 'p1' },
        { fixtureId: 'f1', channelName: 'Pan', value: 10, presetId: 'p2', fade: 1 }
      ],
      featureTiming: { position: { fade: 5 }, colour: {} },
      parts: [{ index: 1 }]
    })
    const info = cueProInfo(c)
    expect(info.presetIds).toEqual(['p1', 'p2'])
    expect(info.timedFeatures).toEqual(['position'])
    expect(info.parts).toBe(1)
    expect(info.timedValues).toBe(1)
    expect(hasProData(info)).toBe(true)
    expect(hasProData(cueProInfo(cue({ followMode: 'after-go' })))).toBe(true)
    expect(hasProData(cueProInfo(cue({ followMode: 'after-fade' })))).toBe(false)
    expect(hasProData(cueProInfo(cue({ block: true })))).toBe(true)
  })

  it('presetNames skips missing presets', () => {
    const presets: Preset[] = [
      { id: 'p1', name: 'Red', type: 'color', values: {} },
      { id: 'p2', name: '', type: 'position', values: {}, number: 3 }
    ]
    expect(presetNames(['p1', 'gone', 'p2'], presets)).toEqual(['Red', '#3'])
  })
})

describe('timing values', () => {
  it('cleanTime', () => {
    expect(cleanTime(1.234)).toBe(1.23)
    expect(cleanTime(-1)).toBeUndefined()
    expect(cleanTime(NaN)).toBeUndefined()
    expect(cleanTime(undefined)).toBeUndefined()
    expect(cleanTime(9999)).toBe(600)
    expect(cleanTime(0)).toBe(0)
  })

  it('setFeatureTime sets and clears, dropping empty entries', () => {
    let ft = setFeatureTime({}, 'position', 'fade', 4)
    expect(ft).toEqual({ position: { fade: 4 } })
    ft = setFeatureTime({ featureTiming: ft }, 'position', 'delay', 1)
    expect(ft).toEqual({ position: { fade: 4, delay: 1 } })
    ft = setFeatureTime({ featureTiming: ft }, 'colour', 'fade', 0)
    expect(ft).toEqual({ position: { fade: 4, delay: 1 }, colour: { fade: 0 } })
    ft = setFeatureTime({ featureTiming: ft }, 'colour', 'fade', undefined)
    expect(ft).toEqual({ position: { fade: 4, delay: 1 } })
    ft = setFeatureTime({ featureTiming: ft }, 'position', 'fade', undefined)
    ft = setFeatureTime({ featureTiming: ft }, 'position', 'delay', NaN)
    expect(ft).toBeUndefined()
  })

  it('setFeatureTime never mutates the input', () => {
    const input = { featureTiming: { beam: { fade: 2 } } }
    setFeatureTime(input, 'beam', 'fade', 5)
    expect(input.featureTiming.beam.fade).toBe(2)
  })

  it('clearFeatureTiming', () => {
    expect(clearFeatureTiming({ featureTiming: { beam: { fade: 2 } } }, 'beam')).toBeUndefined()
    expect(clearFeatureTiming({ featureTiming: { beam: { fade: 2 }, colour: { delay: 1 } } }, 'beam')).toEqual({ colour: { delay: 1 } })
    const same = { beam: { fade: 2 } }
    expect(clearFeatureTiming({ featureTiming: same }, 'colour')).toBe(same)
  })

  it('countByFeature', () => {
    expect(countByFeature(cue(), featureOf)).toEqual({ intensity: 1, position: 1, colour: 1, beam: 0, control: 0 })
  })
})

describe('parts', () => {
  it('adds parts with the next index', () => {
    expect(nextPartIndex(undefined)).toBe(1)
    expect(nextPartIndex([{ index: 1 }, { index: 4 }])).toBe(5)
    expect(addPart({})).toEqual([{ index: 1 }])
    expect(addPart({ parts: [{ index: 2, name: 'Pos' }] })).toEqual([{ index: 2, name: 'Pos' }, { index: 3 }])
  })

  it('updates name and times (undefined clears)', () => {
    const parts = [{ index: 1, fade: 2 }, { index: 2 }]
    expect(updatePart({ parts }, 1, { name: 'Colour', delay: 1.5 })).toEqual([{ index: 1, fade: 2, name: 'Colour', delay: 1.5 }, { index: 2 }])
    expect(updatePart({ parts }, 1, { fade: undefined, name: '  ' })).toEqual([{ index: 1 }, { index: 2 }])
    expect(updatePart({}, 1, { fade: 1 })).toBeUndefined()
  })

  it('removing a part sends its values back to the cue', () => {
    const c = cue({ parts: [{ index: 1 }], values: [{ fixtureId: 'f1', channelName: 'Pan', value: 1, part: 1 }, { fixtureId: 'f1', channelName: 'Dimmer', value: 2 }] })
    const r = removePart(c, 1)
    expect(r.parts).toBeUndefined()
    expect(r.values).toEqual([{ fixtureId: 'f1', channelName: 'Pan', value: 1 }, { fixtureId: 'f1', channelName: 'Dimmer', value: 2 }])
    // Untouched values keep their identity
    expect(r.values[1]).toBe(c.values[1])
  })

  it('assignToPart by feature, all, and back to the cue', () => {
    const c = cue()
    const pos = assignToPart(c, 2, 'position', featureOf)
    expect(pos.map((v) => v.part)).toEqual([undefined, 2, undefined])
    const all = assignToPart({ values: pos }, 1, null, featureOf)
    expect(all.map((v) => v.part)).toEqual([1, 1, 1])
    const back = assignToPart({ values: all }, null, 'intensity', featureOf)
    expect(back.map((v) => v.part)).toEqual([undefined, 1, 1])
    expect('part' in back[0]).toBe(false)
    // Nothing to change → same array
    expect(assignToPart(c, null, null, featureOf)).toBe(c.values)
    expect(countByPart({ values: back })).toEqual(new Map([[0, 1], [1, 2]]))
  })
})

describe('scene advanced settings', () => {
  it('cleanRate clamps and drops ×1', () => {
    expect(cleanRate(2)).toBe(2)
    expect(cleanRate(10)).toBe(4)
    expect(cleanRate(0.1)).toBe(0.25)
    expect(cleanRate(1)).toBeUndefined()
    expect(cleanRate(NaN)).toBeUndefined()
  })

  it('nextMib merges with defaults and cleans times', () => {
    expect(nextMib({}, { enabled: true })).toEqual({ enabled: true, delay: 0, fade: 2 })
    expect(nextMib({ mib: { enabled: true, delay: 1, fade: 2 } }, { delay: -3 })).toEqual({ enabled: true, delay: 0, fade: 2 })
  })

  it('hasAdvancedSettings', () => {
    expect(hasAdvancedSettings({})).toBe(false)
    expect(hasAdvancedSettings({ tracking: true, rate: 1, priorityMode: 'normal', mib: { enabled: false, delay: 0, fade: 1 } })).toBe(false)
    expect(hasAdvancedSettings({ tracking: false })).toBe(true)
    expect(hasAdvancedSettings({ rate: 2 })).toBe(true)
    expect(hasAdvancedSettings({ priorityMode: 'swap' })).toBe(true)
    expect(hasAdvancedSettings({ speedMasterId: 's1' })).toBe(true)
    expect(hasAdvancedSettings({ mib: { enabled: true, delay: 0, fade: 1 } })).toBe(true)
  })
})

describe('store feature filter', () => {
  it('toggles from all, back to all, never empty', () => {
    expect(toggleFeatureFilter([], 'position')).toEqual(['intensity', 'colour', 'beam', 'control'])
    expect(toggleFeatureFilter(['intensity', 'colour', 'beam', 'control'], 'position')).toEqual([])
    expect(toggleFeatureFilter(['colour'], 'intensity')).toEqual(['intensity', 'colour'])
    expect(toggleFeatureFilter(['colour'], 'colour')).toEqual(['colour'])
  })

  it('cleans stored filters', () => {
    expect(cleanFeatureFilter('x')).toEqual([])
    expect(cleanFeatureFilter(['beam', 'nope', 'intensity'])).toEqual(['intensity', 'beam'])
    expect(cleanFeatureFilter(['intensity', 'position', 'colour', 'beam', 'control'])).toEqual([])
  })
})

describe('column prefs', () => {
  it('parses with defaults', () => {
    expect(parseProColumns(null)).toEqual(DEFAULT_PRO_COLUMNS)
    expect(parseProColumns('nope')).toEqual(DEFAULT_PRO_COLUMNS)
    expect(parseProColumns('{"parts":true,"presets":false,"x":1,"trigger":"yes"}')).toEqual({ ...DEFAULT_PRO_COLUMNS, parts: true, presets: false })
  })
})
