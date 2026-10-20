import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The UI store reads the window at import time (no DOM under node)
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import type { Cuelist } from '@shared/types'
import { createEmptyShow } from '@shared/show-format'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { applyContentFromRemote } from './content-sync'
import { applyShowData } from './show-io'
import { holdHistory } from './history-gate'
import {
  HISTORY_IDLE_MS, HISTORY_LIMIT, canRedo, canUndo, clearHistory, getHistory, historyStep, installHistory, redo, undo, undoStep,
  useHistoryStore
} from './history'

function cuelist(id: string, extra: Partial<Cuelist> = {}): Cuelist {
  return {
    id, name: id, cues: [{ id: `${id}-q1`, name: 'Q1', number: 1, values: [{ fixtureId: 'f', channelName: 'Dimmer', value: 200 }], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }],
    currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...extra
  }
}

const names = () => usePlaybackStore.getState().cuelists.map(c => c.name)
const idle = () => vi.advanceTimersByTime(HISTORY_IDLE_MS + 10)

describe('undo / redo history', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    vi.useFakeTimers()
    usePlaybackStore.setState({ cuelists: [cuelist('a'), cuelist('b')], chases: [], presets: [] })
    useEffectsStore.setState({ effects: [] })
    usePatchStore.setState({ patch: [], groups: [] })
    stop = installHistory()
    clearHistory()
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('coalesces rapid edits into one step and undoes / redoes it', () => {
    const pb = usePlaybackStore.getState()
    pb.renameCuelist('a', 'O')
    pb.renameCuelist('a', 'Op')
    pb.renameCuelist('a', 'Opening')
    idle()
    expect(getHistory().past).toHaveLength(1)
    expect(canUndo()).toBe(true)
    undo({ toast: false })
    expect(names()).toEqual(['a', 'b'])
    expect(canRedo()).toBe(true)
    redo({ toast: false })
    expect(names()).toEqual(['Opening', 'b'])
  })

  it('separate edits after an idle pause are separate steps', () => {
    usePlaybackStore.getState().renameCuelist('a', 'One')
    idle()
    usePlaybackStore.getState().renameCuelist('b', 'Two')
    idle()
    expect(getHistory().past).toHaveLength(2)
    undo({ toast: false })
    expect(names()).toEqual(['One', 'b'])
  })

  it('undo commits a pending edit first (typing then Ctrl+Z)', () => {
    usePlaybackStore.getState().renameCuelist('a', 'Typed')
    expect(canUndo()).toBe(true)
    undo({ toast: false })
    expect(names()).toEqual(['a', 'b'])
  })

  it('runtime changes are not recorded', () => {
    const pb = usePlaybackStore.getState()
    pb.setCuelistFader('a', 10)
    usePlaybackStore.setState({ cuelists: usePlaybackStore.getState().cuelists.map(c => ({ ...c, isPlaying: true, currentCueIndex: 0 })) })
    idle()
    expect(getHistory().past).toHaveLength(0)
    expect(canUndo()).toBe(false)
  })

  it('restoring never stops playback: a playing scene keeps its runtime state', () => {
    usePlaybackStore.getState().renameCuelist('a', 'Renamed')
    idle()
    // Started after the edit
    usePlaybackStore.setState({ cuelists: usePlaybackStore.getState().cuelists.map(c => c.id === 'a' ? { ...c, isPlaying: true, currentCueIndex: 0, faderLevel: 80 } : c) })
    undo({ toast: false })
    const a = usePlaybackStore.getState().cuelists.find(c => c.id === 'a')!
    expect(a.name).toBe('a')
    expect(a.isPlaying).toBe(true)
    expect(a.currentCueIndex).toBe(0)
    expect(a.faderLevel).toBe(80)
  })

  it('a deleted scene comes back stopped, at its place, with its executor cell', () => {
    usePlaybackStore.setState({ cuelists: usePlaybackStore.getState().cuelists.map(c => c.id === 'b' ? { ...c, isPlaying: true, currentCueIndex: 0 } : c) })
    useExecutorStore.getState().syncCuelists(['a', 'b'])
    const cellBefore = useExecutorStore.getState().grid.flat().indexOf('b')
    const step = historyStep('Delete b', () => {
      usePlaybackStore.getState().removeCuelist('b')
      useExecutorStore.getState().syncCuelists(['a'])
    })
    expect(step?.label).toBe('Delete b')
    expect(names()).toEqual(['a'])
    undo({ toast: false })
    const list = usePlaybackStore.getState().cuelists
    expect(list.map(c => c.id)).toEqual(['a', 'b'])
    expect(list[1].isPlaying).toBe(false)
    expect(useExecutorStore.getState().grid.flat().indexOf('b')).toBe(cellBefore)
  })

  it('undoStep only undoes the step if it is still the last one', () => {
    const step = historyStep('Delete a', () => usePlaybackStore.getState().removeCuelist('a'))!
    usePlaybackStore.getState().renameCuelist('b', 'Later')
    idle()
    expect(undoStep(step.id, { toast: false })).toBe(false)
    expect(names()).toEqual(['Later'])
    undo({ toast: false })
    expect(undoStep(step.id, { toast: false })).toBe(true)
    expect(names()).toEqual(['a', 'b'])
  })

  it('a new edit clears the redo stack', () => {
    usePlaybackStore.getState().renameCuelist('a', 'X')
    idle()
    undo({ toast: false })
    expect(canRedo()).toBe(true)
    usePlaybackStore.getState().renameCuelist('b', 'Y')
    idle()
    expect(canRedo()).toBe(false)
  })

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      usePlaybackStore.getState().renameCuelist('a', `n${i}`)
      idle()
    }
    expect(getHistory().past).toHaveLength(HISTORY_LIMIT)
  })

  it('a held gesture (pointer drag) is one step however long it pauses', () => {
    const release = holdHistory()
    usePlaybackStore.getState().renameCuelist('a', 'd1')
    idle()
    idle()
    usePlaybackStore.getState().renameCuelist('a', 'd2')
    idle()
    expect(getHistory().past).toHaveLength(0)
    release()
    idle()
    expect(getHistory().past).toHaveLength(1)
    undo({ toast: false })
    expect(names()).toEqual(['a', 'b'])
  })

  it('edits from another device are not recorded (each device undoes its own)', () => {
    applyContentFromRemote({ origin: 'remote-1', seq: 1, sections: { cuelists: { upsert: [{ ...cuelist('a'), name: 'From remote' }] } } })
    idle()
    expect(getHistory().past).toHaveLength(0)
    // A local edit afterwards undoes to the remote's version, not before it
    usePlaybackStore.getState().renameCuelist('b', 'Local')
    idle()
    undo({ toast: false })
    expect(names()).toEqual(['From remote', 'b'])
  })

  it('loading a show clears the history', () => {
    usePlaybackStore.getState().renameCuelist('a', 'Edited')
    idle()
    expect(canUndo()).toBe(true)
    applyShowData(createEmptyShow('Fresh'))
    expect(canUndo()).toBe(false)
    expect(useHistoryStore.getState().canUndo).toBe(false)
  })

  it('publishes the undo / redo state with labels', () => {
    historyStep('Delete a', () => usePlaybackStore.getState().removeCuelist('a'))
    expect(useHistoryStore.getState()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Delete a' })
    undo({ toast: false })
    expect(useHistoryStore.getState()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Delete a' })
  })
})
