import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import type { Cuelist } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useToastStore } from '@renderer/stores/toast-store'
import { clearHistory, installHistory } from './history'
import {
  __resetSelectionActionsForTests, canDeleteSelection, deleteSelection, duplicateSelection, getActiveSelection,
  registerSelectionActions, renameSelection
} from './selection-actions'

function cuelist(id: string): Cuelist {
  return { id, name: id, cues: [], currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false }
}

describe('selection actions', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    __resetSelectionActionsForTests()
    usePlaybackStore.setState({ cuelists: [cuelist('a'), cuelist('b')] })
    useToastStore.setState({ toasts: [] })
    stop = installHistory()
    clearHistory()
  })
  afterEach(() => stop())

  it('the most recently registered view is active; requireFocus registrations never are by default', () => {
    const offA = registerSelectionActions(() => ({ label: () => 'A' }))
    registerSelectionActions(() => ({ label: () => 'bar' }), { requireFocus: true })
    expect(getActiveSelection()?.label()).toBe('A')
    const offB = registerSelectionActions(() => ({ label: () => 'B' }))
    expect(getActiveSelection()?.label()).toBe('B')
    offB()
    expect(getActiveSelection()?.label()).toBe('A')
    offA()
    expect(getActiveSelection()).toBeNull()
  })

  it('null actions = nothing selected: the keys do nothing', async () => {
    registerSelectionActions(() => null)
    expect(canDeleteSelection()).toBe(false)
    expect(await deleteSelection()).toBe(false)
    expect(duplicateSelection()).toBe(false)
    expect(renameSelection()).toBe(false)
  })

  it('delete = one undo step + an Undo toast that restores the item', async () => {
    registerSelectionActions(() => ({
      label: () => 'scene “a”',
      delete: () => usePlaybackStore.getState().removeCuelist('a'),
      confirmDelete: false
    }))
    expect(await deleteSelection()).toBe(true)
    expect(usePlaybackStore.getState().cuelists.map((c) => c.id)).toEqual(['b'])
    const toast = useToastStore.getState().toasts.find((x) => x.id === 'history')
    expect(toast?.message).toContain('scene “a”')
    toast!.action!.onClick()
    expect(usePlaybackStore.getState().cuelists.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('canDelete false blocks the delete', async () => {
    const del = vi.fn()
    registerSelectionActions(() => ({ label: () => 'x', delete: del, canDelete: () => false, confirmDelete: false }))
    expect(await deleteSelection()).toBe(false)
    expect(del).not.toHaveBeenCalled()
  })

  it('duplicate and rename call the view', () => {
    const rename = vi.fn()
    registerSelectionActions(() => ({
      label: () => 'scene “b”',
      duplicate: () => { usePlaybackStore.getState().duplicateCuelist('b') },
      rename
    }))
    expect(duplicateSelection()).toBe(true)
    expect(usePlaybackStore.getState().cuelists).toHaveLength(3)
    expect(renameSelection()).toBe(true)
    expect(rename).toHaveBeenCalled()
  })
})
