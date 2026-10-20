import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})

import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { handleCommand } from './command-handler'
import { clearProgrammer, setProgrammerChannel } from './dmx-mixer'
import { getContentState, installContentTracking } from './content-sync'
import { DIMMER, RGB_PAR, patchEntry } from './testing/test-fixtures'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { getColumnLevel, resetPlayback } from './playback-controller'

const cue = { id: 'q1', name: 'Q1', number: 1, values: [], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }
const scene = (id: string) => ({ id, name: id, cues: [cue], currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false })

describe('remote holds are released when the client disconnects', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [scene('a'), scene('b')], chases: [] })
    useDmxStore.setState({ blinder: false, strobe: false })
  })

  it('flash, blinder and strobe go off with the client that held them', () => {
    handleCommand({ type: 'flash-cuelist', payload: { id: 'a', on: true }, clientId: 'web-1' })
    handleCommand({ type: 'toggle-blinder', payload: true, clientId: 'web-1' })
    handleCommand({ type: 'toggle-strobe', payload: true, clientId: 'web-2' })
    expect(usePlaybackStore.getState().cuelists[0].flash).toBe(true)
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(true)

    handleCommand({ type: 'client-disconnected', payload: { clientId: 'web-1' } })
    expect(usePlaybackStore.getState().cuelists[0].flash).toBe(false)
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(false)
    expect(useDmxStore.getState().blinder).toBe(false)
    expect(useDmxStore.getState().strobe).toBe(true) // web-2 still holds it
    handleCommand({ type: 'client-disconnected', payload: { clientId: 'web-2' } })
    expect(useDmxStore.getState().strobe).toBe(false)
  })

  it('a scene toggled on (not held) stays on', () => {
    handleCommand({ type: 'go-cuelist', payload: 'b', clientId: 'web-3' })
    handleCommand({ type: 'client-disconnected', payload: { clientId: 'web-3' } })
    expect(usePlaybackStore.getState().cuelists[1].isPlaying).toBe(true)
  })
})

describe('remote record and effects', () => {
  it('records with the console programmer into the scene id the remote chose', () => {
    const off = installContentTracking()
    const fx = patchEntry('dim1', DIMMER, 0, 1)
    usePatchStore.setState({ patch: [fx], groups: [], fixtures: [DIMMER], selectedFixtureIds: [] })
    usePlaybackStore.setState({ cuelists: [], chases: [] })
    clearProgrammer()
    setProgrammerChannel(0, 0, 180)
    const before = getContentState().sections.cuelists.rev
    handleCommand({ type: 'record', payload: { action: 'new-scene', targetId: 'rec-1', itemId: 'cue-1', name: 'From iPad' } })
    const cl = usePlaybackStore.getState().cuelists.find(c => c.id === 'rec-1')!
    expect(cl.name).toBe('From iPad')
    expect(cl.cues[0].id).toBe('cue-1')
    expect(cl.cues[0].values).toEqual([{ fixtureId: 'dim1', channelName: DIMMER.modes[0].channels[0], value: 180 }])
    expect(getContentState().sections.cuelists).toEqual({ rev: before + 1 })
    clearProgrammer()
    off()
  })

  it('start-effect by id never overwrites the console definition', () => {
    useEffectsStore.setState({ effects: [{ id: 'e1', name: 'Live', waveform: 'sine', speed: 2, depth: 255, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0, isRunning: false }] })
    handleCommand({ type: 'start-effect', payload: { id: 'e1', name: 'Stale copy', speed: 9 } })
    const e = useEffectsStore.getState().effects[0]
    expect(e.isRunning).toBe(true)
    expect(e.name).toBe('Live')
    expect(e.speed).toBe(2)
    handleCommand({ type: 'stop-effect', payload: 'e1' })
    handleCommand({ type: 'start-effect', payload: 'e1' })
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(true)
    useEffectsStore.getState().stopAllEffects()
  })
})

describe('pro remote commands (Stage window, web remote, Companion)', () => {
  beforeEach(() => {
    resetPlayback()
    usePlaybackStore.setState({ cuelists: [scene('a'), scene('b')], chases: [] })
    useExecutorStore.getState().loadLayout(undefined, ['a', 'b'])
    useExecutorStore.getState().syncCuelists(['a', 'b'])
    usePatchStore.setState({ patch: [], groups: [{ id: 'g1', name: 'Front', color: '#ff0000', fixtureIds: [], number: 1 }], fixtures: [], selectedFixtureIds: [] })
    usePoolStore.setState({ groupMasters: {}, speedMasters: [{ id: 's1', number: 1, name: 'Main', bpm: 120 }] })
  })

  it('column-fader moves the column level (current page or a given page)', () => {
    const loc = useExecutorStore.getState().findCell('cuelist', 'a')!
    handleCommand({ type: 'column-fader', payload: { page: 'current', col: loc.col, level: 64 } })
    expect(getColumnLevel(loc.page, loc.col)).toBe(64)
    handleCommand({ type: 'column-fader', payload: { page: 0, col: loc.col, level: 300 } })
    expect(getColumnLevel(0, loc.col)).toBe(255)
    handleCommand({ type: 'column-fader', payload: { page: 5, col: 0, level: 0 } }) // no such page: ignored
    handleCommand({ type: 'column-fader', payload: { col: 'x', level: 0 } })
    expect(usePlaybackStore.getState().cuelists[0].faderLevel).toBe(255)
  })

  it('set-group-master / tap-speed-master / set-speed-master-bpm', () => {
    handleCommand({ type: 'set-group-master', payload: { id: 'g1', level: 100 } })
    expect(usePoolStore.getState().groupMasters.g1).toBe(100)
    handleCommand({ type: 'set-group-master', payload: { id: 'nope', level: 10 } })
    expect(usePoolStore.getState().groupMasters.nope).toBeUndefined()
    handleCommand({ type: 'set-speed-master-bpm', payload: { id: 's1', bpm: 90 } })
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(90)
    handleCommand({ type: 'set-speed-master-bpm', payload: { id: 's1', bpm: -3 } })
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(90)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(10_000)
    handleCommand({ type: 'tap-speed-master', payload: 's1' })
    now.mockReturnValue(10_500)
    handleCommand({ type: 'tap-speed-master', payload: { id: 's1' } })
    now.mockRestore()
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(120)
  })

  it('record carries the Pro store mode and feature filter', () => {
    const par = patchEntry('par1', RGB_PAR, 0, 1)
    const dim = patchEntry('dim1', DIMMER, 0, 10)
    usePatchStore.setState({ patch: [par, dim], groups: [], fixtures: [RGB_PAR, DIMMER], selectedFixtureIds: [] })
    const q = { id: 'q1', name: 'Q1', number: 1, values: [{ fixtureId: 'dim1', channelName: 'Intensity', value: 50 }], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }
    usePlaybackStore.setState({ cuelists: [{ ...scene('a'), cues: [q] }], chases: [] })
    clearProgrammer()
    setProgrammerChannel(0, 0, 255) // par Red
    setProgrammerChannel(0, 9, 200) // dimmer
    // Overwrite, colour only: the cue becomes the par's colour (the dimmer is filtered out)
    handleCommand({ type: 'record', payload: { action: 'update-cue', targetId: 'a', itemId: 'q1', storeMode: 'overwrite', filter: ['colour'] } })
    const values = usePlaybackStore.getState().cuelists[0].cues[0].values
    expect(values.some(v => v.fixtureId === 'par1' && v.channelName === 'Red' && v.value === 255)).toBe(true)
    expect(values.some(v => v.fixtureId === 'dim1' && v.value === 200)).toBe(false)
    clearProgrammer()
  })
})
