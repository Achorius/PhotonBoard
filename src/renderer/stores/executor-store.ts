// ============================================================
// PhotonBoard — Executor Store
// Persists the 8×4 scene grid, column colors/titles and per-cell
// playback modes that drive the ExecutorBar (main app), the Stage
// window and the Remote (tablet/phone) views.
// Living in a real Zustand store (not local React state) lets us
// broadcast the layout to remote clients and to the Stage window.
// ============================================================

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { ExecutorSceneMode, ShowExecutorLayout } from '@shared/types'
import {
  EXECUTOR_COLUMN_COUNT,
  EXECUTOR_ROW_COUNT,
  DEFAULT_EXECUTOR_COLUMN_COLORS,
  defaultExecutorLayout,
  normalizeExecutorLayout
} from '@shared/show-format'

export const COLUMN_COUNT = EXECUTOR_COLUMN_COUNT
export const ROWS_PER_COLUMN = EXECUTOR_ROW_COUNT
export const TOTAL_SLOTS = COLUMN_COUNT * ROWS_PER_COLUMN

export type SceneMode = ExecutorSceneMode

export interface ColumnMeta {
  title: string
  color: string
}

export const DEFAULT_COLUMN_COLORS = DEFAULT_EXECUTOR_COLUMN_COLORS

interface ExecutorState {
  grid: (string | null)[][]
  columns: ColumnMeta[]
  modes: SceneMode[][]

  // Cell ops
  swapCells: (from: { col: number; row: number }, to: { col: number; row: number }) => void
  syncCuelists: (cuelistIds: string[]) => void

  // Column ops
  setColumnTitle: (col: number, title: string) => void
  setColumnColor: (col: number, color: string) => void

  // Mode ops
  setMode: (col: number, row: number, mode: SceneMode) => void

  /** Replace the whole layout (show load). Shape is normalised to 8×4. */
  loadLayout: (layout: ShowExecutorLayout | undefined, cuelistIds?: string[]) => void
  /** Current layout, for saving */
  getLayout: () => ShowExecutorLayout

  // Bulk replace (used by remote-sync to apply state from Pi)
  applyRemote: (data: {
    grid?: (string | null)[][]
    columns?: ColumnMeta[]
    modes?: SceneMode[][]
  }) => void
}

const initialLayout = defaultExecutorLayout()

export const useExecutorStore = create<ExecutorState>()(subscribeWithSelector((set, get) => ({
  grid: initialLayout.grid,
  columns: initialLayout.columns,
  modes: initialLayout.modes,

  swapCells: (from, to) => {
    if (from.col === to.col && from.row === to.row) return
    set((state) => {
      const newGrid = state.grid.map((c) => [...c])
      const newModes = state.modes.map((c) => [...c])
      const tmpId = newGrid[from.col][from.row]
      newGrid[from.col][from.row] = newGrid[to.col][to.row]
      newGrid[to.col][to.row] = tmpId
      const tmpMode = newModes[from.col][from.row]
      newModes[from.col][from.row] = newModes[to.col][to.row]
      newModes[to.col][to.row] = tmpMode
      return { grid: newGrid, modes: newModes }
    })
  },

  syncCuelists: (cuelistIds) => {
    set((state) => {
      const validIds = new Set(cuelistIds)
      const placed = new Set<string>()
      for (const col of state.grid) {
        for (const cell of col) if (cell) placed.add(cell)
      }
      const newCuelists = cuelistIds.filter((id) => !placed.has(id))
      const hasDeleted = Array.from(placed).some((id) => !validIds.has(id))
      if (newCuelists.length === 0 && !hasDeleted) return state

      const newGrid = state.grid.map((c) => [...c])
      // Clear deleted cuelists
      for (let col = 0; col < COLUMN_COUNT; col++) {
        for (let row = 0; row < ROWS_PER_COLUMN; row++) {
          if (newGrid[col][row] && !validIds.has(newGrid[col][row]!)) {
            newGrid[col][row] = null
          }
        }
      }
      // Fill empty slots column-first with new cuelists
      let idx = 0
      for (let col = 0; col < COLUMN_COUNT && idx < newCuelists.length; col++) {
        for (let row = 0; row < ROWS_PER_COLUMN && idx < newCuelists.length; row++) {
          if (!newGrid[col][row]) {
            newGrid[col][row] = newCuelists[idx]
            idx++
          }
        }
      }
      return { grid: newGrid }
    })
  },

  setColumnTitle: (col, title) => {
    set((state) => {
      const cols = [...state.columns]
      cols[col] = { ...cols[col], title }
      return { columns: cols }
    })
  },

  setColumnColor: (col, color) => {
    set((state) => {
      const cols = [...state.columns]
      cols[col] = { ...cols[col], color }
      return { columns: cols }
    })
  },

  setMode: (col, row, mode) => {
    set((state) => {
      const newModes = state.modes.map((c) => [...c])
      newModes[col][row] = mode
      return { modes: newModes }
    })
  },

  loadLayout: (layout, cuelistIds) => {
    const normalized = normalizeExecutorLayout(layout, cuelistIds ? new Set(cuelistIds) : undefined)
    set({ grid: normalized.grid, columns: normalized.columns, modes: normalized.modes })
  },

  getLayout: () => {
    const { grid, columns, modes } = get()
    return {
      grid: grid.map((c) => [...c]),
      columns: columns.map((c) => ({ ...c })),
      modes: modes.map((c) => [...c])
    }
  },

  applyRemote: (data) => {
    const state = get()
    const normalized = normalizeExecutorLayout({
      grid: Array.isArray(data.grid) ? data.grid : state.grid,
      columns: Array.isArray(data.columns) ? data.columns : state.columns,
      modes: Array.isArray(data.modes) ? data.modes : state.modes
    })
    // Keep references when nothing changed (no re-render, no echo)
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    set({
      grid: same(normalized.grid, state.grid) ? state.grid : normalized.grid,
      columns: same(normalized.columns, state.columns) ? state.columns : normalized.columns,
      modes: same(normalized.modes, state.modes) ? state.modes : normalized.modes
    })
  }
})))
