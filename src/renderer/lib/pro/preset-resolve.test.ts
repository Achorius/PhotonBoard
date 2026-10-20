import { describe, expect, it } from 'vitest'
import type { Preset } from '@shared/types'
import { ALL_FIXTURES, DIMMER, MOVING_HEAD, RGB_PAR, patchEntry } from '@renderer/lib/testing/test-fixtures'
import { channelFitsPreset, presetFamilyOfChannel, presetFixtureIds, resolvePreset, resolvePresetForFixture, resolvedScope } from './preset-resolve'

const mh = patchEntry('mh', MOVING_HEAD, 0, 1)
const mh2 = patchEntry('mh2', MOVING_HEAD, 0, 20)
const par = patchEntry('par', RGB_PAR, 0, 40)
const dim = patchEntry('dim', DIMMER, 0, 50)

describe('preset resolution (scopes)', () => {
  const colour: Preset = {
    id: 'c', name: 'Red', type: 'color',
    values: { mh: { Red: 250 } },
    typeValues: { 'test/moving-head': { Red: 200, Green: 10 } },
    universal: { red: 100, green: 0, blue: 0, speed: 5 }
  }

  it('selective → global → universal, per fixture', () => {
    expect(resolvePreset(colour, mh, MOVING_HEAD, 'Red')).toBe(250)
    expect(resolvePreset(colour, mh2, MOVING_HEAD, 'Red')).toBe(200)
    expect(resolvePreset(colour, mh2, MOVING_HEAD, 'Blue')).toBe(0)
    expect(resolvePreset(colour, par, RGB_PAR, 'Red')).toBe(100)
    expect(resolvedScope(colour, mh, MOVING_HEAD, 'Red')).toBe('selective')
    expect(resolvedScope(colour, mh2, MOVING_HEAD, 'Green')).toBe('global')
    expect(resolvedScope(colour, par, RGB_PAR, 'Green')).toBe('universal')
    expect(resolvedScope(colour, dim, DIMMER, 'Intensity')).toBeNull()
  })

  it('a universal value only reaches channels of the preset family when the fixture type is known', () => {
    const pos: Preset = { id: 'p', name: 'Centre', type: 'position', values: {}, universal: { pan: 128, tilt: 128, gobo: 4 } }
    expect(resolvePreset(pos, mh, MOVING_HEAD, 'Pan')).toBe(128)
    expect(resolvePreset(pos, mh, MOVING_HEAD, 'Gobo')).toBeUndefined()
    expect(resolvePreset(pos, mh, undefined, 'Gobo')).toBe(4) // unknown type: no family check
    const full: Preset = { ...pos, type: 'full' }
    expect(resolvePreset(full, mh, MOVING_HEAD, 'Gobo')).toBe(4)
  })

  it('clamps stored values and ignores non-numbers', () => {
    const p = { id: 'x', name: '', type: 'full', values: { mh: { Pan: 999, Tilt: Number.NaN } } } as Preset
    expect(resolvePreset(p, mh, MOVING_HEAD, 'Pan')).toBe(255)
    expect(resolvePreset(p, mh, MOVING_HEAD, 'Tilt')).toBeUndefined()
  })

  it('every value a preset gives a fixture, in channel order; fixtures it reaches', () => {
    expect([...resolvePresetForFixture(colour, mh2, MOVING_HEAD)]).toEqual([['Red', 200], ['Green', 10], ['Blue', 0]])
    expect([...resolvePresetForFixture(colour, par, RGB_PAR)]).toEqual([['Red', 100], ['Green', 0], ['Blue', 0]])
    // Unknown definition: the stored keys
    expect([...resolvePresetForFixture(colour, mh2, undefined)]).toEqual([['Red', 200], ['Green', 10]])
    expect(presetFixtureIds(colour, [mh, mh2, par, dim], ALL_FIXTURES)).toEqual(['mh', 'mh2', 'par'])
  })

  it('families of channels', () => {
    expect(presetFamilyOfChannel(MOVING_HEAD, 'Gobo')).toBe('gobo')
    expect(presetFamilyOfChannel(MOVING_HEAD, 'Pan Fine')).toBe('position')
    expect(presetFamilyOfChannel(MOVING_HEAD, 'Dimmer')).toBe('intensity')
    expect(channelFitsPreset('color', MOVING_HEAD, 'Color Wheel')).toBe(true)
    expect(channelFitsPreset('color', MOVING_HEAD, 'Pan')).toBe(false)
    expect(channelFitsPreset('full', MOVING_HEAD, 'Pan')).toBe(true)
  })
})
