import { beforeEach, describe, expect, it, vi } from 'vitest'

// The undo history (window-bound) is not under test: run the step as is
vi.mock('@renderer/lib/history', () => ({ historyStep: (_label: string, fn: () => void) => { fn(); return null } }))
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { applyFeatureFilter, makeFeatureOf, storeIntoExistingCue } from './store-modes'

function scene() {
  const pb = usePlaybackStore.getState()
  const id = pb.addCuelist('Test')
  pb.addCue(id, 'Q1', [
    { fixtureId: 'f1', channelName: 'Dimmer', value: 255 },
    { fixtureId: 'f1', channelName: 'Pan', value: 100 },
    { fixtureId: 'f1', channelName: 'Red', value: 50 }
  ])
  return id
}

const cueValues = (id: string) => usePlaybackStore.getState().cuelists.find((c) => c.id === id)!.cues[0].values

describe('Pro store modes into an existing cue', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [], chases: [], selectedCuelistId: null, selectedChaseId: null })
  })

  it('classifies channels by feature (no patch: by name)', () => {
    const featureOf = makeFeatureOf()
    expect(featureOf('f1', 'Dimmer')).toBe('intensity')
    expect(featureOf('f1', 'Pan')).toBe('position')
    expect(featureOf('f1', 'Red')).toBe('colour')
  })

  it('filters values by feature', () => {
    const values = [{ fixtureId: 'f1', channelName: 'Dimmer', value: 1 }, { fixtureId: 'f1', channelName: 'Tilt', value: 2 }]
    expect(applyFeatureFilter(values, ['position'])).toEqual([values[1]])
    expect(applyFeatureFilter(values, [])).toBe(values)
  })

  it('merge / remove / overwrite with a filter', () => {
    const id = scene()
    const cueId = usePlaybackStore.getState().cuelists[0].cues[0].id
    // merge: Dimmer changes, Tilt added
    expect(storeIntoExistingCue(id, cueId, [{ fixtureId: 'f1', channelName: 'Dimmer', value: 10 }, { fixtureId: 'f1', channelName: 'Tilt', value: 20 }], { mode: 'merge' }, 'x')).toBe(1)
    expect(cueValues(id).map((v) => `${v.channelName}=${v.value}`)).toEqual(['Dimmer=10', 'Pan=100', 'Red=50', 'Tilt=20'])
    // remove, only the colour feature: Red goes, Dimmer stays
    storeIntoExistingCue(id, cueId, [{ fixtureId: 'f1', channelName: 'Dimmer', value: 0 }, { fixtureId: 'f1', channelName: 'Red', value: 0 }], { mode: 'remove', filter: ['colour'] }, 'x')
    expect(cueValues(id).map((v) => v.channelName)).toEqual(['Dimmer', 'Pan', 'Tilt'])
    // nothing changes → 0
    expect(storeIntoExistingCue(id, cueId, [{ fixtureId: 'f1', channelName: 'Red', value: 0 }], { mode: 'remove' }, 'x')).toBe(0)
    // unknown cue / scene
    expect(storeIntoExistingCue(id, 'nope', [], { mode: 'merge' }, 'x')).toBe(0)
    expect(storeIntoExistingCue('nope', cueId, [], { mode: 'merge' }, 'x')).toBe(0)
  })
})
