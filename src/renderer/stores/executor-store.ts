// ============================================================
// PhotonBoard — Executor Store
// Executor PAGES (8 columns × 4 rows each, up to MAX_EXECUTOR_PAGES):
// what each cell plays (scene, chase, effect, macro, group, speed
// master), its mode / button function, column titles, colours and
// fader functions. They drive the ExecutorBar (main app), the Stage
// window, the Remote (tablet/phone) views, MIDI controllers and the
// command line.
//
// Legacy view: `grid` / `columns` / `modes` are the CURRENT page as the
// v2 executor bar knew it (scene cells only). Every existing consumer
// keeps reading and editing them unchanged; the setters (swapCells,
// setMode, setColumnTitle…) act on the current page.
//
// `pages` is show content (saved, synced, undoable); `currentPage` is
// per-machine runtime state (never saved, never undone).
// ============================================================

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type {
  ExecutorButtonFn, ExecutorCell, ExecutorColumnFader, ExecutorPage, ExecutorSceneMode, ExecutorTargetKind, ShowExecutorLayout
} from '@shared/types'
import {
  EXECUTOR_COLUMN_COUNT,
  EXECUTOR_ROW_COUNT,
  DEFAULT_EXECUTOR_COLUMN_COLORS,
  MAX_EXECUTOR_PAGES,
  createExecutorPage,
  defaultExecutorLayout,
  executorLayoutFromPages,
  executorPageToLegacy,
  normalizeExecutorLayout,
  type ExecutorRefIds
} from '@shared/show-format'
import { usePlaybackStore } from './playback-store'
import { isRemoteMode } from '@renderer/lib/runtime'

export const COLUMN_COUNT = EXECUTOR_COLUMN_COUNT
export const ROWS_PER_COLUMN = EXECUTOR_ROW_COUNT
export const TOTAL_SLOTS = COLUMN_COUNT * ROWS_PER_COLUMN
export const MAX_PAGES = MAX_EXECUTOR_PAGES

export type SceneMode = ExecutorSceneMode

export interface ColumnMeta {
  title: string
  color: string
}

export const DEFAULT_COLUMN_COLORS = DEFAULT_EXECUTOR_COLUMN_COLORS

/** Where an object sits: page index (0-based), column, row */
export interface CellLocation {
  page: number
  col: number
  row: number
  cell: ExecutorCell
}

interface ExecutorState {
  /** Executor pages (show content). Never empty. */
  pages: ExecutorPage[]
  /** Page shown on this machine (0-based; runtime, not saved) */
  currentPage: number

  /** Legacy view of the CURRENT page: scene ids (other cell kinds read as null) */
  grid: (string | null)[][]
  columns: ColumnMeta[]
  modes: SceneMode[][]

  // ---- Pages ----
  /** Show another page (clamped) */
  setPage: (index: number) => void
  /** Add a page at the end; returns its index, or -1 at MAX_PAGES */
  addPage: (name?: string) => number
  /** Remove a page (never the last one) */
  removePage: (index: number) => void
  renamePage: (index: number, name: string) => void
  /** Put an object in a cell (null = empty it). An object already elsewhere on that page moves. */
  assignCell: (page: number, col: number, row: number, cell: ExecutorCell | null) => void
  /** Button function of a cell (undefined = from its mode) */
  setCellButton: (page: number, col: number, row: number, fn: ExecutorButtonFn | undefined) => void
  /** Column fader function (undefined = the column's cells) */
  setColumnFader: (page: number, col: number, fader: ExecutorColumnFader | undefined) => void
  /** First cell holding this object (current page first, then page order) */
  findCell: (kind: ExecutorTargetKind, id: string) => CellLocation | null

  // ---- Current page (legacy API) ----
  swapCells: (from: { col: number; row: number }, to: { col: number; row: number }) => void
  /** Free the cells of deleted scenes and place new ones (overflowing onto new pages) */
  syncCuelists: (cuelistIds: string[]) => void
  setColumnTitle: (col: number, title: string) => void
  setColumnColor: (col: number, color: string) => void
  setMode: (col: number, row: number, mode: SceneMode) => void

  /** Replace the whole layout (show load). Normalised (8×4 pages). */
  loadLayout: (layout: ShowExecutorLayout | undefined, cuelistIds?: string[], refs?: ExecutorRefIds) => void
  /** Current layout, for saving: pages + their v2 mirror (page 1) */
  getLayout: () => ShowExecutorLayout

  /**
   * Bulk replace (content sync, undo, 'set-executor-layout'). `pages`
   * replaces every page; without it, grid / columns / modes replace the
   * CURRENT page (legacy clients).
   */
  applyRemote: (data: {
    grid?: (string | null)[][]
    columns?: ColumnMeta[]
    modes?: SceneMode[][]
    pages?: ExecutorPage[]
  }) => void
}

// ------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function clampPage(index: number, pages: readonly ExecutorPage[]): number {
  if (!Number.isFinite(index)) return 0
  return Math.max(0, Math.min(pages.length - 1, Math.trunc(index)))
}

function validCell(col: number, row: number): boolean {
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < COLUMN_COUNT && row >= 0 && row < ROWS_PER_COLUMN
}

function copyCells(page: ExecutorPage): (ExecutorCell | null)[][] {
  return page.cells.map((c) => [...c])
}

/**
 * Legacy grid sync (single page): deleted scenes removed, unplaced scenes in
 * the first free slots (column-first). Returns the SAME array when nothing
 * changes — also when more scenes exist than slots.
 */
export function syncGrid(grid: (string | null)[][], cuelistIds: string[]): (string | null)[][] {
  const validIds = new Set(cuelistIds)
  const placed = new Set<string>()
  let hasDeleted = false
  let hasFree = false
  for (const col of grid) {
    for (const cell of col) {
      if (!cell) { hasFree = true; continue }
      placed.add(cell)
      if (!validIds.has(cell)) hasDeleted = true
    }
  }
  const unplaced = cuelistIds.filter((id) => !placed.has(id))
  if (!hasDeleted && (unplaced.length === 0 || !hasFree)) return grid

  const newGrid = grid.map((c) => [...c])
  let changed = false
  for (let col = 0; col < newGrid.length; col++) {
    for (let row = 0; row < newGrid[col].length; row++) {
      const id = newGrid[col][row]
      if (id && !validIds.has(id)) { newGrid[col][row] = null; changed = true }
    }
  }
  let idx = 0
  for (let col = 0; col < Math.min(COLUMN_COUNT, newGrid.length) && idx < unplaced.length; col++) {
    for (let row = 0; row < Math.min(ROWS_PER_COLUMN, newGrid[col].length) && idx < unplaced.length; row++) {
      if (!newGrid[col][row]) {
        newGrid[col][row] = unplaced[idx++]
        changed = true
      }
    }
  }
  return changed ? newGrid : grid
}

/**
 * Multi-page auto-placement: scene cells of deleted scenes are emptied, scenes
 * on no page take the first free cell (page order, column-first); when every
 * page is full, new pages are added (up to MAX_PAGES). Returns the SAME array
 * when nothing changes (a fader move or a GO never produces new pages).
 */
export function syncPages(pages: ExecutorPage[], cuelistIds: string[], newPageId: () => string = uuidv4): ExecutorPage[] {
  const validIds = new Set(cuelistIds)
  const placed = new Set<string>()
  let hasDeleted = false
  let free = 0
  for (const page of pages) {
    for (const column of page.cells) {
      for (const cell of column) {
        if (!cell) { free++; continue }
        if (cell.kind !== 'cuelist') continue
        placed.add(cell.id)
        if (!validIds.has(cell.id)) hasDeleted = true
      }
    }
  }
  const unplaced = cuelistIds.filter((id) => !placed.has(id))
  const canGrow = pages.length < MAX_PAGES
  if (!hasDeleted && (unplaced.length === 0 || (free === 0 && !canGrow))) return pages

  const next = [...pages]
  let changed = false
  const touched = new Set<number>()
  const editable = (p: number) => {
    if (!touched.has(p)) { next[p] = { ...next[p], cells: copyCells(next[p]) }; touched.add(p) }
    return next[p]
  }
  if (hasDeleted) {
    next.forEach((page, p) => {
      page.cells.forEach((column, col) => column.forEach((cell, row) => {
        if (cell && cell.kind === 'cuelist' && !validIds.has(cell.id)) {
          editable(p).cells[col][row] = null
          changed = true
        }
      }))
    })
  }
  let idx = 0
  for (let p = 0; idx < unplaced.length; p++) {
    if (p >= next.length) {
      if (next.length >= MAX_PAGES) break
      next.push(createExecutorPage(newPageId()))
      touched.add(p)
      changed = true
    }
    for (let col = 0; col < COLUMN_COUNT && idx < unplaced.length; col++) {
      for (let row = 0; row < ROWS_PER_COLUMN && idx < unplaced.length; row++) {
        if (!next[p].cells[col]?.[row]) {
          editable(p).cells[col][row] = { kind: 'cuelist', id: unplaced[idx++], mode: 'toggle' }
          changed = true
        }
      }
    }
  }
  return changed ? next : pages
}

/** Legacy view of a page, keeping the previous arrays when equal (no re-render) */
function viewOf(
  pages: ExecutorPage[], currentPage: number, prev?: Pick<ExecutorState, 'grid' | 'columns' | 'modes'>
): Pick<ExecutorState, 'grid' | 'columns' | 'modes'> {
  const view = executorPageToLegacy(pages[currentPage])
  if (!prev) return view
  return {
    grid: same(view.grid, prev.grid) ? prev.grid : view.grid,
    columns: same(view.columns, prev.columns) ? prev.columns : view.columns,
    modes: same(view.modes, prev.modes) ? prev.modes : view.modes
  }
}

// Saved / synced layout, memoised on the pages array (stable reference for diffs)
let layoutCache: { pages: ExecutorPage[]; layout: ShowExecutorLayout } | null = null

/** Executor layout as show content (pages + mirror of page 1). Same object while pages do not change. */
export function getExecutorContent(pages: ExecutorPage[] = useExecutorStore.getState().pages): ShowExecutorLayout {
  if (layoutCache && layoutCache.pages === pages) return layoutCache.layout
  const layout = executorLayoutFromPages(pages)
  layoutCache = { pages, layout }
  return layout
}

const initialLayout = defaultExecutorLayout()

export const useExecutorStore = create<ExecutorState>()(subscribeWithSelector((set, get) => {
  /** Replace pages (and / or the current page), recomputing the legacy view */
  const commit = (pages: ExecutorPage[], currentPage = get().currentPage) => {
    const state = get()
    const page = clampPage(currentPage, pages)
    if (pages === state.pages && page === state.currentPage) return
    set({ pages, currentPage: page, ...viewOf(pages, page, state) })
  }

  /** Update one page through a function on a copy of its cells / columns */
  const editPage = (index: number, fn: (page: ExecutorPage) => ExecutorPage | null) => {
    const { pages } = get()
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) return
    const updated = fn({ ...pages[index], cells: copyCells(pages[index]), columns: pages[index].columns.map((c) => ({ ...c })) })
    if (!updated || same(updated, pages[index])) return
    const next = [...pages]
    next[index] = updated
    commit(next)
  }

  return {
    pages: initialLayout.pages!,
    currentPage: 0,
    grid: initialLayout.grid,
    columns: initialLayout.columns,
    modes: initialLayout.modes,

    // ---- Pages ----
    setPage: (index) => commit(get().pages, index),

    addPage: (name = '') => {
      const { pages } = get()
      if (pages.length >= MAX_PAGES) return -1
      commit([...pages, createExecutorPage(uuidv4(), name)])
      return get().pages.length - 1
    },

    removePage: (index) => {
      const { pages, currentPage } = get()
      if (pages.length <= 1 || !Number.isInteger(index) || index < 0 || index >= pages.length) return
      const next = pages.filter((_, i) => i !== index)
      commit(next, currentPage > index ? currentPage - 1 : currentPage)
    },

    renamePage: (index, name) => editPage(index, (page) => ({ ...page, name: name.trim() })),

    assignCell: (pageIndex, col, row, cell) => {
      if (!validCell(col, row)) return
      editPage(pageIndex, (page) => {
        if (cell) {
          // One cell per object on a page: it moves
          page.cells.forEach((column, c) => column.forEach((x, r) => {
            if (x && x.kind === cell.kind && x.id === cell.id && (c !== col || r !== row)) page.cells[c][r] = null
          }))
          page.cells[col][row] = { ...cell }
        } else {
          page.cells[col][row] = null
        }
        return page
      })
    },

    setCellButton: (pageIndex, col, row, fn) => {
      if (!validCell(col, row)) return
      editPage(pageIndex, (page) => {
        const cell = page.cells[col][row]
        if (!cell) return null
        const next: ExecutorCell = { kind: cell.kind, id: cell.id, mode: cell.mode }
        if (fn) next.button = fn
        page.cells[col][row] = next
        return page
      })
    },

    setColumnFader: (pageIndex, col, fader) => {
      if (!Number.isInteger(col) || col < 0 || col >= COLUMN_COUNT) return
      editPage(pageIndex, (page) => {
        const { fader: _old, ...rest } = page.columns[col]
        page.columns[col] = fader ? { ...rest, fader: { ...fader } } : rest
        return page
      })
    },

    findCell: (kind, id) => {
      const { pages, currentPage } = get()
      const order = [currentPage, ...pages.map((_, i) => i).filter((i) => i !== currentPage)]
      for (const p of order) {
        const cells = pages[p]?.cells ?? []
        for (let col = 0; col < cells.length; col++) {
          const row = cells[col].findIndex((c) => c?.kind === kind && c.id === id)
          if (row >= 0) return { page: p, col, row, cell: cells[col][row]! }
        }
      }
      return null
    },

    // ---- Current page (legacy API) ----
    swapCells: (from, to) => {
      if (from.col === to.col && from.row === to.row) return
      if (!validCell(from.col, from.row) || !validCell(to.col, to.row)) return
      editPage(get().currentPage, (page) => {
        const tmp = page.cells[from.col][from.row]
        page.cells[from.col][from.row] = page.cells[to.col][to.row]
        page.cells[to.col][to.row] = tmp
        return page
      })
    },

    syncCuelists: (cuelistIds) => {
      const { pages } = get()
      const next = syncPages(pages, cuelistIds)
      if (next !== pages) commit(next)
    },

    setColumnTitle: (col, title) => {
      editPage(get().currentPage, (page) => {
        if (!page.columns[col]) return null
        page.columns[col] = { ...page.columns[col], title }
        return page
      })
    },

    setColumnColor: (col, color) => {
      editPage(get().currentPage, (page) => {
        if (!page.columns[col]) return null
        page.columns[col] = { ...page.columns[col], color }
        return page
      })
    },

    setMode: (col, row, mode) => {
      if (!validCell(col, row)) return
      editPage(get().currentPage, (page) => {
        const cell = page.cells[col][row]
        if (!cell) return null
        page.cells[col][row] = { ...cell, mode }
        return page
      })
    },

    loadLayout: (layout, cuelistIds, refs) => {
      const normalized = normalizeExecutorLayout(layout, cuelistIds ? new Set(cuelistIds) : undefined, refs)
      const pages = normalized.pages!
      set({ pages, currentPage: 0, ...viewOf(pages, 0) })
    },

    getLayout: () => {
      const layout = executorLayoutFromPages(get().pages)
      return JSON.parse(JSON.stringify(layout)) as ShowExecutorLayout
    },

    applyRemote: (data) => {
      const state = get()
      if (Array.isArray(data.pages)) {
        const normalized = normalizeExecutorLayout({ pages: data.pages }).pages!
        // Keep references when nothing changed (no re-render, no echo)
        const pages = same(normalized, state.pages)
          ? state.pages
          : normalized.map((p, i) => (state.pages[i] && same(p, state.pages[i]) ? state.pages[i] : p))
        commit(pages)
        return
      }
      // Legacy client: grid / columns / modes of the current page
      const current = executorPageToLegacy(state.pages[state.currentPage])
      const page = normalizeExecutorLayout({
        grid: Array.isArray(data.grid) ? data.grid : current.grid,
        columns: Array.isArray(data.columns) ? data.columns : current.columns,
        modes: Array.isArray(data.modes) ? data.modes : current.modes
      }).pages![0]
      const old = state.pages[state.currentPage]
      // Cells of other kinds stay where the legacy view could not see them
      const cells = page.cells.map((column, col) => column.map((cell, row) => {
        const before = old.cells[col]?.[row]
        if (!cell && before && before.kind !== 'cuelist') return before
        if (cell && before && before.kind === 'cuelist' && before.id === cell.id && before.mode === cell.mode) return before
        return cell
      }))
      const columns = page.columns.map((c, col) => (old.columns[col]?.fader ? { ...c, fader: old.columns[col].fader } : c))
      const updated: ExecutorPage = { ...old, cells, columns }
      if (same(updated, old)) return
      const pages = [...state.pages]
      pages[state.currentPage] = updated
      commit(pages)
    }
  }
}))

// ------------------------------------------------------------
// Auto-placement: new scenes take the first free slot (on any page, new
// pages when all are full), deleted ones free theirs — whether or not the
// executor bar is shown. Console only: in remote mode the layout comes
// from the console.
// ------------------------------------------------------------

let stopAutoSync: (() => void) | null = null

/** Keep the pages in step with the scene list (idempotent). Returns a stop function. */
export function startExecutorAutoSync(): () => void {
  if (stopAutoSync) return stopAutoSync
  let lastIds: string[] = []
  const run = (force: boolean) => {
    if (isRemoteMode()) return
    const { cuelists } = usePlaybackStore.getState()
    if (!force && cuelists.length === lastIds.length && cuelists.every((c, i) => c.id === lastIds[i])) return
    lastIds = cuelists.map((c) => c.id)
    useExecutorStore.getState().syncCuelists(lastIds)
  }
  run(true)
  const unsubPlayback = usePlaybackStore.subscribe((s, p) => { if (s.cuelists !== p.cuelists) run(false) })
  // Layout replaced (show load, remote edit): re-check (no-op when consistent)
  const unsubPages = useExecutorStore.subscribe((s, p) => { if (s.pages !== p.pages) run(true) })
  stopAutoSync = () => {
    unsubPlayback()
    unsubPages()
    stopAutoSync = null
  }
  return stopAutoSync
}
