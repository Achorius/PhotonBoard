import { describe, it, expect } from 'vitest'
import {
  applyMasters,
  buildChannelInfo,
  mixLayers,
  strobePhaseAt,
  PROGRAMMER_LAYER_ID,
  type LayerChannels,
  type MasterState,
  type MixerLayer
} from './dmx-mixer'
import { classifyModeChannels, ChannelRole } from './channel-classify'
import { MOVING_HEAD, RGB_PAR, DIMMER, DIMMER_16, ALL_FIXTURES, patchEntry, addr } from './testing/test-fixtures'

const U = 512

const mh = patchEntry('mh', MOVING_HEAD, 0, 1)
const par = patchEntry('par', RGB_PAR, 0, 101)
const dim = patchEntry('dim', DIMMER, 0, 201)
const dim16 = patchEntry('dim16', DIMMER_16, 1, 1)
const patch = [mh, par, dim, dim16]
const info = buildChannelInfo(patch, ALL_FIXTURES, 2)

function layer(id: string, values: [number, number, number][], priority = 50, master = 255, activatedAt = 0): MixerLayer {
  const channels: LayerChannels = new Map()
  for (const [u, ch, v] of values) {
    if (!channels.has(u)) channels.set(u, new Map())
    channels.get(u)!.set(ch, v)
  }
  return { id, priority, master, activatedAt, channels }
}

function mix(layers: MixerLayer[]): Uint8Array {
  const out = new Uint8Array(info.universeCount * U)
  mixLayers(layers, info, out)
  return out
}

function output(m: Uint8Array, masters: Partial<MasterState>): Uint8Array {
  const out = new Uint8Array(m.length)
  applyMasters(m, info, { grandMaster: 255, blackout: false, blinder: false, strobe: false, strobeOn: true, ...masters }, out)
  return out
}

const PAN = addr(mh, MOVING_HEAD, 'Pan')
const TILT = addr(mh, MOVING_HEAD, 'Tilt')
const MH_DIM = addr(mh, MOVING_HEAD, 'Dimmer')
const SHUTTER = addr(mh, MOVING_HEAD, 'Shutter')
const MH_RED = addr(mh, MOVING_HEAD, 'Red')
const GOBO = addr(mh, MOVING_HEAD, 'Gobo')
const RESET = addr(mh, MOVING_HEAD, 'Reset')
const PAR_R = addr(par, RGB_PAR, 'Red')
const PAR_G = addr(par, RGB_PAR, 'Green')
const DIM = addr(dim, DIMMER, 'Intensity')

describe('channel classification', () => {
  it('classifies a moving head', () => {
    const c = classifyModeChannels(MOVING_HEAD, MOVING_HEAD.modes[0])
    const byName = Object.fromEntries(c.map(x => [x.name, x]))
    expect(byName.Dimmer.role).toBe(ChannelRole.Dimmer)
    expect(byName.Dimmer.htp).toBe(true)
    expect(byName.Pan.role).toBe(ChannelRole.Position)
    expect(byName['Pan Fine'].coarseIndex).toBe(0)
    expect(byName.Pan.fineIndex).toBe(1)
    expect(byName.Red.role).toBe(ChannelRole.Color) // has a dimmer → colour is not intensity
    expect(byName.Shutter.blinderValue).toBe(22) // middle of ShutterOpen 20-24
    expect(byName.Reset.blinderValue).toBe(-1)
  })

  it('treats the colour emitters of a dimmer-less fixture as intensity', () => {
    const c = classifyModeChannels(RGB_PAR, RGB_PAR.modes[0])
    expect(c.every(x => x.role === ChannelRole.ColorIntensity)).toBe(true)
    expect(c.every(x => x.blinderValue === 255)).toBe(true)
  })
})

describe('mixLayers', () => {
  it('outputs patch defaults when nothing plays (pan/tilt centred, shutter open)', () => {
    const m = mix([])
    expect(m[PAN]).toBe(128)
    expect(m[TILT]).toBe(128)
    expect(m[SHUTTER]).toBe(20)
    expect(m[MH_DIM]).toBe(0)
  })

  it('merges HTP channels by highest value', () => {
    const m = mix([layer('a', [[0, DIM, 100]], 80), layer('b', [[0, DIM, 200]], 20)])
    expect(m[DIM]).toBe(200)
  })

  it('merges LTP channels by priority, then latest activation', () => {
    expect(mix([layer('a', [[0, PAN, 10]], 80), layer('b', [[0, PAN, 200]], 20)])[PAN]).toBe(10)
    expect(mix([layer('a', [[0, PAN, 10]], 50, 255, 1), layer('b', [[0, PAN, 200]], 50, 255, 2)])[PAN]).toBe(200)
  })

  it('scales only intensity channels with the layer master (fader)', () => {
    const m = mix([layer('cl', [[0, MH_DIM, 200], [0, PAN, 60], [0, GOBO, 40], [0, MH_RED, 255], [0, PAR_R, 200]], 50, 128)])
    expect(m[MH_DIM]).toBe(Math.round(200 * 128 / 255))
    expect(m[PAN]).toBe(60)
    expect(m[GOBO]).toBe(40)
    expect(m[MH_RED]).toBe(255) // colour of a fixture with a dimmer: untouched
    expect(m[PAR_R]).toBe(Math.round(200 * 128 / 255)) // dimmer-less par: colour is its intensity
  })

  it('a layer at master 0 does not claim LTP channels', () => {
    const m = mix([layer('top', [[0, PAN, 10]], 90, 0), layer('low', [[0, PAN, 220]], 10)])
    expect(m[PAN]).toBe(220)
  })

  it('the programmer always wins', () => {
    const m = mix([layer('cl', [[0, DIM, 255], [0, PAN, 1]], 100), layer(PROGRAMMER_LAYER_ID, [[0, DIM, 10], [0, PAN, 99]], 100)])
    expect(m[DIM]).toBe(10)
    expect(m[PAN]).toBe(99)
  })

  it('never writes NaN or out-of-range values', () => {
    const m = mix([layer('bad', [[0, DIM, NaN], [0, PAN, 999], [0, GOBO, -5], [7, 3, 50], [0, 9999, 50]])])
    expect(m[DIM]).toBe(0)
    expect(m[PAN]).toBe(255)
    expect(m[GOBO]).toBe(0)
  })
})

describe('applyMasters (output stage)', () => {
  const base = mix([layer('cl', [[0, MH_DIM, 200], [0, PAN, 60], [0, TILT, 70], [0, GOBO, 40], [0, RESET, 0], [0, PAR_R, 200], [0, PAR_G, 100], [0, DIM, 255]])])

  it('grand master scales intensity only — heads do not move', () => {
    const out = output(base, { grandMaster: 128 })
    expect(out[MH_DIM]).toBe(Math.round(200 * 128 / 255))
    expect(out[DIM]).toBe(128)
    expect(out[PAR_R]).toBe(Math.round(200 * 128 / 255))
    expect(out[PAN]).toBe(60)
    expect(out[TILT]).toBe(70)
    expect(out[GOBO]).toBe(40)
  })

  it('blackout kills intensity but keeps position/gobo', () => {
    const out = output(base, { blackout: true })
    expect(out[MH_DIM]).toBe(0)
    expect(out[DIM]).toBe(0)
    expect(out[PAR_R]).toBe(0)
    expect(out[PAN]).toBe(60)
    expect(out[GOBO]).toBe(40)
  })

  it('blinder: dimmers full, shutter open, dimmer-less RGB full, nothing else touched', () => {
    const out = output(base, { blinder: true })
    expect(out[MH_DIM]).toBe(255)
    expect(out[SHUTTER]).toBe(22)
    expect(out[PAR_R]).toBe(255)
    expect(out[PAR_G]).toBe(255)
    expect(out[PAN]).toBe(60)
    expect(out[TILT]).toBe(70)
    expect(out[GOBO]).toBe(40)
    expect(out[RESET]).toBe(0) // never fires a lamp-off / reset macro
    expect(out[MH_RED]).toBe(base[MH_RED])
  })

  it('blackout wins over blinder', () => {
    const out = output(base, { blinder: true, blackout: true })
    expect(out[MH_DIM]).toBe(0)
    expect(out[PAN]).toBe(60)
  })

  it('strobe toggles intensity only', () => {
    const dark = output(base, { strobe: true, strobeOn: false })
    expect(dark[MH_DIM]).toBe(0)
    expect(dark[PAR_R]).toBe(0)
    expect(dark[PAN]).toBe(60)
    const lit = output(base, { strobe: true, strobeOn: true })
    expect(lit[MH_DIM]).toBe(200)
  })

  it('scales a 16-bit dimmer on the combined value', () => {
    const coarse = 1 * U + 0
    const fine = 1 * U + 1
    const m = mix([layer('cl', [[1, 0, 0x80], [1, 1, 0x00]])])
    const out = output(m, { grandMaster: 128 })
    const v16 = out[coarse] * 256 + out[fine]
    expect(v16).toBe(Math.round(0x8000 * 128 / 255))
  })

  it('strobe phase alternates at the requested rate', () => {
    // 10 Hz → 50 ms lit, 50 ms dark
    expect(strobePhaseAt(0, 10)).toBe(true)
    expect(strobePhaseAt(60, 10)).toBe(false)
    expect(strobePhaseAt(110, 10)).toBe(true)
  })
})

describe('buildChannelInfo', () => {
  it('grows the universe count to cover the patch', () => {
    const i = buildChannelInfo([patchEntry('x', DIMMER, 5, 1)], ALL_FIXTURES, 3)
    expect(i.universeCount).toBe(6)
  })

  it('rebuilds a different description when a fixture is re-addressed', () => {
    const moved = buildChannelInfo([{ ...dim, address: 300 }], ALL_FIXTURES, 1)
    expect(moved.htp[299]).toBe(1)
    expect(moved.htp[200]).toBe(0)
  })
})
