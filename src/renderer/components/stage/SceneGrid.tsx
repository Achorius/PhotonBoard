// ============================================================
// Executor grid for the stage surfaces (Electron Stage window, remote
// phone / tablet). Same 8 × 4 layout, column colours and button
// functions as the executor bar, sized for fingers. Any cell kind:
// scenes, chases, effects, macros, groups, speed masters.
//
// Prop-driven (no store access): the Stage window feeds it from the
// console's surface data, the remote views from the mirrored stores;
// presses go to ONE callback (`onPress(cell, phase)`), which both
// route to lib/pro/executor-actions on the console.
//
// Grid modes:
//   play     tap (on release) = the cell's function (GO / STOP…)
//            TRIG / FLASH / SWAP act while held (released on lift,
//            cancel, unmount and when the grid leaves play mode)
//            long-press a tap cell (touch) or drag it (mouse) to move it
//            swipe sideways (touch) = previous / next executor page
//   levels   scenes and chases become faders (master level)
//   arrange  nothing fires: drag any cell onto another to swap
// ============================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuCrosshair, LuGripVertical, LuMoveDiagonal } from 'react-icons/lu'
import type { ExecutorButtonFn, ExecutorTargetKind } from '@shared/types'
import { Badge, Fader, SWATCH_COLORS, usePointerDrag, cn, formatCuePosition, formatPercent, palette, tint, withAlpha } from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import type { ResolvedCell } from './pages/surface-data'
import { isHoldFn } from './executor-surface'
import { KIND_ICON, cellName, fnBadge, fnBadgeTone } from './cell-visuals'
import { useSwipePaging } from './PageSelector'

export type StageGridMode = 'play' | 'levels' | 'arrange'
export type Cell = { col: number; row: number }

export interface ColumnInfo {
  title: string
  color: string
}

export const STAGE_COLUMNS = 8
export const STAGE_ROWS = 4

const LONG_PRESS_MS = 450
const DRAG_THRESHOLD = 8
const FALLBACK_COLOR: string = SWATCH_COLORS[11]

/** Cells that act while held (scenes, chases, effects with TRIG / FLASH / SWAP) */
function holdCell(kind: ExecutorTargetKind, fn: ExecutorButtonFn): boolean {
  return kind !== 'macro' && kind !== 'group' && kind !== 'speed' && isHoldFn(fn)
}

interface Callbacks {
  press: (cell: Cell, phase: 'down' | 'up') => void
  level: (cell: Cell, level: number) => void
  dragStart: (from: Cell, x: number, y: number) => void
  dragMove: (x: number, y: number) => void
  dragEnd: (drop: boolean) => void
}

interface DragState {
  from: Cell
  name: string
  color: string
  x: number
  y: number
  over: Cell | null
}

export interface SceneGridProps {
  /** [col][row] → resolved cell (null = empty) */
  cells: readonly (readonly (ResolvedCell | null)[] | undefined)[]
  columns: readonly ColumnInfo[]
  mode: StageGridMode
  /** Visible column indexes (column pairs on phones); default all 8 */
  visibleColumns?: number[]
  /** lg: Stage window / Pi; md: tablet; sm: phone */
  size?: 'sm' | 'md' | 'lg'
  /** The executor GO / Back act on, when it is on this page */
  selected?: Cell | null
  onPress: (cell: Cell, phase: 'down' | 'up') => void
  onLevel: (cell: ResolvedCell, level: number) => void
  onSwap: (from: Cell, to: Cell) => void
  /** Swipe sideways (touch, play mode) */
  onSwipe?: (step: -1 | 1) => void
  className?: string
}

const ALL_COLUMNS = Array.from({ length: STAGE_COLUMNS }, (_, i) => i)

export function SceneGrid({
  cells, columns, mode, visibleColumns = ALL_COLUMNS, size = 'md', selected, onPress, onLevel, onSwap, onSwipe, className
}: SceneGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const latest = useRef({ cells, columns, drag, onPress, onLevel, onSwap })
  latest.current = { cells, columns, drag, onPress, onLevel, onSwap }
  const swipe = useSwipePaging((s) => onSwipe?.(s), !!onSwipe && mode === 'play')

  const callbacks = useMemo<Callbacks>(() => ({
    press: (cell, phase) => latest.current.onPress(cell, phase),
    level: (cell, level) => {
      const c = latest.current.cells[cell.col]?.[cell.row]
      if (c) latest.current.onLevel(c, level)
    },
    dragStart: (from, x, y) => {
      const c = latest.current.cells[from.col]?.[from.row]
      if (!c) return
      setDrag({ from, name: cellName(c), color: c.color || latest.current.columns[from.col]?.color || FALLBACK_COLOR, x, y, over: null })
    },
    dragMove: (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-stage-cell]')
      const over = el ? parseCell(el.dataset.stageCell!) : null
      setDrag((d) => (d ? { ...d, x, y, over } : d))
    },
    dragEnd: (drop) => {
      const d = latest.current.drag
      setDrag(null)
      if (drop && d?.over && (d.over.col !== d.from.col || d.over.row !== d.from.row)) latest.current.onSwap(d.from, d.over)
    }
  }), [])

  return (
    <div
      {...swipe}
      className={cn('grid min-h-0 min-w-0 flex-1 touch-pan-y', size === 'lg' ? 'gap-2' : 'gap-1.5', mode === 'arrange' && 'rounded-lg bg-info/[0.05]', className)}
      style={{
        gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))`,
        gridTemplateRows: `auto repeat(${STAGE_ROWS}, minmax(0, 1fr))`,
        gridAutoFlow: 'column'
      }}
    >
      {visibleColumns.map((col) => (
        <ColumnCells
          key={col}
          col={col}
          title={columns[col]?.title ?? ''}
          color={columns[col]?.color || FALLBACK_COLOR}
          cells={cells[col]}
          gridMode={mode}
          size={size}
          selectedRow={selected && selected.col === col ? selected.row : -1}
          drag={drag}
          callbacks={callbacks}
        />
      ))}
      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-popover flex h-10 max-w-[240px] items-center gap-2 rounded-md px-3 text-sm font-semibold text-fg-primary shadow-popover"
          style={{ left: drag.x + 14, top: drag.y - 56, backgroundColor: tint(drag.color, 0.45), border: `1px solid ${drag.color}` }}
        >
          <LuGripVertical size={16} />
          <span className="truncate">{drag.name}</span>
        </div>
      )}
    </div>
  )
}

function parseCell(key: string): Cell | null {
  const [col, row] = key.split(':').map(Number)
  return Number.isInteger(col) && Number.isInteger(row) ? { col, row } : null
}

const ColumnCells = memo(function ColumnCells({ col, title, color, cells, gridMode, size, selectedRow, drag, callbacks }: {
  col: number
  title: string
  color: string
  cells: readonly (ResolvedCell | null)[] | undefined
  gridMode: StageGridMode
  size: 'sm' | 'md' | 'lg'
  selectedRow: number
  drag: DragState | null
  callbacks: Callbacks
}) {
  const t = useT()
  return (
    <>
      <div className={cn('flex min-w-0 items-center gap-1.5 px-1', size === 'lg' ? 'h-7' : 'h-6')}>
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-semibold uppercase tracking-[0.06em]',
            size === 'lg' ? 'text-xs' : 'text-2xs',
            title ? 'text-fg-secondary' : 'text-fg-tertiary'
          )}
        >
          {title || t('stage.columnN', { n: col + 1 })}
        </span>
      </div>
      {Array.from({ length: STAGE_ROWS }, (_, row) => {
        const c = cells?.[row] ?? null
        const isSource = drag?.from.col === col && drag.from.row === row
        const isTarget = !!drag && drag.over?.col === col && drag.over.row === row && !isSource
        if (!c) {
          return (
            <div
              key={row}
              data-stage-cell={`${col}:${row}`}
              aria-hidden
              className={cn(
                'min-h-0 rounded-md border border-dashed',
                isTarget ? 'border-info-fg bg-info/15' : gridMode === 'arrange' ? 'border-line-strong' : 'border-line-subtle bg-surface-1/40'
              )}
            />
          )
        }
        return (
          <ExecTile
            key={row}
            col={col}
            row={row}
            kind={c.kind}
            fn={c.fn}
            name={cellName(c)}
            missing={!!c.missing}
            active={c.active}
            flash={c.flash}
            level={c.level ?? -1}
            posIndex={c.position?.index ?? -2}
            posCount={c.position?.count ?? 0}
            cueName={c.cueName}
            number={c.number}
            color={c.color || color}
            selected={selectedRow === row}
            gridMode={gridMode}
            size={size}
            dragSource={isSource}
            dropTarget={isTarget}
            callbacks={callbacks}
          />
        )
      })}
    </>
  )
})

// ---------------------------------------------------------------
// Tile
// ---------------------------------------------------------------

type Gesture =
  | { kind: 'pending'; id: number; x: number; y: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'lifted'; id: number; x: number; y: number }
  | { kind: 'holding'; id: number | 'key' }
  | { kind: 'dragging'; id: number }

interface TileProps {
  col: number
  row: number
  kind: ExecutorTargetKind
  fn: ExecutorButtonFn
  name: string
  missing: boolean
  active: boolean
  flash: boolean
  /** 0-255, -1 = no level (macros…) */
  level: number
  /** -2 = no position (macros…), -1 = stopped */
  posIndex: number
  posCount: number
  cueName?: string
  number?: number
  color: string
  selected: boolean
  gridMode: StageGridMode
  size: 'sm' | 'md' | 'lg'
  dragSource: boolean
  dropTarget: boolean
  callbacks: Callbacks
}

const ExecTile = memo(function ExecTile(props: TileProps) {
  const {
    col, row, kind, fn, name, missing, active, flash, level, posIndex, posCount, cueName, number, color, selected, gridMode, size,
    dragSource, dropTarget, callbacks
  } = props
  useT() // labels follow the UI language
  const gesture = useRef<Gesture | null>(null)
  const [lifted, setLifted] = useState(false)
  const arranging = gridMode === 'arrange'
  const hold = holdCell(kind, fn)
  const cell = useMemo(() => ({ col, row }), [col, row])

  const clearTimer = () => {
    const g = gesture.current
    if (g?.kind === 'pending' && g.timer) clearTimeout(g.timer)
  }
  const tap = () => {
    callbacks.press(cell, 'down')
    callbacks.press(cell, 'up')
  }

  // A held cell never stays on: release on unmount and when the grid leaves play mode
  useEffect(() => () => {
    clearTimer()
    if (gesture.current?.kind === 'holding') callbacks.press(cell, 'up')
    gesture.current = null
  }, [callbacks, cell])
  useEffect(() => {
    if (gridMode !== 'play' && gesture.current?.kind === 'holding') {
      gesture.current = null
      callbacks.press(cell, 'up')
    }
  }, [gridMode, callbacks, cell])

  if (gridMode === 'levels') {
    const hasLevel = level >= 0 && (kind === 'cuelist' || kind === 'chase')
    return (
      <div
        data-stage-cell={`${col}:${row}`}
        className={cn(
          'relative flex min-h-0 min-w-0 flex-col items-center gap-1 overflow-hidden rounded-md border px-1.5 pb-1.5 pt-1.5',
          active ? '' : 'border-line-subtle bg-surface-2',
          !hasLevel && 'opacity-50'
        )}
        style={active ? { backgroundColor: tint(color, 0.18, palette.surface2), borderColor: withAlpha(color, 0.7) } : undefined}
      >
        <span className={cn('w-full truncate text-center font-semibold', size === 'lg' ? 'text-sm' : 'text-xs', active ? 'text-fg-primary' : 'text-fg-secondary')}>
          {name}
        </span>
        {!hasLevel ? null : size === 'sm' ? (
          <LevelBar value={level} color={color} label={t('stage.sceneLevel', { name })} onChange={(v) => callbacks.level(cell, v)} />
        ) : (
          <div className="flex min-h-0 w-full flex-1 justify-center">
            <Fader
              value={level}
              onChange={(v) => callbacks.level(cell, v)}
              defaultValue={255}
              color={color}
              ticks
              aria-label={t('stage.sceneLevel', { name })}
              className="w-full max-w-[96px]"
            />
          </div>
        )}
      </div>
    )
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    if (!arranging && hold) {
      gesture.current = { kind: 'holding', id: e.pointerId }
      callbacks.press(cell, 'down')
      return
    }
    const touch = e.pointerType !== 'mouse'
    const g: Gesture = { kind: 'pending', id: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: null }
    if (touch && !arranging) {
      g.timer = setTimeout(() => {
        if (gesture.current === g) {
          gesture.current = { kind: 'lifted', id: g.id, x: g.x, y: g.y }
          setLifted(true)
          navigator.vibrate?.(10)
        }
      }, LONG_PRESS_MS)
    }
    gesture.current = g
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.kind === 'holding' || g.id !== e.pointerId) return
    if (g.kind === 'dragging') { callbacks.dragMove(e.clientX, e.clientY); return }
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_THRESHOLD) return
    if (g.kind === 'pending' && g.touch && !arranging) {
      // The finger slid before the long-press: neither a tap nor a drag (maybe a page swipe)
      clearTimer()
      gesture.current = null
      return
    }
    clearTimer()
    gesture.current = { kind: 'dragging', id: g.id }
    setLifted(false)
    callbacks.dragStart(cell, e.clientX, e.clientY)
    callbacks.dragMove(e.clientX, e.clientY)
  }

  const end = (e: React.PointerEvent<HTMLDivElement>, canceled: boolean) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    clearTimer()
    gesture.current = null
    setLifted(false)
    if (g.kind === 'holding') callbacks.press(cell, 'up')
    else if (g.kind === 'dragging') callbacks.dragEnd(!canceled)
    else if (!canceled && g.kind === 'pending' && !arranging) tap() // fires on release
  }

  const big = size === 'lg'
  const small = size === 'sm'
  const pct = level >= 0 ? Math.round((level / 255) * 100) : 100
  const badge = fnBadge(fn, kind)
  const Icon = kind === 'cuelist' ? null : KIND_ICON[kind]
  const modeText = badge ?? 'TOG'

  return (
    <div
      data-stage-cell={`${col}:${row}`}
      data-hold={hold && !arranging ? '1' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={active && posIndex >= 0
        ? t('stage.cellPlaying', { name, mode: modeText, cue: posIndex + 1, count: posCount })
        : t('stage.cellStopped', { name, mode: modeText })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onLostPointerCapture={(e) => end(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !arranging) {
          e.preventDefault()
          e.stopPropagation()
          if (gesture.current) return
          if (hold) {
            gesture.current = { kind: 'holding', id: 'key' }
            callbacks.press(cell, 'down')
          } else tap()
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.press(cell, 'up')
        }
      }}
      onBlur={() => {
        if (gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.press(cell, 'up')
        }
      }}
      className={cn(
        'relative flex min-h-0 min-w-0 cursor-pointer touch-none select-none flex-col overflow-hidden rounded-md border transition-[background-color,box-shadow,transform,opacity] duration-fast',
        big ? 'gap-1 py-2.5 pl-4 pr-3' : 'gap-0.5 py-2 pl-3 pr-2',
        !active && 'border-line-subtle bg-surface-2 active:bg-surface-3',
        missing && 'opacity-60',
        dragSource && 'opacity-35',
        lifted && 'z-10 scale-[1.04] shadow-popover',
        dropTarget && 'outline outline-2 -outline-offset-2 outline-info-fg',
        selected && !dropTarget && 'outline outline-2 -outline-offset-2 outline-info-fg/80',
        arranging && 'cursor-grab'
      )}
      style={active ? {
        backgroundColor: tint(color, flash ? 0.55 : 0.32, palette.surface2),
        borderColor: color,
        boxShadow: `0 0 18px ${withAlpha(color, 0.35)}, inset 0 0 0 1px ${withAlpha(color, 0.55)}`
      } : undefined}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0', big ? 'w-1.5' : 'w-1')} style={{ backgroundColor: color, opacity: active ? 1 : 0.6 }} />
      <div className="flex min-w-0 items-start gap-1.5">
        {Icon && <Icon size={big ? 16 : 13} aria-hidden className={cn('mt-0.5 shrink-0', active ? 'text-fg-primary' : 'text-fg-tertiary')} />}
        <span
          className={cn(
            'line-clamp-2 min-w-0 flex-1 break-words font-semibold leading-tight',
            big ? 'text-lg' : 'text-sm',
            missing ? 'italic text-fg-tertiary' : active ? 'text-fg-primary' : 'text-fg-primary/90'
          )}
        >
          {name}
        </span>
        {arranging
          ? <LuMoveDiagonal size={big ? 18 : 14} aria-hidden className="mt-0.5 shrink-0 text-info-fg" />
          : active && <span aria-hidden className={cn('mt-1 shrink-0 rounded-full bg-go-fg shadow-[0_0_8px_rgb(var(--pb-go)/0.8)]', big ? 'h-2.5 w-2.5' : 'h-2 w-2')} />}
      </div>
      {active && cueName && !small && (
        <span className={cn('truncate text-fg-secondary', big ? 'text-sm' : 'text-xs')}>{cueName}</span>
      )}
      <span className="flex-1" />
      <div className="flex min-w-0 items-center gap-1.5">
        {posIndex >= -1 ? (
          <span className={cn('font-mono tabular', big ? 'text-sm' : 'text-xs', active ? 'text-fg-primary' : 'text-fg-tertiary')}>
            {formatCuePosition(posIndex, posCount)}
          </span>
        ) : number !== undefined && (
          <span className={cn('font-mono tabular text-fg-tertiary', big ? 'text-sm' : 'text-xs')}>{number}</span>
        )}
        <span className="flex-1" />
        {selected && <span title={t('pro.stage.goTargetMark')} className="flex shrink-0 text-info-fg"><LuCrosshair size={12} aria-hidden /></span>}
        {badge && (
          <Badge size="xs" tone={fnBadgeTone(fn)} variant={active ? 'solid' : 'subtle'}>{badge}</Badge>
        )}
      </div>
      {/* Master level (only when not at full) */}
      {level >= 0 && pct < 100 && (kind === 'cuelist' || kind === 'chase') && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-surface-0/70">
          <span className="block h-full" style={{ width: `${pct}%`, backgroundColor: withAlpha(color, 0.85) }} />
        </span>
      )}
    </div>
  )
})

/**
 * Horizontal level for phone tiles (vertical travel is too short there):
 * relative drag across the whole tile width, double-tap = full.
 */
export function LevelBar({ value, color, label, onChange, ghost }: { value: number; color: string; label: string; onChange: (v: number) => void; ghost?: number | null }) {
  useT()
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef(0)
  const lastTap = useRef(0)
  const drag = usePointerDrag({
    onStart: (s) => {
      const now = s.event.timeStamp
      if (now - lastTap.current < 300) { lastTap.current = 0; onChange(255); return false }
      lastTap.current = now
      start.current = value
    },
    onMove: (s) => {
      const w = ref.current?.getBoundingClientRect().width || 1
      const next = Math.max(0, Math.min(255, Math.round(start.current + (s.dx / w) * 255 * (s.fine ? 0.2 : 1))))
      if (next !== value) onChange(next)
    }
  })
  const pct = Math.round((value / 255) * 100)
  return (
    <div className="flex w-full min-h-0 flex-1 flex-col justify-end gap-1">
      <span className="text-center font-mono text-xs tabular text-fg-secondary">{formatPercent(value)}</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={value}
        aria-valuetext={formatPercent(value)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 25 : 5
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(255, value + step)) }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, value - step)) }
        }}
        {...drag}
        className="relative h-11 w-full cursor-ew-resize touch-none overflow-hidden rounded-md bg-surface-0 ring-1 ring-inset ring-line"
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, backgroundColor: withAlpha(color, 0.55) }} />
        {ghost != null && (
          <div aria-hidden className="absolute inset-y-1 w-0.5 -translate-x-1/2 border-l-2 border-dashed border-fg-secondary/70" style={{ left: `${Math.round((ghost / 255) * 100)}%` }} />
        )}
        <div className="absolute inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-fg-primary" style={{ left: `max(6px, min(calc(100% - 6px), ${pct}%))` }} />
      </div>
    </div>
  )
}
