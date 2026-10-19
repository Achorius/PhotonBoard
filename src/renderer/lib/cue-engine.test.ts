import { describe, it, expect } from 'vitest'
import type { Cue } from '@shared/types'
import { CueEngine, computeTrackedState } from './cue-engine'
import type { KeyMeta } from './fixture-index'

const DIM = 'mh:Dimmer'
const DIM2 = 'par:Dimmer'
const PAN = 'mh:Pan'
const PAN_FINE = 'mh:Pan Fine'
const GOBO = 'mh:Gobo'

function meta(key: string): KeyMeta {
  if (key.endsWith(':Dimmer')) return { intensity: true }
  if (key === PAN) return { intensity: false, fineKey: PAN_FINE }
  if (key === PAN_FINE) return { intensity: false, coarseKey: PAN }
  return { intensity: false }
}

function cue(id: string, values: Record<string, number>, t: Partial<Cue> = {}): Cue {
  return {
    id,
    name: id,
    number: 1,
    values: Object.entries(values).map(([k, value]) => {
      const [fixtureId, channelName] = k.split(':')
      return { fixtureId, channelName, value }
    }),
    fadeIn: 0,
    fadeOut: 0,
    delay: 0,
    followTime: null,
    ...t
  }
}

function state(values: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(values))
}

const SNAP = { fadeIn: 0, fadeOut: 0, delay: 0 }

function out(engine: CueEngine, id: string, now: number): Record<string, number> {
  engine.update(now)
  return Object.fromEntries(engine.getOutput(id) ?? [])
}

describe('computeTrackedState', () => {
  const cues = [
    cue('1', { [DIM]: 255, [PAN]: 100 }),
    cue('2', { [DIM]: 128 }),
    cue('3', { [PAN]: 200 })
  ]

  it('accumulates values across cues (later cues win)', () => {
    expect(Object.fromEntries(computeTrackedState(cues, 0))).toEqual({ [DIM]: 255, [PAN]: 100 })
    expect(Object.fromEntries(computeTrackedState(cues, 1))).toEqual({ [DIM]: 128, [PAN]: 100 })
    expect(Object.fromEntries(computeTrackedState(cues, 2))).toEqual({ [DIM]: 128, [PAN]: 200 })
  })

  it('ignores malformed values', () => {
    const bad = cue('x', {})
    bad.values = [{ fixtureId: 'a', channelName: 'Dimmer', value: NaN }, null as never]
    expect(computeTrackedState([bad], 0).size).toBe(0)
  })
})

describe('CueEngine', () => {
  it('tracks values across 3 cues without dropping tracked channels', () => {
    const engine = new CueEngine({ meta })
    const cues = [
      cue('1', { [DIM]: 255, [PAN]: 100 }),
      cue('2', { [DIM]: 128 }, { fadeOut: 1 }),
      cue('3', { [PAN]: 200 }, { fadeIn: 1 })
    ]
    engine.go('cl', computeTrackedState(cues, 0), SNAP, 0)
    expect(out(engine, 'cl', 0)).toEqual({ [DIM]: 255, [PAN]: 100 })

    engine.go('cl', computeTrackedState(cues, 1), cues[1], 1000)
    const mid = out(engine, 'cl', 1500)
    expect(mid[PAN]).toBe(100) // tracked: never jumps to 0
    expect(mid[DIM]).toBeGreaterThan(128)
    expect(mid[DIM]).toBeLessThan(255)
    expect(out(engine, 'cl', 2000)).toEqual({ [DIM]: 128, [PAN]: 100 })

    engine.go('cl', computeTrackedState(cues, 2), cues[2], 3000)
    const mid3 = out(engine, 'cl', 3500)
    expect(mid3[DIM]).toBe(128)
    expect(mid3[PAN]).toBe(150) // smoothstep(0.5) = 0.5
    expect(out(engine, 'cl', 4000)).toEqual({ [DIM]: 128, [PAN]: 200 })
  })

  it('GO during a fade starts from the current output, not the previous target', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 0 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [DIM]: 255 }), { fadeIn: 2, fadeOut: 2, delay: 0 }, 0)
    expect(out(engine, 'cl', 1000)[DIM]).toBe(128) // halfway up

    engine.go('cl', state({ [DIM]: 0 }), { fadeIn: 1, fadeOut: 1, delay: 0 }, 1000)
    expect(out(engine, 'cl', 1000)[DIM]).toBe(128) // no jump to 255
    expect(out(engine, 'cl', 1500)[DIM]).toBe(64)
    expect(out(engine, 'cl', 2000)[DIM]).toBe(0)
  })

  it('uses fade-in for intensity going up and fade-out for going down', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 0, [DIM2]: 255 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [DIM]: 255, [DIM2]: 0 }), { fadeIn: 0, fadeOut: 2, delay: 0 }, 100)
    const t = out(engine, 'cl', 101)
    expect(t[DIM]).toBe(255) // snap up (fade-in 0)
    expect(t[DIM2]).toBeGreaterThan(250) // still fading down
    expect(out(engine, 'cl', 1100)[DIM2]).toBe(128)
    expect(out(engine, 'cl', 2100)[DIM2]).toBe(0)
  })

  it('a snap cue (0/0) is instant — not a 2 s fade', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 255, [PAN]: 10 }), SNAP, 0)
    const r = engine.update(0)
    expect(Object.fromEntries(r.changed.get('cl')!)).toEqual({ [DIM]: 255, [PAN]: 10 })
    expect(r.completed).toEqual(['cl'])
    for (const v of engine.getOutput('cl')!.values()) expect(Number.isFinite(v)).toBe(true)
  })

  it('LTP channels use the fade-in time', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [GOBO]: 0 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [GOBO]: 100 }), { fadeIn: 1, fadeOut: 5, delay: 0 }, 0)
    expect(out(engine, 'cl', 1000)[GOBO]).toBe(100)
  })

  it('delay holds the current output (tracked values kept), then fades', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 200, [PAN]: 50 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [DIM]: 0, [PAN]: 50 }), { fadeIn: 0, fadeOut: 0, delay: 1 }, 0)
    expect(out(engine, 'cl', 500)).toEqual({ [DIM]: 200, [PAN]: 50 })
    expect(engine.isFading('cl')).toBe(true)
    expect(out(engine, 'cl', 1000)).toEqual({ [DIM]: 0, [PAN]: 50 })
    expect(engine.isFading('cl')).toBe(false)
  })

  it('releases intensity that is no longer in the cue and holds LTP', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 255, [GOBO]: 30 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [DIM2]: 100 }), { fadeIn: 0, fadeOut: 1, delay: 0 }, 0)
    expect(out(engine, 'cl', 500)[DIM]).toBe(128)
    const end = out(engine, 'cl', 1000)
    expect(end[DIM]).toBeUndefined() // released after fading out
    expect(end[GOBO]).toBe(30)
    expect(end[DIM2]).toBe(100)
  })

  it('a newly controlled LTP channel fades from its live value, intensity from 0', () => {
    const engine = new CueEngine({ meta, startValue: (key) => (key === GOBO ? 200 : undefined) })
    engine.go('cl', state({ [GOBO]: 0, [DIM]: 255 }), { fadeIn: 1, fadeOut: 1, delay: 0 }, 0)
    const mid = out(engine, 'cl', 500)
    expect(mid[GOBO]).toBe(100)
    expect(mid[DIM]).toBe(128)
  })

  it('interpolates 16-bit pairs on the combined value', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [PAN]: 0, [PAN_FINE]: 255 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [PAN]: 1, [PAN_FINE]: 1 }), { fadeIn: 1, fadeOut: 1, delay: 0 }, 0)
    const mid = out(engine, 'cl', 500)
    expect(mid[PAN] * 256 + mid[PAN_FINE]).toBe(256) // 255 → 257, halfway
  })

  it('go-back crossfades to the previous tracked state', () => {
    const engine = new CueEngine({ meta })
    const cues = [cue('1', { [DIM]: 100, [PAN]: 10 }), cue('2', { [PAN]: 90 })]
    engine.go('cl', computeTrackedState(cues, 1), SNAP, 0)
    engine.update(0)
    engine.go('cl', computeTrackedState(cues, 0), { fadeIn: 1, fadeOut: 1, delay: 0 }, 0)
    expect(out(engine, 'cl', 500)).toEqual({ [DIM]: 100, [PAN]: 50 })
    expect(out(engine, 'cl', 1000)).toEqual({ [DIM]: 100, [PAN]: 10 })
  })

  it('stop forgets the cuelist', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 255 }), SNAP, 0)
    engine.stop('cl')
    expect(engine.has('cl')).toBe(false)
    expect(engine.update(10).changed.size).toBe(0)
  })
})
