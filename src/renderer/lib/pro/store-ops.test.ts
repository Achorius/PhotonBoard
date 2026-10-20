import { describe, expect, it } from 'vitest'
import type { Cue, CueChannelValue, Cuelist, Preset } from '@shared/types'
import { MOVING_HEAD, DIMMER, patchEntry } from '@renderer/lib/testing/test-fixtures'
import {
  insertCue, nextCueNumber, storeIntoCue, storePreset, trackedValues, updateCueValues, updateFromProgrammer, type KeyMetaFn
} from './store-ops'

const meta: KeyMetaFn = (_f, ch) => ({ feature: /pan|tilt/i.test(ch) ? 'position' : /red|green|blue/i.test(ch) ? 'colour' : /dim/i.test(ch) ? 'intensity' : 'beam' })
const v = (fixtureId: string, channelName: string, value: number, extra: Partial<CueChannelValue> = {}): CueChannelValue => ({ fixtureId, channelName, value, ...extra })
const cue = (n: number, values: CueChannelValue[], extra: Partial<Cue> = {}): Cue =>
  ({ id: `q${n}`, name: `Q${n}`, number: n, values, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null, ...extra })
const list = (cues: Cue[], extra: Partial<Cuelist> = {}): Cuelist =>
  ({ id: 'L', name: 'L', cues, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...extra })

const values = (c: Cue) => Object.fromEntries(c.values.map(x => [`${x.fixtureId}.${x.channelName}`, x.value]))

describe('storeIntoCue', () => {
  const base = list([
    cue(1, [v('f', 'Dimmer', 100), v('f', 'Pan', 10)]),
    cue(2, [v('f', 'Red', 50)]),
    cue(3, [v('f', 'Dimmer', 0)])
  ])

  it('overwrite with a filter only replaces the filtered features', () => {
    const res = storeIntoCue(base, 0, [v('f', 'Pan', 99), v('f', 'Dimmer', 1)], { mode: 'overwrite', filter: ['position'] }, meta)
    expect(values(res.cues[0])).toEqual({ 'f.Dimmer': 100, 'f.Pan': 99 })
  })

  it('cue only: cue N+1 gets restore values for what tracked through', () => {
    const res = storeIntoCue(base, 0, [v('f', 'Pan', 200), v('f', 'Dimmer', 255), v('g', 'Dimmer', 80), v('g', 'Gobo', 3)], { mode: 'cueonly' }, meta)
    expect(values(res.cues[0])).toEqual({ 'f.Dimmer': 255, 'f.Pan': 200, 'g.Dimmer': 80, 'g.Gobo': 3 })
    // f.Pan restored to 10 (tracked from cue 1); g.Dimmer had nothing → 0 (intensity);
    // g.Gobo had nothing and is not intensity → nothing; f.Dimmer: cue 2 does not set it → restored to 100
    expect(values(res.cues[1])).toEqual({ 'f.Red': 50, 'f.Pan': 10, 'f.Dimmer': 100, 'g.Dimmer': 0 })
    expect(res.cues[2]).toBe(base.cues[2])
    // A key the next cue already sets needs no restore
    const res2 = storeIntoCue(base, 1, [v('f', 'Dimmer', 7)], { mode: 'cueonly' }, meta)
    expect(res2.cues[2]).toBe(base.cues[2])
    // Last cue / tracking off: plain merge
    expect(storeIntoCue(base, 2, [v('f', 'Pan', 1)], { mode: 'cueonly' }, meta).cues.length).toBe(3)
    const noTracking = storeIntoCue({ ...base, tracking: false }, 0, [v('f', 'Pan', 200)], { mode: 'cueonly' }, meta)
    expect(noTracking.cues[1]).toBe(base.cues[1])
  })

  it('cue only keeps a preset reference in the restore value', () => {
    const l = list([cue(1, [v('f', 'Red', 255, { presetId: 'p', fade: 2 })]), cue(2, [])])
    const res = storeIntoCue(l, 0, [v('f', 'Red', 0)], { mode: 'cueonly' }, meta)
    expect(res.cues[1].values).toEqual([{ fixtureId: 'f', channelName: 'Red', value: 255, presetId: 'p' }])
  })

  it('block hard-stores the whole tracked state', () => {
    const res = storeIntoCue(base, 1, [v('f', 'Pan', 77)], { mode: 'block' }, meta)
    expect(values(res.cues[1])).toEqual({ 'f.Dimmer': 100, 'f.Pan': 77, 'f.Red': 50 })
    expect(res.cues[1].block).toBe(true)
    expect(base.cues[1].block).toBeUndefined()
  })

  it('merge copies preset refs and timing of the programmer', () => {
    const res = storeIntoCue(base, 1, [v('f', 'Red', 255, { presetId: 'p', fade: 3 })], { mode: 'merge' }, meta)
    expect(res.cues[1].values).toEqual([{ fixtureId: 'f', channelName: 'Red', value: 255, presetId: 'p', fade: 3 }])
  })

  it('tracked values, cue numbers and insertion', () => {
    expect([...trackedValues(base.cues, 2).values()].map(x => x.value)).toEqual([0, 10, 50])
    expect([...trackedValues(base.cues, 2, false).values()].map(x => x.value)).toEqual([0])
    expect(nextCueNumber(base)).toBe(4)
    expect(nextCueNumber(list([cue(2.5, [])]))).toBe(3)
    const playing = { ...base, currentCueIndex: 1, isPlaying: true }
    const { cuelist, index } = insertCue(playing, cue(1.5, []))
    expect(index).toBe(1)
    expect(cuelist.cues.map(c => c.number)).toEqual([1, 1.5, 2, 3])
    expect(cuelist.currentCueIndex).toBe(2) // cue 2 keeps playing
  })
})

describe('storePreset', () => {
  const patch = [patchEntry('mh1', MOVING_HEAD, 0, 1), patchEntry('d1', DIMMER, 0, 20)]

  it('overwrite drops every level; remove takes channels out', () => {
    const p: Preset = { id: 'p', name: 'P', type: 'color', scope: 'global', values: { mh1: { Red: 1 } }, typeValues: { 'test/moving-head': { Green: 2 } }, universal: { blue: 3 } }
    const over = storePreset(p, 'color', [v('mh1', 'Red', 300)], 'selective', patch, 'overwrite')
    expect(over).toEqual({ id: 'p', name: 'P', type: 'color', values: { mh1: { Red: 255 } } })
    const removed = storePreset(p, 'color', [v('mh1', 'Red', 0)], 'selective', patch, 'remove')
    expect(removed.values).toEqual({})
    expect(removed.scope).toBe('global')
    expect(storePreset(p, 'color', [v('mh1', 'Green', 0)], 'global', patch, 'remove').typeValues).toEqual({})
    expect(storePreset(p, 'color', [v('mh1', 'B', 0)], 'universal', patch, 'remove').universal).toEqual({})
    expect(p.values).toEqual({ mh1: { Red: 1 } }) // input untouched
  })
})

describe('update', () => {
  const l = list([cue(1, [v('f', 'Red', 10, { fade: 4 }), v('f', 'Pan', 20, { presetId: 'pos' })])], { isPlaying: true, currentCueIndex: 0 })

  it('updates existing cue values with programmer values and preset refs', () => {
    const res = updateCueValues([l], [{ cuelistId: 'L', cueIndex: 0 }], [v('f', 'Red', 99, { presetId: 'c' }), v('f', 'Pan', 30), v('f', 'Tilt', 5)])
    expect(res.cues).toBe(1)
    expect(res.cuelists[0].cues[0].values).toEqual([
      { fixtureId: 'f', channelName: 'Red', value: 99, fade: 4, presetId: 'c' },
      { fixtureId: 'f', channelName: 'Pan', value: 30 }
    ])
    const merged = updateCueValues([l], [{ cuelistId: 'L', cueIndex: 0 }], [v('f', 'Tilt', 5)], { mode: 'merge' })
    expect(merged.cuelists[0].cues[0].values.map(x => x.channelName)).toEqual(['Red', 'Pan', 'Tilt'])
    const filtered = updateCueValues([l], [{ cuelistId: 'L', cueIndex: 0 }], [v('f', 'Red', 1), v('f', 'Pan', 1)], { filter: ['position'] }, meta)
    expect(values(filtered.cuelists[0].cues[0])).toEqual({ 'f.Red': 10, 'f.Pan': 1 })
    expect(updateCueValues([l], [], [v('f', 'Red', 1)]).cuelists[0]).toBe(l)
  })

  it('updates a preset at the level it holds the value', () => {
    const patch = [patchEntry('mh1', MOVING_HEAD, 0, 1)]
    const p: Preset = { id: 'p', name: 'P', type: 'color', scope: 'universal', values: {}, universal: { red: 1 }, typeValues: { 'test/moving-head': { Green: 2 } } }
    const res = updateFromProgrammer({
      cuelists: [], presets: [p], activeCues: [], patch,
      values: [v('mh1', 'Red', 200, { presetId: 'p' }), v('mh1', 'Green', 100, { presetId: 'p' })]
    })
    expect(res.presets).toBe(1)
    expect(res.presetList[0]).toMatchObject({ scope: 'universal', universal: { red: 200 }, typeValues: { 'test/moving-head': { Green: 100 } }, values: {} })
    // Nothing changed → identity, not counted
    const same = updateFromProgrammer({ cuelists: [], presets: [res.presetList[0]], activeCues: [], patch, values: [v('mh1', 'Red', 200, { presetId: 'p' })] })
    expect(same.presets).toBe(0)
    expect(same.presetList[0]).toBe(res.presetList[0])
  })
})
