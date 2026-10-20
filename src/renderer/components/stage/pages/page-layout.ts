// ============================================================
// PhotonBoard — Stage page layout (pure): widget rectangles on the
// page grid, collision checks, free spots, default sizes and the
// starter layout offered for a new page.
// ============================================================

import type { StagePage, StageWidget, StageWidgetKind } from '@shared/types'
import { encodeExecRef, EXEC_COLUMNS } from '../executor-surface'

export interface Rect { x: number; y: number; w: number; h: number }

export const STAGE_GRID_MIN = 2
export const STAGE_GRID_MAX = 16

/** Widget kinds, palette order */
export const WIDGET_KINDS: readonly StageWidgetKind[] = ['executor', 'go', 'fader', 'master', 'group', 'preset', 'macro', 'speed', 'clock', 'label']

/** Size a new widget gets (shrunk to fit) */
export const WIDGET_DEFAULT_SIZE: Record<StageWidgetKind, { w: number; h: number }> = {
  executor: { w: 1, h: 1 },
  go: { w: 2, h: 2 },
  fader: { w: 1, h: 3 },
  master: { w: 1, h: 3 },
  group: { w: 1, h: 1 },
  preset: { w: 1, h: 1 },
  macro: { w: 1, h: 1 },
  speed: { w: 1, h: 2 },
  clock: { w: 2, h: 1 },
  label: { w: 2, h: 1 }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function inBounds(page: Pick<StagePage, 'cols' | 'rows'>, r: Rect): boolean {
  return Number.isInteger(r.x) && Number.isInteger(r.y) && r.w >= 1 && r.h >= 1 &&
    r.x >= 0 && r.y >= 0 && r.x + r.w <= page.cols && r.y + r.h <= page.rows
}

/** `r` is inside the page and covers no other widget (`ignoreId` = the one being moved) */
export function rectFits(page: Pick<StagePage, 'cols' | 'rows' | 'widgets'>, r: Rect, ignoreId?: string): boolean {
  if (!inBounds(page, r)) return false
  return !page.widgets.some((w) => w.id !== ignoreId && overlaps(w, r))
}

/** Clamp a rectangle into the page (size first, then position) */
export function clampRect(page: Pick<StagePage, 'cols' | 'rows'>, r: Rect): Rect {
  const w = Math.max(1, Math.min(page.cols, Math.round(r.w)))
  const h = Math.max(1, Math.min(page.rows, Math.round(r.h)))
  const x = Math.max(0, Math.min(page.cols - w, Math.round(r.x)))
  const y = Math.max(0, Math.min(page.rows - h, Math.round(r.y)))
  return { x, y, w, h }
}

/**
 * First free spot for a w × h widget (row by row, left to right). When
 * nothing that big fits, smaller sizes are tried down to 1 × 1. null =
 * the page is full.
 */
export function findFreeSpot(page: Pick<StagePage, 'cols' | 'rows' | 'widgets'>, w: number, h: number, near?: { x: number; y: number }): Rect | null {
  const sizes: { w: number; h: number }[] = []
  for (let hh = Math.min(h, page.rows); hh >= 1; hh--) {
    for (let ww = Math.min(w, page.cols); ww >= 1; ww--) sizes.push({ w: ww, h: hh })
  }
  sizes.sort((a, b) => b.w * b.h - a.w * a.h)
  for (const s of sizes) {
    if (near) {
      const r = clampRect(page, { x: near.x, y: near.y, ...s })
      if (r.x === near.x && r.y === near.y && rectFits(page, r)) return r
    }
    for (let y = 0; y + s.h <= page.rows; y++) {
      for (let x = 0; x + s.w <= page.cols; x++) {
        const r = { x, y, ...s }
        if (rectFits(page, r)) return r
      }
    }
  }
  return null
}

/** Grid cell under a point of the page element (clamped) */
export function cellAt(bounds: { left: number; top: number; width: number; height: number }, cols: number, rows: number, x: number, y: number): { x: number; y: number } {
  const cx = Math.floor(((x - bounds.left) / Math.max(1, bounds.width)) * cols)
  const cy = Math.floor(((y - bounds.top) / Math.max(1, bounds.height)) * rows)
  return { x: Math.max(0, Math.min(cols - 1, cx)), y: Math.max(0, Math.min(rows - 1, cy)) }
}

/** Widgets that no longer fit after the grid shrank are dropped; the others are clamped */
export function fitWidgetsToGrid(widgets: readonly StageWidget[], cols: number, rows: number): StageWidget[] {
  const placed: StageWidget[] = []
  const page = { cols, rows, widgets: placed }
  for (const w of widgets) {
    const r = clampRect(page, w)
    if (rectFits(page, r)) placed.push({ ...w, ...r })
    else {
      const spot = findFreeSpot(page, r.w, r.h)
      if (spot) placed.push({ ...w, ...spot })
    }
  }
  return placed
}

// ---------------------------------------------------------------
// Starter layout (new page): a ready-to-play surface the operator then edits
// ---------------------------------------------------------------

export interface StarterSource {
  groups: readonly { id: string }[]
  macros: readonly { id: string }[]
  presets: readonly { id: string; type: string }[]
}

/** Widgets (without ids) of the starter layout on an 8 × 6 page */
export function starterWidgets(src: StarterSource): Omit<StageWidget, 'id'>[] {
  const out: Omit<StageWidget, 'id'>[] = [
    { kind: 'go', x: 0, y: 0, w: 3, h: 2 },
    { kind: 'clock', x: 3, y: 0, w: 2, h: 1 },
    { kind: 'master', x: 5, y: 0, w: 2, h: 1, options: { fn: 'blackout' } },
    { kind: 'master', x: 3, y: 1, w: 2, h: 1, options: { fn: 'release' } },
    { kind: 'master', x: 5, y: 1, w: 1, h: 1, options: { fn: 'blinder' } },
    { kind: 'master', x: 6, y: 1, w: 1, h: 1, options: { fn: 'strobe' } },
    { kind: 'master', x: 7, y: 0, w: 1, h: 6, options: { fn: 'gm' } }
  ]
  // Executors of the current page, rows 1-2, columns 1-7
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < Math.min(7, EXEC_COLUMNS); col++) {
      out.push({ kind: 'executor', x: col, y: 2 + row, w: 1, h: 1, ref: encodeExecRef({ page: 'current', col, row }) })
    }
  }
  src.groups.slice(0, 7).forEach((g, i) => out.push({ kind: 'group', x: i, y: 4, w: 1, h: 1, ref: g.id }))
  const colours = src.presets.filter((p) => p.type === 'color')
  const row5 = colours.length > 0 ? colours.slice(0, 7).map((p) => ({ kind: 'preset' as const, ref: p.id })) : src.macros.slice(0, 7).map((m) => ({ kind: 'macro' as const, ref: m.id }))
  row5.forEach((w, i) => out.push({ ...w, x: i, y: 5, w: 1, h: 1 }))
  return out
}
