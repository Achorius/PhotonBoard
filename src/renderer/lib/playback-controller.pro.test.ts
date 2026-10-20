// Golden tests of the pro playback-controller features, through the
// real stores, engines and mixer (clock mocked): rate, follow after-GO,
// pause, live preset update, layer flags, column levels, speed masters,
// manual X-fade, Move-In-Black, tracking off, per-feature timing.
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
vi.mock('./runtime', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./runtime')>()
  return { ...mod, clockNow: () => clock.now }
})

import type { Cue, CueChannelValue, Cuelist, Chase, Preset } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { DIMMER, MOVING_HEAD, patchEntry } from './testing/test-fixtures'
import { getMixValue, runMixerFrame } from './dmx-mixer'
import {
  LAYER_SUPER, LAYER_SWAP, crossfadeFader, cuelistLayerFlags, getColumnLevel, isCuelistPaused, noteFiredFrom,
  pauseChase, pauseCuelist, resetPlayback, setColumnLevel, setLayerFlagsHandler, setRuntimeRate, setSwapHold,
  startPlaybackController, changedPresetIds
} from './playback-controller'

// mh1 @ 1: Pan 0, Pan Fine 1, Tilt 2, Tilt Fine 3, Dimmer 4, Shutter 5, Red 6, Green 7, Blue 8, CW 9, Gobo 10 · d1 @ 20
const PAN = 0
const DIM = 4
const RED = 6
const GOBO = 10
const D1 = 19

function v(fixtureId: string, channelName: string, value: number, extra: Partial<CueChannelValue> = {}): CueChannelValue {
  return { fixtureId, channelName, value, ...extra }
}

function cue(n: number, values: CueChannelValue[], t: Partial<Cue> = {}): Cue {
  return { id: `q${n}`, name: `Q${n}`, number: n, values, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null, ...t }
}

function cuelist(id: string, cues: Cue[], extra: Partial<Cuelist> = {}): Cuelist {
  return { id, name: id, cues, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...extra }
}

function frame(t: number): void {
  clock.now = t
  runMixerFrame(t)
}

const mix = (ch: number) => getMixValue(0, ch)
const pb = () => usePlaybackStore.getState()
const cl = (id: string) => pb().cuelists.find(c => c.id === id)!

let stop: (() => void) | null = null
let T = 10_000

beforeAll(() => {
  usePatchStore.setState({ fixtures: [MOVING_HEAD, DIMMER], patch: [patchEntry('mh1', MOVING_HEAD, 0, 1), patchEntry('d1', DIMMER, 0, 20)], groups: [] })
  usePlaybackStore.setState({ cuelists: [], chases: [], presets: [] })
  stop = startPlaybackController()
})

afterAll(() => {
  stop?.()
})

beforeEach(() => {
  T += 100_000
  clock.now = T
})

afterEach(() => {
  pb().releaseAll()
  frame(clock.now + 1)
  usePlaybackStore.setState({ cuelists: [], chases: [], presets: [] })
  resetPlayback()
  setLayerFlagsHandler(null)
  frame(clock.now + 1)
})

function start(list: Cuelist): void {
  usePlaybackStore.setState({ cuelists: [list] })
  pb().goCuelist(list.id)
}

describe('timing', () => {
  it('the cuelist rate divides the cue times', () => {
    start(cuelist('a', [cue(1, [v('mh1', 'Gobo', 200)], { fadeIn: 2 })], { rate: 2 }))
    frame(T + 500)
    expect(mix(GOBO)).toBe(100)
    frame(T + 1000)
    expect(mix(GOBO)).toBe(200)
  })

  it('a runtime rate (rate fader) multiplies the cuelist rate', () => {
    setRuntimeRate('cuelist', 'a', 2)
    start(cuelist('a', [cue(1, [v('mh1', 'Gobo', 200)], { fadeIn: 4 })], { rate: 2 }))
    frame(T + 500)
    expect(mix(GOBO)).toBe(100)
  })

  it('per-feature timing comes from the patch (colour snaps, beam fades)', () => {
    start(cuelist('a', [cue(1, [v('mh1', 'Gobo', 200), v('mh1', 'Red', 200)], { fadeIn: 2, featureTiming: { colour: { fade: 0 } } })]))
    frame(T + 1000)
    expect(mix(RED)).toBe(200)
    expect(mix(GOBO)).toBe(100)
  })

  it("follow 'after-go' counts from the GO, not the end of the fade", () => {
    start(cuelist('a', [
      cue(1, [v('mh1', 'Gobo', 200)], { fadeIn: 2, followTime: 0.5, followMode: 'after-go' }),
      cue(2, [v('mh1', 'Gobo', 0)], { fadeIn: 2 })
    ]))
    frame(T + 400)
    expect(cl('a').currentCueIndex).toBe(0)
    frame(T + 500)
    expect(cl('a').currentCueIndex).toBe(1)
  })

  it("follow 'after-fade' (default) still waits for the fade, divided by the rate", () => {
    start(cuelist('a', [
      cue(1, [v('mh1', 'Gobo', 200)], { fadeIn: 2, followTime: 1 }),
      cue(2, [v('mh1', 'Gobo', 0)])
    ], { rate: 2 }))
    frame(T + 1000) // fade done (2 s / 2)
    frame(T + 1400)
    expect(cl('a').currentCueIndex).toBe(0)
    frame(T + 1500) // + follow 1 s / 2
    expect(cl('a').currentCueIndex).toBe(1)
  })
})

describe('pause / resume', () => {
  it('pauses a running fade and resumes it where it stopped', () => {
    start(cuelist('a', [cue(1, [v('mh1', 'Gobo', 200)], { fadeIn: 2 })]))
    frame(T + 1000)
    expect(mix(GOBO)).toBe(100)
    expect(pauseCuelist('a', undefined, T + 1000)).toBe(true)
    expect(isCuelistPaused('a')).toBe(true)
    frame(T + 3000)
    expect(mix(GOBO)).toBe(100)
    expect(pauseCuelist('a', undefined, T + 3000)).toBe(false)
    frame(T + 3500)
    expect(mix(GOBO)).toBe(169)
    frame(T + 4000)
    expect(mix(GOBO)).toBe(200)
  })

  it('a pending follow waits while paused', () => {
    start(cuelist('a', [cue(1, [v('d1', 'Intensity', 255)], { followTime: 1 }), cue(2, [v('d1', 'Intensity', 10)])]))
    frame(T) // complete → follow due at T + 1000
    pauseCuelist('a', true, T + 200)
    frame(T + 3000)
    expect(cl('a').currentCueIndex).toBe(0)
    pauseCuelist('a', false, T + 3000)
    frame(T + 3700)
    expect(cl('a').currentCueIndex).toBe(0)
    frame(T + 3800)
    expect(cl('a').currentCueIndex).toBe(1)
    expect(isCuelistPaused('a')).toBe(false)
  })

  it('a stopped cuelist cannot be paused', () => {
    usePlaybackStore.setState({ cuelists: [cuelist('a', [cue(1, [])])] })
    expect(pauseCuelist('a')).toBe(false)
  })
})

describe('presets', () => {
  const preset = (red: number): Preset => ({ id: 'p', name: 'Red', type: 'color', values: { mh1: { Red: red } } })

  it('preset references resolve at GO time', () => {
    usePlaybackStore.setState({ presets: [preset(100)] })
    start(cuelist('a', [cue(1, [v('mh1', 'Red', 10, { presetId: 'p' })])]))
    frame(T)
    expect(mix(RED)).toBe(100)
  })

  it('live update: a playing cuelist follows a preset edit at once', () => {
    usePlaybackStore.setState({ presets: [preset(100)] })
    start(cuelist('a', [cue(1, [v('mh1', 'Red', 100, { presetId: 'p' }), v('mh1', 'Gobo', 5)])]))
    frame(T)
    usePlaybackStore.setState({ presets: [preset(250)] })
    frame(T + 1)
    expect(mix(RED)).toBe(250)
    expect(mix(GOBO)).toBe(5)
  })

  it('live update during a fade heads the fade to the new value', () => {
    usePlaybackStore.setState({ presets: [preset(100)] })
    start(cuelist('a', [cue(1, [v('mh1', 'Red', 100, { presetId: 'p' })], { fadeIn: 2 })]))
    frame(T + 1000)
    expect(mix(RED)).toBe(50)
    usePlaybackStore.setState({ presets: [preset(200)] })
    frame(T + 1000)
    expect(mix(RED)).toBe(100)
    frame(T + 2000)
    expect(mix(RED)).toBe(200)
  })

  it('changedPresetIds: edited, added and removed presets', () => {
    const a = preset(1)
    const b = { ...preset(2), id: 'b' }
    expect([...changedPresetIds([a, b], [a, b])]).toEqual([])
    expect([...changedPresetIds([{ ...a }, b], [a, b])]).toEqual(['p'])
    expect([...changedPresetIds([a], [a, b])]).toEqual(['b'])
  })
})

describe('mixer layer flags', () => {
  it('swap / super priority modes and the held swap button', () => {
    expect(cuelistLayerFlags({})).toBe(0)
    expect(cuelistLayerFlags({ priorityMode: 'normal' })).toBe(0)
    expect(cuelistLayerFlags({ priorityMode: 'swap' })).toBe(LAYER_SWAP)
    expect(cuelistLayerFlags({ priorityMode: 'super' })).toBe(LAYER_SUPER)
    expect(cuelistLayerFlags({ priorityMode: 'super' }, true)).toBe(LAYER_SUPER | LAYER_SWAP)
  })

  it('are sent for pro cuelists only, re-sent when the swap button is held / released', () => {
    const calls: [string, number][] = []
    setLayerFlagsHandler((id, flags) => calls.push([id, flags]))
    usePlaybackStore.setState({ cuelists: [cuelist('plain', [cue(1, [v('d1', 'Intensity', 255)])])] })
    pb().goCuelist('plain')
    frame(T)
    expect(calls).toEqual([])

    usePlaybackStore.setState({ cuelists: [...pb().cuelists, cuelist('sup', [cue(1, [v('mh1', 'Dimmer', 255)])], { priorityMode: 'super' })] })
    pb().goCuelist('sup')
    frame(T + 1)
    expect(calls).toContainEqual(['cuelist_sup', LAYER_SUPER])

    calls.length = 0
    setSwapHold('plain', true)
    expect(calls).toEqual([['cuelist_plain', LAYER_SWAP]])
    setSwapHold('plain', false)
    expect(calls).toEqual([['cuelist_plain', LAYER_SWAP], ['cuelist_plain', 0]])
  })
})

describe('column levels (effective master)', () => {
  beforeEach(() => {
    useExecutorStore.getState().loadLayout({ grid: [['a'], ['b']], columns: [], modes: [['toggle'], ['toggle']] })
  })
  afterEach(() => {
    setColumnLevel(0, 0, 255)
    setColumnLevel(0, 1, 255)
  })

  it('fader × column level / 255, for the column the scene sits in or was fired from', () => {
    usePlaybackStore.setState({ cuelists: [cuelist('a', [cue(1, [v('d1', 'Intensity', 255)])], { faderLevel: 200 })] })
    pb().goCuelist('a')
    frame(T)
    expect(mix(D1)).toBe(200)
    setColumnLevel(0, 0, 128)
    expect(getColumnLevel(0, 0)).toBe(128)
    frame(T + 1)
    expect(mix(D1)).toBe(100)
    setColumnLevel(0, 1, 0) // another column: no effect…
    frame(T + 2)
    expect(mix(D1)).toBe(100)
    noteFiredFrom('cuelist', 'a', { page: 0, col: 1, row: 0 }) // …but that cell holds 'b', not 'a': ignored
    frame(T + 3)
    expect(mix(D1)).toBe(100)
  })

  it('a flash ignores the column level; a column with another fader function does not scale', () => {
    usePlaybackStore.setState({ cuelists: [cuelist('a', [cue(1, [v('d1', 'Intensity', 255)])], { faderLevel: 100 })] })
    setColumnLevel(0, 0, 0)
    pb().goCuelist('a')
    frame(T)
    expect(mix(D1)).toBe(0)
    pb().flashCuelist('a', true)
    frame(T + 1)
    expect(mix(D1)).toBe(255)
    pb().flashCuelist('a', false)
    useExecutorStore.getState().setColumnFader(0, 0, { kind: 'grandmaster' })
    frame(T + 2)
    expect(mix(D1)).toBe(100)
  })

  it('scales chases too', () => {
    const chase: Chase = { id: 'ch', name: 'C', steps: [{ id: 's', values: [v('d1', 'Intensity', 255)] }], currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 60, fadePercent: 0, direction: 'forward', faderLevel: 255 }
    usePlaybackStore.setState({ chases: [chase] })
    useExecutorStore.getState().assignCell(0, 1, 0, { kind: 'chase', id: 'ch', mode: 'toggle' })
    setColumnLevel(0, 1, 51)
    pb().toggleChase('ch', true)
    frame(T)
    expect(mix(D1)).toBe(51)
  })
})

describe('speed masters', () => {
  afterEach(() => usePoolStore.setState({ speedMasters: [] }))

  it('a chase follows its speed master without jumping steps; pause holds the step', () => {
    usePoolStore.setState({ speedMasters: [{ id: 's', number: 1, name: 'S', bpm: 120 }] })
    const chase: Chase = {
      id: 'ch', name: 'C', currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 30, fadePercent: 0, direction: 'forward', faderLevel: 255,
      speedMasterId: 's',
      steps: [{ id: 's1', values: [v('d1', 'Intensity', 10)] }, { id: 's2', values: [v('d1', 'Intensity', 20)] }, { id: 's3', values: [v('d1', 'Intensity', 30)] }]
    }
    usePlaybackStore.setState({ chases: [chase] })
    pb().toggleChase('ch', true)
    frame(T)
    frame(T + 499)
    expect(mix(D1)).toBe(10)
    frame(T + 500) // 120 BPM = 500 ms a step (not 2 s at 30 BPM)
    expect(mix(D1)).toBe(20)
    expect(pb().chases[0].currentStepIndex).toBe(1)
    frame(T + 750) // halfway through step 2
    usePoolStore.getState().setSpeedMasterBpm('s', 60)
    frame(T + 751)
    expect(mix(D1)).toBe(20) // no jump
    frame(T + 1249) // half a step left = 500 ms at 60 BPM
    expect(mix(D1)).toBe(20)
    frame(T + 1251)
    expect(mix(D1)).toBe(30)
    pauseChase('ch', true)
    frame(T + 9000)
    expect(mix(D1)).toBe(30)
    pauseChase('ch', false)
  })
})

describe('manual X-fade', () => {
  it('the fader drives the crossfade; reaching the end completes the cue', () => {
    usePlaybackStore.setState({ cuelists: [cuelist('a', [cue(1, [v('mh1', 'Gobo', 200)], { fadeIn: 3 }), cue(2, [v('mh1', 'Gobo', 0)], { fadeIn: 3 })])] })
    crossfadeFader('a', 0) // where the fader rests
    crossfadeFader('a', 0)
    expect(cl('a').isPlaying).toBe(false)
    crossfadeFader('a', 128) // moved up from 0: GO, half way
    expect(cl('a').currentCueIndex).toBe(0)
    frame(T + 60_000) // the clock does not finish it
    expect(mix(GOBO)).toBe(101)
    crossfadeFader('a', 255)
    frame(T + 60_001)
    expect(mix(GOBO)).toBe(200)
    crossfadeFader('a', 64) // moved down from the top: GO next cue, 3/4 of the way already
    expect(cl('a').currentCueIndex).toBe(1)
    frame(T + 60_002)
    expect(mix(GOBO)).toBe(31)
    crossfadeFader('a', 0)
    frame(T + 60_003)
    expect(mix(GOBO)).toBe(0)
  })
})

describe('sequence options', () => {
  it('tracking off: values of earlier cues do not track', () => {
    const cues = [cue(1, [v('mh1', 'Dimmer', 255), v('d1', 'Intensity', 255)]), cue(2, [v('d1', 'Intensity', 128)])]
    start(cuelist('a', cues, { tracking: false }))
    frame(T)
    pb().goCuelist('a')
    frame(T + 1)
    expect(mix(DIM)).toBe(0)
    expect(mix(D1)).toBe(128)
    usePlaybackStore.setState({ cuelists: [cuelist('b', cues)] })
    resetPlayback()
    pb().goCuelist('b')
    frame(T + 2)
    pb().goCuelist('b')
    frame(T + 3)
    expect(mix(DIM)).toBe(255) // tracking (default)
  })

  it('Move-In-Black pre-positions a dark fixture after its fade-out', () => {
    const cues = [
      cue(1, [v('mh1', 'Dimmer', 255), v('mh1', 'Pan', 10)]),
      cue(2, [v('mh1', 'Dimmer', 0)], { fadeOut: 1 }),
      cue(3, [v('mh1', 'Dimmer', 255), v('mh1', 'Pan', 200)])
    ]
    start(cuelist('a', cues, { mib: { enabled: true, delay: 0.5, fade: 0 } }))
    frame(T)
    expect(mix(PAN)).toBe(10)
    pb().goCuelist('a')
    frame(T + 500)
    expect(mix(PAN)).toBe(10) // still fading out
    frame(T + 1400)
    expect(mix(PAN)).toBe(10) // dark, MIB delay
    frame(T + 1500)
    expect(mix(PAN)).toBe(200) // moved in black
    expect(mix(DIM)).toBe(0)
    pb().goCuelist('a')
    frame(T + 1501)
    expect(mix(PAN)).toBe(200)
    expect(mix(DIM)).toBe(255)
  })

  it('MIB disabled: no pre-positioning', () => {
    const cues = [
      cue(1, [v('mh1', 'Dimmer', 255), v('mh1', 'Pan', 10)]),
      cue(2, [v('mh1', 'Dimmer', 0)]),
      cue(3, [v('mh1', 'Dimmer', 255), v('mh1', 'Pan', 200)])
    ]
    start(cuelist('a', cues, { mib: { enabled: false, delay: 0, fade: 0 } }))
    frame(T)
    pb().goCuelist('a')
    frame(T + 5000)
    expect(mix(PAN)).toBe(10)
  })
})
