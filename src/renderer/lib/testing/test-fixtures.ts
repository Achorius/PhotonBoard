// Test helpers: small fixture library + patch builders (used by *.test.ts only)

import type { FixtureChannel, FixtureDefinition, PatchEntry } from '@shared/types'

function ch(name: string, type: FixtureChannel['type'], extra: Partial<FixtureChannel> = {}): FixtureChannel {
  return { name, type, ...extra }
}

/** Moving head: 12 channels, 16-bit pan/tilt, dimmer, shutter, RGB, wheels, reset */
export const MOVING_HEAD: FixtureDefinition = {
  id: 'test/moving-head',
  name: 'Test Moving Head',
  manufacturer: 'Test',
  categories: ['Moving Head'],
  channels: {
    Pan: ch('Pan', 'pan', { defaultValue: 128, precedence: 'LTP' }),
    'Pan Fine': ch('Pan Fine', 'pan', { defaultValue: 0, precedence: 'LTP' }),
    Tilt: ch('Tilt', 'tilt', { defaultValue: 128, precedence: 'LTP' }),
    'Tilt Fine': ch('Tilt Fine', 'tilt', { defaultValue: 0, precedence: 'LTP' }),
    Dimmer: ch('Dimmer', 'intensity', { defaultValue: 0, precedence: 'HTP' }),
    Shutter: ch('Shutter', 'shutter', {
      defaultValue: 20,
      precedence: 'LTP',
      capabilities: [
        { dmxRange: [0, 19], type: 'ShutterClose', label: 'Closed' },
        { dmxRange: [20, 24], type: 'ShutterOpen', label: 'Open' },
        { dmxRange: [64, 95], type: 'StrobeSpeed', label: 'Strobe' }
      ]
    }),
    Red: ch('Red', 'color', { precedence: 'LTP' }),
    Green: ch('Green', 'color', { precedence: 'LTP' }),
    Blue: ch('Blue', 'color', { precedence: 'LTP' }),
    'Color Wheel': ch('Color Wheel', 'color', { precedence: 'LTP' }),
    Gobo: ch('Gobo', 'gobo', { precedence: 'LTP' }),
    Reset: ch('Reset', 'maintenance', { precedence: 'LTP' })
  },
  modes: [{
    name: '12ch',
    channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'Color Wheel', 'Gobo', 'Reset'],
    channelCount: 12
  }],
  physical: { panRange: 540, tiltRange: 270 }
}

/** RGB par without a dimmer channel */
export const RGB_PAR: FixtureDefinition = {
  id: 'test/rgb-par',
  name: 'Test RGB Par',
  manufacturer: 'Test',
  categories: ['Color Changer'],
  channels: {
    Red: ch('Red', 'color', { precedence: 'LTP' }),
    Green: ch('Green', 'color', { precedence: 'LTP' }),
    Blue: ch('Blue', 'color', { precedence: 'LTP' })
  },
  modes: [{ name: '3ch', channels: ['Red', 'Green', 'Blue'], channelCount: 3 }]
}

/** Single-channel dimmer */
export const DIMMER: FixtureDefinition = {
  id: 'test/dimmer',
  name: 'Test Dimmer',
  manufacturer: 'Test',
  categories: ['Dimmer'],
  channels: { Intensity: ch('Intensity', 'intensity', { precedence: 'HTP' }) },
  modes: [{ name: '1ch', channels: ['Intensity'], channelCount: 1 }]
}

/** 16-bit dimmer */
export const DIMMER_16: FixtureDefinition = {
  id: 'test/dimmer16',
  name: 'Test 16-bit Dimmer',
  manufacturer: 'Test',
  categories: ['Dimmer'],
  channels: {
    Dimmer: ch('Dimmer', 'intensity', { precedence: 'HTP' }),
    'Dimmer Fine': ch('Dimmer Fine', 'intensity', { precedence: 'HTP' })
  },
  modes: [{ name: '2ch', channels: ['Dimmer', 'Dimmer Fine'], channelCount: 2 }]
}

/** CMY spot (dimmer + CMY flags) */
export const CMY_SPOT: FixtureDefinition = {
  id: 'test/cmy',
  name: 'Test CMY Spot',
  manufacturer: 'Test',
  categories: ['Moving Head'],
  channels: {
    Dimmer: ch('Dimmer', 'intensity', { precedence: 'HTP' }),
    Cyan: ch('Cyan', 'color'),
    Magenta: ch('Magenta', 'color'),
    Yellow: ch('Yellow', 'color')
  },
  modes: [{ name: '4ch', channels: ['Dimmer', 'Cyan', 'Magenta', 'Yellow'], channelCount: 4 }]
}

export const ALL_FIXTURES = [MOVING_HEAD, RGB_PAR, DIMMER, DIMMER_16, CMY_SPOT]

export function patchEntry(id: string, def: FixtureDefinition, universe: number, address: number, extra: Partial<PatchEntry> = {}): PatchEntry {
  return {
    id,
    fixtureDefId: def.id,
    modeName: def.modes[0].name,
    universe,
    address,
    name: id,
    groupIds: [],
    ...extra
  }
}

/** Absolute (0-based) channel of a named channel in a patch entry */
export function addr(entry: PatchEntry, def: FixtureDefinition, channelName: string): number {
  const i = def.modes[0].channels.indexOf(channelName)
  if (i === -1) throw new Error(`no channel ${channelName}`)
  return entry.address - 1 + i
}
