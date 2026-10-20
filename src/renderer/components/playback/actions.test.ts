import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import type { Chase, Cue, Cuelist } from '@shared/types'
import { getT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { clearHistory, installHistory, undo } from '@renderer/lib/history'
import {
  chaseSelectionActions, cueLabel, cueSelectionActions, duplicateChase, duplicateCue, duplicateScene, duplicateStep, sceneSelectionActions,
  stepSelectionActions
} from './actions'

function cue(id: string, number: number, extra: Partial<Cue> = {}): Cue {
  return { id, name: id, number, values: [{ fixtureId: 'f', channelName: 'Dimmer', value: number }], fadeIn: 1, fadeOut: 2, delay: 0.5, followTime: 3, ...extra }
}

function cuelist(id: string, cues: Cue[] = []): Cuelist {
  return { id, name: id, cues, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false }
}

function chase(id: string): Chase {
  return {
    id, name: id, currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 90, fadePercent: 20, direction: 'bounce', faderLevel: 200,
    steps: [{ id: 's1', values: [] }, { id: 's2', values: [{ fixtureId: 'f', channelName: 'Red', value: 9 }], holdTime: 2 }, { id: 's3', values: [] }]
  }
}

const pb = usePlaybackStore.getState

describe('scenes view actions', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    usePlaybackStore.setState({
      cuelists: [cuelist('a', [cue('c1', 1), cue('c2', 2), cue('c3', 3)]), cuelist('b')],
      chases: [chase('ch1'), chase('ch2')],
      selectedCuelistId: 'a',
      selectedChaseId: 'ch1'
    })
    stop = installHistory()
    clearHistory()
  })
  afterEach(() => stop())

  it('duplicates a cue right after it with its timing, as one undo step', () => {
    const id = duplicateCue('a', pb().cuelists[0].cues[0])
    const cues = pb().cuelists[0].cues
    expect(cues.map((c) => c.id)).toEqual(['c1', id, 'c2', 'c3'])
    expect(cues[1]).toMatchObject({ name: 'c1', fadeIn: 1, fadeOut: 2, delay: 0.5, followTime: 3 })
    expect(cues[1].number).toBeGreaterThan(1)
    expect(cues[1].number).toBeLessThan(2)
    undo()
    expect(pb().cuelists[0].cues.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('deletes the selected cue and selects the next one', () => {
    const onSelect = vi.fn()
    cueSelectionActions('a', pb().cuelists[0].cues[1], onSelect).delete!()
    expect(pb().cuelists[0].cues.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(onSelect).toHaveBeenCalledWith('c3')
  })

  it('duplicates and deletes the scene, keeping a selection', () => {
    const id = duplicateScene(pb().cuelists[0])
    expect(pb().cuelists.map((c) => c.id)).toEqual(['a', id, 'b'])
    expect(pb().selectedCuelistId).toBe(id)
    sceneSelectionActions(pb().cuelists[1]).delete!()
    expect(pb().cuelists.map((c) => c.id)).toEqual(['a', 'b'])
    expect(pb().selectedCuelistId).toBe('b')
  })

  it('duplicates a chase with its settings and steps', () => {
    const id = duplicateChase(pb().chases[0])
    const copy = pb().chases.find((c) => c.id === id)!
    expect(copy).toMatchObject({ bpm: 90, fadePercent: 20, direction: 'bounce', faderLevel: 200, isLooping: true })
    expect(copy.steps.map((s) => s.holdTime)).toEqual([undefined, 2, undefined])
    expect(copy.steps.every((s) => !['s1', 's2', 's3'].includes(s.id))).toBe(true)
    expect(pb().selectedChaseId).toBe(id)
    chaseSelectionActions(copy).delete!()
    expect(pb().chases.map((c) => c.id)).toEqual(['ch1', 'ch2'])
  })

  it('duplicates a step right after it and deletes it again', () => {
    const src = pb().chases[0].steps[1]
    const id = duplicateStep('ch1', src, 1)!
    expect(pb().chases[0].steps.map((s) => s.id)).toEqual(['s1', 's2', id, 's3'])
    expect(pb().chases[0].steps[2].holdTime).toBe(2)
    const onSelect = vi.fn()
    stepSelectionActions('ch1', pb().chases[0].steps[2], 2, onSelect).delete!()
    expect(pb().chases[0].steps.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(onSelect).toHaveBeenCalledWith('s3')
  })

  it('labels read after "Delete …?" in both languages', () => {
    expect(getT('en')('scenes.selection.scene', { name: 'Intro' })).toBe('scene “Intro”')
    expect(getT('fr')('scenes.selection.scene', { name: 'Intro' })).toBe('la scène «\u00A0Intro\u00A0»')
    expect(cueLabel({ number: 2.5, name: '' })).toMatch(/2\.5/)
  })
})
