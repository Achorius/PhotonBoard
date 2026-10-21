import { describe, expect, it } from 'vitest'
import { DmxEngine } from './dmx-engine'
import { MAX_UNIVERSES } from '../shared/types'

describe('DmxEngine', () => {
  it('drives every universe the UI can patch (default MAX_UNIVERSES)', () => {
    const engine = new DmxEngine()
    expect(engine.getUniverseCount()).toBe(MAX_UNIVERSES)
    engine.setChannel(MAX_UNIVERSES - 1, 511, 200)
    engine.setChannel(3, 0, 42)
    expect(engine.getChannel(MAX_UNIVERSES - 1, 511)).toBe(200)
    expect(engine.getUniverse(3)[0]).toBe(42)
    // Out of range is still ignored
    engine.setChannel(MAX_UNIVERSES, 0, 255)
    expect(engine.getChannel(MAX_UNIVERSES, 0)).toBe(0)
  })
})

describe('DmxEngine strobe chop (in step with the output frames)', () => {
  const pattern = (engine: DmxEngine, frames: number, now = 0): string => {
    let s = ''
    for (let i = 0; i < frames; i++) s += engine.chopFrameData(now).universes[0][5] ? 'L' : 'D'
    return s
  }
  const make = () => {
    const e = new DmxEngine(2)
    e.setChannel(0, 5, 200)
    e.setChannel(0, 6, 99)
    return e
  }

  it('even flashes at 40 fps: 10 Hz = 2 lit + 2 dark, 20 Hz = 1 + 1, 15 Hz = 1 + 2, 5 Hz = 4 + 4', () => {
    const e = make()
    e.setStrobeChop(10, { 0: [5] }, 0)
    expect(pattern(e, 8)).toBe('LLDDLLDD')
    e.setStrobeChop(20, { 0: [5] }, 0)
    expect(pattern(e, 6)).toBe('LDLDLD')
    e.setStrobeChop(15, { 0: [5] }, 0)
    expect(pattern(e, 6)).toBe('LDDLDD')
    e.setStrobeChop(5, { 0: [5] }, 0)
    expect(pattern(e, 8)).toBe('LLLLDDDD')
  })

  it('only the masked channels go dark; the engine buffer itself is untouched', () => {
    const e = make()
    e.setStrobeChop(20, { 0: [5] }, 0)
    e.chopFrameData(0)
    const dark = e.chopFrameData(0)
    expect(dark.universes[0][5]).toBe(0)
    expect(dark.universes[0][6]).toBe(99)
    expect(e.getChannel(0, 5)).toBe(200)
  })

  it('reports a change on every lit/dark transition; off and expiry restore the plain frames', () => {
    const e = make()
    e.setStrobeChop(20, { 0: [5] }, 0)
    expect(e.chopFrameData(0).changed).toBe(false)
    expect(e.chopFrameData(0).changed).toBe(true)
    expect(e.chopFrameData(0).changed).toBe(true)
    e.setStrobeChop(null)
    expect(e.getStrobeChop()).toBeNull()
    e.setStrobeChop(20, { 0: [5] }, 0, 2000)
    expect(e.chopFrameData(2001).universes[0][5]).toBe(200) // not refreshed: expired
    expect(e.getStrobeChop()).toBeNull()
  })
})
