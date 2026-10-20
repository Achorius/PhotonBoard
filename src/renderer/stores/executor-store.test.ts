import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultExecutorLayout } from '@shared/show-format'
import { startExecutorAutoSync, syncGrid, TOTAL_SLOTS, useExecutorStore } from './executor-store'
import { usePlaybackStore } from './playback-store'

const placed = () => useExecutorStore.getState().grid.flat().filter((id): id is string => !!id)

describe('executor grid sync', () => {
  let stop: (() => void) | null = null

  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [], chases: [], selectedCuelistId: null, selectedChaseId: null })
    const layout = defaultExecutorLayout()
    useExecutorStore.setState({ grid: layout.grid, columns: layout.columns, modes: layout.modes })
  })
  afterEach(() => {
    stop?.()
    stop = null
  })

  it('places new scenes and frees deleted ones without any UI mounted', () => {
    stop = startExecutorAutoSync()
    const pb = usePlaybackStore.getState()
    const a = pb.addCuelist('A')
    const b = pb.addCuelist('B')
    expect(placed()).toEqual([a, b])
    usePlaybackStore.getState().removeCuelist(a)
    expect(placed()).toEqual([b])
  })

  it('returns the same grid when nothing changes, even with more than 32 scenes', () => {
    stop = startExecutorAutoSync()
    const pb = usePlaybackStore.getState()
    const ids: string[] = []
    for (let i = 0; i < TOTAL_SLOTS + 3; i++) ids.push(pb.addCuelist(`S${i}`))
    expect(placed()).toHaveLength(TOTAL_SLOTS)
    const grid = useExecutorStore.getState().grid
    // Fader move / GO: cuelists array changes, ids do not
    usePlaybackStore.getState().setCuelistFader(ids[0], 100)
    usePlaybackStore.getState().goCuelist(ids[1])
    expect(useExecutorStore.getState().grid).toBe(grid)
    // Direct call with the overflowing list is a no-op too
    expect(syncGrid(grid, ids)).toBe(grid)
    // Deleting a placed scene lets the next unplaced one in
    usePlaybackStore.getState().removeCuelist(ids[0])
    expect(placed()).toContain(ids[TOTAL_SLOTS])
    expect(placed()).not.toContain(ids[0])
  })
})
