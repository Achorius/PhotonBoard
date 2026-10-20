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
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { applyContentFromRemote, collectCurrentContent, getContentState, installContentTracking } from './content-sync'
import { HISTORY_IDLE_MS, clearHistory, getHistory, installHistory, redo, undo } from './history'
import { installDirtyTracking } from './show-io'
import { handleCommand } from './command-handler'
import { diffSection, sameSection } from './content-merge'

function cuelist(id: string, extra: Partial<Cuelist> = {}): Cuelist {
  return {
    id, name: id, cues: [{ id: `${id}-q1`, name: 'Q1', number: 1, values: [], fadeIn: 0, fadeOut: 0, delay: 0, followTime: null }],
    currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false, ...extra
  }
}

function reset(): void {
  usePlaybackStore.setState({ cuelists: [cuelist('a'), cuelist('b')], chases: [], presets: [] })
  useEffectsStore.setState({ effects: [] })
  usePatchStore.setState({ patch: [], groups: [] })
  usePoolStore.getState().loadPools({})
  useExecutorStore.getState().loadLayout({ grid: [['a', 'b']], columns: [], modes: [] })
  useProStore.setState({ cliLog: [], selectedExecutor: null })
}

const idle = () => vi.advanceTimersByTime(HISTORY_IDLE_MS + 10)

describe('undo / redo of the v3 sections', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    vi.useFakeTimers()
    reset()
    stop = installHistory()
    clearHistory()
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('macros, speed masters, stage pages and park are undoable; a speed master BPM is not', () => {
    const pool = usePoolStore.getState()
    const m = pool.addMacro({ name: 'M' })
    idle()
    const s = usePoolStore.getState().addSpeedMaster({ name: 'S', bpm: 100 })
    idle()
    usePoolStore.getState().addStagePage({ name: 'P' })
    idle()
    usePoolStore.getState().park([{ fixtureId: 'f', channelName: 'Dimmer', value: 10 }])
    idle()
    usePoolStore.getState().setSpeedMasterBpm(s, 140) // live control
    idle()
    expect(getHistory().past.map(h => h.sections)).toEqual([['macros'], ['speedMasters'], ['stagePages'], ['parked']])
    expect(getHistory().past.map(h => h.label)).toEqual(['Macro change', 'Speed master change', 'Stage page change', 'Park change'])

    undo({ toast: false })
    expect(usePoolStore.getState().parked).toEqual([])
    undo({ toast: false })
    expect(usePoolStore.getState().stagePages).toEqual([])
    expect(usePoolStore.getState().speedMasters.map(x => x.id)).toEqual([s])
    expect(usePoolStore.getState().speedMasters[0].bpm).toBe(140) // live tempo kept
    undo({ toast: false })
    expect(usePoolStore.getState().speedMasters).toEqual([])
    undo({ toast: false })
    expect(usePoolStore.getState().macros).toEqual([])
    redo({ toast: false })
    expect(usePoolStore.getState().macros.map(x => x.id)).toEqual([m])
  })

  it('executor pages are undoable; switching page is not an edit', () => {
    useExecutorStore.getState().addPage('Two')
    idle()
    useExecutorStore.getState().setPage(1)
    idle()
    useExecutorStore.getState().assignCell(1, 0, 0, { kind: 'cuelist', id: 'a', mode: 'flash' })
    idle()
    expect(getHistory().past).toHaveLength(2)
    undo({ toast: false })
    expect(useExecutorStore.getState().pages[1].cells[0][0]).toBeNull()
    expect(useExecutorStore.getState().currentPage).toBe(1)
    undo({ toast: false })
    expect(useExecutorStore.getState().pages).toHaveLength(1)
    expect(useExecutorStore.getState().currentPage).toBe(0)
    expect(useExecutorStore.getState().grid[0].slice(0, 2)).toEqual(['a', 'b'])
  })

  it('deleting a macro empties its executor cells in the same step', () => {
    const m = usePoolStore.getState().addMacro({ name: 'M' })
    useExecutorStore.getState().assignCell(0, 3, 0, { kind: 'macro', id: m, mode: 'toggle' })
    idle()
    usePoolStore.getState().removeMacro(m)
    expect(useExecutorStore.getState().pages[0].cells[3][0]).toBeNull()
    idle()
    undo({ toast: false })
    expect(usePoolStore.getState().macros.map(x => x.id)).toEqual([m])
    expect(useExecutorStore.getState().pages[0].cells[3][0]?.id).toBe(m)
  })
})

describe('content sync of the v3 sections (console)', () => {
  let offs: (() => void)[] = []
  beforeEach(() => {
    reset()
    useUiStore.getState().setDirty(false)
    offs = [installContentTracking(), installDirtyTracking()]
  })
  afterEach(() => { for (const off of offs) off() })

  it('merges a remote edit of macros, speed masters (BPM kept), parked and executor pages', () => {
    const s = usePoolStore.getState().addSpeedMaster({ name: 'S', bpm: 128 })
    const before = getContentState().sections
    const ok = applyContentFromRemote({
      origin: 'tab', seq: 1,
      sections: {
        macros: { upsert: [{ id: 'm1', number: 4, name: 'Intro', lines: [{ command: 'Go Sequence 1' }] }] },
        speedMasters: { upsert: [{ id: s, number: 1, name: 'Renamed', bpm: 60 }] },
        parked: { value: [{ fixtureId: 'f', channelName: 'Dimmer', value: 0 }] },
        executor: {
          value: {
            pages: [
              { id: 'page-1', name: '', cells: [[{ kind: 'cuelist', id: 'a', mode: 'toggle' }, { kind: 'macro', id: 'm1', mode: 'toggle' }]], columns: [] },
              { id: 'p2', name: 'Two', cells: [[{ kind: 'speed', id: s, mode: 'toggle' }]], columns: [] }
            ]
          }
        }
      }
    })
    expect(ok).toBe(true)
    const pool = usePoolStore.getState()
    expect(pool.macros).toEqual([{ id: 'm1', number: 4, name: 'Intro', lines: [{ command: 'Go Sequence 1' }] }])
    expect(pool.speedMasters[0]).toMatchObject({ name: 'Renamed', bpm: 128 })
    expect(pool.parked).toEqual([{ fixtureId: 'f', channelName: 'Dimmer', value: 0 }])
    const pages = useExecutorStore.getState().pages
    expect(pages.map(p => p.id)).toEqual(['page-1', 'p2'])
    expect(pages[0].cells[0][1]).toEqual({ kind: 'macro', id: 'm1', mode: 'toggle' }) // macro applied before executor
    expect(pages[1].cells[0][0]?.kind).toBe('speed')
    const after = getContentState().sections
    for (const sec of ['macros', 'speedMasters', 'parked', 'executor']) {
      expect(after[sec].rev).toBeGreaterThan(before[sec].rev)
      expect(after[sec].by).toBe('tab')
    }
    expect(useUiStore.getState().isDirty).toBe(true)
  })

  it('serves the new sections to remotes', () => {
    usePoolStore.getState().addMacro({ name: 'M' })
    useExecutorStore.getState().addPage()
    const res = collectCurrentContent(undefined, ['macros', 'executor', 'parked', 'speedMasters', 'stagePages'])
    expect((res.show!.macros as unknown[]).length).toBe(1)
    expect((res.show!.executor as { pages: unknown[] }).pages).toHaveLength(2)
    expect(res.show!.parked).toEqual([])
    expect(res.show!.stagePages).toEqual([])
  })

  it('a page switch neither versions the executor section nor dirties the show', () => {
    useExecutorStore.getState().addPage()
    useUiStore.getState().setDirty(false)
    const rev = getContentState().sections.executor.rev
    useExecutorStore.getState().setPage(1)
    expect(getContentState().sections.executor.rev).toBe(rev)
    expect(useUiStore.getState().isDirty).toBe(false)
  })
})

describe('executor content equality', () => {
  it('compares pages when present, the v2 grid otherwise', () => {
    const pages = useExecutorStore.getState().pages
    const a = { grid: [], columns: [], modes: [], pages }
    expect(sameSection('executor', a, { grid: [[]], columns: [], modes: [], pages })).toBe(true)
    expect(diffSection('executor', a, { ...a, pages: [...pages] })).not.toBeNull()
  })
})

describe('pro remote commands', () => {
  beforeEach(reset)

  it("'executor' presses a cell of a page (TRIG held by the client is released on disconnect)", () => {
    const ex = useExecutorStore.getState()
    ex.addPage()
    useExecutorStore.getState().assignCell(1, 2, 1, { kind: 'cuelist', id: 'b', mode: 'trigger' })
    handleCommand({ type: 'executor', payload: { page: 1, col: 2, row: 1, phase: 'down' }, clientId: 'web-1' })
    expect(usePlaybackStore.getState().cuelists[1].isPlaying).toBe(true)
    handleCommand({ type: 'client-disconnected', payload: { clientId: 'web-1' } })
    expect(usePlaybackStore.getState().cuelists[1].isPlaying).toBe(false)
    // Current page, toggle
    handleCommand({ type: 'executor', payload: { page: 'current', col: 0, row: 0, phase: 'down' } })
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(true)
    handleCommand({ type: 'executor', payload: { page: 'current', col: 0, row: 0, phase: 'up' } })
    expect(usePlaybackStore.getState().cuelists[0].isPlaying).toBe(true)
    // Malformed: ignored
    handleCommand({ type: 'executor', payload: { page: 9, col: 0, row: 0, phase: 'down' } })
    handleCommand({ type: 'executor', payload: { col: 'x' } })
  })

  it("'set-executor-page' selects a page (index, object or delta)", () => {
    useExecutorStore.getState().addPage()
    useExecutorStore.getState().addPage()
    handleCommand({ type: 'set-executor-page', payload: 2 })
    expect(useExecutorStore.getState().currentPage).toBe(2)
    handleCommand({ type: 'set-executor-page', payload: { delta: -1 } })
    expect(useExecutorStore.getState().currentPage).toBe(1)
    handleCommand({ type: 'set-executor-page', payload: { page: 0 } })
    expect(useExecutorStore.getState().currentPage).toBe(0)
  })

  it("'run-macro' and 'cli' reach the command line (stub: logged as not available)", () => {
    const m = usePoolStore.getState().addMacro({ number: 3, lines: [{ command: 'Go Sequence 1' }] })
    handleCommand({ type: 'run-macro', payload: { number: 3 } })
    handleCommand({ type: 'run-macro', payload: m })
    handleCommand({ type: 'cli', payload: { text: 'Fixture 1 At 50', origin: 'tab-1', seq: 1 } })
    const log = useProStore.getState().cliLog
    expect(log.map(l => [l.text, l.origin])).toEqual([['Go Sequence 1', 'macro'], ['Go Sequence 1', 'macro'], ['Fixture 1 At 50', 'tab-1']])
    expect(log.every(l => !l.ok && l.level === 'warning')).toBe(true)
    handleCommand({ type: 'cli', payload: { text: 'x'.repeat(5000) } })
    expect(useProStore.getState().cliLog).toHaveLength(3)
  })
})
