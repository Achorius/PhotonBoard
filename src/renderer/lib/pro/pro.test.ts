import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import type { Cuelist, Preset } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { clearProgrammer, getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { MOVING_HEAD, patchEntry } from '@renderer/lib/testing/test-fixtures'
import { applyMatricks, fanValues } from './selection-tools'
import { storeIntoCue, storePreset, updateFromProgrammer, type KeyMetaFn } from './store-ops'
import { refreshCueValuesFromPresets, resolvePreset } from './preset-resolve'
import { effectiveBpm, effectiveSpeed, tapSpeedMaster, __resetSpeedTapsForTests } from './speed-masters'
import { columnFader, executorPress, selectExecutor, selectedExecutor } from './executor-actions'
import { applyPreset, clearProgrammerMeta, getProgrammerMeta, setAttributeValues } from './programmer-engine'
import {
  executeLine, getCommand, isMacroRunning, listCommands, parse, registerCommand, runMacro, setCliContext, stopMacro, type CliContext
} from '@renderer/lib/cli'
import type { ProApi } from './contracts'

function cuelist(id: string, values: Cuelist['cues'][number]['values'] = []): Cuelist {
  return {
    id, name: id, cues: [{ id: `${id}-q1`, name: 'Q1', number: 1, values, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }],
    currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false
  }
}

const featureMeta: KeyMetaFn = (_f, ch) => ({ feature: /pan|tilt/i.test(ch) ? 'position' : /red|green|blue/i.test(ch) ? 'colour' : 'intensity' })

describe('selection tools (basic)', () => {
  it('step and invert; phases spread over the active fixtures', () => {
    const all = applyMatricks(['a', 'b', 'c'], {}, null)
    expect(all.active).toEqual(['a', 'b', 'c'])
    expect([...all.phase.values()]).toEqual([0, 0.5, 1])
    expect(applyMatricks(['a', 'b', 'c'], { invert: true }, null).active).toEqual(['c', 'b', 'a'])
    expect(applyMatricks(['a', 'b', 'c'], {}, 4).active).toEqual(['b'])
    expect(applyMatricks(['a', 'b', 'c'], {}, -1).active).toEqual(['c'])
  })

  it('fans in the four align modes', () => {
    const { phase } = applyMatricks(['a', 'b', 'c'], {}, null)
    expect([...fanValues(phase, 0, 100, '<').values()]).toEqual([0, 50, 100])
    expect([...fanValues(phase, 0, 100, '>').values()]).toEqual([100, 50, 0])
    expect([...fanValues(phase, 0, 100, '<>').values()]).toEqual([0, 100, 0])
    expect([...fanValues(phase, 0, 100, '><').values()]).toEqual([100, 0, 100])
  })
})

describe('store operations (basic)', () => {
  const base = cuelist('a', [{ fixtureId: 'f', channelName: 'Dimmer', value: 10 }, { fixtureId: 'f', channelName: 'Pan', value: 20 }])
  const incoming = [{ fixtureId: 'f', channelName: 'Dimmer', value: 99 }, { fixtureId: 'f', channelName: 'Red', value: 5 }]

  it('merge / overwrite / remove, feature filter, input untouched', () => {
    const merged = storeIntoCue(base, 0, incoming, { mode: 'merge' }, featureMeta)
    expect(merged.cues[0].values).toEqual([
      { fixtureId: 'f', channelName: 'Dimmer', value: 99 }, { fixtureId: 'f', channelName: 'Pan', value: 20 }, { fixtureId: 'f', channelName: 'Red', value: 5 }
    ])
    expect(base.cues[0].values[0].value).toBe(10)
    expect(storeIntoCue(base, 0, incoming, { mode: 'overwrite' }, featureMeta).cues[0].values).toEqual(incoming)
    expect(storeIntoCue(base, 0, incoming, { mode: 'remove' }, featureMeta).cues[0].values).toEqual([{ fixtureId: 'f', channelName: 'Pan', value: 20 }])
    expect(storeIntoCue(base, 0, incoming, { mode: 'merge', filter: ['colour'] }, featureMeta).cues[0].values.map(v => v.value)).toEqual([10, 20, 5])
    expect(storeIntoCue(base, 5, incoming, { mode: 'merge' }, featureMeta)).toBe(base)
  })

  it('stores presets in the three scopes', () => {
    const patch = [patchEntry('mh1', MOVING_HEAD, 0, 1)]
    const sel = storePreset(null, 'color', [{ fixtureId: 'mh1', channelName: 'Red', value: 255 }], 'selective', patch)
    expect(sel).toMatchObject({ type: 'color', values: { mh1: { Red: 255 } } })
    expect(sel.scope).toBeUndefined()
    const glob = storePreset(sel, 'color', [{ fixtureId: 'mh1', channelName: 'Green', value: 9 }], 'global', patch)
    expect(glob).toMatchObject({ id: sel.id, scope: 'global', values: { mh1: { Red: 255 } }, typeValues: { 'test/moving-head': { Green: 9 } } })
    const uni = storePreset(null, 'color', [{ fixtureId: 'mh1', channelName: 'R', value: 7 }], 'universal', patch)
    expect(uni.universal).toEqual({ red: 7 })
  })

  it('update: preset values update their preset, others the active cue', () => {
    const preset: Preset = { id: 'p', name: 'P', type: 'color', values: { f: { Red: 1 } } }
    const res = updateFromProgrammer({
      cuelists: [base],
      presets: [preset],
      values: [{ fixtureId: 'f', channelName: 'Red', value: 200, presetId: 'p' }, { fixtureId: 'f', channelName: 'Pan', value: 77 }, { fixtureId: 'f', channelName: 'Tilt', value: 1 }],
      activeCues: [{ cuelistId: 'a', cueIndex: 0 }],
      patch: []
    })
    expect(res.presets).toBe(1)
    expect(res.cues).toBe(1)
    expect(res.presetList[0].values).toEqual({ f: { Red: 200 } })
    expect(res.cuelists[0].cues[0].values).toEqual([{ fixtureId: 'f', channelName: 'Dimmer', value: 10 }, { fixtureId: 'f', channelName: 'Pan', value: 77 }])
  })
})

describe('preset resolution', () => {
  const entry = { id: 'f', fixtureDefId: 'test/moving-head' }
  const preset: Preset = {
    id: 'p', name: 'P', type: 'color', values: { f: { Red: 1 } }, typeValues: { 'test/moving-head': { Red: 2, Green: 3 } }, universal: { blue: 4, red: 5 }
  }
  it('selective → global → universal', () => {
    expect(resolvePreset(preset, entry, undefined, 'Red')).toBe(1)
    expect(resolvePreset(preset, entry, undefined, 'Green')).toBe(3)
    expect(resolvePreset(preset, entry, undefined, 'B')).toBe(4)
    expect(resolvePreset(preset, entry, undefined, 'Pan')).toBeUndefined()
  })

  it('refreshes referenced cue values, keeping identities when nothing changes', () => {
    const patch = [{ ...patchEntry('f', MOVING_HEAD, 0, 1) }]
    const lists = [cuelist('a', [{ fixtureId: 'f', channelName: 'Green', value: 0, presetId: 'p' }]), cuelist('b')]
    const next = refreshCueValuesFromPresets(lists, [preset], patch)
    expect(next[0].cues[0].values[0].value).toBe(3)
    expect(next[1]).toBe(lists[1])
    expect(refreshCueValuesFromPresets(next, [preset], patch)).toBe(next)
    expect(refreshCueValuesFromPresets(lists, [], patch)).toBe(lists)
  })
})

describe('speed masters', () => {
  beforeEach(() => {
    usePoolStore.getState().loadPools({ speedMasters: [{ id: 's', number: 1, name: 'S', bpm: 120 }] })
    __resetSpeedTapsForTests()
  })

  it('tap tempo per master', () => {
    expect(tapSpeedMaster('s', 1000)).toBeNull()
    expect(tapSpeedMaster('s', 1500)).toBe(120)
    expect(tapSpeedMaster('s', 1900)).toBeCloseTo(133.3, 1)
    expect(usePoolStore.getState().speedMasters[0].bpm).toBeCloseTo(133.3, 1)
  })

  it('effective chase BPM / effect speed', () => {
    expect(effectiveBpm({ bpm: 90, speedMasterId: 's' })).toBe(120)
    expect(effectiveBpm({ bpm: 90 })).toBe(90)
    expect(effectiveSpeed({ speed: 1, speedMasterId: 's', speedMultiplier: 2 })).toBe(4)
    expect(effectiveSpeed({ speed: 1.5, speedMasterId: 'gone' })).toBe(1.5)
  })
})

describe('executor actions (same as the executor bar)', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      cuelists: [cuelist('a'), cuelist('b'), cuelist('c')],
      chases: [{ id: 'ch', name: 'C', steps: [{ id: 's', values: [] }], currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 120, fadePercent: 0, direction: 'forward', faderLevel: 255 }]
    })
    useEffectsStore.setState({ effects: [] })
    const ex = useExecutorStore.getState()
    ex.loadLayout({ grid: [['a', 'b', 'c']], columns: [], modes: [['toggle', 'trigger', 'flash']] })
    useExecutorStore.getState().assignCell(0, 1, 0, { kind: 'chase', id: 'ch', mode: 'toggle' })
    useProStore.setState({ selectedExecutor: null })
  })
  const playing = (id: string) => usePlaybackStore.getState().cuelists.find(c => c.id === id)!.isPlaying

  it('TOG / TRIG / FLASH scene cells', () => {
    executorPress({ page: 0, col: 0, row: 0 }, 'down')
    expect(playing('a')).toBe(true)
    executorPress({ page: 0, col: 0, row: 0 }, 'up')
    expect(playing('a')).toBe(true)
    executorPress({ page: 0, col: 0, row: 0 }, 'down')
    expect(playing('a')).toBe(false)

    executorPress({ page: 0, col: 0, row: 1 }, 'down')
    expect(playing('b')).toBe(true)
    executorPress({ page: 0, col: 0, row: 1 }, 'up')
    expect(playing('b')).toBe(false)

    executorPress({ page: 0, col: 0, row: 2 }, 'down')
    expect(usePlaybackStore.getState().cuelists[2].flash).toBe(true)
    executorPress({ page: 0, col: 0, row: 2 }, 'up')
    expect(usePlaybackStore.getState().cuelists[2].flash).toBe(false)
    expect(playing('c')).toBe(false)

    // Button function override
    executorPress({ page: 0, col: 0, row: 0 }, 'down', { fn: 'go' })
    executorPress({ page: 0, col: 0, row: 0 }, 'down', { fn: 'go' })
    expect(usePlaybackStore.getState().cuelists[0].currentCueIndex).toBe(0)
    executorPress({ page: 0, col: 0, row: 0 }, 'down', { fn: 'off' })
    expect(playing('a')).toBe(false)
    // Empty / missing cells do nothing
    executorPress({ page: 3, col: 0, row: 0 }, 'down')
    executorPress({ page: 0, col: 7, row: 3 }, 'down')
  })

  it('chase cells, select, column faders', () => {
    executorPress({ page: 0, col: 1, row: 0 }, 'down')
    expect(usePlaybackStore.getState().chases[0].isPlaying).toBe(true)
    executorPress({ page: 0, col: 0, row: 1 }, 'down', { fn: 'select' })
    expect(selectedExecutor()).toEqual({ page: 0, col: 0, row: 1 })
    expect(usePlaybackStore.getState().selectedCuelistId).toBe('b')
    expect(playing('b')).toBe(false)
    selectExecutor(null)
    expect(selectedExecutor()).toBeNull()

    columnFader(0, 0, 100)
    expect(usePlaybackStore.getState().cuelists.map(c => c.faderLevel)).toEqual([100, 100, 100])
    useExecutorStore.getState().setColumnFader(0, 1, { kind: 'grandmaster' })
    columnFader(0, 1, 64)
    expect(useDmxStore.getState().grandMaster).toBe(64)
    useDmxStore.getState().setGrandMaster(255)
  })
})

describe('programmer engine (basic)', () => {
  beforeEach(() => {
    clearProgrammer()
    clearProgrammerMeta()
    usePatchStore.setState({ fixtures: [MOVING_HEAD], patch: [patchEntry('mh1', MOVING_HEAD, 0, 1)], groups: [] })
    usePlaybackStore.setState({ presets: [{ id: 'p', name: 'Red', type: 'color', values: { mh1: { Red: 255, Green: 0 } } }] })
    useProStore.setState({ progTime: null })
  })

  it('writes fixture channels to the programmer with their meta', () => {
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Dimmer', value: 200 }, { fixtureId: 'nope', channelName: 'Dimmer', value: 1 }])
    expect(getProgrammerValue(0, 4)).toBe(200)
    expect(applyPreset('p', ['mh1'])).toBe(2)
    expect(getProgrammerValue(0, 6)).toBe(255)
    expect(getProgrammerMeta().get('mh1:Red')).toEqual({ presetId: 'p' })
    expect(getProgrammerMeta().has('mh1:Dimmer')).toBe(false)
    useProStore.getState().setProgTime({ fade: 2, delay: 0 })
    setAttributeValues([{ fixtureId: 'mh1', channelName: 'Pan', value: 10 }])
    expect(getProgrammerMeta().get('mh1:Pan')).toEqual({ fade: 2 })
    clearProgrammer()
    expect(getProgrammerMeta().size).toBe(0)
    expect(applyPreset('missing', ['mh1'])).toBe(0)
  })
})

describe('command line contract (stubs)', () => {
  beforeEach(() => {
    setCliContext(null)
    useProStore.setState({ cliLog: [] })
  })

  it('parse never throws and reports what can come next', () => {
    expect(parse('').expected.length).toBeGreaterThan(0)
    expect(parse('Fixture 1 At 50').error).toBeUndefined()
    expect(parse('Fixture 1 At').error).toBeDefined()
  })

  it('executeLine without a context says the command line is not available', () => {
    expect(executeLine('Go')).toMatchObject({ ok: false, level: 'warning' })
    expect(executeLine('  ')).toMatchObject({ ok: true })
  })

  it('registry: keywords and aliases are case-insensitive; a command that throws is an error result', () => {
    registerCommand({ keyword: 'oops', aliases: ['Undo'], helpKey: 'oops', run: () => { throw new Error('boom') } })
    expect(getCommand('OOPS')?.keyword).toBe('oops')
    expect(getCommand('undo')?.keyword).toBe('oops')
    expect(listCommands().filter(c => c.keyword === 'oops')).toHaveLength(1)
  })

  it('macros run their lines in order with waits, and can be stopped', () => {
    vi.useFakeTimers()
    try {
      const ctx: CliContext = { api: {} as ProApi, t: (k) => k, now: () => 0 }
      setCliContext(ctx)
      const m = usePoolStore.getState().addMacro({ number: 9, lines: [{ command: 'One', wait: 1 }, { command: 'Two' }] })
      expect(runMacro(9)).toBe(true)
      expect(isMacroRunning(m)).toBe(true)
      expect(runMacro(m)).toBe(false) // already running
      expect(useProStore.getState().cliLog.map(l => l.text)).toEqual(['One'])
      vi.advanceTimersByTime(1000)
      expect(useProStore.getState().cliLog.map(l => l.text)).toEqual(['One', 'Two'])
      expect(isMacroRunning(m)).toBe(false)
      runMacro(m)
      stopMacro(m)
      vi.advanceTimersByTime(2000)
      expect(useProStore.getState().cliLog.map(l => l.text)).toEqual(['One', 'Two', 'One'])
      expect(runMacro(404)).toBe(false)
    } finally {
      vi.useRealTimers()
      setCliContext(null)
    }
  })
})
