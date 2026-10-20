// Golden tests: speed / rate fader mappings, effective BPM with a rate,
// the effect engine following its speed master (no phase jump), chase
// engine BPM override and pause.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})

import type { Chase, Effect } from '@shared/types'
import { usePoolStore } from '@renderer/stores/pool-store'
import { getActiveEffects, isEffectPaused, setEffectPaused, startEffect, stopAllEffects, updateEffects } from '@renderer/lib/effect-engine'
import { ChaseEngine, stepDurationMs } from '@renderer/lib/chase-engine'
import {
  bpmToSpeedFader, clampRate, effectiveBpm, effectiveSpeed, rateFaderToRate, rateToFader, speedFaderToBpm
} from './speed-masters'

describe('fader mappings', () => {
  it('speed fader ↔ BPM', () => {
    expect(speedFaderToBpm(0)).toBe(1)
    expect(speedFaderToBpm(255)).toBe(240)
    expect(speedFaderToBpm(128)).toBe(120)
    expect(speedFaderToBpm(NaN)).toBe(1)
    expect(bpmToSpeedFader(120)).toBe(128)
    expect(bpmToSpeedFader(999)).toBe(255)
  })

  it('rate fader ↔ rate (log, centre = 1×)', () => {
    expect(rateFaderToRate(128)).toBe(1)
    expect(rateFaderToRate(255)).toBe(4)
    expect(rateFaderToRate(0)).toBe(0.25)
    expect(rateFaderToRate(191.5)).toBe(2)
    expect(rateToFader(1)).toBe(128)
    expect(rateToFader(4)).toBe(255)
    expect(rateToFader(0.25)).toBe(1)
    expect(clampRate(undefined)).toBe(1)
    expect(clampRate(10)).toBe(4)
    expect(clampRate(0.1)).toBe(0.25)
    expect(clampRate(-1)).toBe(1)
  })

  it('effective BPM with a rate; effect speed with a multiplier', () => {
    const masters = [{ id: 'm', number: 1, name: 'M', bpm: 100 }]
    expect(effectiveBpm({ bpm: 60, speedMasterId: 'm' }, masters, 2)).toBe(200)
    expect(effectiveBpm({ bpm: 60 }, masters, 0.5)).toBe(30)
    expect(effectiveSpeed({ speed: 3, speedMasterId: 'm', speedMultiplier: 0 }, masters)).toBeCloseTo(100 / 60)
    expect(effectiveSpeed({ speed: 3 }, masters)).toBe(3)
  })
})

describe('effects follow their speed master', () => {
  afterEach(() => {
    stopAllEffects()
    usePoolStore.setState({ speedMasters: [] })
  })
  const fx: Effect = { id: 'sm-fx', name: 'FX', waveform: 'sine', speed: 0.1, depth: 100, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0, isRunning: true, speedMasterId: 'm', speedMultiplier: 0.5 }
  const cycles = () => getActiveEffects().get('sm-fx')!.cycles

  it('speed = master BPM / 60 × multiplier, read every frame (phase kept), pause holds the phase', () => {
    usePoolStore.setState({ speedMasters: [{ id: 'm', number: 1, name: 'M', bpm: 120 }] })
    startEffect(fx, { now: 0 })
    updateEffects(1000)
    expect(cycles()).toBeCloseTo(1) // 120 BPM = 2 Hz × 0.5
    usePoolStore.getState().setSpeedMasterBpm('m', 240)
    updateEffects(1500)
    expect(cycles()).toBeCloseTo(2) // continues from 1, now 240 BPM = 4 Hz × 0.5
    expect(setEffectPaused('sm-fx')).toBe(true)
    expect(isEffectPaused('sm-fx')).toBe(true)
    updateEffects(5000)
    expect(cycles()).toBeCloseTo(2)
    setEffectPaused('sm-fx', false)
    updateEffects(5500)
    expect(cycles()).toBeCloseTo(3)
    expect(setEffectPaused('nope')).toBe(false)
  })

  it('an effect without a master keeps its own speed', () => {
    startEffect({ ...fx, speedMasterId: undefined }, { now: 0 })
    updateEffects(1000)
    expect(cycles()).toBeCloseTo(0.1)
  })
})

describe('chase engine pro', () => {
  const chase: Chase = {
    id: 'c', name: 'C', currentStepIndex: 0, isPlaying: true, isLooping: true, bpm: 60, fadePercent: 0, direction: 'forward', faderLevel: 255,
    steps: [{ id: '1', values: [] }, { id: '2', values: [] }, { id: '3', values: [], holdTime: 3 }]
  }

  it('a BPM override replaces chase.bpm (hold times stay)', () => {
    expect(stepDurationMs(chase, 0)).toBe(1000)
    expect(stepDurationMs(chase, 0, 120)).toBe(500)
    expect(stepDurationMs(chase, 2, 120)).toBe(3000)
    const engine = new ChaseEngine(() => ({ intensity: false }))
    engine.start(chase, 0)
    expect(engine.update(chase, 400, 120)?.stepIndex).toBe(0)
    expect(engine.update(chase, 500, 120)?.stepIndex).toBe(1)
    expect(engine.update(chase, 900, 60)?.stepIndex).toBe(1) // 0.4 of a 1 s step — no jump
    expect(engine.update(chase, 1499, 60)?.stepIndex).toBe(1)
    expect(engine.update(chase, 1500, 60)?.stepIndex).toBe(2)
  })

  it('pause holds the step and phase', () => {
    const engine = new ChaseEngine(() => ({ intensity: false }))
    engine.start(chase, 0)
    engine.update(chase, 500)
    expect(engine.setPaused('c')).toBe(true)
    expect(engine.isPaused('c')).toBe(true)
    expect(engine.update(chase, 10_000)?.stepIndex).toBe(0)
    engine.setPaused('c', false)
    expect(engine.update(chase, 10_499)?.stepIndex).toBe(0)
    expect(engine.update(chase, 10_500)?.stepIndex).toBe(1)
    expect(engine.setPaused('missing')).toBe(false)
  })
})
