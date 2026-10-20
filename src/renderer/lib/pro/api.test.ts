import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useSelectionStore } from '@renderer/stores/selection-store'
import { getProgrammerValue, resetMixer } from '@renderer/lib/dmx-mixer'
import { programChannel } from '@renderer/lib/programmer-utils'
import { installHistory } from '@renderer/lib/history'
import { DIMMER, MOVING_HEAD, addr, patchEntry } from '@renderer/lib/testing/test-fixtures'
import { getProgrammerMeta } from './programmer-engine'
import { createProApi } from './api'

const mh = patchEntry('mh1', MOVING_HEAD, 0, 1, { fid: 1 })
const d1 = patchEntry('d1', DIMMER, 0, 101, { fid: 2 })
const d2 = patchEntry('d2', DIMMER, 0, 102, { fid: 3 })
const RED = addr(mh, MOVING_HEAD, 'Red')

const api = createProApi({ interactive: false })
let stopHistory: () => void

beforeAll(() => { stopHistory = installHistory() })
afterAll(() => stopHistory())

beforeEach(() => {
  resetMixer()
  usePatchStore.setState({ fixtures: [MOVING_HEAD, DIMMER], patch: [mh, d1, d2], groups: [], selectedFixtureIds: [] })
  usePlaybackStore.setState({ presets: [], cuelists: [], chases: [], selectedCuelistId: null })
  usePoolStore.setState({ parked: [], groupMasters: {}, macros: [] })
  useProStore.setState({ progTime: null, blind: false, highlight: false, selectedExecutor: null })
  useSelectionStore.getState().reset()
  useExecutorStore.getState().loadLayout(undefined)
})

const cues = () => usePlaybackStore.getState().cuelists[0]?.cues ?? []
const vals = (i: number) => Object.fromEntries((cues()[i]?.values ?? []).map(v => [`${v.fixtureId}.${v.channelName}`, v.value]))

describe('ProApi: cues', () => {
  it('Store Cue creates the sequence, merges into an existing cue, one undo step each', () => {
    expect(api.storeCue(null, 1, { mode: 'merge' })).toBeNull() // empty programmer
    api.setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 255 }])
    const first = api.storeCue(null, 1, { mode: 'merge' })!
    expect(first.existed).toBe(false)
    expect(api.getSelectedCuelist()).toBe(first.cuelistId)
    expect(vals(0)).toEqual({ 'd1.Intensity': 255 })
    api.clear('values')
    api.setAttributeValues([{ fixtureId: 'd2', channelName: 'Intensity', value: 100 }])
    expect(api.storeCue(null, 1, { mode: 'merge' })).toMatchObject({ existed: true, cueId: first.cueId })
    expect(vals(0)).toEqual({ 'd1.Intensity': 255, 'd2.Intensity': 100 })
    expect(api.storeCue(null, null, { mode: 'merge' })?.existed).toBe(false) // next number: cue 2
    expect(cues().map(c => c.number)).toEqual([1, 2])
    expect(api.undo()).toBe('Store cue 2')
    expect(cues().map(c => c.number)).toEqual([1])
    expect(api.undo()).toBe('Store cue 1')
    expect(vals(0)).toEqual({ 'd1.Intensity': 255 })
    expect(api.redo()).toBe('Store cue 1')
  })

  it('cue only between two cues, block, and the preset / timing meta', () => {
    api.setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 200 }])
    const { cuelistId } = api.storeCue(null, 1, { mode: 'merge' })!
    api.storeCue(cuelistId, 3, { mode: 'merge' })
    api.clear('values')
    api.setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 50, meta: { fade: 4 } }])
    api.storeCue(cuelistId, 2, { mode: 'cueonly' })
    expect(cues().map(c => c.number)).toEqual([1, 2, 3])
    expect(cues()[1].values).toEqual([{ fixtureId: 'd1', channelName: 'Intensity', value: 50, fade: 4 }])
    expect(vals(2)).toEqual({ 'd1.Intensity': 200 })
    api.clear('values')
    api.setAttributeValues([{ fixtureId: 'd2', channelName: 'Intensity', value: 9 }])
    api.storeCue(cuelistId, 3, { mode: 'block' })
    expect(cues()[2]).toMatchObject({ block: true })
    expect(vals(2)).toEqual({ 'd1.Intensity': 200, 'd2.Intensity': 9 })
  })

  it('copy / move / goto / update', () => {
    api.setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 10 }])
    const { cuelistId, cueId } = api.storeCue(null, 1, { mode: 'merge' })!
    const copy = api.copyCue(cuelistId, cueId, 5)!
    expect(api.copyCue(cuelistId, cueId, 5)).toBeNull()
    expect(api.moveCue(cuelistId, copy, 0.5)).toBe(true)
    expect(cues().map(c => c.number)).toEqual([0.5, 1])
    expect(api.goto(cuelistId, 1)).toBe(true)
    expect(api.goto(cuelistId, 9)).toBe(false)
    const cl = usePlaybackStore.getState().cuelists[0]
    expect(cl.isPlaying && cl.currentCueIndex).toBe(1)
    api.setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 99 }, { fixtureId: 'd2', channelName: 'Intensity', value: 1 }])
    expect(api.updateCuesFromProgrammer()).toBe(1)
    expect(vals(1)).toEqual({ 'd1.Intensity': 99 })
    expect(api.updateCuesFromProgrammer({ mode: 'merge' })).toBe(1)
    expect(vals(1)).toEqual({ 'd1.Intensity': 99, 'd2.Intensity': 1 })
  })
})

describe('ProApi: presets', () => {
  it('Store Preset keeps only the family, numbers it, links the programmer; Update goes back to it', () => {
    api.setAttributeValues([
      { fixtureId: 'mh1', channelName: 'Dimmer', value: 255 },
      { fixtureId: 'mh1', channelName: 'Red', value: 200 },
      { fixtureId: 'mh1', channelName: 'Green', value: 20 }
    ])
    const p = api.storePreset('color', 3, { name: 'Warm' })!
    expect(p).toMatchObject({ type: 'color', number: 3, name: 'Warm', values: { mh1: { Red: 200, Green: 20 } } })
    expect(getProgrammerMeta().get('mh1:Red')).toEqual({ presetId: p.id })
    // Recorded with its reference
    const { cuelistId } = api.storeCue(null, 1, { mode: 'merge' })!
    expect(usePlaybackStore.getState().cuelists[0].cues[0].values.find(v => v.channelName === 'Red')?.presetId).toBe(p.id)
    // Tweak by hand, Update: the preset follows, the cue's value too
    programChannel(0, RED, 120)
    expect(api.updatePresetsFromProgrammer()).toBe(1)
    expect(usePlaybackStore.getState().presets[0].values.mh1.Red).toBe(120)
    expect(usePlaybackStore.getState().cuelists.find(c => c.id === cuelistId)!.cues[0].values.find(v => v.channelName === 'Red')?.value).toBe(120)
    expect(getProgrammerMeta().get('mh1:Red')).toEqual({ presetId: p.id })
    // Overwrite at another scope
    api.clear('values')
    api.setAttributeValues([{ fixtureId: 'mh1', channelName: 'Blue', value: 255 }])
    const g = api.storePreset('color', 3, { mode: 'overwrite', scope: 'universal' })!
    expect(g).toMatchObject({ id: p.id, scope: 'universal', values: {}, universal: { blue: 255 } })
    expect(api.storePreset('position', 1)).toBeNull() // nothing of that family in the programmer
  })

  it('apply, copy, move, delete', () => {
    const id = usePoolStore.getState().addPreset({ type: 'color', number: 1, values: { d1: {}, mh1: { Red: 255 } } })
    expect(api.applyPreset(id, ['mh1', 'd1'])).toBe(1)
    expect(getProgrammerValue(0, RED)).toBe(255)
    const copy = api.copyPreset(id, 2)!
    expect(api.copyPreset(id, 2)).toBeNull()
    expect(api.movePreset(copy, 7)).toBe(true)
    expect(usePlaybackStore.getState().presets.map(p => p.number)).toEqual([1, 7])
    api.deletePreset(copy)
    expect(usePlaybackStore.getState().presets).toHaveLength(1)
  })
})

describe('ProApi: groups, executors, macros, clear', () => {
  it('Store Group: new, merge, remove, overwrite (selection order kept)', () => {
    const id = api.storeGroup(4, ['d2', 'd1', 'nope'])
    let g = usePatchStore.getState().groups[0]
    expect(g).toMatchObject({ id, number: 4, name: 'Group 4', fixtureIds: ['d2', 'd1'] })
    expect(usePatchStore.getState().patch.find(p => p.id === 'd1')!.groupIds).toEqual([id])
    api.storeGroup(4, ['mh1'], { mode: 'merge' })
    api.storeGroup(4, ['d2'], { mode: 'remove' })
    g = usePatchStore.getState().groups[0]
    expect(g.fixtureIds).toEqual(['d1', 'mh1'])
    expect(usePatchStore.getState().patch.find(p => p.id === 'd2')!.groupIds).toEqual([])
    api.storeGroup(4, ['d2'], { name: 'Front' })
    expect(usePatchStore.getState().groups[0]).toMatchObject({ name: 'Front', fixtureIds: ['d2'] })
  })

  it('assigns executors on new pages; stores macros by number', () => {
    usePlaybackStore.getState().addCuelist('Seq')
    const seq = usePlaybackStore.getState().cuelists[0].id
    api.assignExecutor({ page: 1, col: 2, row: 3 }, { kind: 'cuelist', id: seq }, { button: 'go' })
    expect(useExecutorStore.getState().pages[1].cells[2][3]).toMatchObject({ kind: 'cuelist', id: seq, button: 'go' })
    api.selectExecutor({ page: 1, col: 2, row: 3 })
    expect(api.getSelectedCuelist()).toBe(seq)
    api.assignExecutor({ page: 1, col: 2, row: 3 }, null)
    expect(useExecutorStore.getState().pages[1].cells[2][3]).toBeNull()
    const m = api.storeMacro(3, [{ command: 'Go' }], 'M')
    expect(api.storeMacro(3, [{ command: 'Off' }])).toBe(m)
    expect(usePoolStore.getState().macros[0]).toMatchObject({ number: 3, name: 'M', lines: [{ command: 'Off' }] })
  })

  it('clear in three stages; selection steps; highlight / blind flags', async () => {
    api.setSelection(['d1', 'd2'])
    api.setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 255 }])
    api.selectStep('next')
    expect(api.getActiveSelection()).toEqual(['d1'])
    api.selectStep('prev')
    expect(api.getActiveSelection()).toEqual(['d2'])
    api.setHighlight(true)
    expect(api.isHighlight()).toBe(true)
    expect(api.clear()).toBe('selection')
    expect(api.getSelection()).toEqual([])
    expect(api.clear()).toBe('values')
    expect(getProgrammerValue(0, addr(d1, DIMMER, 'Intensity'))).toBeUndefined()
    expect(api.clear()).toBe('all')
    expect(api.isHighlight()).toBe(false)
    api.setBlind(true)
    expect(api.isBlind()).toBe(true)
    api.setBlind(false)
    expect(await api.ask('?', [{ id: 'a', label: 'A' }], 'a')).toBe('a')
    expect(api.featureOf('mh1', 'Pan')).toBe('position')
  })

  it('transaction: several mutations are one undo step', () => {
    api.transaction('Two groups', () => {
      api.storeGroup(1, ['d1'])
      api.storeGroup(2, ['d2'])
    })
    expect(usePatchStore.getState().groups).toHaveLength(2)
    expect(api.undo()).toBe('Two groups')
    expect(usePatchStore.getState().groups).toHaveLength(0)
  })

  it('park / unpark (undoable), park at the current output', () => {
    api.park([{ fixtureId: 'd1', channelName: 'Intensity', value: 40 }])
    expect(usePoolStore.getState().parked).toHaveLength(1)
    expect(api.getOutputValues(['d1'])).toEqual([{ fixtureId: 'd1', channelName: 'Intensity', value: 0 }])
    api.unpark(['d1'])
    expect(usePoolStore.getState().parked).toHaveLength(0)
    expect(api.undo()).toBe('Unpark')
    expect(usePoolStore.getState().parked).toHaveLength(1)
  })
})
