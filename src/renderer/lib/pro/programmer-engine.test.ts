import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useSelectionStore } from '@renderer/stores/selection-store'
import {
  clearProgrammer, getGroupMasterScale, getLayerIds, getOutputBuffer, getParked, getPreviewBuffer, getProgrammerChannels,
  getProgrammerValue, HIGHLIGHT_LAYER_ID, isBlindActive, resetMixer, runMixerFrame
} from '@renderer/lib/dmx-mixer'
import { programChannel, recordFromProgrammer } from '@renderer/lib/programmer-utils'
import { MOVING_HEAD, DIMMER, patchEntry, addr } from '@renderer/lib/testing/test-fixtures'
import {
  __setProgrammerClockForTests, applyPreset, getProgrammerMeta, isProgrammerFading, outputValuesOf, releaseFixtures,
  setAttributeValues, setHighlight, setPresetRef, tickProgrammer
} from './programmer-engine'

const mh = patchEntry('mh1', MOVING_HEAD, 0, 1)
const d1 = patchEntry('d1', DIMMER, 0, 101)
const PAN = addr(mh, MOVING_HEAD, 'Pan')
const PAN_FINE = addr(mh, MOVING_HEAD, 'Pan Fine')
const TILT = addr(mh, MOVING_HEAD, 'Tilt')
const DIM = addr(mh, MOVING_HEAD, 'Dimmer')
const RED = addr(mh, MOVING_HEAD, 'Red')
const D1 = addr(d1, DIMMER, 'Intensity')

let now = 0

beforeEach(() => {
  resetMixer()
  now = 0
  __setProgrammerClockForTests(() => now)
  usePatchStore.setState({ fixtures: [MOVING_HEAD, DIMMER], patch: [mh, d1], groups: [], selectedFixtureIds: [] })
  usePlaybackStore.setState({ presets: [{ id: 'red', name: 'Red', type: 'color', values: { mh1: { Red: 255, Green: 0 } } }], cuelists: [], chases: [] })
  usePoolStore.setState({ parked: [], groupMasters: {} })
  useProStore.setState({ progTime: null, blind: false, highlight: false })
  useSelectionStore.getState().reset()
  useDmxStore.setState({ grandMaster: 255, blackout: false })
})

afterEach(() => __setProgrammerClockForTests(null))

describe('programmer fades', () => {
  it('fades a value from what the channel shows to the target', () => {
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Dimmer', value: 200 }], { fade: 1, delay: 0 })
    expect(getProgrammerValue(0, DIM)).toBe(0) // joined at its current value
    expect(isProgrammerFading()).toBe(true)
    tickProgrammer(500)
    expect(getProgrammerValue(0, DIM)).toBe(100) // smoothstep(0.5) = 0.5
    tickProgrammer(1000)
    expect(getProgrammerValue(0, DIM)).toBe(200)
    expect(isProgrammerFading()).toBe(false)
    expect(getProgrammerMeta().get('mh1:Dimmer')).toEqual({ fade: 1 })
  })

  it('fades a 16-bit pair on the combined value', () => {
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Pan', value: 100 }, { fixtureId: 'mh1', channelName: 'Pan Fine', value: 0 }])
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Pan', value: 101 }, { fixtureId: 'mh1', channelName: 'Pan Fine', value: 0 }], { fade: 2, delay: 0 })
    tickProgrammer(1000)
    expect([getProgrammerValue(0, PAN), getProgrammerValue(0, PAN_FINE)]).toEqual([100, 128])
    tickProgrammer(2000)
    expect([getProgrammerValue(0, PAN), getProgrammerValue(0, PAN_FINE)]).toEqual([101, 0])
  })

  it('a coarse value alone keeps a fine half already in the programmer', () => {
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Tilt', value: 10 }, { fixtureId: 'mh1', channelName: 'Tilt Fine', value: 200 }])
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Tilt', value: 20 }], { fade: 1, delay: 0 })
    tickProgrammer(1000)
    expect([getProgrammerValue(0, TILT), getProgrammerValue(0, TILT + 1)]).toEqual([20, 200])
  })

  it('delay: the channel joins the programmer when the delay ends; recording sees the target', () => {
    useProStore.getState().setProgTime({ fade: 0, delay: 1 })
    setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 255 }])
    expect(getProgrammerValue(0, D1)).toBeUndefined()
    expect(getProgrammerMeta().get('d1:Intensity')).toEqual({ delay: 1 })
    expect(recordFromProgrammer({ withMeta: true })).toEqual([{ fixtureId: 'd1', channelName: 'Intensity', value: 255, delay: 1 }])
    tickProgrammer(999)
    expect(getProgrammerValue(0, D1)).toBeUndefined()
    tickProgrammer(1000)
    expect(getProgrammerValue(0, D1)).toBe(255)
  })

  it('recording mid-fade records the target with preset refs and timing', () => {
    applyPreset('red', ['mh1'], { fade: 4, delay: 0 })
    tickProgrammer(2000)
    expect(getProgrammerValue(0, RED)).toBe(128)
    expect(recordFromProgrammer({ withMeta: true })).toEqual([
      { fixtureId: 'mh1', channelName: 'Red', value: 255, presetId: 'red', fade: 4 },
      { fixtureId: 'mh1', channelName: 'Green', value: 0, presetId: 'red', fade: 4 }
    ])
    expect(recordFromProgrammer().map(v => v.value)).toEqual([255, 0])
  })

  it('a hand-set value stops the fade and drops the preset ref (keeping its origin)', () => {
    applyPreset('red', ['mh1'], { fade: 4, delay: 0 })
    programChannel(0, RED, 33)
    tickProgrammer(4000)
    expect(getProgrammerValue(0, RED)).toBe(33)
    expect(getProgrammerMeta().get('mh1:Red')).toEqual({ origin: 'red' }) // not a reference any more; Update still knows it
    expect(recordFromProgrammer({ withMeta: true })[0]).toEqual({ fixtureId: 'mh1', channelName: 'Red', value: 33 })
    expect(getProgrammerMeta().get('mh1:Green')).toEqual({ presetId: 'red', fade: 4 })
  })

  it('release and clear drop values, pending fades and meta', () => {
    useProStore.getState().setProgTime({ fade: 0, delay: 5 })
    setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 255 }])
    useProStore.getState().setProgTime(null)
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Dimmer', value: 9, meta: { presetId: 'x' } }])
    releaseFixtures(['d1'])
    tickProgrammer(6000)
    expect(getProgrammerValue(0, D1)).toBeUndefined()
    expect(getProgrammerMeta().has('d1:Intensity')).toBe(false)
    expect(getProgrammerMeta().has('mh1:Dimmer')).toBe(true)
    clearProgrammer()
    expect(getProgrammerMeta().size).toBe(0)
    expect(isProgrammerFading()).toBe(false)
  })

  it('Store Preset links the programmer values to the preset', () => {
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Red', value: 10 }])
    setPresetRef([{ fixtureId: 'mh1', channelName: 'Red' }, { fixtureId: 'mh1', channelName: 'Blue' }], 'red')
    expect(getProgrammerMeta().get('mh1:Red')).toEqual({ presetId: 'red' })
    expect(getProgrammerMeta().has('mh1:Blue')).toBe(false) // not in the programmer
  })
})

describe('highlight, park, group masters, blind', () => {
  it('highlight: full open white, positions untouched, never recorded, follows the selection', () => {
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Pan', value: 30 }])
    setHighlight(['mh1'])
    expect(useProStore.getState().highlight).toBe(true)
    runMixerFrame(0)
    const out = getOutputBuffer()
    expect(out[DIM]).toBe(255)
    expect(out[PAN]).toBe(30)
    expect(getProgrammerChannels().get(0)?.has(DIM)).toBeFalsy()
    expect(recordFromProgrammer().map(v => v.channelName)).toEqual(['Pan'])
    // Follows the selection (and Next / Prev)
    usePatchStore.getState().selectFixtures(['mh1', 'd1'])
    runMixerFrame(10)
    expect(getOutputBuffer()[D1]).toBe(255)
    useSelectionStore.getState().setStep(0)
    runMixerFrame(20)
    expect(getOutputBuffer()[D1]).toBe(0)
    expect(getOutputBuffer()[DIM]).toBe(255)
    setHighlight(null)
    expect(getLayerIds()).not.toContain(HIGHLIGHT_LAYER_ID)
    runMixerFrame(30)
    expect(getOutputBuffer()[DIM]).toBe(0)
  })

  it('park: pool values reach the mixer and win over every master', () => {
    usePoolStore.getState().park([{ fixtureId: 'd1', channelName: 'Intensity', value: 77 }])
    expect(getParked()?.[D1]).toBe(77)
    useDmxStore.setState({ blackout: true })
    runMixerFrame(0)
    expect(getOutputBuffer()[D1]).toBe(77)
    usePoolStore.getState().unpark(['d1'])
    expect(getParked()).toBeNull()
  })

  it('group masters scale their fixtures', () => {
    usePatchStore.setState({ groups: [{ id: 'g', name: 'G', color: '#fff', fixtureIds: ['d1'] }] })
    usePoolStore.getState().setGroupMaster('g', 51)
    expect(getGroupMasterScale()?.[D1]).toBeCloseTo(0.2)
    expect(getGroupMasterScale()?.[DIM]).toBe(1)
    setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 255 }])
    runMixerFrame(0)
    expect(getOutputBuffer()[D1]).toBe(51)
    usePoolStore.getState().setGroupMaster('g', 255)
    expect(getGroupMasterScale()).toBeNull()
  })

  it('blind keeps programmer edits off stage; the preview shows them', () => {
    useProStore.getState().setBlind(true)
    expect(isBlindActive()).toBe(true)
    setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 200 }])
    runMixerFrame(10_000) // mixer clock past the previous tests' publishes
    expect(getOutputBuffer()[D1]).toBe(0)
    expect(getPreviewBuffer()[D1]).toBe(200)
    expect(useDmxStore.getState().values[0][D1]).toBe(200) // the UI shows what is being programmed
    useProStore.getState().setBlind(false)
    runMixerFrame(10_100)
    expect(getOutputBuffer()[D1]).toBe(200)
  })

  it('output values of fixtures (park as is)', () => {
    setAttributeValues([{ fixtureId: 'd1', channelName: 'Intensity', value: 120 }])
    runMixerFrame(0)
    expect(outputValuesOf(['d1'])).toEqual([{ fixtureId: 'd1', channelName: 'Intensity', value: 120 }])
  })
})
