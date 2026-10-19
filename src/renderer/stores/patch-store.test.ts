import { beforeEach, describe, expect, it } from 'vitest'
import { usePatchStore } from './patch-store'
import { clearProgrammer, getProgrammerValue, setProgrammerChannel } from '@renderer/lib/dmx-mixer'
import { ALL_FIXTURES, DIMMER, RGB_PAR, patchEntry } from '@renderer/lib/testing/test-fixtures'

describe('patch edits release stale programmer values', () => {
  beforeEach(() => {
    clearProgrammer()
    usePatchStore.setState({
      patch: [patchEntry('par', RGB_PAR, 0, 1), patchEntry('dim', DIMMER, 0, 10)],
      fixtures: ALL_FIXTURES,
      groups: [],
      selectedFixtureIds: []
    })
    for (const ch of [0, 1, 2, 9]) setProgrammerChannel(0, ch, 200)
    setProgrammerChannel(0, 100, 50) // unpatched channel: untouched
  })

  it('deleting fixtures releases their channels only', () => {
    usePatchStore.getState().removeFixtures(['par'])
    expect([0, 1, 2].map((ch) => getProgrammerValue(0, ch))).toEqual([undefined, undefined, undefined])
    expect(getProgrammerValue(0, 9)).toBe(200)
    expect(getProgrammerValue(0, 100)).toBe(50)
  })

  it('re-addressing releases the old footprint; other edits do not', () => {
    usePatchStore.getState().updateFixture('dim', { name: 'Renamed', position3D: { x: 1, y: 2, z: 3 } })
    expect(getProgrammerValue(0, 9)).toBe(200)
    usePatchStore.getState().updateFixtures({ dim: { address: 20 } })
    expect(getProgrammerValue(0, 9)).toBeUndefined()
    usePatchStore.getState().updateFixture('par', { universe: 1 })
    expect(getProgrammerValue(0, 0)).toBeUndefined()
    expect(getProgrammerValue(0, 100)).toBe(50)
  })
})
