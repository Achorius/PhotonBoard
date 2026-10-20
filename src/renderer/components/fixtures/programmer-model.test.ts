import { describe, expect, it } from 'vitest'
import type { FixtureDefinition, PatchEntry } from '@shared/types'
import { buildProgrammerModel, colourWrites, nearestSlot, STANDARD_COLOUR_WHEEL, summarize, targetChannels, targetWrites } from './programmer-model'
import { hsvToRgb, rgbToHsv } from './colour-math'

const spot: FixtureDefinition = {
  id: 'test/spot',
  name: 'Spot',
  manufacturer: 'Test',
  categories: ['Moving Head'],
  channels: {
    Pan: { name: 'Pan', type: 'pan', defaultValue: 128 },
    'Pan Fine': { name: 'Pan Fine', type: 'pan' },
    Tilt: { name: 'Tilt', type: 'tilt', defaultValue: 128 },
    Dimmer: { name: 'Dimmer', type: 'intensity' },
    Shutter: {
      name: 'Shutter', type: 'shutter', capabilities: [
        { dmxRange: [0, 19], type: 'ShutterClose', label: 'Closed' },
        { dmxRange: [20, 24], type: 'ShutterOpen', label: 'Open' },
        { dmxRange: [64, 95], type: 'StrobeSpeed', label: 'Strobe' }
      ]
    },
    'Color Wheel': { name: 'Color Wheel', type: 'color', capabilities: [{ dmxRange: [0, 255], type: 'WheelSlot', label: 'Color Wheel' }] },
    Zoom: { name: 'Zoom', type: 'generic' },
    Speed: { name: 'Speed', type: 'speed' }
  },
  modes: [{ name: '8ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Dimmer', 'Shutter', 'Color Wheel', 'Zoom', 'Speed'], channelCount: 8 }]
}

const bar: FixtureDefinition = {
  id: 'test/bar',
  name: 'Bar',
  manufacturer: 'Test',
  categories: ['Pixel Bar'],
  channels: {
    'Master Dimmer': { name: 'Master Dimmer', type: 'intensity' },
    'Red 1': { name: 'Red 1', type: 'color' }, 'Green 1': { name: 'Green 1', type: 'color' }, 'Blue 1': { name: 'Blue 1', type: 'color' },
    'Red 2': { name: 'Red 2', type: 'color' }, 'Green 2': { name: 'Green 2', type: 'color' }, 'Blue 2': { name: 'Blue 2', type: 'color' }
  },
  modes: [{
    name: '7ch',
    channels: ['Master Dimmer', 'Red 1', 'Green 1', 'Blue 1', 'Red 2', 'Green 2', 'Blue 2'],
    channelCount: 7,
    pixelLayout: {
      cellCount: 2,
      orientation: 'horizontal',
      cells: [
        { index: 0, channelOffset: 1, channelNames: ['Red 1', 'Green 1', 'Blue 1'] },
        { index: 1, channelOffset: 4, channelNames: ['Red 2', 'Green 2', 'Blue 2'] }
      ]
    }
  }]
}

const entry = (id: string, def: string, mode: string, address: number, universe = 0): PatchEntry =>
  ({ id, fixtureDefId: def, modeName: mode, universe, address, name: id, groupIds: [] })

const values = (): number[][] => [new Array(512).fill(0), new Array(512).fill(0)]

describe('buildProgrammerModel', () => {
  const model = buildProgrammerModel([entry('s1', 'test/spot', '8ch', 1), entry('s2', 'test/spot', '8ch', 11), entry('b1', 'test/bar', '7ch', 1, 1)], [spot, bar])

  it('groups channels into features in console order', () => {
    expect(model.byFeature.intensity.map((a) => a.key)).toEqual(['dimmer'])
    expect(model.byFeature.position.map((a) => a.key)).toEqual(['pan', 'tilt'])
    expect(model.byFeature.colour.map((a) => a.key)).toEqual(['red', 'green', 'blue', 'color wheel'])
    expect(model.byFeature.beam.map((a) => a.key)).toEqual(['shutter', 'zoom'])
    expect(model.byFeature.control.map((a) => a.key)).toEqual(['speed'])
  })

  it('merges dimmer aliases and multi-cell channels across fixtures', () => {
    const dimmer = model.byKey.get('dimmer')!
    expect(dimmer.fixtureIds).toEqual(['s1', 's2', 'b1'])
    const red = model.byKey.get('red')!
    expect(red.cells).toBe(true)
    expect(red.targets.map((t) => [t.universe, t.coarse])).toEqual([[1, 1], [1, 4]])
  })

  it('pairs 16-bit coarse / fine', () => {
    const pan = model.byKey.get('pan')!
    expect(pan.fine).toBe(true)
    expect(pan.max).toBe(65535)
    expect(pan.targets[0]).toMatchObject({ coarse: 0, fine: 1 })
    expect(model.byKey.get('tilt')!.fine).toBe(false)
  })

  it('exposes labelled ranges and the standard colour wheel', () => {
    expect(model.byKey.get('shutter')!.ranges.map((r) => r.label)).toEqual(['Closed', 'Open', 'Strobe'])
    expect(model.byKey.get('color wheel')!.ranges).toBe(STANDARD_COLOUR_WHEEL)
  })

  it('summarizes mixed values and writes 16-bit values', () => {
    const v = values()
    v[0][3] = 255 // s1 dimmer
    v[0][13] = 51 // s2 dimmer
    expect(summarize(v, model.byKey.get('dimmer')!)).toEqual({ first: 255, min: 0, max: 255 })
    expect(summarize(v, model.byKey.get('dimmer')!, 's2')).toEqual({ first: 51, min: 51, max: 51 })
    const pan = model.byKey.get('pan')!
    expect(targetWrites(pan.targets[0], 0x1234, true)).toEqual([[0, 0x12], [1, 0x34]])
    expect(targetChannels(pan.targets)).toEqual({ 0: [0, 1, 10, 11] })
  })
})

describe('colour helpers', () => {
  it('extracts white on RGBW and inverts for CMY', () => {
    expect(Object.fromEntries(colourWrites(new Set(['red', 'green', 'blue', 'white']), [255, 128, 0]))).toEqual({ white: 0, red: 255, green: 128, blue: 0 })
    expect(Object.fromEntries(colourWrites(new Set(['red', 'green', 'blue', 'white']), [255, 255, 255]))).toEqual({ white: 255, red: 0, green: 0, blue: 0 })
    expect(Object.fromEntries(colourWrites(new Set(['cyan', 'magenta', 'yellow']), [255, 0, 0]))).toEqual({ cyan: 0, magenta: 255, yellow: 255 })
  })

  it('finds the nearest wheel slot', () => {
    expect(nearestSlot(STANDARD_COLOUR_WHEEL, [250, 40, 40])?.label).toBe('Red')
    expect(nearestSlot(STANDARD_COLOUR_WHEEL, [255, 255, 255])?.label).toBe('Open')
  })

  it('round-trips HSV', () => {
    const [r, g, b] = hsvToRgb(200, 0.5, 0.8)
    const hsv = rgbToHsv(r, g, b)
    expect(Math.round(hsv.h)).toBe(200)
    expect(hsv.s).toBeCloseTo(0.5, 1)
    expect(hsv.v).toBeCloseTo(0.8, 1)
  })
})
