// Golden tests of the pro cue-engine features (per-key timing, parts,
// tracking off, block cues, preset resolution, Move-In-Black, pause,
// manual fades, retarget). The simple-mode behaviour is covered by
// cue-engine.test.ts (unchanged).
import { describe, expect, it } from 'vitest'
import type { Cue, CueChannelValue } from '@shared/types'
import {
  CueEngine, applyMoveInBlack, buildCueTiming, computeTrackedState, cueHasPerKeyTiming, mibTiming,
  type CueKeyMeta, type CueTiming
} from './cue-engine'

const DIM = 'mh:Dimmer'
const PAN = 'mh:Pan'
const PAN_FINE = 'mh:Pan Fine'
const RED = 'mh:Red'
const GOBO = 'mh:Gobo'
const DIM2 = 'par:Dimmer'
const RED2 = 'par:Red'

function meta(key: string): CueKeyMeta {
  if (key.endsWith(':Dimmer')) return { intensity: true, feature: 'intensity' }
  if (key === PAN) return { intensity: false, fineKey: PAN_FINE, feature: 'position' }
  if (key === PAN_FINE) return { intensity: false, coarseKey: PAN, feature: 'position' }
  if (key.endsWith(':Red')) return { intensity: false, feature: 'colour' }
  if (key.endsWith(':Gobo')) return { intensity: false, feature: 'beam' }
  return { intensity: false }
}

function v(key: string, value: number, extra: Partial<CueChannelValue> = {}): CueChannelValue {
  const [fixtureId, channelName] = key.split(':')
  return { fixtureId, channelName, value, ...extra }
}

function cue(values: CueChannelValue[], t: Partial<Cue> = {}): Cue {
  return { id: 'q', name: 'q', number: 1, values, fadeIn: 0, fadeOut: 0, delay: 0, followTime: null, ...t }
}

function state(values: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(values))
}

const SNAP: CueTiming = { fadeIn: 0, fadeOut: 0, delay: 0 }

function out(engine: CueEngine, now: number, id = 'cl'): Record<string, number> {
  engine.update(now)
  return Object.fromEntries(engine.getOutput(id) ?? [])
}

describe('buildCueTiming', () => {
  it('no per-key data → no table (fast path), times divided by the rate', () => {
    const c = cue([v(DIM, 255)], { fadeIn: 2, fadeOut: 4, delay: 1 })
    expect(cueHasPerKeyTiming(c)).toBe(false)
    expect(buildCueTiming(c, [DIM], meta)).toEqual({ fadeIn: 2, fadeOut: 4, delay: 1 })
    expect(buildCueTiming(c, [DIM], meta, 2)).toEqual({ fadeIn: 1, fadeOut: 2, delay: 0.5 })
    expect(buildCueTiming(c, [DIM], meta, 0)).toEqual({ fadeIn: 2, fadeOut: 4, delay: 1 }) // invalid rate → 1
  })

  it('precedence value → part → feature → cue', () => {
    const c = cue([
      v(DIM, 255),
      v(PAN, 10),
      v(RED, 20, { part: 1 }),
      v(GOBO, 30, { part: 1, fade: 9, delay: 0.5 })
    ], {
      fadeIn: 2, fadeOut: 3, delay: 0,
      featureTiming: { position: { fade: 5, delay: 1 }, colour: { fade: 6 }, beam: { delay: 7 }, intensity: { fade: 1 } },
      parts: [{ index: 1, fade: 4, delay: 2 }]
    })
    const t = buildCueTiming(c, [DIM, PAN, RED, GOBO, DIM2], meta)
    expect(t.perKey?.get(PAN)).toEqual({ delayMs: 1000, upMs: 5000, downMs: 3000 }) // feature
    expect(t.perKey?.get(RED)).toEqual({ delayMs: 2000, upMs: 4000, downMs: 4000 }) // part over feature
    expect(t.perKey?.get(GOBO)).toEqual({ delayMs: 500, upMs: 9000, downMs: 9000 }) // value over part
    // intensity feature fade = fade-in only; fade-out stays the cue's
    expect(t.perKey?.get(DIM)).toEqual({ delayMs: 0, upMs: 1000, downMs: 3000 })
    // tracked / released keys use feature then cue timing
    expect(t.perKey?.get(DIM2)).toEqual({ delayMs: 0, upMs: 1000, downMs: 3000 })
  })

  it('a part with a fade-out; the rate divides every per-key time', () => {
    const c = cue([v(DIM, 0, { part: 2 })], { fadeIn: 1, fadeOut: 1, parts: [{ index: 2, fade: 2, fadeOut: 8 }] })
    expect(buildCueTiming(c, [DIM], meta, 2).perKey?.get(DIM)).toEqual({ delayMs: 0, upMs: 1000, downMs: 4000 })
    expect(buildCueTiming(c, [DIM], meta, 2).fadeIn).toBe(0.5)
  })
})

describe('computeTrackedState options', () => {
  const cues = [
    cue([v(DIM, 255), v(PAN, 100)]),
    cue([v(DIM, 128)]),
    cue([v(PAN, 200)], { block: true }),
    cue([v(RED, 50)])
  ]

  it('tracking off: a cue plays only its own values', () => {
    expect(Object.fromEntries(computeTrackedState(cues, 1, { tracking: false }))).toEqual({ [DIM]: 128 })
  })

  it('a block cue stops tracking', () => {
    expect(Object.fromEntries(computeTrackedState(cues, 1))).toEqual({ [DIM]: 128, [PAN]: 100 })
    expect(Object.fromEntries(computeTrackedState(cues, 2))).toEqual({ [PAN]: 200 })
    expect(Object.fromEntries(computeTrackedState(cues, 3))).toEqual({ [PAN]: 200, [RED]: 50 })
  })

  it('preset references resolve at GO time (stored value as fallback)', () => {
    const withRef = [cue([v(RED, 10, { presetId: 'p1' }), v(GOBO, 40, { presetId: 'gone' }), v(PAN, 5)])]
    const resolve = (cv: CueChannelValue) => (cv.presetId === 'p1' ? 222 : undefined)
    expect(Object.fromEntries(computeTrackedState(withRef, 0, { resolve }))).toEqual({ [RED]: 222, [GOBO]: 40, [PAN]: 5 })
    expect(Object.fromEntries(computeTrackedState(withRef, 0))).toEqual({ [RED]: 10, [GOBO]: 40, [PAN]: 5 })
  })
})

describe('CueEngine per-key timing', () => {
  it('each key runs its own delay and fade; the fast path is untouched', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 0, [PAN]: 0, [RED]: 0 }), SNAP, 0)
    engine.update(0)
    const c = cue([v(DIM, 255), v(PAN, 200, { delay: 1, fade: 1 }), v(RED, 100, { fade: 4 })], { fadeIn: 2, fadeOut: 2 })
    const target = state({ [DIM]: 255, [PAN]: 200, [RED]: 100 })
    engine.go('cl', target, buildCueTiming(c, target.keys(), meta), 0)
    expect(out(engine, 1000)).toEqual({ [DIM]: 128, [PAN]: 0, [RED]: 16 }) // pan still in its delay; red smoothstep(0.25)
    expect(out(engine, 1500)).toEqual({ [DIM]: 215, [PAN]: 100, [RED]: 32 })
    expect(out(engine, 2000)[PAN]).toBe(200)
    expect(engine.isFading('cl')).toBe(true) // red takes 4 s
    expect(out(engine, 4000)).toEqual({ [DIM]: 255, [PAN]: 200, [RED]: 100 })
    expect(engine.isFading('cl')).toBe(false)
  })

  it('a key new to the cuelist is not output before its own delay', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 100 }), SNAP, 0)
    engine.update(0)
    const c = cue([v(DIM, 100), v(GOBO, 50, { delay: 2 })])
    const target = state({ [DIM]: 100, [GOBO]: 50 })
    engine.go('cl', target, buildCueTiming(c, target.keys(), meta), 0)
    expect(out(engine, 1000)).toEqual({ [DIM]: 100 })
    expect(out(engine, 2000)).toEqual({ [DIM]: 100, [GOBO]: 50 })
  })

  it('16-bit pairs follow the timing of their coarse channel', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [PAN]: 0, [PAN_FINE]: 0 }), SNAP, 0)
    engine.update(0)
    const c = cue([v(PAN, 2, { fade: 2 }), v(PAN_FINE, 0)], { fadeIn: 0 })
    const target = state({ [PAN]: 2, [PAN_FINE]: 0 })
    engine.go('cl', target, buildCueTiming(c, target.keys(), meta), 0)
    const mid = out(engine, 1000)
    expect(mid[PAN] * 256 + mid[PAN_FINE]).toBe(256)
  })

  it('released intensity uses the cue fade-out unless a feature delay applies', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [DIM]: 200 }), SNAP, 0)
    engine.update(0)
    const c = cue([v(DIM2, 255)], { fadeIn: 0, fadeOut: 2, featureTiming: { intensity: { delay: 1 } } })
    const target = state({ [DIM2]: 255 })
    engine.go('cl', target, buildCueTiming(c, [DIM2, DIM], meta), 0)
    expect(out(engine, 1000)).toEqual({ [DIM]: 200, [DIM2]: 255 })
    expect(out(engine, 2000)[DIM]).toBe(100)
    expect(out(engine, 3000)).toEqual({ [DIM2]: 255 }) // released at the end
  })
})

describe('Move-In-Black', () => {
  const cues = [
    cue([v(DIM, 255), v(PAN, 10), v(DIM2, 255), v(RED2, 0)]),
    cue([v(DIM, 0), v(DIM2, 255)]), // mh dark in Q2
    cue([v(DIM, 255), v(PAN, 200), v(GOBO, 3), v(RED2, 255)]) // mh lit again in Q3 with a new position
  ]

  it('pre-positions non-intensity values of fixtures dark now and lit next (pure)', () => {
    expect(Object.fromEntries(applyMoveInBlack(cues, 1, meta))).toEqual({ [PAN]: 200, [GOBO]: 3 })
    // the par stays lit → never moved in black; Q1 → Q2: mh is lit in Q1
    expect(applyMoveInBlack(cues, 0, meta).size).toBe(0)
    // no next cue (unless given, e.g. looping)
    expect(applyMoveInBlack(cues, 2, meta).size).toBe(0)
    expect(applyMoveInBlack(cues, 2, meta, { nextIndex: 0 }).size).toBe(0)
  })

  it('MIB moves wait for the fade-out of the fixture, then the MIB delay, in the MIB fade', () => {
    const keys = [DIM, DIM2, PAN, GOBO]
    const timing = mibTiming({ fadeIn: 1, fadeOut: 2, delay: 0.5 }, [PAN, GOBO], { delay: 1, fade: 3 }, keys, meta)
    expect(timing.perKey?.get(PAN)).toEqual({ delayMs: 3500, upMs: 3000, downMs: 3000 })
    expect(timing.perKey?.get(DIM)).toBeUndefined() // other keys keep cue-level timing
    // `timing` is already rate-divided (buildCueTiming); the MIB times are divided here
    const fast = mibTiming({ fadeIn: 0.5, fadeOut: 1, delay: 0.25 }, [PAN], { delay: 1, fade: 3 }, keys, meta, 2)
    expect(fast.perKey?.get(PAN)).toEqual({ delayMs: 1750, upMs: 1500, downMs: 1500 })
  })

  it('engine: the position moves only once the fixture is dark', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', computeTrackedState(cues, 0), SNAP, 0)
    engine.update(0)
    const target = computeTrackedState(cues, 1)
    const mib = applyMoveInBlack(cues, 1, meta)
    for (const [k, val] of mib) target.set(k, val)
    const keys = new Set([...target.keys(), ...engine.getOutput('cl')!.keys()])
    const q2 = { ...cues[1], fadeOut: 1 }
    const timing = mibTiming(buildCueTiming(q2, keys, meta), mib.keys(), { delay: 0, fade: 0 }, keys, meta)
    engine.go('cl', target, timing, 0)
    expect(out(engine, 500)[PAN]).toBe(10) // fading out, not moved
    expect(out(engine, 1000)).toMatchObject({ [DIM]: 0, [PAN]: 200, [GOBO]: 3 })
  })
})

describe('pause / manual / retarget', () => {
  it('pause freezes a fade, resume continues where it stopped', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [GOBO]: 0 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [GOBO]: 200 }), { fadeIn: 2, fadeOut: 2, delay: 0 }, 0)
    expect(out(engine, 1000)[GOBO]).toBe(100)
    expect(engine.pause('cl', 1000)).toBe(true)
    expect(engine.isPaused('cl')).toBe(true)
    expect(out(engine, 5000)[GOBO]).toBe(100)
    expect(engine.isFading('cl')).toBe(true)
    engine.resume('cl', 5000)
    expect(out(engine, 5500)[GOBO]).toBe(169) // 1.5 s of 2 s
    expect(out(engine, 6000)[GOBO]).toBe(200)
    expect(engine.isFading('cl')).toBe(false)
  })

  it('a new GO from a paused fade starts from the frozen output', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [GOBO]: 0 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [GOBO]: 200 }), { fadeIn: 2, fadeOut: 2, delay: 0 }, 0)
    engine.pause('cl', 1000)
    engine.go('cl', state({ [GOBO]: 0 }), { fadeIn: 1, fadeOut: 1, delay: 0 }, 3000)
    expect(engine.isPaused('cl')).toBe(false)
    expect(out(engine, 3000)[GOBO]).toBe(100)
    expect(out(engine, 3500)[GOBO]).toBe(50)
  })

  it('a manual fade follows its progress (per-key proportions kept) and completes at 1', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [GOBO]: 0, [RED]: 0 }), SNAP, 0)
    engine.update(0)
    const c = cue([v(GOBO, 200), v(RED, 200, { delay: 2, fade: 2 })], { fadeIn: 2 })
    const target = state({ [GOBO]: 200, [RED]: 200 })
    engine.go('cl', target, buildCueTiming(c, target.keys(), meta), 0, { manual: true })
    expect(engine.isManual('cl')).toBe(true)
    expect(out(engine, 99999)).toEqual({ [GOBO]: 0, [RED]: 0 }) // the clock does nothing
    engine.setManualProgress('cl', 0.5) // 2 s of 4 s
    expect(out(engine, 0)).toEqual({ [GOBO]: 200, [RED]: 0 })
    engine.setManualProgress('cl', 0.75)
    expect(out(engine, 0)[RED]).toBe(100)
    expect(engine.pause('cl', 0)).toBe(false) // manual fades do not pause
    engine.setManualProgress('cl', 1)
    const r = engine.update(0)
    expect(r.completed).toEqual(['cl'])
    expect(engine.getOutput('cl')?.get(RED)).toBe(200)
  })

  it('retarget: a running fade heads to the new values, an idle cuelist snaps', () => {
    const engine = new CueEngine({ meta })
    engine.go('cl', state({ [RED]: 0 }), SNAP, 0)
    engine.update(0)
    engine.go('cl', state({ [RED]: 100 }), { fadeIn: 2, fadeOut: 2, delay: 0 }, 0)
    engine.retarget('cl', state({ [RED]: 200 }), 0)
    expect(out(engine, 1000)[RED]).toBe(100)
    expect(out(engine, 2000)[RED]).toBe(200)
    engine.retarget('cl', state({ [RED]: 50 }), 3000)
    expect(out(engine, 3000)[RED]).toBe(50)
    engine.retarget('nope', state({ [RED]: 1 }), 0)
    expect(engine.has('nope')).toBe(false)
  })
})
