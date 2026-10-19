import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Effect } from '@shared/types'
import { getActiveEffects, stopAllEffects } from '@renderer/lib/effect-engine'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { ALL_FIXTURES, DIMMER, patchEntry } from '@renderer/lib/testing/test-fixtures'
import { EFFECT_TEMPLATES, effectFromTemplate, sizeUpdates, templateCompat } from './effect-templates'

const patch = [0, 1, 2].map((i) => patchEntry(`d${i}`, DIMMER, 0, i + 1))
const tpl = (id: string) => EFFECT_TEMPLATES.find((t) => t.id === id)!

beforeEach(() => {
  stopAllEffects()
  usePatchStore.setState({ patch, fixtures: ALL_FIXTURES })
  useEffectsStore.setState({ effects: [] })
})

describe('templates', () => {
  it('builds one compound effect with spread phases for multi-attribute templates', () => {
    const fx = effectFromTemplate(tpl('rainbow'), ['d0'])
    expect(fx.channels?.map((c) => [c.channelType, c.phaseOffset])).toEqual([['Red', 0], ['Green', 120], ['Blue', 240]])
    expect(fx.speed).toBeCloseTo(10 / 60)
    expect(fx.isRunning).toBe(true)
  })

  it('rates compatibility against the targets attributes', () => {
    const dimmerOnly = [new Set(['dimmer'])]
    expect(templateCompat(tpl('pulse'), dimmerOnly)).toBe('full')
    expect(templateCompat(tpl('circle'), dimmerOnly)).toBe('none')
    expect(templateCompat(tpl('circle'), [new Set(['pan', 'tilt']), new Set(['dimmer'])])).toBe('partial')
    expect(templateCompat(tpl('rainbow'), [new Set(['color wheel'])])).toBe('full')
    expect(templateCompat(tpl('pulse'), [])).toBe('none')
  })

  it('keeps attribute proportions when the size goes to zero and back', () => {
    const fx: Effect = {
      id: 'p', name: 'P', waveform: 'sine', speed: 1, depth: 200, offset: 0, channelType: 'Pan', fixtureIds: [], fan: 0, isRunning: false,
      channels: [{ channelType: 'Pan', phaseOffset: 0, depth: 200 }, { channelType: 'Tilt', phaseOffset: 90, depth: 100 }]
    }
    const zero = { ...fx, ...sizeUpdates(fx, 0) }
    expect(zero.channels!.map((c) => c.depth)).toEqual([0, 0])
    const back = sizeUpdates(zero, 100)
    expect(back.channels!.map((c) => c.depth)).toEqual([100, 50])
  })
})

describe('effects store additions', () => {
  afterEach(() => vi.useRealTimers())

  it('createEffect adds and starts a running effect', () => {
    const id = useEffectsStore.getState().createEffect({ fixtureIds: ['d0'], isRunning: true, name: 'X' })
    expect(useEffectsStore.getState().effects.find((e) => e.id === id)?.name).toBe('X')
    expect(getActiveEffects().has(id)).toBe(true)
  })

  it('fades the size in and out without restarting the phase', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
    const store = useEffectsStore.getState()
    const id = store.createEffect({ fixtureIds: ['d0'], depth: 200 })
    store.fadeEffect(id, true, 1)
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(true)
    expect(getActiveEffects().get(id)!.effect.depth).toBe(0)

    vi.advanceTimersByTime(500)
    const mid = getActiveEffects().get(id)!.effect.depth
    expect(mid).toBeGreaterThan(60)
    expect(mid).toBeLessThan(140)

    vi.advanceTimersByTime(600)
    expect(getActiveEffects().get(id)!.effect.depth).toBe(200)

    useEffectsStore.getState().fadeEffect(id, false, 0.5)
    vi.advanceTimersByTime(250)
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(true)
    vi.advanceTimersByTime(400)
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(false)
    expect(getActiveEffects().has(id)).toBe(false)
  })

  it('an instant stop cancels a running fade', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    const store = useEffectsStore.getState()
    const id = store.createEffect({ fixtureIds: ['d0'] })
    store.fadeEffect(id, true, 2)
    store.setEffectRunning(id, false)
    vi.advanceTimersByTime(3000)
    expect(getActiveEffects().has(id)).toBe(false)
    expect(useEffectsStore.getState().effects[0].isRunning).toBe(false)
  })
})
