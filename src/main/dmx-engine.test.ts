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
