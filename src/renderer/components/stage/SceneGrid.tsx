// ============================================================
// Scene grid for the stage surfaces (Electron Stage window, remote
// phone / tablet). Same 8 × 4 layout, column colours and button
// modes as the executor bar, sized for fingers.
//
// Prop-driven (no store access): the Stage window feeds it from the
// state snapshot, the remote views from the mirrored stores.
//
// Grid modes:
//   play     TOG  tap (on release) = GO / STOP
//            TRIG plays while held · FLASH full while held
//            long-press a TOG scene (touch) or drag it (mouse) to move it
//   levels   every scene becomes a fader (scene master level)
//   arrange  nothing fires: drag any scene onto another cell to swap
// ============================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuGripVertical, LuMoveDiagonal } from 'react-icons/lu'
import type { ExecutorSceneMode } from '@shared/types'
import { Badge, Fader, SWATCH_COLORS, usePointerDrag, cn, formatCuePosition, palette, tint, withAlpha } from '@renderer/components/ui'

export type SceneMode = ExecutorSceneMode
export type StageGridMode = 'play' | 'levels' | 'arrange'
export type Cell = { col: number; row: number }

export interface StageScene {
  id: string
  name: string
  isPlaying: boolean
  faderLevel: number
  currentCueIndex: number
  cueCount: number
  flash?: boolean
  /** Name of the current cue (while playing) */
  cueName?: string
}

export interface ColumnInfo {
  title: string
  color: string
}

export const STAGE_COLUMNS = 8
export const STAGE_ROWS = 4

const MODE_LABEL: Record<SceneMode, string> = { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' }
const LONG_PRESS_MS = 450
const DRAG_THRESHOLD = 8
const FALLBACK_COLOR: string = SWATCH_COLORS[11]

export function normalizeMode(m: unknown): SceneMode {
  return m === 'trigger' || m === 'flash' ? m : 'toggle'
}

interface Callbacks {
  fire: (scene: StageScene, mode: SceneMode, phase: 'down' | 'up') => void
  level: (id: string, level: number) => void
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
  /** [col][row] → scene id */
  grid: (string | null)[][]
  columns: ColumnInfo[]
  /** [col][row] → button mode */
  modes: (string | null | undefined)[][]
  scenes: ReadonlyMap<string, StageScene>
  mode: StageGridMode
  /** Visible column indexes (paging on phones); default all 8 */
  visibleColumns?: number[]
  /** lg: Stage window / Pi; md: tablet; sm: phone */
  size?: 'sm' | 'md' | 'lg'
  onFire: (scene: StageScene, mode: SceneMode, phase: 'down' | 'up') => void
  onLevel: (id: string, level: number) => void
  onSwap: (from: Cell, to: Cell) => void
  className?: string
}

const ALL_COLUMNS = Array.from({ length: STAGE_COLUMNS }, (_, i) => i)

export function SceneGrid({
  grid, columns, modes, scenes, mode, visibleColumns = ALL_COLUMNS, size = 'md', onFire, onLevel, onSwap, className
}: SceneGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const latest = useRef({ grid, columns, scenes, drag, onFire, onLevel, onSwap })
  latest.current = { grid, columns, scenes, drag, onFire, onLevel, onSwap }

  const callbacks = useMemo<Callbacks>(() => ({
    fire: (scene, m, phase) => latest.current.onFire(scene, m, phase),
    level: (id, level) => latest.current.onLevel(id, level),
    dragStart: (from, x, y) => {
      const id = latest.current.grid[from.col]?.[from.row]
      const scene = id ? latest.current.scenes.get(id) : undefined
      if (!scene) return
      setDrag({ from, name: scene.name, color: latest.current.columns[from.col]?.color ?? FALLBACK_COLOR, x, y, over: null })
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
      className={cn('grid min-h-0 min-w-0 flex-1', size === 'lg' ? 'gap-2' : 'gap-1.5', mode === 'arrange' && 'rounded-lg bg-info/[0.05]', className)}
      style={{
        gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0, 1fr))`,
        gridTemplateRows: `auto repeat(${STAGE_ROWS}, minmax(0, 1fr))`,
        gridAutoFlow: 'column'
      }}
    >
      {visibleColumns.map((col) => {
        const color = columns[col]?.color || FALLBACK_COLOR
        return (
          <ColumnCells
            key={col}
            col={col}
            title={columns[col]?.title ?? ''}
            color={color}
            ids={grid[col]}
            modes={modes[col]}
            scenes={scenes}
            gridMode={mode}
            size={size}
            drag={drag}
            callbacks={callbacks}
          />
        )
      })}
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

const ColumnCells = memo(function ColumnCells({ col, title, color, ids, modes, scenes, gridMode, size, drag, callbacks }: {
  col: number
  title: string
  color: string
  ids: (string | null)[] | undefined
  modes: (string | null | undefined)[] | undefined
  scenes: ReadonlyMap<string, StageScene>
  gridMode: StageGridMode
  size: 'sm' | 'md' | 'lg'
  drag: DragState | null
  callbacks: Callbacks
}) {
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
          {title || `Column ${col + 1}`}
        </span>
      </div>
      {Array.from({ length: STAGE_ROWS }, (_, row) => {
        const id = ids?.[row] ?? null
        const scene = id ? scenes.get(id) : undefined
        const isSource = drag?.from.col === col && drag.from.row === row
        const isTarget = !!drag && drag.over?.col === col && drag.over.row === row && !isSource
        if (!scene) {
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
          <SceneTile
            key={row}
            col={col}
            row={row}
            id={scene.id}
            name={scene.name}
            isPlaying={scene.isPlaying}
            faderLevel={scene.faderLevel}
            currentCueIndex={scene.currentCueIndex}
            cueCount={scene.cueCount}
            cueName={scene.cueName}
            flash={!!scene.flash}
            color={color}
            sceneMode={normalizeMode(modes?.[row])}
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
  id: string
  name: string
  isPlaying: boolean
  faderLevel: number
  currentCueIndex: number
  cueCount: number
  cueName?: string
  flash: boolean
  color: string
  sceneMode: SceneMode
  gridMode: StageGridMode
  size: 'sm' | 'md' | 'lg'
  dragSource: boolean
  dropTarget: boolean
  callbacks: Callbacks
}

const SceneTile = memo(function SceneTile(props: TileProps) {
  const { col, row, id, name, isPlaying, faderLevel, currentCueIndex, cueCount, cueName, flash, color, sceneMode, gridMode, size, dragSource, dropTarget, callbacks } = props
  const gesture = useRef<Gesture | null>(null)
  const [lifted, setLifted] = useState(false)
  const latest = useRef(props)
  latest.current = props
  const arranging = gridMode === 'arrange'

  const scene = (): StageScene => {
    const p = latest.current
    return { id: p.id, name: p.name, isPlaying: p.isPlaying, faderLevel: p.faderLevel, currentCueIndex: p.currentCueIndex, cueCount: p.cueCount, cueName: p.cueName, flash: p.flash }
  }
  const clearTimer = () => {
    const g = gesture.current
    if (g?.kind === 'pending' && g.timer) clearTimeout(g.timer)
  }

  // A held TRIG / FLASH never stays on: release on unmount and when the grid leaves play mode
  useEffect(() => () => {
    clearTimer()
    if (gesture.current?.kind === 'holding') callbacks.fire(scene(), latest.current.sceneMode, 'up')
    gesture.current = null
  }, [callbacks])
  useEffect(() => {
    if (gridMode !== 'play' && gesture.current?.kind === 'holding') {
      gesture.current = null
      callbacks.fire(scene(), latest.current.sceneMode, 'up')
    }
  }, [gridMode, callbacks])

  if (gridMode === 'levels') {
    return (
      <div
        data-stage-cell={`${col}:${row}`}
        className={cn(
          'relative flex min-h-0 min-w-0 flex-col items-center gap-1 overflow-hidden rounded-md border px-1.5 pb-1.5 pt-1.5',
          isPlaying ? '' : 'border-line-subtle bg-surface-2'
        )}
        style={isPlaying ? { backgroundColor: tint(color, 0.18, palette.surface2), borderColor: withAlpha(color, 0.7) } : undefined}
      >
        <span className={cn('w-full truncate text-center font-semibold', size === 'lg' ? 'text-sm' : 'text-xs', isPlaying ? 'text-fg-primary' : 'text-fg-secondary')}>
          {name}
        </span>
        {size === 'sm' ? (
          <LevelBar value={faderLevel} color={color} label={`${name} level`} onChange={(v) => callbacks.level(id, v)} />
        ) : (
        <div className="flex min-h-0 w-full flex-1 justify-center">
          <Fader
            value={faderLevel}
            onChange={(v) => callbacks.level(id, v)}
            defaultValue={255}
            color={color}
            ticks
            aria-label={`${name} level`}
            className="!w-full max-w-[96px]"
          />
        </div>
        )}
      </div>
    )
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    if (!arranging && sceneMode !== 'toggle') {
      gesture.current = { kind: 'holding', id: e.pointerId }
      callbacks.fire(scene(), sceneMode, 'down')
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
      // The finger slid before the long-press: neither a tap nor a drag
      clearTimer()
      gesture.current = null
      return
    }
    clearTimer()
    gesture.current = { kind: 'dragging', id: g.id }
    setLifted(false)
    callbacks.dragStart({ col, row }, e.clientX, e.clientY)
    callbacks.dragMove(e.clientX, e.clientY)
  }

  const end = (e: React.PointerEvent<HTMLDivElement>, canceled: boolean) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    clearTimer()
    gesture.current = null
    setLifted(false)
    if (g.kind === 'holding') callbacks.fire(scene(), sceneMode, 'up')
    else if (g.kind === 'dragging') callbacks.dragEnd(!canceled)
    else if (!canceled && g.kind === 'pending' && !arranging) callbacks.fire(scene(), sceneMode, 'down') // toggle: fires on release
  }

  const active = isPlaying
  const pct = Math.round((faderLevel / 255) * 100)
  const big = size === 'lg'
  const small = size === 'sm'

  return (
    <div
      data-stage-cell={`${col}:${row}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${name}, ${MODE_LABEL[sceneMode]}, ${active ? `playing cue ${currentCueIndex + 1} of ${cueCount}` : 'stopped'}`}
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
          if (sceneMode !== 'toggle') gesture.current = { kind: 'holding', id: 'key' }
          callbacks.fire(scene(), sceneMode, 'down')
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.fire(scene(), sceneMode, 'up')
        }
      }}
      onBlur={() => {
        if (gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.fire(scene(), sceneMode, 'up')
        }
      }}
      className={cn(
        'relative flex min-h-0 min-w-0 cursor-pointer touch-none select-none flex-col overflow-hidden rounded-md border transition-[background-color,box-shadow,transform,opacity] duration-fast',
        big ? 'gap-1 py-2.5 pl-4 pr-3' : small ? 'gap-0.5 py-2 pl-3 pr-2' : 'gap-0.5 py-2 pl-3 pr-2',
        !active && 'border-line-subtle bg-surface-2 active:bg-surface-3',
        dragSource && 'opacity-35',
        lifted && 'z-10 scale-[1.04] shadow-popover',
        dropTarget && 'outline outline-2 -outline-offset-2 outline-info-fg',
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
        <span
          className={cn(
            'line-clamp-2 min-w-0 flex-1 break-words font-semibold leading-tight',
            big ? 'text-lg' : small ? 'text-sm' : 'text-sm',
            active ? 'text-fg-primary' : 'text-fg-primary/90'
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
        <span className={cn('font-mono tabular', big ? 'text-sm' : 'text-xs', active ? 'text-fg-primary' : 'text-fg-tertiary')}>
          {formatCuePosition(active ? currentCueIndex : -1, cueCount)}
        </span>
        <span className="flex-1" />
        {sceneMode !== 'toggle' && (
          <Badge size="xs" tone={sceneMode === 'flash' ? 'warning' : 'info'} variant={active ? 'solid' : 'subtle'}>{MODE_LABEL[sceneMode]}</Badge>
        )}
      </div>
      {/* Scene master level (only when not at full) */}
      {pct < 100 && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-surface-0/70">
          <span className="block h-full" style={{ width: `${pct}%`, backgroundColor: withAlpha(color, 0.85) }} />
        </span>
      )}
    </div>
  )
})

/**
 * Horizontal scene level for phone tiles (vertical travel is too short there):
 * relative drag across the whole tile width, double-tap = full.
 */
function LevelBar({ value, color, label, onChange }: { value: number; color: string; label: string; onChange: (v: number) => void }) {
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
      <span className="text-center font-mono text-xs tabular text-fg-secondary">{pct}%</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={value}
        aria-valuetext={`${pct}%`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 25 : 5
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(255, value + step)) }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, value - step)) }
        }}
        {...drag}
        className="relative h-11 w-full cursor-ew-resize touch-none overflow-hidden rounded-md bg-surface-0 ring-1 ring-inset ring-line"
      >
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, backgroundColor: withAlpha(color, 0.55) }} />
        <div className="absolute inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-fg-primary" style={{ left: `max(6px, min(calc(100% - 6px), ${pct}%))` }} />
      </div>
    </div>
  )
}
