import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { pressExecutor, getStoreActions } from './pages/surface-store'
import { collectSurfaceData } from './pages/stage-surface-broadcast'
import { assignToCell, setColumnFaderFn } from './executor-menus'
import { applyRemoteState } from '@renderer/hooks/useRemoteSync'

function cuelist(id: string): Cuelist {
  return {
    id, name: id, currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
    cues: [{ id: `${id}-1`, name: 'One', number: 1, values: [], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }]
  }
}

beforeEach(() => {
  usePlaybackStore.setState({ cuelists: [cuelist('a'), cuelist('b')], chases: [], selectedCuelistId: null })
  useExecutorStore.getState().loadLayout(undefined, ['a', 'b'])
  useExecutorStore.getState().syncCuelists(['a', 'b'])
  useProStore.setState({ selectedExecutor: null, blind: false, highlight: false, cliLog: [] })
  usePoolStore.setState({ speedMasters: [{ id: 's1', number: 1, name: 'Main', bpm: 120 }], groupMasters: {} })
  useDmxStore.setState({ grandMaster: 255 })
})

describe('executor presses from the surfaces (console)', () => {
  it('route TOG / TRIG through executorPress', () => {
    const ex = useExecutorStore.getState()
    const loc = ex.findCell('cuelist', 'a')!
    pressExecutor({ page: loc.page, col: loc.col, row: loc.row }, 'down')
    pressExecutor({ page: loc.page, col: loc.col, row: loc.row }, 'up')
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(true)
    // Tap again: stop
    pressExecutor({ page: loc.page, col: loc.col, row: loc.row }, 'down')
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(false)

    ex.setMode(loc.col, loc.row, 'trigger')
    pressExecutor({ page: loc.page, col: loc.col, row: loc.row }, 'down')
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(true)
    pressExecutor({ page: loc.page, col: loc.col, row: loc.row }, 'up')
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(false)
  })

  it('column faders go through executor-actions', () => {
    const loc = useExecutorStore.getState().findCell('cuelist', 'b')!
    getStoreActions().columnFader(loc.page, loc.col, 100)
    expect(usePlaybackStore.getState().cuelists.find((c) => c.id === 'b')!.faderLevel).toBe(100)
  })
})

describe('Pro cell menu operations', () => {
  it('assigns objects and column fader functions', () => {
    assignToCell({ page: 0, col: 5, row: 2 }, { kind: 'speed', id: 's1' })
    expect(useExecutorStore.getState().pages[0].cells[5][2]).toEqual({ kind: 'speed', id: 's1', mode: 'toggle' })
    assignToCell({ page: 0, col: 5, row: 2 }, null)
    expect(useExecutorStore.getState().pages[0].cells[5][2]).toBeNull()
    setColumnFaderFn(0, 3, 'grandmaster')
    expect(useExecutorStore.getState().pages[0].columns[3].fader).toEqual({ kind: 'grandmaster' })
    setColumnFaderFn(0, 3, 'column')
    expect(useExecutorStore.getState().pages[0].columns[3].fader).toBeUndefined()
  })
})

describe('Stage window surface data', () => {
  it('collects every page with its cells', () => {
    useExecutorStore.getState().addPage('Band')
    assignToCell({ page: 1, col: 0, row: 0 }, { kind: 'speed', id: 's1' })
    const data = collectSurfaceData()
    expect(data.executorPages).toHaveLength(2)
    expect(data.executorPages[1]).toMatchObject({ name: 'Band' })
    expect(data.executorPages[1].cells[0][0]).toEqual({ kind: 'speed', id: 's1', mode: 'toggle' })
    expect(data.speedMasters[0]).toMatchObject({ id: 's1', bpm: 120 })
    expect(data.goTargetId).toBe('a')
  })
})

describe('remote mirror (useRemoteSync)', () => {
  it('mirrors the executor page, Blind / Highlight, speed master BPMs and the command line', () => {
    useExecutorStore.getState().addPage()
    useExecutorStore.getState().setPage(0)
    applyRemoteState({
      executorPage: 1,
      blind: true,
      highlight: true,
      speedMasters: [{ id: 's1', number: 1, name: 'Main', bpm: 128 }],
      cliLog: [{ id: 7, time: 1, text: 'Go Sequence 1', ok: true, message: 'GO', level: 'info', origin: 'remote-x' }]
    })
    expect(useExecutorStore.getState().currentPage).toBe(1)
    expect(useProStore.getState().blind).toBe(true)
    expect(useProStore.getState().highlight).toBe(true)
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(128)
    expect(useProStore.getState().cliLog).toEqual([{ id: 7, time: 1, text: 'Go Sequence 1', ok: true, message: 'GO', level: 'info', origin: 'remote-x' }])
  })

  it('keeps the console page for later when the pages content has not arrived yet', () => {
    applyRemoteState({ executorPage: 2 })
    expect(useExecutorStore.getState().currentPage).toBe(0)
  })
})
