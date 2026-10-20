// ============================================================
// PhotonBoard — Executor surfaces: pure helpers shared by the
// executor bar, the Stage window, the remote stage views and the
// stage pages (no store access: safe in the Stage window bundle).
//
//   - button functions: which ones act while held (TRIG / FLASH…)
//   - page labels, page stepping, swipe recognition
//   - executor widget references ("page.col.row", 1-based, 0 = current page)
//   - column faders: the level they show, and the existing remote
//     commands they map to (Stage window: no store, only commands)
// ============================================================

import type { ExecutorButtonFn, ExecutorCell, ExecutorColumnFader, ExecutorSceneMode, ExecutorTargetKind } from '@shared/types'

/** Columns × rows of an executor page */
export const EXEC_COLUMNS = 8
export const EXEC_ROWS = 4

/** The cell data a surface needs (an ExecutorCell, possibly from a snapshot) */
export type CellRefData = Pick<ExecutorCell, 'kind' | 'id' | 'mode' | 'button'>

/** Button function a cell uses when none is set (same rule as lib/pro/executor-actions) */
export function defaultFn(mode: ExecutorSceneMode): ExecutorButtonFn {
  return mode === 'trigger' ? 'temp' : mode === 'flash' ? 'flash' : 'toggle'
}

export function cellFn(cell: Pick<CellRefData, 'mode' | 'button'>): ExecutorButtonFn {
  return cell.button ?? defaultFn(cell.mode)
}

/** Functions that act while the button is held (down = on, up = off): fire on press */
export function isHoldFn(fn: ExecutorButtonFn): boolean {
  return fn === 'temp' || fn === 'flash' || fn === 'swap'
}

/**
 * Whether a cell's button is held (fires on press, releases on lift) or
 * tapped (fires on release, so a long-press can still open the menu / drag).
 * Only scenes, chases and effects can be held.
 */
export function isHoldCell(cell: Pick<CellRefData, 'kind' | 'mode' | 'button'>): boolean {
  if (cell.kind === 'macro' || cell.kind === 'group' || cell.kind === 'speed') return false
  return isHoldFn(cellFn(cell))
}

/** Short badge of a button function (shown on cells whose function is not the default toggle) */
export const FN_BADGE: Record<ExecutorButtonFn, string> = {
  toggle: 'TOG', go: 'GO', goBack: 'GO-', flash: 'FLASH', temp: 'TRIG', off: 'OFF', select: 'SEL', swap: 'SWAP', pause: 'PAUSE', learn: 'LEARN'
}

/** Every button function, menu order */
export const BUTTON_FNS: readonly ExecutorButtonFn[] = ['toggle', 'go', 'goBack', 'flash', 'temp', 'off', 'select', 'swap', 'pause', 'learn']

/** Objects an executor cell can hold, menu order */
export const TARGET_KINDS: readonly ExecutorTargetKind[] = ['cuelist', 'chase', 'effect', 'macro', 'group', 'speed']

// ---------------------------------------------------------------
// Pages
// ---------------------------------------------------------------

/** Next page index after a step (clamped, no wrap: a swipe past the end does nothing) */
export function stepPage(current: number, delta: number, count: number): number {
  if (count <= 0) return 0
  const next = Math.trunc(current) + Math.trunc(delta)
  return Math.max(0, Math.min(count - 1, next))
}

/** Swipe thresholds */
export const SWIPE_MIN_PX = 56
export const SWIPE_MAX_MS = 700

/**
 * Horizontal swipe → page step: +1 (finger moved left: next page), -1
 * (moved right: previous), 0 (not a swipe: too short, too slow, too vertical).
 */
export function swipeStep(dx: number, dy: number, ms: number): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || ms > SWIPE_MAX_MS) return 0
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}

// ---------------------------------------------------------------
// Executor widget references: "page.col.row", 1-based; page 0 = the
// current executor page (the widget follows page changes)
// ---------------------------------------------------------------

export interface ExecRefSpec {
  page: number | 'current'
  col: number
  row: number
}

export function encodeExecRef(ref: ExecRefSpec): string {
  return `${ref.page === 'current' ? 0 : ref.page + 1}.${ref.col + 1}.${ref.row + 1}`
}

export function decodeExecRef(ref: string | undefined): ExecRefSpec | null {
  if (!ref) return null
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(ref.trim())
  if (!m) return null
  const page = Number(m[1])
  const col = Number(m[2]) - 1
  const row = Number(m[3]) - 1
  if (col < 0 || col >= EXEC_COLUMNS || row < 0 || row >= EXEC_ROWS) return null
  return { page: page === 0 ? 'current' : page - 1, col, row }
}

/** Page index a reference points at, given the current page */
export function resolveExecPage(ref: ExecRefSpec, currentPage: number): number {
  return ref.page === 'current' ? currentPage : ref.page
}

/** "page.col" (1-based; page 0 = current) for column fader widgets */
export function encodeColumnRef(page: number | 'current', col: number): string {
  return `${page === 'current' ? 0 : page + 1}.${col + 1}`
}

export function decodeColumnRef(ref: string | undefined): { page: number | 'current'; col: number } | null {
  if (!ref) return null
  const m = /^(\d+)\.(\d+)$/.exec(ref.trim())
  if (!m) return null
  const page = Number(m[1])
  const col = Number(m[2]) - 1
  if (col < 0 || col >= EXEC_COLUMNS) return null
  return { page: page === 0 ? 'current' : page - 1, col }
}

// ---------------------------------------------------------------
// Column faders
// ---------------------------------------------------------------

export interface ColumnPageLike {
  cells: (CellRefData | null)[][]
  columns: { fader?: ExecutorColumnFader }[]
}

export interface LevelLookup {
  cuelist(id: string): number | undefined
  chase(id: string): number | undefined
  group(id: string): number | undefined
  grandMaster: number
}

/** Fader function of a column (default: the column's cells) */
export function columnFaderOf(page: ColumnPageLike | undefined, col: number): ExecutorColumnFader {
  return page?.columns[col]?.fader ?? { kind: 'column' }
}

function cellLevel(cell: CellRefData | null | undefined, l: LevelLookup): number | undefined {
  if (!cell) return undefined
  if (cell.kind === 'cuelist') return l.cuelist(cell.id)
  if (cell.kind === 'chase') return l.chase(cell.id)
  if (cell.kind === 'group') return l.group(cell.id)
  return undefined
}

/**
 * Level a column fader shows (0-255): the first fader-driven cell of the
 * column, the grand master, a group master. null = nothing to show
 * (empty column, speed / rate / x-fade functions).
 */
export function columnFaderLevel(page: ColumnPageLike | undefined, col: number, lookup: LevelLookup): number | null {
  if (!page) return null
  const fader = columnFaderOf(page, col)
  switch (fader.kind) {
    case 'column': {
      for (const cell of page.cells[col] ?? []) {
        const v = cellLevel(cell, lookup)
        if (v !== undefined) return v
      }
      return null
    }
    case 'cell': return cellLevel(page.cells[col]?.[fader.row], lookup) ?? null
    case 'grandmaster': return lookup.grandMaster
    case 'group': return lookup.group(fader.id) ?? 255
    default: return null
  }
}

/** Whether a column fader drives anything (empty columns hide their fader) */
export function columnFaderActive(page: ColumnPageLike | undefined, col: number): boolean {
  if (!page) return false
  const fader = columnFaderOf(page, col)
  switch (fader.kind) {
    case 'column': return (page.cells[col] ?? []).some((c) => !!c && (c.kind === 'cuelist' || c.kind === 'chase' || c.kind === 'group'))
    case 'cell': {
      const c = page.cells[col]?.[fader.row]
      return !!c && (c.kind === 'cuelist' || c.kind === 'chase' || c.kind === 'group')
    }
    default: return true
  }
}

export interface SurfaceCommand {
  type: string
  payload?: unknown
}

/**
 * A column fader as EXISTING remote commands (the Stage window has no
 * store: it can only send commands). Group / speed / rate / x-fade have
 * no remote command yet: [].
 */
export function columnFaderCommands(page: ColumnPageLike | undefined, col: number, level: number): SurfaceCommand[] {
  if (!page) return []
  const v = Math.max(0, Math.min(255, Math.round(Number.isFinite(level) ? level : 0)))
  const forCell = (cell: CellRefData | null | undefined): SurfaceCommand | null => {
    if (!cell) return null
    if (cell.kind === 'cuelist') return { type: 'set-cuelist-fader', payload: { id: cell.id, level: v } }
    if (cell.kind === 'chase') return { type: 'set-chase-fader', payload: { id: cell.id, level: v } }
    return null
  }
  const fader = columnFaderOf(page, col)
  switch (fader.kind) {
    case 'column': return (page.cells[col] ?? []).map(forCell).filter((c): c is SurfaceCommand => !!c)
    case 'cell': { const c = forCell(page.cells[col]?.[fader.row]); return c ? [c] : [] }
    case 'grandmaster': return [{ type: 'set-grand-master', payload: v }]
    default: return []
  }
}

/** Serialise a column fader function for a <select> */
export function faderKey(f: ExecutorColumnFader | undefined): string {
  if (!f || f.kind === 'column') return 'column'
  if (f.kind === 'grandmaster') return 'grandmaster'
  if (f.kind === 'cell' || f.kind === 'rate' || f.kind === 'xfade') return `${f.kind}:${f.row}`
  return `${f.kind}:${f.id}`
}

export function parseFaderKey(key: string): ExecutorColumnFader | undefined {
  if (key === 'column') return undefined
  if (key === 'grandmaster') return { kind: 'grandmaster' }
  const i = key.indexOf(':')
  if (i < 0) return undefined
  const kind = key.slice(0, i)
  const rest = key.slice(i + 1)
  if (kind === 'cell' || kind === 'rate' || kind === 'xfade') {
    const row = Number(rest)
    return Number.isInteger(row) && row >= 0 && row < EXEC_ROWS ? { kind, row } : undefined
  }
  if ((kind === 'group' || kind === 'speed') && rest) return { kind, id: rest }
  return undefined
}
