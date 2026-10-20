import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExecutorPage } from '@shared/show-format'
import { MAX_PAGES, startExecutorAutoSync, syncGrid, syncPages, TOTAL_SLOTS, useExecutorStore, getExecutorContent } from './executor-store'
import { usePlaybackStore } from './playback-store'

const placed = () => useExecutorStore.getState().grid.flat().filter((id): id is string => !!id)
const placedOn = (page: number) =>
  useExecutorStore.getState().pages[page].cells.flat().filter((c) => c?.kind === 'cuelist').map((c) => c!.id)

describe('executor grid sync', () => {
  let stop: (() => void) | null = null

  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [], chases: [], selectedCuelistId: null, selectedChaseId: null })
    useExecutorStore.getState().loadLayout(undefined)
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

  it('overflows onto a new page past 32 scenes, and returns the same pages when nothing changes', () => {
    stop = startExecutorAutoSync()
    const pb = usePlaybackStore.getState()
    const ids: string[] = []
    for (let i = 0; i < TOTAL_SLOTS + 3; i++) ids.push(pb.addCuelist(`S${i}`))
    // Page 1 = the legacy view: unchanged for every existing consumer
    expect(placed()).toHaveLength(TOTAL_SLOTS)
    expect(useExecutorStore.getState().pages).toHaveLength(2)
    expect(placedOn(1)).toEqual(ids.slice(TOTAL_SLOTS))
    const { grid, pages } = useExecutorStore.getState()
    // Fader move / GO: cuelists array changes, ids do not
    usePlaybackStore.getState().setCuelistFader(ids[0], 100)
    usePlaybackStore.getState().goCuelist(ids[1])
    expect(useExecutorStore.getState().grid).toBe(grid)
    expect(useExecutorStore.getState().pages).toBe(pages)
    expect(syncPages(pages, ids)).toBe(pages)
    // Deleting a scene frees its cell; nothing moves
    usePlaybackStore.getState().removeCuelist(ids[0])
    expect(placed()).not.toContain(ids[0])
    expect(placedOn(1)).toEqual(ids.slice(TOTAL_SLOTS))
    // The next new scene takes the free cell on page 1
    const n = usePlaybackStore.getState().addCuelist('New')
    expect(placed()).toContain(n)
  })

  it('legacy syncGrid is unchanged (single grid, same array when full)', () => {
    const ids = Array.from({ length: TOTAL_SLOTS + 1 }, (_, i) => `s${i}`)
    const grid = syncGrid(Array.from({ length: 8 }, () => [null, null, null, null]), ids)
    expect(grid.flat()).toEqual(ids.slice(0, TOTAL_SLOTS))
    expect(syncGrid(grid, ids)).toBe(grid)
  })

  it('never grows past MAX_PAGES', () => {
    const ids = Array.from({ length: TOTAL_SLOTS * MAX_PAGES + 5 }, (_, i) => `s${i}`)
    const pages = syncPages([createExecutorPage('p1')], ids)
    expect(pages).toHaveLength(MAX_PAGES)
    expect(syncPages(pages, ids)).toBe(pages)
  })
})

describe('executor pages', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ cuelists: [], chases: [] })
    useExecutorStore.getState().loadLayout(undefined)
  })

  it('adds, renames, switches and removes pages; the legacy view follows the current page', () => {
    const ex = useExecutorStore.getState()
    ex.assignCell(0, 0, 0, { kind: 'cuelist', id: 'a', mode: 'flash' })
    const p2 = ex.addPage('Busk')
    expect(p2).toBe(1)
    useExecutorStore.getState().assignCell(1, 2, 3, { kind: 'cuelist', id: 'b', mode: 'trigger' })
    useExecutorStore.getState().assignCell(1, 0, 0, { kind: 'chase', id: 'ch', mode: 'toggle' })
    expect(useExecutorStore.getState().grid[0][0]).toBe('a')
    expect(useExecutorStore.getState().modes[0][0]).toBe('flash')

    useExecutorStore.getState().setPage(1)
    let s = useExecutorStore.getState()
    expect(s.currentPage).toBe(1)
    expect(s.grid[2][3]).toBe('b')
    expect(s.modes[2][3]).toBe('trigger')
    expect(s.grid[0][0]).toBeNull() // chase cells are invisible to the legacy view

    // Legacy setters act on the current page
    s.setColumnTitle(2, 'Song')
    s.setMode(2, 3, 'toggle')
    s.swapCells({ col: 2, row: 3 }, { col: 5, row: 0 })
    s = useExecutorStore.getState()
    expect(s.pages[1].columns[2].title).toBe('Song')
    expect(s.pages[1].cells[5][0]).toEqual({ kind: 'cuelist', id: 'b', mode: 'toggle' })
    expect(s.pages[0].columns[2].title).toBe('')

    s.renamePage(1, '  Songs  ')
    expect(useExecutorStore.getState().pages[1].name).toBe('Songs')
    useExecutorStore.getState().setPage(99)
    expect(useExecutorStore.getState().currentPage).toBe(1)
    useExecutorStore.getState().removePage(1)
    s = useExecutorStore.getState()
    expect(s.pages).toHaveLength(1)
    expect(s.currentPage).toBe(0)
    expect(s.grid[0][0]).toBe('a')
    s.removePage(0) // never the last page
    expect(useExecutorStore.getState().pages).toHaveLength(1)
  })

  it('assignCell moves an object within a page; button and fader functions', () => {
    const ex = useExecutorStore.getState()
    ex.assignCell(0, 0, 0, { kind: 'macro', id: 'm', mode: 'toggle' })
    ex.assignCell(0, 3, 1, { kind: 'macro', id: 'm', mode: 'toggle' })
    let page = useExecutorStore.getState().pages[0]
    expect(page.cells[0][0]).toBeNull()
    expect(page.cells[3][1]?.id).toBe('m')
    useExecutorStore.getState().setCellButton(0, 3, 1, 'go')
    useExecutorStore.getState().setColumnFader(0, 3, { kind: 'grandmaster' })
    page = useExecutorStore.getState().pages[0]
    expect(page.cells[3][1]?.button).toBe('go')
    expect(page.columns[3].fader).toEqual({ kind: 'grandmaster' })
    useExecutorStore.getState().setCellButton(0, 3, 1, undefined)
    useExecutorStore.getState().setColumnFader(0, 3, undefined)
    page = useExecutorStore.getState().pages[0]
    expect(page.cells[3][1]?.button).toBeUndefined()
    expect('fader' in page.columns[3]).toBe(false)
    expect(useExecutorStore.getState().findCell('macro', 'm')).toMatchObject({ page: 0, col: 3, row: 1 })
    expect(useExecutorStore.getState().findCell('macro', 'x')).toBeNull()
  })

  it('a page switch is not a content change; the saved layout mirrors page 1', () => {
    const ex = useExecutorStore.getState()
    ex.assignCell(0, 1, 0, { kind: 'cuelist', id: 'a', mode: 'flash' })
    ex.addPage()
    const content = getExecutorContent()
    useExecutorStore.getState().setPage(1)
    expect(getExecutorContent()).toBe(content)
    const layout = useExecutorStore.getState().getLayout()
    expect(layout.grid[1][0]).toBe('a')
    expect(layout.modes[1][0]).toBe('flash')
    expect(layout.pages).toHaveLength(2)
  })

  it('legacy applyRemote (grid / columns / modes) edits the current page and keeps other cell kinds', () => {
    const ex = useExecutorStore.getState()
    ex.addPage()
    useExecutorStore.getState().setPage(1)
    useExecutorStore.getState().assignCell(1, 0, 1, { kind: 'effect', id: 'fx', mode: 'toggle' })
    const grid = Array.from({ length: 8 }, () => [null, null, null, null] as (string | null)[])
    grid[0][0] = 'a'
    useExecutorStore.getState().applyRemote({ grid })
    const s = useExecutorStore.getState()
    expect(s.pages[1].cells[0][0]).toEqual({ kind: 'cuelist', id: 'a', mode: 'toggle' })
    expect(s.pages[1].cells[0][1]).toEqual({ kind: 'effect', id: 'fx', mode: 'toggle' })
    expect(s.pages[0].cells.flat().every((c) => c === null)).toBe(true)
    // Same pages again: no change, same references
    const pages = s.pages
    useExecutorStore.getState().applyRemote({ pages: JSON.parse(JSON.stringify(pages)) })
    expect(useExecutorStore.getState().pages).toBe(pages)
  })
})
