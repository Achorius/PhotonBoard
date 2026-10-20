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
import { DIMMER, patchEntry } from './testing/test-fixtures'

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
