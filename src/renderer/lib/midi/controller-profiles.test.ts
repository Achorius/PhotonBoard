import { describe, expect, it } from 'vitest'
import type { Cuelist, ExecutorPage } from '@shared/types'
import { createExecutorPage } from '@shared/show-format'
import { CONTROLLER_PROFILES, apcMiniMk1, apcMiniMk2, effectiveProfile, findOutputPort, launchpadMiniMk3, matchProfile, nanoKontrol2, xTouchMini } from './profiles'
import { APC_MINI_MK2, apcPadNote, mk2RgbSysex, parseMk2FaderReply } from './profiles/akai-apc-mini'
import { launchpadPadNote } from './profiles/generic'
import { buildBindings, padAction } from './layouts'
import { LED_HELD, LED_LEARN, LED_OFF, led } from './led-colors'
import { abletonPalette, ABLETON_PALETTE } from './palette'
import { computeLeds, computePagePlaying, diffLeds, softBlinkLed, type FeedbackSnapshot } from './led-states'
import { dmxToMidi, initialTakeover, midiToDmx, needsGhost, rearm, takeover } from './takeover'
import { parsePoolRef, resolvePresetRef } from './pool-refs'
import { mappingFeedbackMessage, mappingFeedbackValue, valueToRaw } from './mapping-feedback'
import type { ControlId, LedState } from './controller-types'
import type { MidiMapping, Preset } from '@shared/types'

describe('profile matching', () => {
  const cases: [string, string | null][] = [
    ['APC MINI', 'akai-apc-mini'],
    ['APC MINI MIDI 1', 'akai-apc-mini'],
    ['APC MINI:APC MINI MIDI 1 20:0', 'akai-apc-mini'],
    ['2- APC MINI', 'akai-apc-mini'],
    ['APC mini mk2 Control', 'akai-apc-mini-mk2'],
    ['APC mini mk2', 'akai-apc-mini-mk2'],
    ['APC mini mk2:APC mini mk2 APC mini mk2 Contr 24:0', 'akai-apc-mini-mk2'],
    ['APC mini mk2 Notes', null],
    ['APC40 mkII', 'akai-apc40-mk2'],
    ['Launchpad Mini MK3 LPMiniMK3 MIDI', 'novation-launchpad-mini-mk3'],
    ['LPMiniMK3 MIDI', 'novation-launchpad-mini-mk3'],
    ['Launchpad Mini MK3 LPMiniMK3 DAW', null],
    ['MIDIIN2 (LPMiniMK3 MIDI)', null],
    ['LPX MIDI', 'novation-launchpad-x'],
    ['X-TOUCH MINI', 'behringer-x-touch-mini'],
    ['nanoKONTROL2 SLIDER/KNOB', 'korg-nanokontrol2'],
    ['IAC Driver Bus 1', null],
    ['', null]
  ]
  it.each(cases)('%s → %s', (name, id) => {
    expect(matchProfile(name)?.id ?? null).toBe(id)
  })

  it('profile ids are unique and every profile has a default layout', () => {
    const ids = CONTROLLER_PROFILES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of CONTROLLER_PROFILES) expect(p.defaultLayouts[0]).toBe('executors-2pages')
  })

  it('control messages are unique within a profile', () => {
    for (const p of CONTROLLER_PROFILES) {
      const keys = p.controls.map((c) => `${c.type}:${c.channel}:${c.number}`)
      expect(new Set(keys).size, p.id).toBe(keys.length)
      const ids = p.controls.map((c) => c.id)
      expect(new Set(ids).size, p.id).toBe(ids.length)
    }
  })

  it('finds the output port: same name, never the ignored port, longest shared prefix', () => {
    expect(findOutputPort(apcMiniMk2, 'APC mini mk2 Control', ['APC mini mk2 Notes', 'APC mini mk2 Control'])).toBe('APC mini mk2 Control')
    expect(findOutputPort(apcMiniMk2, 'APC mini mk2 Control', ['APC mini mk2 Notes'])).toBeNull()
    expect(findOutputPort(apcMiniMk1, '2- APC MINI', ['APC MINI', '2- APC MINI'])).toBe('2- APC MINI')
    expect(findOutputPort(apcMiniMk1, 'APC MINI', ['APC MINI'], new Set(['APC MINI']))).toBeNull()
  })
})

describe('APC mini mk1 LED encoding', () => {
  const enc = (id: ControlId, s: LedState) => apcMiniMk1.encodeLeds([[id, s]])
  it('pads: note 0 bottom-left, colours by meaning', () => {
    expect(apcPadNote(0, 7)).toBe(0)
    expect(apcPadNote(0, 0)).toBe(56)
    expect(apcPadNote(7, 0)).toBe(63)
    expect(enc('pad:0:0', LED_OFF)).toEqual([[0x90, 56, 0]])
    expect(enc('pad:0:0', led('on', '#e85d04'))).toEqual([[0x90, 56, 1]]) // playing: green
    expect(enc('pad:1:7', led('dim', '#e85d04'))).toEqual([[0x90, 1, 5]]) // stopped: yellow
    expect(enc('pad:0:0', led('pulse', '#e85d04'))).toEqual([[0x90, 56, 2]]) // fading: green blink
    expect(enc('pad:0:0', led('on', LED_HELD))).toEqual([[0x90, 56, 3]]) // held: red
    expect(enc('pad:0:0', led('blink', '#e85d04'))).toEqual([[0x90, 56, 4]]) // selected: red blink
    expect(enc('pad:0:0', led('blink', LED_LEARN))).toEqual([[0x90, 56, 6]]) // learn: yellow blink
  })
  it('track / scene buttons 0 / 1 / 2; no LED for shift and faders', () => {
    expect(enc('track:0', led('on', '#0055ff'))).toEqual([[0x90, 64, 1]])
    expect(enc('track:7', led('blink', '#0055ff'))).toEqual([[0x90, 71, 2]])
    expect(enc('scene:0', led('on', '#00ff00'))).toEqual([[0x90, 82, 1]])
    expect(enc('scene:7', LED_OFF)).toEqual([[0x90, 89, 0]])
    expect(enc('shift', led('on'))).toEqual([])
    expect(enc('fader:0', led('on'))).toEqual([])
  })
})

describe('APC mini mk2 LED encoding', () => {
  const red = '#ff0000'
  const redIndex = abletonPalette.nearest(red)
  it('nearest palette colour (cached per hex)', () => {
    expect(ABLETON_PALETTE).toHaveLength(128)
    expect(ABLETON_PALETTE[redIndex]).toBe('#ff0000')
    expect(abletonPalette.nearest('#000000')).toBe(0)
    expect(abletonPalette.nearest('#010101')).not.toBe(0)
    expect(abletonPalette.nearest('#FF0000')).toBe(redIndex)
  })
  it('velocity = palette index, channel = behaviour', () => {
    const enc = (s: LedState) => apcMiniMk2.encodeLeds([['pad:0:7', s]])[0]
    expect(enc(LED_OFF)).toEqual([0x90, 0, 0])
    expect(enc(led('dim', red))).toEqual([0x91, 0, redIndex]) // ch2 = 25 %
    expect(enc(led('on', red))).toEqual([0x96, 0, redIndex]) // ch7 = 100 %
    expect(enc(led('pulse', red))).toEqual([0x98, 0, redIndex]) // ch9 = pulse 1/8
    expect(enc(led('blink', red))).toEqual([0x9e, 0, redIndex]) // ch15 = blink 1/4
  })
  it('track 100-107, scene 112-119, shift has no LED', () => {
    expect(apcMiniMk2.encodeLeds([['track:0', led('on', '#0055ff')], ['scene:7', led('blink', red)], ['shift', led('on')]]))
      .toEqual([[0x90, 100, 1], [0x90, 119, 2]])
  })
  it('RGB SysEx (opt-in): contiguous pads of one colour share a range', () => {
    expect(mk2RgbSysex([{ note: 1, color: '#ff8000' }, { note: 0, color: '#ff8000' }, { note: 5, color: '#000001' }])).toEqual([
      0xf0, 0x47, 0x7f, 0x4f, 0x24, 0x00, 16,
      0, 1, 0x01, 0x7f, 0x01, 0x00, 0x00, 0x00,
      5, 5, 0, 0, 0, 0, 0, 1,
      0xf7
    ])
    const rgb = effectiveProfile(apcMiniMk2, { rgbLeds: true })
    expect(rgb).not.toBe(apcMiniMk2)
    expect(effectiveProfile(rgb, { rgbLeds: false })).toBe(apcMiniMk2)
    const msgs = rgb.encodeLeds([['pad:0:7', led('on', '#ff0000')], ['pad:1:7', led('dim', '#ff0000')], ['pad:2:7', led('blink', '#ff0000')]])
    // blink stays a palette note-on; solid pads go through one SysEx (dim = 25 %)
    expect(msgs[0]).toEqual([0x9e, 2, redIndex])
    expect(msgs[1].slice(0, 5)).toEqual(APC_MINI_MK2.SYSEX_RGB)
    expect(msgs[1].slice(7, 15)).toEqual([0, 0, 1, 0x7f, 0, 0, 0, 0])
    expect(msgs[1].slice(15, 23)).toEqual([1, 1, 0, 64, 0, 0, 0, 0])
  })
  it('parses the fader position reply', () => {
    expect(parseMk2FaderReply([0xf0, 0x47, 0x7f, 0x4f, 0x61, 0x00, 0x09, 0, 10, 20, 30, 40, 50, 60, 70, 127, 0xf7]))
      .toEqual([['fader:0', 0], ['fader:1', 10], ['fader:2', 20], ['fader:3', 30], ['fader:4', 40], ['fader:5', 50], ['fader:6', 60], ['fader:7', 70], ['fader:8', 127]])
    expect(parseMk2FaderReply([0xf0, 0x7e, 0x7f, 0x06, 0x02, 0xf7])).toBeNull()
  })
})

describe('generic profiles', () => {
  it('Launchpad: programmer-mode notes, flash = static off + flash colour', () => {
    expect(launchpadPadNote(0, 7)).toBe(11)
    expect(launchpadPadNote(7, 0)).toBe(88)
    const red = abletonPalette.nearest('#ff0000')
    expect(launchpadMiniMk3.encodeLeds([['pad:0:0', led('blink', '#ff0000')]])).toEqual([[0x90, 81, 0], [0x91, 81, red]])
    expect(launchpadMiniMk3.encodeLeds([['scene:0', led('pulse', '#ff0000')]])).toEqual([[0xb2, 89, red]])
    expect(launchpadMiniMk3.init?.[0]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7])
  })
  it('nanoKONTROL2: CC LEDs on/off, soft blink', () => {
    expect(nanoKontrol2.softBlink).toBe(true)
    expect(nanoKontrol2.encodeLeds([['pad:0:0', led('on', '#fff')], ['pad:1:2', LED_OFF], ['page:+', led('on')]])).toEqual([[0xb0, 32, 127], [0xb0, 65, 0]])
    expect(softBlinkLed(led('blink', '#ff0000'), true)).toEqual(led('on', '#ff0000'))
    expect(softBlinkLed(led('blink', '#ff0000'), false)).toBe(LED_OFF)
  })
  it('X-Touch Mini: buttons on channel 11, encoders drive the column faders', () => {
    expect(xTouchMini.encodeLeds([['pad:2:1', led('blink', '#fff')]])).toEqual([[0x9a, 18, 2]])
    const b = buildBindings(xTouchMini, 'executors-2pages')
    expect(b.find((x) => x.control === 'encoder:3')?.action).toEqual({ type: 'column-fader', col: 3 })
    expect(b.find((x) => x.control === 'fader:8')?.action).toEqual({ type: 'grand-master' })
  })
})

describe('layouts', () => {
  it('executors-2pages on an 8×8 grid', () => {
    const b = buildBindings(apcMiniMk2, 'executors-2pages')
    const at = (id: string) => b.find((x) => x.control === id)
    expect(at('pad:2:0')).toEqual({ control: 'pad:2:0', action: { type: 'executor', page: 'current', col: 2, row: 0 }, shiftAction: { type: 'select-executor', page: 'current', col: 2, row: 0 } })
    expect(at('pad:2:5')?.action).toEqual({ type: 'executor', page: 'next', col: 2, row: 1 })
    expect(at('track:3')).toEqual({ control: 'track:3', action: { type: 'page', page: 3 }, shiftAction: { type: 'page', page: '+' } })
    expect(at('track:0')?.shiftAction).toEqual({ type: 'page', page: '-' })
    expect(['scene:0', 'scene:1', 'scene:2', 'scene:3', 'scene:4', 'scene:5', 'scene:6', 'scene:7'].map((id) => at(id)?.action.type))
      .toEqual(['go-selected', 'back-selected', 'release-all', 'blackout', 'blinder', 'strobe', 'tap', 'clear'])
    expect(at('fader:0')?.action).toEqual({ type: 'column-fader', col: 0 })
    expect(at('fader:8')?.action).toEqual({ type: 'grand-master' })
    expect(at('shift')).toBeUndefined()
  })
  it('executors-busk: groups, colour / position presets, macros', () => {
    expect(padAction('executors-busk', 0, 3)).toEqual({ type: 'executor', page: 'current', col: 0, row: 3 })
    expect(padAction('executors-busk', 0, 4)).toEqual({ type: 'group', id: '#1' })
    expect(padAction('executors-busk', 1, 5)).toEqual({ type: 'preset', id: 'color#2' })
    expect(padAction('executors-busk', 7, 6)).toEqual({ type: 'preset', id: 'position#8' })
    expect(padAction('executors-busk', 2, 7)).toEqual({ type: 'macro', id: '#3' })
  })
  it('nanoKONTROL2: 3 executor rows, transport, page − / +', () => {
    const b = buildBindings(nanoKontrol2, 'executors-2pages')
    expect(b.filter((x) => x.action.type === 'executor')).toHaveLength(24)
    expect(b.find((x) => x.control === 'page:+')?.action).toEqual({ type: 'page', page: '+' })
    expect(b.find((x) => x.control === 'knob:0')).toBeUndefined()
  })
  it('pool references', () => {
    expect(parsePoolRef('#3')).toEqual({ n: 3 })
    expect(parsePoolRef('color#2')).toEqual({ family: 'color', n: 2 })
    expect(parsePoolRef('abc')).toBeNull()
    const presets = [
      { id: 'a', name: 'A', type: 'color', values: {}, number: 2 },
      { id: 'b', name: 'B', type: 'position', values: {}, number: 2 },
      { id: 'c', name: 'C', type: 'color', values: {}, number: 1 }
    ] as Preset[]
    expect(resolvePresetRef(presets, 'color#2')?.id).toBe('a')
    expect(resolvePresetRef(presets, 'position#2')?.id).toBe('b')
    expect(resolvePresetRef(presets, 'colour#1')?.id).toBe('c')
    expect(resolvePresetRef(presets, 'gobo#1')).toBeUndefined()
    expect(resolvePresetRef(presets, 'b')?.id).toBe('b')
  })
})

describe('soft takeover', () => {
  it('ignores a far fader until it comes within tolerance', () => {
    let s = initialTakeover()
    let r = takeover(s, 10, 100)
    expect(r.apply).toBe(false)
    s = r.state
    r = takeover(s, 60, 100)
    expect(r.apply).toBe(false)
    r = takeover(r.state, 99, 100)
    expect(r.apply).toBe(true)
    expect(r.state.synced).toBe(true)
    // Synced: follows every move
    r = takeover(r.state, 20, 99)
    expect(r.apply).toBe(true)
  })
  it('syncs when the fader crosses the value', () => {
    let r = takeover(initialTakeover(), 10, 64)
    expect(r.apply).toBe(false)
    r = takeover(r.state, 90, 64) // jumped over 64
    expect(r.apply).toBe(true)
  })
  it('re-arms when another source moved the value, and on rearm()', () => {
    let r = takeover(initialTakeover(), 50, 50)
    expect(r.apply).toBe(true)
    // the scene fader moved on screen to 120 (MIDI scale)
    r = takeover(r.state, 52, 120)
    expect(r.apply).toBe(false)
    expect(needsGhost(r.state, 120)).toBe(true)
    r = takeover(r.state, 121, 120)
    expect(r.apply).toBe(true)
    const re = rearm(r.state)
    expect(re.synced).toBe(false)
    expect(takeover(re, 100, 30).apply).toBe(false)
    expect(needsGhost(re, 30)).toBe(true)
    expect(needsGhost(initialTakeover(), 30)).toBe(false) // position unknown
  })
  it('scales round-trip', () => {
    for (let v = 0; v <= 127; v++) expect(dmxToMidi(midiToDmx(v))).toBe(v)
  })
})

// ---------------- LED states + diffing ----------------

function cuelist(id: string, over: Partial<Cuelist> = {}): Cuelist {
  return { id, name: id, cues: [{ id: 'q', name: 'Q', values: [], fadeIn: 2, fadeOut: 2, delay: 0 }] as unknown as Cuelist['cues'], currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...over }
}

function snapshot(pages: ExecutorPage[], cls: Cuelist[], over: Partial<FeedbackSnapshot> = {}): FeedbackSnapshot {
  const cuelistById = new Map(cls.map((c) => [c.id, c]))
  const base = { cuelistById, chaseById: new Map(), effectRunning: new Map<string, boolean>() }
  const pagePlaying = computePagePlaying(pages, base)
  return {
    pages, currentPage: 0, ...base, groups: [], presets: [], macros: [], selected: null, goTarget: true,
    blackout: false, blinder: false, strobe: false, learnTargetId: null, programmerActive: false, tapOn: false,
    pagePlaying, anythingPlaying: pagePlaying.some(Boolean), isFading: () => false, isMacroRunning: () => false,
    ...over
  }
}

describe('LED states', () => {
  const page = createExecutorPage('p1')
  page.columns[0].color = '#e85d04'
  page.cells[0][0] = { kind: 'cuelist', id: 'a', mode: 'toggle' }
  page.cells[0][1] = { kind: 'cuelist', id: 'b', mode: 'flash' }
  page.cells[0][2] = { kind: 'cuelist', id: 'gone', mode: 'toggle' }
  const page2 = createExecutorPage('p2')
  page2.cells[3][0] = { kind: 'cuelist', id: 'c', mode: 'toggle' }
  const bindings = buildBindings(apcMiniMk2, 'executors-2pages')
  const ctx = { held: new Set<string>(), overridden: new Set<string>() }
  const colour = '#e85d04'

  it('executor states: stopped, playing, fading, held, selected, learn, empty', () => {
    const out = new Map<ControlId, LedState>()
    const cls = [cuelist('a'), cuelist('b'), cuelist('c', { isPlaying: true })]
    computeLeds(bindings, snapshot([page, page2], cls), ctx, out)
    expect(out.get('pad:0:0')).toEqual(led('dim', colour))
    expect(out.get('pad:0:2')).toBe(LED_OFF) // points at a deleted scene
    expect(out.get('pad:0:3')).toBe(LED_OFF) // empty
    expect(out.get('pad:3:4')?.mode).toBe('on') // next page, playing
    expect(out.has('fader:0')).toBe(false)

    computeLeds(bindings, snapshot([page, page2], [cuelist('a', { isPlaying: true }), cuelist('b')]), ctx, out)
    expect(out.get('pad:0:0')).toEqual(led('on', colour))
    computeLeds(bindings, snapshot([page, page2], [cuelist('a', { isPlaying: true }), cuelist('b')], { isFading: () => true }), ctx, out)
    expect(out.get('pad:0:0')).toEqual(led('pulse', colour))
    computeLeds(bindings, snapshot([page, page2], [cuelist('a'), cuelist('b', { flash: true, isPlaying: true })]), ctx, out)
    expect(out.get('pad:0:1')).toEqual(led('on', LED_HELD))
    computeLeds(bindings, snapshot([page, page2], [cuelist('a'), cuelist('b')], { selected: { page: 0, col: 0, row: 0 } }), ctx, out)
    expect(out.get('pad:0:0')).toEqual(led('blink', colour))
    computeLeds(bindings, snapshot([page, page2], [cuelist('a'), cuelist('b')], { learnTargetId: 'a' }), ctx, out)
    expect(out.get('pad:0:0')).toEqual(led('blink', LED_LEARN))
    computeLeds(bindings, snapshot([page, page2], [cuelist('a'), cuelist('b')]), { held: new Set(['pad:0:0']), overridden: new Set() }, out)
    expect(out.get('pad:0:0')).toEqual(led('on', LED_HELD))
  })

  it('function buttons and user-mapping override', () => {
    const out = new Map<ControlId, LedState>()
    const cls = [cuelist('a'), cuelist('b'), cuelist('c', { isPlaying: true })]
    computeLeds(bindings, snapshot([page, page2], cls, { blackout: true, programmerActive: true }), { held: new Set(), overridden: new Set(['scene:0']) }, out)
    expect(out.get('track:0')?.mode).toBe('on') // current page
    expect(out.get('track:1')?.mode).toBe('blink') // page 2 has something playing
    expect(out.get('track:2')).toBe(LED_OFF) // no page 3
    expect(out.get('scene:0')).toBe(LED_OFF) // a user mapping owns it
    expect(out.get('scene:1')?.mode).toBe('on') // Back
    expect(out.get('scene:2')?.mode).toBe('on') // Release all: something plays
    expect(out.get('scene:3')?.mode).toBe('blink') // Blackout on
    expect(out.get('scene:4')).toBe(LED_OFF) // Blinder off
    expect(out.get('scene:7')?.mode).toBe('on') // programmer has values
  })

  it('diffing: only changes are sent, removed controls switch off', () => {
    const shown = new Map<ControlId, LedState>()
    const next = new Map<ControlId, LedState>([['pad:0:0', led('on', '#ff0000')], ['pad:1:0', LED_OFF]])
    expect(diffLeds(shown, next)).toHaveLength(2) // first frame: everything (also off)
    expect(diffLeds(shown, next)).toHaveLength(0)
    next.set('pad:0:0', led('on', '#FF0000'))
    expect(diffLeds(shown, next)).toHaveLength(0) // same colour
    next.set('pad:0:0', led('dim', '#ff0000'))
    expect(diffLeds(shown, next)).toEqual([['pad:0:0', led('dim', '#ff0000')]])
    next.delete('pad:0:0')
    expect(diffLeds(shown, next)).toEqual([['pad:0:0', LED_OFF]])
    expect(shown.has('pad:0:0')).toBe(false)
  })
})

describe('user mapping feedback', () => {
  const mapping = (type: MidiMapping['target']['type'], over: Partial<MidiMapping['options']> = {}): MidiMapping => ({
    id: 'm', name: 'm', source: { deviceName: 'Dev', type: 'cc', channel: 2, number: 7 }, target: { type, id: 'a' },
    options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct', ...over }
  })
  const ctx = {
    cuelist: () => ({ isPlaying: true, flash: false, faderLevel: 128 }), chase: () => undefined, effectRunning: () => undefined,
    grandMaster: 255, blackout: false, blinder: true, strobe: false, timelinePlaying: false, channelValue: () => undefined
  }
  it('values on the mapping scale and messages', () => {
    expect(mappingFeedbackValue(mapping('cuelist_fader'), ctx)).toBe(64)
    expect(mappingFeedbackValue(mapping('cuelist_go'), ctx)).toBe(127)
    expect(mappingFeedbackValue(mapping('blackout'), ctx)).toBe(0)
    expect(mappingFeedbackValue(mapping('tap_tempo'), ctx)).toBeNull()
    expect(valueToRaw(mapping('master', { inverted: true }), 255)).toBe(0)
    expect(mappingFeedbackMessage(mapping('master'), 'cc', 64)).toEqual([0xb1, 7, 64])
    expect(mappingFeedbackMessage(mapping('master'), 'note', 64)).toEqual([0x91, 7, 127])
  })
})
