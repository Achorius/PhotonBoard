import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The UI store reads the window at import time (no DOM under node)
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import { useMidiStore, __resetMidiForTests } from '@renderer/stores/midi-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useControllerStore } from '@renderer/stores/controller-store'
import { initMidiRouting } from '@renderer/lib/midi-manager'
import { stopMidiControllers } from './index'
import { __resetControllersForTests, computeGhosts, getController } from './controller-runtime'
import { __resetFeedbackForTests, runFeedbackFrame, FadeTracker } from './midi-feedback'
import { FakeMidiAccess, installFakeWebMidi, type FakeMidiInput, type FakeMidiOutput } from './testing/fake-web-midi'
import { abletonPalette } from './palette'
import type { Cuelist } from '@shared/types'

const MK2 = 'APC mini mk2 Control'
/** pad:col:row → note on the APC mini (note 0 bottom-left) */
const pad = (col: number, row: number) => (7 - row) * 8 + col
const noteOn = (n: number) => [0x90, n, 127]
const noteOff = (n: number) => [0x80, n, 0]
const cc = (n: number, v: number) => [0xb0, n, v]

let access: FakeMidiAccess
let apc: { input: FakeMidiInput; output: FakeMidiOutput }
let sysexCalls: boolean[]

const cl = (id: string): Cuelist => usePlaybackStore.getState().cuelists.find((c) => c.id === id)!

function addScene(name: string): string {
  const pb = usePlaybackStore.getState()
  const id = pb.addCuelist(name)
  pb.addCue(id, 'Q1', [{ fixtureId: 'f', channelName: 'Dimmer', value: 255 }], 2, 2)
  return id
}

async function boot(): Promise<void> {
  const rec = installFakeWebMidi((sysex) => { access.sysexEnabled = sysex; return access })
  sysexCalls = rec.sysexCalls
  await useMidiStore.getState().initMidi()
  initMidiRouting()
  await vi.dynamicImportSettled() // the controller layer loads on demand
}

let A: string, B: string, C: string

beforeEach(() => {
  vi.useFakeTimers()
  __resetMidiForTests()
  __resetControllersForTests()
  __resetFeedbackForTests()
  useControllerStore.setState({ settings: [], detected: [], ghosts: {}, testing: null })
  useMidiStore.setState({ mappings: [], isLearning: false, learnTarget: null, devices: [] })
  usePlaybackStore.setState({ cuelists: [], chases: [], presets: [], selectedCuelistId: null, selectedChaseId: null })
  useDmxStore.setState({ grandMaster: 255, blackout: false, blinder: false, strobe: false })
  useProStore.setState({ selectedExecutor: null })
  useExecutorStore.getState().loadLayout(undefined)
  A = addScene('A')
  B = addScene('B')
  C = addScene('C')
  const ex = useExecutorStore.getState()
  ex.assignCell(0, 0, 0, { kind: 'cuelist', id: A, mode: 'toggle' })
  ex.assignCell(0, 1, 0, { kind: 'cuelist', id: B, mode: 'flash' })
  ex.assignCell(0, 2, 0, { kind: 'cuelist', id: C, mode: 'trigger' })
  access = new FakeMidiAccess()
  apc = access.addDevice(MK2)
  access.addDevice('APC mini mk2 Notes')
})

afterEach(() => {
  stopMidiControllers()
  __resetMidiForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('controller runtime (fake Web MIDI)', () => {
  it('recognises the mk2 Control port (not Notes), asks for SysEx, sends init LEDs + fader request', async () => {
    await boot()
    expect(sysexCalls).toContain(true)
    const detected = useControllerStore.getState().detected
    expect(detected).toEqual([{ port: MK2, profileId: 'akai-apc-mini-mk2', outputPort: MK2, connected: true }])
    const settings = useControllerStore.getState().settings[0]
    expect(settings).toMatchObject({ port: MK2, layout: 'executors-2pages', takeover: 'pickup', enabled: true })
    const sent = apc.output.take()
    expect(sent[0].slice(0, 5)).toEqual([0xf0, 0x47, 0x7f, 0x4f, 0x60]) // fader position request
    runFeedbackFrame()
    const leds = apc.output.take()
    // full LED state: 64 pads + 8 track + 8 scene
    expect(leds.length).toBe(80)
    const colA = useExecutorStore.getState().pages[0].columns[0].color
    expect(leds).toContainEqual([0x91, pad(0, 0), abletonPalette.nearest(colA)]) // assigned, stopped: 25 %
    expect(leds).toContainEqual([0x90, pad(0, 3), 0]) // empty
    expect(leds).toContainEqual([0x90, 100, 1]) // page 1 current
  })

  it('pad press goes through executor actions; LEDs diffed (only changes resent)', async () => {
    await boot()
    runFeedbackFrame()
    apc.output.take()
    apc.input.emit(noteOn(pad(0, 0)))
    apc.input.emit(noteOff(pad(0, 0)))
    expect(cl(A).isPlaying).toBe(true)
    runFeedbackFrame()
    const changes = apc.output.take()
    const colA = useExecutorStore.getState().pages[0].columns[0].color
    // the pad (playing / fading) and Release all, nothing else
    expect(changes).toContainEqual([0x98, pad(0, 0), abletonPalette.nearest(colA)]) // fading pulse (2 s cue)
    expect(changes.length).toBeLessThanOrEqual(3)
    runFeedbackFrame()
    expect(apc.output.take()).toEqual([])
    vi.setSystemTime(Date.now() + 5000)
    runFeedbackFrame()
    expect(apc.output.take()).toContainEqual([0x96, pad(0, 0), abletonPalette.nearest(colA)]) // playing 100 %
  })

  it('flash executor: held while pressed, released on note-off', async () => {
    await boot()
    apc.input.emit(noteOn(pad(1, 0)))
    expect(cl(B).flash).toBe(true)
    runFeedbackFrame()
    expect(apc.output.take()).toContainEqual([0x96, pad(1, 0), abletonPalette.nearest('#ffffff')])
    apc.input.emit(noteOff(pad(1, 0)))
    expect(cl(B).flash).toBe(false)
  })

  it('a user mapping on the same note overrides the profile', async () => {
    await boot()
    useMidiStore.getState().addMapping({
      name: 'Blackout on pad',
      source: { deviceName: MK2, type: 'note', channel: 1, number: pad(0, 0) },
      target: { type: 'blackout' },
      options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'toggle' }
    })
    apc.input.emit(noteOn(pad(0, 0)))
    expect(useDmxStore.getState().blackout).toBe(true)
    expect(cl(A).isPlaying).toBe(false)
    // MIDI learn: the profile stays out of the way
    useMidiStore.getState().startLearn({ type: 'cuelist_go', id: A, label: 'A' })
    apc.input.emit(noteOn(pad(1, 0)))
    expect(cl(B).flash).toBe(false)
  })

  it('unplugging releases flash, TRIG and blinder holds (nothing stuck)', async () => {
    await boot()
    apc.input.emit(noteOn(pad(1, 0))) // flash B
    apc.input.emit(noteOn(pad(2, 0))) // TRIG C
    apc.input.emit(noteOn(116)) // scene 5 = Blinder (hold)
    expect(cl(B).flash).toBe(true)
    expect(cl(C).isPlaying).toBe(true)
    expect(useDmxStore.getState().blinder).toBe(true)
    access.unplug(MK2)
    expect(cl(B).flash).toBe(false)
    expect(cl(C).isPlaying).toBe(false)
    expect(useDmxStore.getState().blinder).toBe(false)
    expect(useControllerStore.getState().detected[0].connected).toBe(false)
    expect(getController(MK2)).toBeUndefined()
  })

  it('also releases a user mapping held on an unplugged generic device', async () => {
    const dev = access.addDevice('Some Pad')
    await boot()
    useMidiStore.getState().addMapping({
      name: 'Strobe', source: { deviceName: 'Some Pad', type: 'note', channel: 1, number: 10 },
      target: { type: 'strobe' }, options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'trigger' }
    })
    dev.input.emit(noteOn(10))
    expect(useDmxStore.getState().strobe).toBe(true)
    access.unplug('Some Pad')
    expect(useDmxStore.getState().strobe).toBe(false)
  })

  it('soft takeover: a far fader picks up, ghost published meanwhile; jump mode applies at once', async () => {
    await boot()
    usePlaybackStore.getState().setCuelistFader(A, 255)
    apc.input.emit(cc(48, 0)) // fader 1 at the bottom, scene at full
    expect(cl(A).faderLevel).toBe(255)
    expect(computeGhosts()).toEqual({ '0:0': 0 })
    apc.input.emit(cc(48, 100))
    expect(cl(A).faderLevel).toBe(255)
    apc.input.emit(cc(48, 126)) // within tolerance → picked up
    expect(cl(A).faderLevel).toBe(253)
    apc.input.emit(cc(48, 64))
    expect(cl(A).faderLevel).toBe(129)
    expect(computeGhosts()).toEqual({})
    // page change re-arms
    const ex = useExecutorStore.getState()
    ex.addPage()
    ex.setPage(1)
    ex.setPage(0)
    usePlaybackStore.getState().setCuelistFader(A, 0)
    apc.input.emit(cc(48, 70))
    expect(cl(A).faderLevel).toBe(0)
    // jump mode
    useControllerStore.getState().updateSettings(MK2, { takeover: 'jump' })
    apc.input.emit(cc(48, 127))
    expect(cl(A).faderLevel).toBe(255)
  })

  it('fader positions reply: faders already in place are synced at connect', async () => {
    await boot()
    usePlaybackStore.getState().setCuelistFader(A, 255)
    useDmxStore.getState().setGrandMaster(0)
    apc.input.emit([0xf0, 0x47, 0x7f, 0x4f, 0x61, 0x00, 0x09, 127, 0, 0, 0, 0, 0, 0, 0, 90, 0xf7])
    apc.input.emit(cc(48, 120)) // synced: applies
    expect(cl(A).faderLevel).toBe(241)
    // faders 2-3 down while their scenes are full; GM fader up while the GM is at 0
    expect(computeGhosts()).toEqual({ '0:1': 0, '0:2': 0, gm: 181 })
    apc.input.emit(cc(56, 80)) // GM fader moves down, still above 0: no pickup
    expect(useDmxStore.getState().grandMaster).toBe(0)
  })

  it('shift + pad selects the GO target; GO / Back scene buttons act on it; page buttons', async () => {
    await boot()
    apc.input.emit(noteOn(122)) // shift
    apc.input.emit(noteOn(pad(0, 0)))
    apc.input.emit(noteOff(pad(0, 0)))
    apc.input.emit(noteOff(122))
    expect(useProStore.getState().selectedExecutor).toEqual({ page: 0, col: 0, row: 0 })
    expect(cl(A).isPlaying).toBe(false)
    apc.input.emit(noteOn(112)) // GO
    expect(cl(A).isPlaying).toBe(true)
    useExecutorStore.getState().addPage()
    apc.input.emit(noteOn(101)) // track 2 → page 2
    expect(useExecutorStore.getState().currentPage).toBe(1)
    apc.input.emit(noteOn(122))
    apc.input.emit(noteOn(100)) // shift + track 1 = page −
    expect(useExecutorStore.getState().currentPage).toBe(0)
  })

  it('disabling the profile releases it and leaves the device to user mappings', async () => {
    await boot()
    apc.output.take()
    useControllerStore.getState().updateSettings(MK2, { enabled: false })
    expect(getController(MK2)).toBeUndefined()
    const off = apc.output.take()
    expect(off.every((m) => m[2] === 0)).toBe(true)
    apc.input.emit(noteOn(pad(0, 0)))
    expect(cl(A).isPlaying).toBe(false)
  })

  it('a hand-mapped device starts with its profile off', async () => {
    useMidiStore.setState({
      mappings: [{
        id: 'x', name: 'x', source: { deviceName: MK2, type: 'cc', channel: 1, number: 48 }, target: { type: 'master' },
        options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct' }
      }]
    })
    await boot()
    expect(useControllerStore.getState().settings[0].enabled).toBe(false)
  })

  it('user mapping feedback (options.feedback) is echoed to the device', async () => {
    const dev = access.addDevice('Some Pad')
    await boot()
    useMidiStore.getState().addMapping({
      name: 'GO A', source: { deviceName: 'Some Pad', type: 'note', channel: 1, number: 5 },
      target: { type: 'cuelist_go', id: A },
      options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'toggle', feedback: 'note' } as never
    })
    runFeedbackFrame()
    expect(dev.output.take()).toEqual([[0x90, 5, 0]])
    usePlaybackStore.getState().goCuelist(A)
    runFeedbackFrame()
    expect(dev.output.take()).toEqual([[0x90, 5, 127]])
    runFeedbackFrame()
    expect(dev.output.take()).toEqual([])
  })

  it('test LEDs cycles every pad, then resends the real state', async () => {
    await boot()
    runFeedbackFrame()
    apc.output.take()
    const { testControllerLeds } = await import('./controller-runtime')
    testControllerLeds(MK2)
    expect(useControllerStore.getState().testing).toBe(MK2)
    runFeedbackFrame()
    const frame = apc.output.take()
    expect(frame.filter((m) => m[1] < 64).length).toBe(64)
    vi.setSystemTime(Date.now() + 4000)
    runFeedbackFrame()
    expect(useControllerStore.getState().testing).toBeNull()
    expect(apc.output.take().length).toBe(80)
  })
})

describe('fade tracker', () => {
  it('a GO opens a window of delay + fade / rate', () => {
    const t = new FadeTracker()
    const base = { id: 'a', name: 'a', isLooping: false, priority: 50, faderLevel: 255, flash: false }
    const cues = [{ id: 'q', name: 'q', values: [], fadeIn: 2, fadeOut: 1, delay: 1 }] as unknown as Cuelist['cues']
    t.observe([{ ...base, cues, currentCueIndex: 0, isPlaying: true, goGeneration: 1, rate: 2 }], 1000)
    expect(t.isFading('a', 2000)).toBe(true)
    expect(t.isFading('a', 2600)).toBe(false) // (1 + 2) / 2 = 1.5 s
    t.observe([{ ...base, cues, currentCueIndex: 0, isPlaying: true, goGeneration: 1, rate: 2 }], 3000)
    expect(t.isFading('a', 3001)).toBe(false) // same GO
    t.observe([{ ...base, cues, currentCueIndex: 0, isPlaying: false, goGeneration: 1 }], 3000)
    expect(t.anyFading(3001)).toBe(false)
  })
})
