import { describe, it, expect } from 'vitest'
import type { Chase } from '@shared/types'
import { ChaseEngine, stepDurationMs } from './chase-engine'
import type { KeyMeta } from './fixture-index'

const DIM = 'f:Dimmer'
const PAN = 'f:Pan'

function meta(key: string): KeyMeta {
  return { intensity: key.endsWith(':Dimmer') }
}

/** Chase whose step i sets the dimmer to i * 10 (+ optional hold times) */
function chase(stepCount: number, opts: Partial<Chase> = {}, holds: (number | undefined)[] = []): Chase {
  return {
    id: 'ch',
    name: 'Chase',
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `s${i}`,
      values: [{ fixtureId: 'f', channelName: 'Dimmer', value: i * 10 }],
      holdTime: holds[i]
    })),
    currentStepIndex: 0,
    isPlaying: true,
    isLooping: true,
    bpm: 60, // 1 step per second
    fadePercent: 0,
    direction: 'forward',
    faderLevel: 255,
    ...opts
  }
}

/** Step index after advancing in 1 s increments */
function sequence(engine: ChaseEngine, c: Chase, steps: number): number[] {
  const seq: number[] = []
  for (let i = 0; i < steps; i++) seq.push(engine.update(c, i * 1000 + 1)!.stepIndex)
  return seq
}

describe('ChaseEngine', () => {
  it('runs forward / backward', () => {
    const e = new ChaseEngine(meta)
    const fwd = chase(3)
    e.start(fwd, 0)
    expect(sequence(e, fwd, 5)).toEqual([0, 1, 2, 0, 1])

    const bwd = chase(3, { direction: 'backward' })
    e.start(bwd, 0)
    expect(sequence(e, bwd, 5)).toEqual([2, 1, 0, 2, 1])
  })

  it('bounces and crossfades toward the step that actually comes next', () => {
    const e = new ChaseEngine(meta)
    const c = chase(3, { direction: 'bounce', fadePercent: 100 })
    e.start(c, 0)
    expect(sequence(e, c, 6)).toEqual([0, 1, 2, 1, 0, 1])

    // Descending: on step 2 halfway → value heads to step 1 (10), not step 3
    const e2 = new ChaseEngine(meta)
    e2.start(c, 0)
    e2.update(c, 2000) // now on step 2 (value 20), going down
    const f = e2.update(c, 2500)!
    expect(f.stepIndex).toBe(2)
    expect(f.values.get(DIM)).toBe(15) // between 20 and 10
  })

  it('random direction crossfades to the step it will play next', () => {
    const picks = [0.0, 0.9, 0.1, 0.6]
    let i = 0
    const e = new ChaseEngine(meta, () => picks[i++ % picks.length])
    const c = chase(4, { direction: 'random', fadePercent: 100 })
    e.start(c, 0)
    const first = e.update(c, 0)!
    const half = e.update(c, 500)!
    const after = e.update(c, 1000)!
    expect(after.stepIndex).not.toBe(first.stepIndex) // never repeats
    const from = first.stepIndex * 10
    const to = after.stepIndex * 10
    expect(half.values.get(DIM)).toBe(Math.round((from + to) / 2))
  })

  it('keeps its position when the BPM changes (no step jump)', () => {
    const e = new ChaseEngine(meta)
    const c = chase(8)
    e.start(c, 0)
    expect(e.update(c, 5500)!.stepIndex).toBe(5)
    // Double the tempo mid-step: still on step 5, continues from there
    const fast = { ...c, bpm: 120 }
    expect(e.update(fast, 5600)!.stepIndex).toBe(5)
    // 0.5 of step 5 done at 60 bpm + 100 ms at 120 bpm (0.2) → 0.3 left = 150 ms
    expect(e.update(fast, 5740)!.stepIndex).toBe(5)
    expect(e.update(fast, 5760)!.stepIndex).toBe(6)
  })

  it('honours per-step hold times', () => {
    const c = chase(3, {}, [undefined, 3, undefined])
    expect(stepDurationMs(c, 1)).toBe(3000)
    const e = new ChaseEngine(meta)
    e.start(c, 0)
    expect(e.update(c, 1500)!.stepIndex).toBe(1)
    expect(e.update(c, 3900)!.stepIndex).toBe(1)
    expect(e.update(c, 4100)!.stepIndex).toBe(2)
  })

  it('a non-looping chase stops on its last step and holds it', () => {
    const e = new ChaseEngine(meta)
    const c = chase(3, { isLooping: false, fadePercent: 50 })
    e.start(c, 0)
    expect(e.update(c, 2500)!.stepIndex).toBe(2)
    const end = e.update(c, 10000)!
    expect(end.stepIndex).toBe(2)
    expect(end.finished).toBe(true)
    expect(end.values.get(DIM)).toBe(20) // no fade back to step 0
  })

  it('crossfade: intensity missing in the next step fades out, LTP holds', () => {
    const e = new ChaseEngine(meta)
    const c: Chase = {
      ...chase(2, { fadePercent: 100 }),
      steps: [
        { id: 'a', values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 200 }, { fixtureId: 'f', channelName: 'Pan', value: 40 }] },
        { id: 'b', values: [] }
      ]
    }
    e.start(c, 0)
    const half = e.update(c, 500)!
    expect(half.values.get(DIM)).toBe(100)
    expect(half.values.get(PAN)).toBe(40)
  })

  it('does not scale values by the fader (the mixer does, on intensity only)', () => {
    const e = new ChaseEngine(meta)
    const c = chase(2, { faderLevel: 10 })
    e.start(c, 0)
    expect(e.update(c, 1500)!.values.get(DIM)).toBe(10)
  })
})
