import { describe, expect, it } from 'vitest'
import type { Chase, Cuelist, Effect } from '@shared/types'
import { normalizeSectionItems } from '@shared/show-format'
import { applyListChange, diffList, diffSection, reconcilePatchGroups, replaceList, sameSection, ITEM_EQUALS } from './content-merge'

function cuelist(id: string, extra: Partial<Cuelist> = {}): Cuelist {
  return {
    id, name: id, cues: [{ id: `${id}-q1`, name: 'Q1', number: 1, values: [], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }],
    currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...extra
  }
}

function chase(id: string, extra: Partial<Chase> = {}): Chase {
  return {
    id, name: id, steps: [{ id: 's1', values: [] }, { id: 's2', values: [] }, { id: 's3', values: [] }],
    currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 120, fadePercent: 0, direction: 'forward', faderLevel: 255, ...extra
  }
}

function effect(id: string, extra: Partial<Effect> = {}): Effect {
  return { id, name: id, waveform: 'sine', speed: 1, depth: 255, offset: 0, channelType: 'Dimmer', fixtureIds: [], fan: 0, isRunning: false, ...extra }
}

describe('content equality ignores runtime state', () => {
  it('a playing / faded scene has the same content', () => {
    const a = cuelist('a')
    const b = { ...a, isPlaying: true, currentCueIndex: 0, faderLevel: 10, flash: true }
    expect(ITEM_EQUALS.cuelists(a, b)).toBe(true)
    expect(ITEM_EQUALS.cuelists(a, { ...a, name: 'renamed' })).toBe(false)
    expect(sameSection('cuelists', [a], [b])).toBe(true)
  })

  it('a running effect has the same content', () => {
    const a = effect('e')
    expect(ITEM_EQUALS.effects(a, { ...a, isRunning: true })).toBe(true)
    expect(ITEM_EQUALS.effects(a, { ...a, speed: 2 })).toBe(false)
  })
})

describe('diffList (remote → console)', () => {
  it('sends only what changed, by id', () => {
    const a = cuelist('a')
    const b = cuelist('b')
    const c = cuelist('c')
    expect(diffList([a, b], [a, { ...b, isPlaying: true }], ITEM_EQUALS.cuelists)).toBeNull()
    const renamed = { ...b, name: 'B!' }
    expect(diffList([a, b], [a, renamed, c], ITEM_EQUALS.cuelists)).toEqual({ upsert: [renamed, c] })
    expect(diffList([a, b, c], [a, c], ITEM_EQUALS.cuelists)).toEqual({ remove: ['b'] })
    expect(diffList([a, b], [b, a], ITEM_EQUALS.cuelists)).toEqual({ order: ['b', 'a'] })
  })

  it('whole-value sections send the value', () => {
    const grid = [[null]]
    const base = { grid, columns: [], modes: [] }
    expect(diffSection('executor', base, { ...base })).toBeNull()
    const moved = { ...base, grid: [['x']] }
    expect(diffSection('executor', base, moved)).toEqual({ value: moved })
  })
})

describe('applyListChange (console merge)', () => {
  it('keeps the runtime state of a running scene and its live fader', () => {
    const running = cuelist('a', { isPlaying: true, currentCueIndex: 0, faderLevel: 100, goGeneration: 3 })
    const incoming = normalizeSectionItems('cuelists', [{ ...cuelist('a'), name: 'Renamed', faderLevel: 255, isPlaying: false }])
    const [merged] = applyListChange('cuelists', [running], incoming)
    expect(merged.name).toBe('Renamed')
    expect(merged.isPlaying).toBe(true)
    expect(merged.currentCueIndex).toBe(0)
    expect(merged.faderLevel).toBe(100)
    expect(merged.goGeneration).toBe(3)
  })

  it('keeps a running effect running and clamps a chase step', () => {
    const fx = effect('e', { isRunning: true })
    const [mergedFx] = applyListChange('effects', [fx], normalizeSectionItems('effects', [{ ...fx, speed: 3 }]))
    expect(mergedFx.isRunning).toBe(true)
    expect(mergedFx.speed).toBe(3)

    const ch = chase('c', { isPlaying: true, currentStepIndex: 2, bpm: 140 })
    const shorter = { ...chase('c'), steps: [{ id: 's1', values: [] }], bpm: 60 }
    const [mergedCh] = applyListChange('chases', [ch], normalizeSectionItems('chases', [shorter]))
    expect(mergedCh.steps).toHaveLength(1)
    expect(mergedCh.currentStepIndex).toBe(0)
    expect(mergedCh.isPlaying).toBe(true)
    expect(mergedCh.bpm).toBe(140) // live tempo wins (tap / BPM fader have their own commands)
  })

  it('leaves items the remote does not name (concurrent console edits) untouched', () => {
    const a = cuelist('a')
    const consoleOnly = cuelist('z')
    const next = applyListChange('cuelists', [a, consoleOnly], normalizeSectionItems('cuelists', [cuelist('b')]), [], ['a', 'b'])
    expect(next.map(c => c.id)).toEqual(['a', 'b', 'z'])
    expect(next[0]).toBe(a)
    expect(next[2]).toBe(consoleOnly)
  })

  it('removes, and returns the same array when nothing changes', () => {
    const a = cuelist('a')
    const b = cuelist('b')
    expect(applyListChange('cuelists', [a, b], [], ['a']).map(c => c.id)).toEqual(['b'])
    const list = [a, b]
    expect(applyListChange('cuelists', list, normalizeSectionItems('cuelists', [a]))).toBe(list)
  })

  it('normalises incoming items like a show load (runtime stripped, values clamped)', () => {
    const [cl] = normalizeSectionItems('cuelists', [{ id: 'x', name: 'X', isPlaying: true, priority: 900, cues: [{ id: 'q', values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 999 }] }] }])
    expect(cl.isPlaying).toBe(false)
    expect(cl.priority).toBe(100)
    expect(cl.cues[0].values[0].value).toBe(255)
  })
})

describe('replaceList (console → remote fetch)', () => {
  it('replaces the content and keeps the local mirror of runtime state', () => {
    const local = [cuelist('a', { isPlaying: true, currentCueIndex: 0 }), cuelist('gone')]
    const next = replaceList('cuelists', local, normalizeSectionItems('cuelists', [{ ...cuelist('a'), name: 'New name' }, cuelist('b')]))
    expect(next.map(c => c.id)).toEqual(['a', 'b'])
    expect(next[0].isPlaying).toBe(true)
    expect(next[0].name).toBe('New name')
  })
})

describe('reconcilePatchGroups', () => {
  it('drops references to removed fixtures / groups', () => {
    const patch = [{ id: 'f1', fixtureDefId: 'd', modeName: 'm', universe: 0, address: 1, name: 'F1', groupIds: ['g1', 'gone'] }]
    const groups = [{ id: 'g1', name: 'G', color: '#fff', fixtureIds: ['f1', 'f2'] }]
    const r = reconcilePatchGroups(patch, groups)
    expect(r.patch[0].groupIds).toEqual(['g1'])
    expect(r.groups[0].fixtureIds).toEqual(['f1'])
    const again = reconcilePatchGroups(r.patch, r.groups)
    expect(again.patch).toBe(r.patch)
    expect(again.groups).toBe(r.groups)
  })
})
