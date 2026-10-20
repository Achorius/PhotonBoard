import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MidiMapping } from '@shared/types'
import { detectCcEncoding, relativeDelta } from './midi-learn'
import { resolveValue, mappingMatches, computeTapTempo } from './midi-manager'
import { useMidiStore, LEARN_CAPTURE_MS, dedupeMappings } from '@renderer/stores/midi-store'
import { setSceneMode, startSceneLearn } from '@renderer/components/playback/scene-meta'
import type { Cuelist } from '@shared/types'

function mapping(extra: Partial<MidiMapping['options']> = {}, source: Partial<MidiMapping['source']> = {}): MidiMapping {
  return {
    id: 'm',
    name: 'test',
    source: { type: 'cc', channel: 1, number: 7, ...source },
    target: { type: 'master' },
    options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct', ...extra }
  }
}

describe('detectCcEncoding', () => {
  it('defaults to absolute — a fader touched at its end stop stays absolute', () => {
    expect(detectCcEncoding([127])).toBe('absolute')
    expect(detectCcEncoding([0])).toBe('absolute')
    expect(detectCcEncoding([1, 2])).toBe('absolute')
  })

  it('keeps fader sweeps near the ends absolute', () => {
    expect(detectCcEncoding([120, 121, 122, 123, 124, 125, 126, 127])).toBe('absolute')
    expect(detectCcEncoding([5, 4, 3, 2, 1, 0])).toBe('absolute')
    expect(detectCcEncoding([126, 127, 126, 127])).toBe('absolute') // jitter, no repeat
    expect(detectCcEncoding([40, 60, 80, 100])).toBe('absolute')
  })

  it('detects two\'s-complement encoders (1 / 127 repeated)', () => {
    expect(detectCcEncoding([1, 1, 1, 1])).toBe('relative')
    expect(detectCcEncoding([127, 127, 126, 127])).toBe('relative')
    expect(detectCcEncoding([1, 1, 2, 3, 3])).toBe('relative') // accelerated
  })

  it('detects binary-offset encoders (63 / 65)', () => {
    expect(detectCcEncoding([65, 65, 65])).toBe('relative')
    expect(detectCcEncoding([63, 63, 62])).toBe('relative')
  })
})

describe('relative values', () => {
  it('decodes deltas', () => {
    expect(relativeDelta(1)).toBe(1)
    expect(relativeDelta(127)).toBe(-1)
    expect(relativeDelta(65)).toBe(1)
    expect(relativeDelta(63)).toBe(-1)
  })

  it('relative encoders move from the current value', () => {
    const m = mapping({ encoding: 'relative' })
    expect(resolveValue(m, 1, 100)).toBe(102)
    expect(resolveValue(m, 127, 100)).toBe(98)
    expect(resolveValue(m, 127, 0)).toBe(0) // clamped
  })

  it('absolute scales 0-127 to min..max (with invert)', () => {
    expect(resolveValue(mapping(), 127, 0)).toBe(255)
    expect(resolveValue(mapping(), 0, 99)).toBe(0)
    expect(resolveValue(mapping({ inverted: true }), 127, 0)).toBe(0)
    expect(resolveValue(mapping({ min: 100, max: 200 }), 64, 0)).toBe(150)
  })
})

describe('mappingMatches', () => {
  it('filters by device when the mapping has one', () => {
    const m = mapping({}, { deviceName: 'APC mini' })
    expect(mappingMatches(m, 'cc', 1, 7, 'APC mini')).toBe(true)
    expect(mappingMatches(m, 'cc', 1, 7, 'nanoKONTROL')).toBe(false)
    expect(mappingMatches(mapping(), 'cc', 1, 7, 'anything')).toBe(true)
    expect(mappingMatches(m, 'note', 1, 7, 'APC mini')).toBe(false)
  })
})

describe('tap tempo', () => {
  it('averages tap intervals', () => {
    expect(computeTapTempo([0])).toBeNull()
    expect(computeTapTempo([0, 500, 1000, 1500])).toBe(120)
  })
})

describe('MIDI learn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useMidiStore.setState({ mappings: [], isLearning: false, learnTarget: null })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('learns a fader as absolute even when touched at the end stop', () => {
    const store = useMidiStore.getState()
    store.startLearn({ type: 'master', label: 'GM' })
    store.completeLearn({ type: 'cc', channel: 1, number: 7, value: 127, deviceName: 'X' })
    expect(useMidiStore.getState().mappings).toHaveLength(0) // still listening
    vi.advanceTimersByTime(LEARN_CAPTURE_MS + 1)
    const [m] = useMidiStore.getState().mappings
    expect(m.options.encoding).toBe('absolute')
    expect(m.source).toMatchObject({ type: 'cc', channel: 1, number: 7, deviceName: 'X' })
    expect(useMidiStore.getState().isLearning).toBe(false)
  })

  it('learns an encoder as relative from the following messages', () => {
    const store = useMidiStore.getState()
    store.startLearn({ type: 'master', label: 'GM' })
    for (let i = 0; i < 4; i++) store.completeLearn({ type: 'cc', channel: 2, number: 16, value: 1 })
    vi.advanceTimersByTime(LEARN_CAPTURE_MS + 1)
    expect(useMidiStore.getState().mappings[0].options.encoding).toBe('relative')
  })

  it('learns notes immediately as toggle buttons', () => {
    const store = useMidiStore.getState()
    store.startLearn({ type: 'blackout', label: 'BO' })
    store.completeLearn({ type: 'note', channel: 1, number: 60 })
    const [m] = useMidiStore.getState().mappings
    expect(m.options.behavior).toBe('toggle')
  })

  it('cancel discards a pending capture', () => {
    const store = useMidiStore.getState()
    store.startLearn({ type: 'master', label: 'GM' })
    store.completeLearn({ type: 'cc', channel: 1, number: 7, value: 3 })
    store.cancelLearn()
    vi.advanceTimersByTime(LEARN_CAPTURE_MS + 1)
    expect(useMidiStore.getState().mappings).toHaveLength(0)
  })
})

describe('MIDI re-learn never duplicates a target', () => {
  beforeEach(() => {
    useMidiStore.setState({ mappings: [], isLearning: false, learnTarget: null })
  })

  it('re-learning a chase start/stop replaces the old pad', () => {
    const store = useMidiStore.getState()
    store.startLearn({ type: 'chase_toggle', id: 'ch1', label: 'Chase' })
    store.completeLearn({ type: 'note', channel: 1, number: 36 })
    store.startLearn({ type: 'chase_toggle', id: 'ch1', label: 'Chase' })
    store.completeLearn({ type: 'note', channel: 1, number: 37 })
    const list = useMidiStore.getState().mappings
    expect(list).toHaveLength(1)
    expect(list[0].source.number).toBe(37)
  })

  it('learning the same pad twice for a scene leaves one mapping (no GO-then-STOP)', () => {
    const cl = { id: 'sc1', name: 'Scene 1' } as Cuelist
    startSceneLearn(cl, 'toggle')
    useMidiStore.getState().completeLearn({ type: 'note', channel: 1, number: 40 })
    startSceneLearn(cl, 'flash')
    useMidiStore.getState().completeLearn({ type: 'note', channel: 1, number: 40 })
    const list = useMidiStore.getState().mappings
    expect(list).toHaveLength(1)
    expect(list[0].options.behavior).toBe('flash')
  })

  it('keeps mappings of other targets and their order', () => {
    const store = useMidiStore.getState()
    store.startLearn({ type: 'blackout', label: 'BO' })
    store.completeLearn({ type: 'note', channel: 1, number: 1 })
    store.startLearn({ type: 'cuelist_go', id: 'a', label: 'A' })
    store.completeLearn({ type: 'note', channel: 1, number: 2 })
    store.startLearn({ type: 'cuelist_go', id: 'b', label: 'B' })
    store.completeLearn({ type: 'note', channel: 1, number: 3 })
    store.startLearn({ type: 'cuelist_go', id: 'a', label: 'A' })
    store.completeLearn({ type: 'note', channel: 1, number: 4 })
    expect(useMidiStore.getState().mappings.map((m) => m.source.number)).toEqual([1, 4, 3])
  })

  it('a mode change updates every mapping of the scene', () => {
    const base = mapping()
    useMidiStore.setState({
      mappings: [
        { ...base, id: 'x', source: { type: 'note', channel: 1, number: 1 }, target: { type: 'cuelist_go', id: 'sc' }, options: { ...base.options, behavior: 'toggle' } },
        { ...base, id: 'y', source: { type: 'note', channel: 1, number: 2 }, target: { type: 'cuelist_go', id: 'sc' }, options: { ...base.options, behavior: 'toggle' } }
      ]
    })
    setSceneMode('sc', { col: 0, row: 0 }, 'trigger')
    expect(useMidiStore.getState().mappings.map((m) => m.options.behavior)).toEqual(['trigger', 'trigger'])
  })

  it('show load drops exact duplicates (same source + target)', () => {
    const a = { ...mapping(), id: 'a', target: { type: 'cuelist_go' as const, id: 's' } }
    const b = { ...a, id: 'b' }
    const c = { ...a, id: 'c', source: { ...a.source, number: 9 } }
    expect(dedupeMappings([a, b, c]).map((m) => m.id)).toEqual(['a', 'c'])
    const clean = [a, c]
    expect(dedupeMappings(clean)).toBe(clean)
  })
})
