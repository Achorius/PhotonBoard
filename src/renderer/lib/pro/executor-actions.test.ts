// Golden tests of the WP3 executor button functions (pause, swap, learn,
// fired-from) and column fader functions (column level, speed, rate,
// x-fade). Basic TOG / TRIG / FLASH behaviour: pro.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})

const clock = vi.hoisted(() => ({ now: 1000 }))
vi.mock('@renderer/lib/runtime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@renderer/lib/runtime')>()
  return { ...mod, clockNow: () => clock.now }
})

import type { Cuelist, Effect } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { runMixerFrame } from '@renderer/lib/dmx-mixer'
import { isEffectPaused, stopAllEffects } from '@renderer/lib/effect-engine'
import {
  LAYER_SWAP, getColumnLevel, getRuntimeRate, isChasePaused, isCuelistPaused, resetPlayback, setColumnLevel,
  setLayerFlagsHandler, startPlaybackController
} from '@renderer/lib/playback-controller'
import { columnFader, executorPress, learnExecutor } from './executor-actions'

function cuelist(id: string, fadeIn = 0): Cuelist {
  return {
    id, name: `Scene ${id}`,
    cues: [
      { id: `${id}1`, name: 'Q1', number: 1, values: [{ fixtureId: 'x', channelName: 'Gobo', value: 100 }], fadeIn, fadeOut: 0, delay: 0, followTime: null },
      { id: `${id}2`, name: 'Q2', number: 2, values: [{ fixtureId: 'x', channelName: 'Gobo', value: 0 }], fadeIn, fadeOut: 0, delay: 0, followTime: null }
    ],
    currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false
  }
}

const effect: Effect = { id: 'fx', name: 'FX', waveform: 'sine', speed: 1, depth: 100, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0, isRunning: false }

const pb = () => usePlaybackStore.getState()
const frame = (t: number) => { clock.now = t; runMixerFrame(t) }
let stop: (() => void) | null = null

beforeAll(() => { stop = startPlaybackController() })
afterAll(() => stop?.())

beforeEach(() => {
  clock.now += 10_000
  usePlaybackStore.setState({
    cuelists: [cuelist('a', 2), cuelist('b'), cuelist('c')],
    chases: [{ id: 'ch', name: 'Chase', steps: [{ id: 's', values: [] }], currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 120, fadePercent: 0, direction: 'forward', faderLevel: 255 }]
  })
  useEffectsStore.setState({ effects: [effect] })
  usePoolStore.setState({ speedMasters: [{ id: 'sm', number: 1, name: 'SM', bpm: 100 }], groupMasters: {} })
  const ex = useExecutorStore.getState()
  ex.loadLayout({ grid: [['a', 'b', 'c']], columns: [], modes: [['toggle', 'toggle', 'toggle']] })
  ex.assignCell(0, 1, 0, { kind: 'chase', id: 'ch', mode: 'toggle' })
  ex.assignCell(0, 1, 1, { kind: 'effect', id: 'fx', mode: 'toggle' })
  ex.assignCell(0, 1, 2, { kind: 'group', id: 'g1', mode: 'toggle' })
  ex.assignCell(0, 1, 3, { kind: 'macro', id: 'm1', mode: 'toggle' })
})

afterEach(() => {
  pb().releaseAll()
  frame(clock.now + 1)
  resetPlayback()
  stopAllEffects()
  setLayerFlagsHandler(null)
  for (let c = 0; c < 8; c++) setColumnLevel(0, c, 255)
  useMidiStore.getState().cancelLearn()
})

describe('button functions', () => {
  it('pause: pauses / resumes the running fade of a scene', () => {
    executorPress({ page: 0, col: 0, row: 0 }, 'down')
    frame(clock.now + 500)
    executorPress({ page: 0, col: 0, row: 0 }, 'down', { fn: 'pause' })
    expect(isCuelistPaused('a')).toBe(true)
    expect(pb().cuelists[0].isPlaying).toBe(true)
    executorPress({ page: 0, col: 0, row: 0 }, 'up', { fn: 'pause' }) // release does nothing
    expect(isCuelistPaused('a')).toBe(true)
    executorPress({ page: 0, col: 0, row: 0 }, 'down', { fn: 'pause' })
    expect(isCuelistPaused('a')).toBe(false)
  })

  it('pause: chases hold their step, effects their phase', () => {
    executorPress({ page: 0, col: 1, row: 0 }, 'down')
    frame(clock.now)
    executorPress({ page: 0, col: 1, row: 0 }, 'down', { fn: 'pause' })
    expect(isChasePaused('ch')).toBe(true)
    executorPress({ page: 0, col: 1, row: 1 }, 'down')
    executorPress({ page: 0, col: 1, row: 1 }, 'down', { fn: 'pause' })
    expect(isEffectPaused('fx')).toBe(true)
    executorPress({ page: 0, col: 1, row: 1 }, 'down', { fn: 'pause' })
    expect(isEffectPaused('fx')).toBe(false)
  })

  it('swap: flash while held with the swap flag on the layer', () => {
    const calls: [string, number][] = []
    setLayerFlagsHandler((id, flags) => calls.push([id, flags]))
    executorPress({ page: 0, col: 0, row: 1 }, 'down', { fn: 'swap' })
    expect(pb().cuelists[1].flash).toBe(true)
    frame(clock.now)
    expect(calls).toContainEqual(['cuelist_b', LAYER_SWAP])
    executorPress({ page: 0, col: 0, row: 1 }, 'up', { fn: 'swap' })
    expect(pb().cuelists[1].flash).toBe(false)
    expect(pb().cuelists[1].isPlaying).toBe(false)
  })

  it('learn: MIDI learn for the executor (scene GO with its mode, chase / effect toggle)', () => {
    useExecutorStore.getState().setMode(0, 1, 'flash')
    executorPress({ page: 0, col: 0, row: 1 }, 'down', { fn: 'learn' })
    expect(useMidiStore.getState().isLearning).toBe(true)
    expect(useMidiStore.getState().learnTarget).toMatchObject({ type: 'cuelist_go', id: 'b', label: 'Scene b', behavior: 'flash' })
    expect(pb().cuelists[1].isPlaying).toBe(false)
    useExecutorStore.getState().setCellButton(0, 1, 0, 'learn')
    executorPress({ page: 0, col: 1, row: 0 }, 'down')
    expect(useMidiStore.getState().learnTarget).toMatchObject({ type: 'chase_toggle', id: 'ch' })
    expect(learnExecutor({ page: 0, col: 1, row: 1 })).toBe(true)
    expect(useMidiStore.getState().learnTarget).toMatchObject({ type: 'effect_toggle', id: 'fx' })
    expect(learnExecutor({ page: 0, col: 1, row: 3 })).toBe(false) // macros: nothing to learn
    expect(learnExecutor({ page: 0, col: 5, row: 3 })).toBe(false)
  })
})

describe('column faders', () => {
  it("'column' (default): the column level, scene faders untouched; group cells get it as group master", () => {
    columnFader(0, 0, 77)
    expect(getColumnLevel(0, 0)).toBe(77)
    expect(pb().cuelists.map(c => c.faderLevel)).toEqual([255, 255, 255])
    columnFader(0, 1, 90)
    expect(usePoolStore.getState().groupMasters.g1).toBe(90)
  })

  it("'cell': the fader of one cell", () => {
    useExecutorStore.getState().setColumnFader(0, 0, { kind: 'cell', row: 2 })
    columnFader(0, 0, 40)
    expect(pb().cuelists.map(c => c.faderLevel)).toEqual([255, 255, 40])
    expect(getColumnLevel(0, 0)).toBe(255)
  })

  it("'speed': the speed master BPM (0 → 1 BPM, full → 240 BPM)", () => {
    useExecutorStore.getState().setColumnFader(0, 2, { kind: 'speed', id: 'sm' })
    columnFader(0, 2, 255)
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(240)
    columnFader(0, 2, 128)
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(120)
    columnFader(0, 2, 0)
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(1)
  })

  it("'rate': runtime rate of the scene / chase of a row (centre = 1×)", () => {
    useExecutorStore.getState().setColumnFader(0, 0, { kind: 'rate', row: 1 })
    columnFader(0, 0, 255)
    expect(getRuntimeRate('cuelist', 'b')).toBe(4)
    columnFader(0, 0, 128)
    expect(getRuntimeRate('cuelist', 'b')).toBe(1)
    columnFader(0, 0, 0)
    expect(getRuntimeRate('cuelist', 'b')).toBe(0.25)
    useExecutorStore.getState().setColumnFader(0, 1, { kind: 'rate', row: 0 })
    columnFader(0, 1, 255)
    expect(getRuntimeRate('chase', 'ch')).toBe(4)
  })

  it("'xfade': moving the fader runs the scene's crossfade", () => {
    useExecutorStore.getState().setColumnFader(0, 0, { kind: 'xfade', row: 0 })
    columnFader(0, 0, 0)
    expect(pb().cuelists[0].isPlaying).toBe(false)
    columnFader(0, 0, 100)
    expect(pb().cuelists[0].isPlaying).toBe(true)
    expect(pb().cuelists[0].currentCueIndex).toBe(0)
  })
})
