import { describe, it, expect } from 'vitest'
import { resolveChannels, getEffectiveColor, dmxToPanDeg, dmxToTiltDeg, dmx16ToUnit, unitToDmx16 } from './dmx-channel-resolver'
import { degreesToDmx16 } from '@renderer/stores/follow-store'
import { CMY_SPOT, RGB_PAR, patchEntry } from './testing/test-fixtures'

function universe(values: Record<number, number>): number[][] {
  const u = new Array(512).fill(0)
  for (const [ch, v] of Object.entries(values)) u[Number(ch)] = v
  return [u]
}

describe('CMY fixtures', () => {
  const entry = patchEntry('cmy', CMY_SPOT, 0, 1) // Dimmer=0, Cyan=1, Magenta=2, Yellow=3

  it('renders white with no colour flags', () => {
    const ch = resolveChannels(entry, CMY_SPOT, universe({ 0: 255 }))
    expect(getEffectiveColor(ch)).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('subtracts CMY from white (cyan → no red) instead of rendering black', () => {
    const ch = resolveChannels(entry, CMY_SPOT, universe({ 0: 255, 1: 255 }))
    expect(ch.hasCmyChannels).toBe(true)
    expect(getEffectiveColor(ch)).toEqual({ r: 0, g: 1, b: 1 })
    const yellow = getEffectiveColor(resolveChannels(entry, CMY_SPOT, universe({ 0: 255, 3: 255 })))
    expect(yellow).toEqual({ r: 1, g: 1, b: 0 })
  })

  it('applies the dimmer', () => {
    const c = getEffectiveColor(resolveChannels(entry, CMY_SPOT, universe({ 0: 0, 2: 255 })))
    expect(c).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('leaves RGB fixtures unchanged', () => {
    const par = patchEntry('par', RGB_PAR, 0, 1)
    expect(getEffectiveColor(resolveChannels(par, RGB_PAR, universe({ 0: 255 })))).toEqual({ r: 1, g: 0, b: 0 })
    expect(getEffectiveColor(resolveChannels(par, RGB_PAR, universe({})))).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('16-bit pan / tilt', () => {
  it('combines coarse and fine as MSB/LSB', () => {
    expect(dmx16ToUnit(0, 0)).toBe(0)
    expect(dmx16ToUnit(255, 255)).toBe(1)
    expect(dmx16ToUnit(128, 0)).toBeCloseTo(32768 / 65535, 9)
    // fine adds less than one coarse step
    expect(dmx16ToUnit(10, 255)).toBeLessThan(dmx16ToUnit(11, 0))
  })

  it('maps to degrees over the travel range', () => {
    expect(dmxToPanDeg(0, 0, 540)).toBe(-270)
    expect(dmxToPanDeg(255, 255, 540)).toBe(270)
    expect(dmxToTiltDeg(128, 0, 270)).toBeCloseTo(0, 0)
  })

  it('round-trips with the follow-spot conversion', () => {
    for (const deg of [-270, -100.5, 0, 33.3, 270]) {
      const { coarse, fine } = degreesToDmx16(deg, 540)
      expect(dmxToPanDeg(coarse, fine, 540)).toBeCloseTo(deg, 1)
    }
    expect(unitToDmx16(1)).toEqual({ coarse: 255, fine: 255 })
    expect(unitToDmx16(NaN)).toEqual({ coarse: 0, fine: 0 })
  })
})
