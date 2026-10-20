import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const data = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v) },
      removeItem: (k: string) => { data.delete(k) }
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
  g.localStorage ??= (g.window as { localStorage: unknown }).localStorage
})

import type { FixtureDefinition } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useSelectionStore } from '@renderer/stores/selection-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { clearProgrammer } from '@renderer/lib/dmx-mixer'
import { programChannel } from '@renderer/lib/programmer-utils'
import { getProgrammerMeta } from '@renderer/lib/pro/programmer-engine'
import {
  activeSelection, applyPresetToSelection, linkToSpeedMaster, renumberGroup, storeGroupAt, storePresetAt, updatePresetFromProgrammer, assignToExecutor
} from './pool-actions'

const def = {
  id: 'rgb',
  name: 'RGB Par',
  manufacturer: 'Test',
  categories: [],
  channels: {
    Dimmer: { name: 'Dimmer', type: 'intensity' },
    Red: { name: 'Red', type: 'color' },
    Green: { name: 'Green', type: 'color' },
    Blue: { name: 'Blue', type: 'color' }
  },
  modes: [{ name: '4ch', channels: ['Dimmer', 'Red', 'Green', 'Blue'] }]
} as unknown as FixtureDefinition

beforeEach(() => {
  clearProgrammer()
  usePatchStore.setState({
    fixtures: [def],
    patch: [
      { id: 'a', fixtureDefId: 'rgb', modeName: '4ch', universe: 0, address: 1, name: 'A', groupIds: [], fid: 1 },
      { id: 'b', fixtureDefId: 'rgb', modeName: '4ch', universe: 0, address: 5, name: 'B', groupIds: [], fid: 2 },
      { id: 'c', fixtureDefId: 'rgb', modeName: '4ch', universe: 0, address: 9, name: 'C', groupIds: [], fid: 3 }
    ],
    groups: [],
    selectedFixtureIds: []
  })
  usePlaybackStore.setState({ cuelists: [], chases: [], presets: [] })
  useEffectsStore.setState({ effects: [] })
  usePoolStore.getState().loadPools({})
  useSelectionStore.getState().reset()
  useExecutorStore.getState().loadLayout(undefined)
})

describe('pool actions', () => {
  it('active selection follows MAtricks and the step', () => {
    usePatchStore.getState().selectFixtures(['a', 'b', 'c'])
    expect(activeSelection()).toEqual(['a', 'b', 'c'])
    useSelectionStore.getState().setStep(1)
    expect(activeSelection()).toEqual(['b'])
    useSelectionStore.getState().setStep(null)
    useSelectionStore.getState().setMatricks({ invert: true })
    expect(activeSelection()).toEqual(['c', 'b', 'a'])
  })

  it('stores only the family values of the selection, then the programmer refers to the preset', () => {
    usePatchStore.getState().selectFixtures(['a'])
    programChannel(0, 0, 255) // a Dimmer
    programChannel(0, 1, 200) // a Red
    programChannel(0, 5, 99) // b Red (not selected)
    const id = storePresetAt('color', 3)
    expect(id).toBeTruthy()
    const p = usePlaybackStore.getState().presets.find((x) => x.id === id)!
    expect(p.type).toBe('color')
    expect(p.number).toBe(3)
    expect(p.values).toEqual({ a: { Red: 200 } })
    expect(getProgrammerMeta().get('a:Red')?.presetId).toBe(id)
    expect(getProgrammerMeta().get('a:Dimmer')).toBeUndefined()
  })

  it('nothing to store: no preset is created', () => {
    usePatchStore.getState().selectFixtures(['a'])
    programChannel(0, 0, 255)
    expect(storePresetAt('position', 1)).toBeNull()
    expect(usePlaybackStore.getState().presets).toHaveLength(0)
  })

  it('merge / overwrite / global scope into an existing slot', () => {
    usePatchStore.getState().selectFixtures(['a'])
    programChannel(0, 1, 10)
    const id = storePresetAt('color', 1)!
    clearProgrammer()
    usePatchStore.getState().selectFixtures(['b'])
    programChannel(0, 6, 20) // b Green
    storePresetAt('color', 1, { mode: 'merge' })
    expect(usePlaybackStore.getState().presets.find((p) => p.id === id)!.values).toEqual({ a: { Red: 10 }, b: { Green: 20 } })
    storePresetAt('color', 1, { mode: 'overwrite' })
    expect(usePlaybackStore.getState().presets.find((p) => p.id === id)!.values).toEqual({ b: { Green: 20 } })
    storePresetAt('color', 1, { mode: 'overwrite', scope: 'global' })
    const g = usePlaybackStore.getState().presets.find((p) => p.id === id)!
    expect(g.scope).toBe('global')
    expect(g.typeValues).toEqual({ rgb: { Green: 20 } })
    expect(usePlaybackStore.getState().presets).toHaveLength(1)
  })

  it('applies to the selection and updates from the programmer', () => {
    usePatchStore.getState().selectFixtures(['a'])
    programChannel(0, 1, 50)
    const id = storePresetAt('color', 1)!
    clearProgrammer()
    expect(applyPresetToSelection(id)).toBe(true)
    expect(getProgrammerMeta().get('a:Red')?.presetId).toBe(id)
    programChannel(0, 1, 80)
    programChannel(0, 2, 90) // Green: not in the preset → ignored by Update
    expect(updatePresetFromProgrammer(id)).toBe(true)
    expect(usePlaybackStore.getState().presets[0].values).toEqual({ a: { Red: 80 } })
    usePatchStore.getState().clearSelection()
    expect(applyPresetToSelection(id)).toBe(false)
  })

  it('groups: store, merge, renumber with swap', () => {
    usePatchStore.getState().selectFixtures(['a', 'b'])
    const g1 = storeGroupAt(4)!
    usePatchStore.getState().selectFixtures(['c'])
    const g2 = storeGroupAt(5)!
    storeGroupAt(4, 'merge')
    const groups = usePatchStore.getState().groups
    expect(groups.find((g) => g.id === g1)).toMatchObject({ number: 4, fixtureIds: ['a', 'b', 'c'] })
    expect(usePatchStore.getState().patch.find((p) => p.id === 'c')!.groupIds.sort()).toEqual([g1, g2].sort())
    expect(renumberGroup(g1, 5)).toBe(true)
    const after = usePatchStore.getState().groups
    expect(after.find((g) => g.id === g1)!.number).toBe(5)
    expect(after.find((g) => g.id === g2)!.number).toBe(4)
  })

  it('links objects to speed masters and assigns to executors', () => {
    const s = usePoolStore.getState().addSpeedMaster({ bpm: 128 })
    const chase = usePlaybackStore.getState().addChase('Chase')
    linkToSpeedMaster('chase', chase, s)
    expect(usePlaybackStore.getState().chases[0].speedMasterId).toBe(s)
    linkToSpeedMaster('chase', chase, undefined)
    expect('speedMasterId' in usePlaybackStore.getState().chases[0]).toBe(false)
    const m = usePoolStore.getState().addMacro({ lines: [{ command: 'Go Sequence 1' }] })
    assignToExecutor('macro', m, 0, 2, 1)
    expect(useExecutorStore.getState().pages[0].cells[2][1]).toMatchObject({ kind: 'macro', id: m })
  })
})
