// Blinder = full open white on every fixture; Strobe = hardware strobe when
// the fixture has one, intensity chop otherwise, 'white' (default) or 'look'.

import { describe, expect, it } from 'vitest'
import { applyMasters, buildChannelInfo, strobeChopChannels, type MasterState } from './dmx-mixer'
import { classifyModeChannels, strobeDmxValue, strobeRangeOf } from './channel-classify'
import { CMY_SPOT, patchEntry, addr } from './testing/test-fixtures'
import type { FixtureChannel, FixtureDefinition } from '@shared/types'

const ch = (name: string, type: FixtureChannel['type'], extra: Partial<FixtureChannel> = {}): FixtureChannel => ({ name, type, ...extra })

/** RGB par WITH a dimmer and a shutter/strobe channel */
const PAR_STROBE: FixtureDefinition = {
  id: 'test/par-strobe', name: 'Par Strobe', manufacturer: 'Test', categories: ['Color Changer'],
  channels: {
    Dimmer: ch('Dimmer', 'intensity', { precedence: 'HTP' }),
    Red: ch('Red', 'color'), Green: ch('Green', 'color'), Blue: ch('Blue', 'color'), White: ch('White', 'color'), UV: ch('UV', 'color'),
    Strobe: ch('Strobe', 'strobe', {
      capabilities: [
        { dmxRange: [0, 9], type: 'ShutterOpen', label: 'No strobe' },
        { dmxRange: [10, 249], type: 'ShutterStrobe', label: 'Strobe 1…25Hz' },
        { dmxRange: [250, 255], type: 'ShutterStrobe', label: 'Random strobe' }
      ]
    })
  },
  modes: [{ name: '7ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'UV', 'Strobe'], channelCount: 7 }]
}

/** RGB par WITH a dimmer, no strobe channel */
const PAR_DIM: FixtureDefinition = {
  id: 'test/par-dim', name: 'Par Dim', manufacturer: 'Test', categories: ['Color Changer'],
  channels: { Dimmer: ch('Dimmer', 'intensity'), Red: ch('Red', 'color'), Green: ch('Green', 'color'), Blue: ch('Blue', 'color') },
  modes: [{ name: '4ch', channels: ['Dimmer', 'Red', 'Green', 'Blue'], channelCount: 4 }]
}

/** Spot: colour wheel / gobo wheel with an open slot that is not 0, "Dimmer/Strobe" combined channel */
const SPOT: FixtureDefinition = {
  id: 'test/spot', name: 'Spot', manufacturer: 'Test', categories: ['Moving Head'],
  channels: {
    'Dimmer/Strobe': ch('Dimmer/Strobe', 'intensity', {
      capabilities: [
        { dmxRange: [0, 127], type: 'Intensity', label: 'Dimmer 0-100%' },
        { dmxRange: [128, 255], type: 'ShutterStrobe', label: 'Strobe slow…fast' }
      ]
    }),
    'Color Wheel': ch('Color Wheel', 'color', {
      capabilities: [
        { dmxRange: [0, 9], type: 'WheelSlot', label: 'Red' },
        { dmxRange: [10, 19], type: 'WheelSlot', label: 'Open / White' },
        { dmxRange: [20, 29], type: 'WheelSlot', label: 'Blue' }
      ]
    }),
    Gobo: ch('Gobo', 'gobo', { capabilities: [{ dmxRange: [0, 7], type: 'WheelSlot', label: 'Gobo 1' }, { dmxRange: [8, 15], type: 'WheelSlot', label: 'Open' }] }),
    'Gobo Rotation': ch('Gobo Rotation', 'gobo'),
    CTO: ch('CTO', 'color'),
    Pan: ch('Pan', 'pan', { defaultValue: 128 })
  },
  modes: [{ name: '6ch', channels: ['Dimmer/Strobe', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'CTO', 'Pan'], channelCount: 6 }]
}

const FIXTURES = [PAR_STROBE, PAR_DIM, SPOT, CMY_SPOT]
const ps = patchEntry('ps', PAR_STROBE, 0, 1)
const pd = patchEntry('pd', PAR_DIM, 0, 11)
const sp = patchEntry('sp', SPOT, 0, 21)
const cmy = patchEntry('cmy', CMY_SPOT, 0, 31)
const info = buildChannelInfo([ps, pd, sp, cmy], FIXTURES, 1)
const A = (e: typeof ps, def: FixtureDefinition, name: string) => addr(e, def, name)

function out(mix: Uint8Array, m: Partial<MasterState>): Uint8Array {
  const o = new Uint8Array(mix.length)
  applyMasters(mix, info, { grandMaster: 255, blackout: false, blinder: false, strobe: false, strobeOn: true, ...m }, o)
  return o
}

/** The current look: everything dark (dimmers 0, RGB 0), the spot on its red slot / gobo 1 with CTO in */
function darkLook(): Uint8Array {
  const m = new Uint8Array(512)
  m[A(sp, SPOT, 'Color Wheel')] = 5
  m[A(sp, SPOT, 'Gobo')] = 3
  m[A(sp, SPOT, 'Gobo Rotation')] = 77
  m[A(sp, SPOT, 'CTO')] = 200
  m[A(sp, SPOT, 'Pan')] = 42
  m[A(cmy, CMY_SPOT, 'Cyan')] = 255
  return m
}

describe('Blinder: full open white on every fixture', () => {
  it('a fixture whose dimmer AND RGB are 0 in the look lights full white (was dark before 1.1.1)', () => {
    const o = out(darkLook(), { blinder: true })
    expect(o[A(pd, PAR_DIM, 'Dimmer')]).toBe(255)
    expect([o[A(pd, PAR_DIM, 'Red')], o[A(pd, PAR_DIM, 'Green')], o[A(pd, PAR_DIM, 'Blue')]]).toEqual([255, 255, 255])
    expect(o[A(ps, PAR_STROBE, 'White')]).toBe(255)
    expect(o[A(ps, PAR_STROBE, 'UV')]).toBe(0) // UV is not white light: left as the look
    expect(o[A(ps, PAR_STROBE, 'Strobe')]).toBe(5) // shutter open (no strobe)
  })

  it('CMY to 0, CTO to 0, colour / gobo wheel to their OPEN slot, rotation and position untouched', () => {
    const o = out(darkLook(), { blinder: true })
    expect(o[A(cmy, CMY_SPOT, 'Dimmer')]).toBe(255)
    expect(o[A(cmy, CMY_SPOT, 'Cyan')]).toBe(0)
    expect(o[A(sp, SPOT, 'Color Wheel')]).toBe(15) // "Open / White" 10-19
    expect(o[A(sp, SPOT, 'Gobo')]).toBe(12) // "Open" 8-15
    expect(o[A(sp, SPOT, 'Gobo Rotation')]).toBe(77)
    expect(o[A(sp, SPOT, 'CTO')]).toBe(0)
    expect(o[A(sp, SPOT, 'Pan')]).toBe(42)
  })

  it('a "Dimmer/Strobe" channel goes to the top of its DIMMER range, never into its strobe range', () => {
    const o = out(darkLook(), { blinder: true })
    expect(o[A(sp, SPOT, 'Dimmer/Strobe')]).toBe(127)
  })

  it('blackout still wins', () => {
    const o = out(darkLook(), { blinder: true, blackout: true })
    expect(o[A(pd, PAR_DIM, 'Dimmer')]).toBe(0)
  })
})

describe('Strobe', () => {
  it('reads the plain strobe range of a channel (Hz in the label, fast→slow, random excluded)', () => {
    expect(strobeRangeOf(PAR_STROBE.channels.Strobe)).toEqual({ lo: 10, hi: 249, hzLo: 1, hzHi: 25 })
    const fastSlow = strobeRangeOf(ch('S', 'shutter', { capabilities: [{ dmxRange: [64, 95], type: 'ShutterStrobe', label: 'Strobe effect (Fast to slow)' }] }))
    expect(fastSlow).toEqual({ lo: 64, hi: 95, hzLo: 20, hzHi: 1 })
    expect(strobeDmxValue(fastSlow!, 20)).toBe(64)
    expect(strobeDmxValue(fastSlow!, 1)).toBe(95)
    expect(strobeRangeOf(ch('S', 'shutter', { capabilities: [{ dmxRange: [0, 255], type: 'ShutterStrobe', label: 'Random strobe' }] }))).toBeNull()
    expect(strobeRangeOf(ch('S', 'strobe'))).toBeNull() // no capabilities: chopped instead
  })

  it('hardware strobe: the strobe channel follows the rate, the fixture is not chopped', () => {
    const look = darkLook()
    look[A(ps, PAR_STROBE, 'Dimmer')] = 255
    look[A(ps, PAR_STROBE, 'Red')] = 255
    const at1 = out(look, { strobe: true, strobeOn: false, strobeRate: 1, strobeMode: 'look' })
    const at25 = out(look, { strobe: true, strobeOn: false, strobeRate: 25, strobeMode: 'look' })
    expect(at1[A(ps, PAR_STROBE, 'Strobe')]).toBe(10)
    expect(at25[A(ps, PAR_STROBE, 'Strobe')]).toBe(249)
    expect(at1[A(ps, PAR_STROBE, 'Dimmer')]).toBe(255) // dark phase: not chopped
  })

  it("'white' (default): fixtures dark in the look flash full white; 'look': they stay dark", () => {
    const white = out(darkLook(), { strobe: true, strobeOn: true, strobeRate: 10 })
    expect(white[A(pd, PAR_DIM, 'Dimmer')]).toBe(255)
    expect(white[A(pd, PAR_DIM, 'Red')]).toBe(255)
    expect(white[A(ps, PAR_STROBE, 'Dimmer')]).toBe(255)
    const whiteDark = out(darkLook(), { strobe: true, strobeOn: false, strobeRate: 10 })
    expect(whiteDark[A(pd, PAR_DIM, 'Dimmer')]).toBe(0) // chopped (no hardware strobe)
    expect(whiteDark[A(ps, PAR_STROBE, 'Dimmer')]).toBe(255) // hardware strobe does the flashing
    const look = out(darkLook(), { strobe: true, strobeOn: true, strobeMode: 'look' })
    expect(look[A(pd, PAR_DIM, 'Dimmer')]).toBe(0)
    expect(look[A(pd, PAR_DIM, 'Red')]).toBe(0)
  })

  it('external chop (output engine): the mixer leaves intensity lit; the chop mask skips hardware-strobe fixtures and parked channels', () => {
    const o = out(darkLook(), { strobe: true, strobeOn: false, externalChop: true })
    expect(o[A(pd, PAR_DIM, 'Dimmer')]).toBe(255)
    const parked = new Int16Array(512).fill(-1)
    parked[A(cmy, CMY_SPOT, 'Dimmer')] = 100
    const mask = strobeChopChannels(info, parked)[0]
    expect(mask).toContain(A(pd, PAR_DIM, 'Dimmer'))
    expect(mask).not.toContain(A(ps, PAR_STROBE, 'Dimmer'))
    expect(mask).not.toContain(A(cmy, CMY_SPOT, 'Dimmer'))
    expect(mask).not.toContain(A(pd, PAR_DIM, 'Red')) // colour of a fixture with a dimmer: not intensity
  })

  it('classification marks the intensity of hardware-strobe fixtures', () => {
    const c = classifyModeChannels(PAR_STROBE, PAR_STROBE.modes[0])
    expect(c.find((x) => x.name === 'Dimmer')!.hwStrobe).toBe(true)
    expect(classifyModeChannels(PAR_DIM, PAR_DIM.modes[0]).some((x) => x.hwStrobe)).toBe(false)
  })
})
