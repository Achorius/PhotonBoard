// Field bugs of 1.1.0 on the Raspberry Pi (APC mini mk2 under Linux / ALSA):
// MIDI learn of the Grand Master on a profile fader, the profile's own GM
// fader, port names that differ between systems, hotplug without rescan,
// Web MIDI failing / hanging at boot.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import {
  useMidiStore, __resetMidiForTests, LEARN_CAPTURE_MS, MIDI_RESCAN_MS, MIDI_RETRY_MS, MIDI_ACCESS_TIMEOUT_MS
} from '@renderer/stores/midi-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useControllerStore } from '@renderer/stores/controller-store'
import { useToastStore } from '@renderer/stores/toast-store'
import { initMidiRouting } from '@renderer/lib/midi-manager'
import { detectCcEncoding, sameMidiPort } from '@renderer/lib/midi-learn'
import { stopMidiControllers } from './index'
import { __resetControllersForTests, computeGhosts } from './controller-runtime'
import { __resetFeedbackForTests } from './midi-feedback'
import { FakeMidiAccess, installFakeWebMidi, type FakeMidiInput } from './testing/fake-web-midi'

/** The mk2 ports as Chromium names them on Linux (ALSA: client name + port name, cut at 32 chars) */
const LINUX_MK2 = 'APC mini mk2 APC mini mk2 Contro'
const LINUX_MK2_NOTES = 'APC mini mk2 APC mini mk2 Notes'
const cc = (n: number, v: number) => [0xb0, n, v]
const gm = () => useDmxStore.getState().grandMaster

let access: FakeMidiAccess

async function boot(): Promise<void> {
  installFakeWebMidi((sysex) => { access.sysexEnabled = sysex; return access })
  initMidiRouting()
  await vi.dynamicImportSettled() // the controller layer loads on demand
  await useMidiStore.getState().initMidi()
}

function sweep(input: FakeMidiInput, number: number, values: number[]): void {
  for (const v of values) input.emit(cc(number, v))
}

beforeEach(() => {
  vi.useFakeTimers()
  __resetMidiForTests()
  __resetControllersForTests()
  __resetFeedbackForTests()
  useControllerStore.setState({ settings: [], detected: [], ghosts: {}, testing: null })
  useMidiStore.setState({ mappings: [], isLearning: false, learnTarget: null, devices: [], apiStatus: 'pending', apiError: null })
  useDmxStore.setState({ grandMaster: 255, blackout: false, blinder: false, strobe: false })
  useToastStore.setState({ toasts: [] })
  access = new FakeMidiAccess()
})

afterEach(() => {
  stopMidiControllers()
  __resetMidiForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MIDI learn of the Grand Master on an APC mini mk2 fader (Linux port names)', () => {
  it('fader pushed to its stop during learn is learned ABSOLUTE and drives the GM at once (profile on)', async () => {
    const apc = access.addDevice(LINUX_MK2)
    access.addDevice(LINUX_MK2_NOTES)
    await boot()
    expect(useControllerStore.getState().detected.map((d) => d.port)).toEqual([LINUX_MK2])
    expect(useControllerStore.getState().settings[0].enabled).toBe(true)

    useMidiStore.getState().startLearn({ type: 'master', label: 'GM' })
    sweep(apc.input, 56, [120, 124, 127, 127]) // end-stop repeat: looked like an encoder before 1.1.1
    vi.advanceTimersByTime(LEARN_CAPTURE_MS + 1)
    const [m] = useMidiStore.getState().mappings
    expect(m).toMatchObject({ source: { deviceName: LINUX_MK2, type: 'cc', channel: 1, number: 56 }, target: { type: 'master' } })
    expect(m.options.encoding).toBe('absolute')

    // No pickup for a user mapping: the GM follows the fader immediately
    apc.input.emit(cc(56, 0))
    expect(gm()).toBe(0)
    apc.input.emit(cc(56, 64))
    expect(gm()).toBe(129)
    apc.input.emit(cc(56, 127))
    expect(gm()).toBe(255)
  })

  it('a slow move with a repeated value in the middle is still absolute on a profile fader', async () => {
    const apc = access.addDevice(LINUX_MK2)
    await boot()
    useMidiStore.getState().startLearn({ type: 'master', label: 'GM' })
    sweep(apc.input, 56, [60, 61, 61, 62])
    vi.advanceTimersByTime(LEARN_CAPTURE_MS + 1)
    expect(useMidiStore.getState().mappings[0].options.encoding).toBe('absolute')
    apc.input.emit(cc(56, 32))
    expect(gm()).toBe(64)
  })

  it('works with the profile off too', async () => {
    const apc = access.addDevice(LINUX_MK2)
    await boot()
    useControllerStore.getState().updateSettings(LINUX_MK2, { enabled: false })
    useMidiStore.getState().startLearn({ type: 'master', label: 'GM' })
    sweep(apc.input, 56, [127, 127])
    vi.advanceTimersByTime(LEARN_CAPTURE_MS + 1)
    expect(useMidiStore.getState().mappings[0].options.encoding).toBe('absolute')
    apc.input.emit(cc(56, 0))
    expect(gm()).toBe(0)
  })

  it('a mapping learned on a Mac ("APC mini mk2 Control") works on the Pi (ALSA name)', async () => {
    const apc = access.addDevice(LINUX_MK2)
    useMidiStore.setState({
      mappings: [{
        id: 'gm', name: 'GM', source: { deviceName: 'APC mini mk2 Control', type: 'cc', channel: 1, number: 56 },
        target: { type: 'master' }, options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct' }
      }]
    })
    await boot()
    // the device counts as hand-mapped (profile starts off) and the mapping matches
    expect(useControllerStore.getState().settings[0].enabled).toBe(false)
    apc.input.emit(cc(56, 0))
    expect(gm()).toBe(0)
  })
})

describe('profile fader 9 = Grand Master, out of the box', () => {
  it('drives the GM once picked up; a far fader says why it waits (toast + ghost)', async () => {
    const apc = access.addDevice(LINUX_MK2)
    await boot()
    // fader at the top, GM full: in place → drives at once
    apc.input.emit(cc(56, 127))
    apc.input.emit(cc(56, 64))
    expect(gm()).toBe(129)
    apc.input.emit(cc(56, 0))
    expect(gm()).toBe(0)

    // GM raised on screen while the fader is down: the fader must pick it up
    useDmxStore.getState().setGrandMaster(255)
    apc.input.emit(cc(56, 10))
    expect(gm()).toBe(255)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toMatch(/Grand Master/)
    apc.input.emit(cc(56, 20))
    expect(useToastStore.getState().toasts).toHaveLength(1) // once, not per message
    vi.advanceTimersByTime(200)
    expect(computeGhosts()).toEqual({ gm: 40 })
    apc.input.emit(cc(56, 126)) // within tolerance: picked up
    expect(gm()).toBe(253)
  })

  it('jump mode applies at once', async () => {
    const apc = access.addDevice(LINUX_MK2)
    await boot()
    useControllerStore.getState().updateSettings(LINUX_MK2, { takeover: 'jump' })
    apc.input.emit(cc(56, 0))
    expect(gm()).toBe(0)
  })
})

describe('MIDI hotplug and start-up robustness', () => {
  it('a device plugged after start appears without a rescan, even when no statechange fires', async () => {
    await boot()
    expect(useMidiStore.getState().devices).toEqual([])
    const apc = access.addDevice(LINUX_MK2) // live port map changes, no event
    await vi.advanceTimersByTimeAsync(MIDI_RESCAN_MS + 10)
    expect(useMidiStore.getState().devices.map((d) => d.name)).toContain(LINUX_MK2)
    expect(useControllerStore.getState().detected.map((d) => d.port)).toEqual([LINUX_MK2])
    // the profile drives it at once (fader at the top: GM in place)
    apc.input.emit(cc(56, 127))
    apc.input.emit(cc(56, 0))
    expect(gm()).toBe(0)
  })

  it('unplug without statechange: the device goes away on the next rescan', async () => {
    access.addDevice(LINUX_MK2)
    await boot()
    const saved = access.onstatechange
    access.onstatechange = null
    access.unplug(LINUX_MK2)
    access.onstatechange = saved
    await vi.advanceTimersByTimeAsync(MIDI_RESCAN_MS + 10)
    expect(useMidiStore.getState().devices).toEqual([])
  })

  it('Web MIDI failing at boot (no ALSA sequencer yet) is retried in the background', async () => {
    let fail = true
    vi.stubGlobal('navigator', {
      requestMIDIAccess: async () => {
        if (fail) throw new Error('Platform dependent initialization failed.')
        return access
      }
    })
    access.addDevice(LINUX_MK2)
    initMidiRouting()
    await vi.dynamicImportSettled()
    await useMidiStore.getState().initMidi()
    expect(useMidiStore.getState().apiStatus).toBe('error')
    fail = false
    await vi.advanceTimersByTimeAsync(MIDI_RETRY_MS + MIDI_RESCAN_MS)
    expect(useMidiStore.getState().apiStatus).toBe('available')
    expect(useControllerStore.getState().detected.map((d) => d.port)).toEqual([LINUX_MK2])
  })

  it('a Web MIDI request that never answers times out instead of blocking; a late answer is adopted', async () => {
    let answer: ((a: FakeMidiAccess) => void) | null = null
    vi.stubGlobal('navigator', {
      requestMIDIAccess: () => new Promise((resolve) => { answer = resolve })
    })
    access.addDevice('Some Pad')
    initMidiRouting()
    const pending = useMidiStore.getState().initMidi()
    await vi.advanceTimersByTimeAsync(MIDI_ACCESS_TIMEOUT_MS + 1)
    await pending
    expect(useMidiStore.getState().apiStatus).toBe('error')
    answer!(access)
    await vi.advanceTimersByTimeAsync(1)
    expect(useMidiStore.getState().apiStatus).toBe('available')
    expect(useMidiStore.getState().devices.map((d) => d.name)).toContain('Some Pad')
  })
})

describe('port names and encoding detection', () => {
  it('matches the same device across systems, never two different ports', () => {
    expect(sameMidiPort('APC mini mk2 Control', LINUX_MK2)).toBe(true)
    expect(sameMidiPort('APC MINI', 'APC MINI MIDI 1')).toBe(true)
    expect(sameMidiPort('nanoKONTROL2 20:0', 'nanoKONTROL2 24:0')).toBe(true)
    expect(sameMidiPort('apc  mini', 'APC mini')).toBe(true)
    expect(sameMidiPort('APC mini mk2 Control', LINUX_MK2_NOTES)).toBe(false)
    expect(sameMidiPort('APC mini mk2 Control', 'APC mini mk2 Notes')).toBe(false)
    expect(sameMidiPort('2- APC MINI', 'APC MINI')).toBe(false) // two identical units on Windows
    expect(sameMidiPort('APC MINI', 'APC mini mk2 Control')).toBe(false)
  })

  it('a fader pushed to its end stop is not an encoder', () => {
    expect(detectCcEncoding([120, 124, 127, 127])).toBe('absolute')
    expect(detectCcEncoding([125, 126, 127, 127, 127])).toBe('absolute')
    expect(detectCcEncoding([127, 127, 126, 127])).toBe('relative') // encoder turned counter-clockwise
    expect(detectCcEncoding([126, 127, 127])).toBe('relative')
  })
})
