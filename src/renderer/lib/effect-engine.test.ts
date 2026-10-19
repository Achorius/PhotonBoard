import { describe, it, expect, beforeEach } from 'vitest'
import type { Effect } from '@shared/types'
import {
  computeEffectLayer,
  computeFanPositions,
  getWaveformValue,
  startEffect,
  stopAllEffects,
  updateEffects,
  isEffectRunning,
  onEffectComplete,
  getActiveEffects
} from './effect-engine'
import { hasLayer } from './dmx-mixer'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { DIMMER, ALL_FIXTURES, patchEntry } from './testing/test-fixtures'

const patch = [0, 1, 2, 3].map(i => patchEntry(`d${i}`, DIMMER, 0, i + 1))

function effect(extra: Partial<Effect> = {}): Effect {
  return {
    id: 'fx',
    name: 'FX',
    waveform: 'sawtooth',
    speed: 1,
    depth: 255,
    offset: 0,
    channelType: 'Dimmer',
    fixtureIds: patch.map(p => p.id),
    fan: 0,
    isRunning: true,
    ...extra
  }
}

beforeEach(() => {
  stopAllEffects()
  usePatchStore.setState({ patch, fixtures: ALL_FIXTURES })
})

describe('fan phase spread', () => {
  it('spreads index phases as i/n (a 360° fan never repeats the first phase)', () => {
    const pos = computeFanPositions(['a', 'b', 'c', 'd'], [], false)
    expect([...pos.values()]).toEqual([0, 0.25, 0.5, 0.75])
  })

  it('gives distinct values to first and last fixture with a 360° fan', () => {
    const layer = computeEffectLayer(effect({ fan: 360, waveform: 'sine' }), 0.1, patch, ALL_FIXTURES)
    const u0 = layer.get(0)!
    expect(u0.get(0)).not.toBe(u0.get(3))
    // evenly spaced: sawtooth at cycles 0 → phases 0, .25, .5, .75
    const saw = computeEffectLayer(effect({ fan: 360 }), 0, patch, ALL_FIXTURES).get(0)!
    expect([0, 1, 2, 3].map(ch => saw.get(ch))).toEqual([0, 64, 128, 191])
  })

  it('spatial spread is scaled so extremes do not coincide', () => {
    const spatial = patch.map((p, i) => ({ ...p, position3D: { x: i * 2, y: 3, z: 0 } }))
    const pos = computeFanPositions(spatial.map(p => p.id), spatial, true, 'x')
    expect(pos.get('d0')).toBe(0)
    expect(pos.get('d3')).toBeCloseTo(0.75)
  })
})

describe('random waveform', () => {
  it('holds one value per cycle (sample & hold), then glides to the next', () => {
    const a = getWaveformValue('random', 0.1, undefined, { seed: 7, cycle: 3 })
    const b = getWaveformValue('random', 0.6, undefined, { seed: 7, cycle: 3 })
    expect(a).toBe(b)
    const next = getWaveformValue('random', 0, undefined, { seed: 7, cycle: 4 })
    const end = getWaveformValue('random', 0.9999, undefined, { seed: 7, cycle: 3 })
    expect(end).toBeCloseTo(next, 3)
    expect(a).toBeGreaterThanOrEqual(-1)
    expect(a).toBeLessThanOrEqual(1)
  })

  it('is stable between frames (no per-frame noise)', () => {
    const e = effect({ waveform: 'random', speed: 0.5 })
    const l1 = computeEffectLayer(e, 1.2, patch, ALL_FIXTURES).get(0)!.get(0)
    const l2 = computeEffectLayer(e, 1.25, patch, ALL_FIXTURES).get(0)!.get(0)
    expect(l1).toBe(l2)
  })
})

describe('runtime', () => {
  it('keeps the phase when a running effect is updated (slider drag)', () => {
    startEffect(effect({ speed: 1 }), { now: 0 })
    updateEffects(500)
    expect(getActiveEffects().get('fx')!.cycles).toBeCloseTo(0.5)
    startEffect(effect({ speed: 2 }), { now: 500 }) // update, no restart
    updateEffects(750)
    expect(getActiveEffects().get('fx')!.cycles).toBeCloseTo(1.0) // 0.5 + 0.25 s × 2 Hz
  })

  it('one-shot stops itself after one cycle, notifies, and can be re-triggered', () => {
    const done: string[] = []
    const off = onEffectComplete(id => done.push(id))
    const shot = effect({ oneShot: true, speed: 2 })
    startEffect(shot, { now: 0, restart: true })
    updateEffects(200)
    expect(hasLayer('effect_fx')).toBe(true)
    updateEffects(500) // 1 cycle at 2 Hz
    expect(isEffectRunning('fx')).toBe(false)
    expect(hasLayer('effect_fx')).toBe(false)
    expect(done).toEqual(['fx'])

    // Re-trigger: runs again from phase 0 (does not die instantly)
    startEffect(shot, { now: 1000, restart: true })
    updateEffects(1100)
    expect(isEffectRunning('fx')).toBe(true)
    expect(hasLayer('effect_fx')).toBe(true)
    off()
  })

  it('the effects store clears isRunning when a one-shot completes', () => {
    useEffectsStore.setState({ effects: [effect({ oneShot: true, speed: 4, isRunning: false })] })
    useEffectsStore.getState().setEffectRunning('fx', true)
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(true)
    const start = getActiveEffects().get('fx')!
    expect(start).toBeDefined()
    updateEffects(1e12) // far in the future → completes
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(false)
  })
})
