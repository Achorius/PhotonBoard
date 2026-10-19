// ============================================================
// Executor bar — 8 columns × 4 scene executors (bottom of the app).
//
// Play (default):
//   TOG   tap = GO / STOP
//   TRIG  plays while held (finger, mouse or Space/Enter)
//   FLASH full level while held
//   Right-click (mouse) or long-press (touch, TOG cells) → options;
//   mouse-drag a TOG cell, or long-press then drag on touch, to move it.
// Arrange: nothing fires; drag any cell to move it, tap for options.
// ============================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  LuArrowLeftRight, LuCheck, LuGripVertical, LuPencil, LuPiano, LuPlay, LuSkipBack, LuSquare, LuSquarePen, LuX
} from 'react-icons/lu'
import type { Cuelist } from '@shared/types'
import {
  Badge, IconButton, Popover, SWATCH_COLORS, SwatchPicker, TextInput, cn, formatCuePosition, prompt,
  tint, useContextMenu, withAlpha, type MenuEntry
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { COLUMN_COUNT, ROWS_PER_COLUMN, useExecutorStore, type SceneMode } from '@renderer/stores/executor-store'

const MODE_LABEL: Record<SceneMode, string> = { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' }
const MODE_NAME: Record<SceneMode, string> = { toggle: 'Toggle — tap GO / STOP', trigger: 'Trigger — plays while held', flash: 'Flash — full while held' }

const LONG_PRESS_MS = 450
const DRAG_THRESHOLD = 6

type Cell = { col: number; row: number }

interface DragState {
  from: Cell
  name: string
  color: string
  x: number
  y: number
  over: Cell | null
}

interface CellCallbacks {
  fire: (id: string, mode: SceneMode, phase: 'down' | 'up') => void
  dragStart: (from: Cell, x: number, y: number) => void
  dragMove: (x: number, y: number) => void
  dragEnd: (drop: boolean) => void
  openMenu: (cell: Cell, x: number, y: number) => void
}

export function ExecutorBar() {
  const cuelists = usePlaybackStore((s) => s.cuelists)
  const grid = useExecutorStore((s) => s.grid)
  const columns = useExecutorStore((s) => s.columns)
  const modes = useExecutorStore((s) => s.modes)
  const mappings = useMidiStore((s) => s.mappings)
  const learningId = useMidiStore((s) => (s.isLearning && s.learnTarget?.type === 'cuelist_go' ? s.learnTarget.id ?? null : null))
  const [arranging, setArranging] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const ctx = useContextMenu()

  // New scenes take the first free slot; deleted ones free theirs
  useEffect(() => {
    useExecutorStore.getState().syncCuelists(cuelists.map((c) => c.id))
  }, [cuelists])

  const byId = useMemo(() => new Map(cuelists.map((c) => [c.id, c])), [cuelists])
  const mapped = useMemo(() => new Set(mappings.filter((m) => m.target.type === 'cuelist_go' && m.target.id).map((m) => m.target.id!)), [mappings])
  const anyPlaying = cuelists.some((c) => c.isPlaying)

  // Stable callbacks for the memoised cells (read fresh state through refs)
  const state = useRef({ grid, modes, byId, drag })
  state.current = { grid, modes, byId, drag }

  const callbacks = useMemo<CellCallbacks>(() => ({
    fire: (id, mode, phase) => {
      const pb = usePlaybackStore.getState()
      if (mode === 'flash') pb.flashCuelist(id, phase === 'down')
      else if (mode === 'trigger') {
        if (phase === 'down') pb.goCuelist(id)
        else pb.stopCuelist(id)
      } else if (phase === 'down') {
        const cl = pb.cuelists.find((c) => c.id === id)
        if (cl?.isPlaying) pb.stopCuelist(id)
        else pb.goCuelist(id)
      }
    },
    dragStart: (from, x, y) => {
      const id = state.current.grid[from.col]?.[from.row]
      const cl = id ? state.current.byId.get(id) : undefined
      if (!cl) return
      setDrag({ from, name: cl.name, color: useExecutorStore.getState().columns[from.col]?.color ?? '#888', x, y, over: null })
    },
    dragMove: (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-exec-cell]')
      const over = el ? parseCell(el.dataset.execCell!) : null
      setDrag((d) => (d ? { ...d, x, y, over } : d))
    },
    dragEnd: (drop) => {
      const d = state.current.drag
      setDrag(null)
      if (drop && d?.over) useExecutorStore.getState().swapCells(d.from, d.over)
    },
    openMenu: (cell, x, y) => {
      const id = state.current.grid[cell.col]?.[cell.row]
      const cl = id ? state.current.byId.get(id) : undefined
      if (!cl) return
      ctx.open({ clientX: x, clientY: y, preventDefault: () => {} }, cellMenu(cl, cell, state.current.modes[cell.col][cell.row]))
    }
  }), [ctx.open])

  return (
    <section aria-label="Executors" className="relative flex shrink-0 border-t border-line bg-surface-1">
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line-subtle py-1.5 [[data-density=touch]_&]:w-14">
        <IconButton
          icon={arranging ? LuCheck : LuArrowLeftRight}
          label={arranging ? 'Done arranging' : 'Arrange executors'}
          tooltip={arranging ? 'Done — back to playback' : 'Arrange: move cells, rename, colours, modes (nothing fires)'}
          size="sm"
          active={arranging}
          tone="info"
          onClick={() => setArranging((a) => !a)}
        />
        <IconButton
          icon={LuSquare}
          label="Release all scenes"
          tooltip="Stop every scene and chase"
          size="sm"
          disabled={!anyPlaying}
          onClick={() => usePlaybackStore.getState().releaseAll()}
          className={anyPlaying ? 'text-danger-fg' : undefined}
        />
      </div>
      <div
        className={cn('grid min-w-0 flex-1 grid-cols-8 gap-1 p-1.5', arranging && 'bg-info/[0.04]')}
        style={{ gridTemplateRows: `auto repeat(${ROWS_PER_COLUMN}, var(--pb-executor-row-h))`, gridAutoFlow: 'column' }}
      >
        {Array.from({ length: COLUMN_COUNT }, (_, col) => (
          <ColumnCells
            key={col}
            col={col}
            title={columns[col]?.title ?? ''}
            color={columns[col]?.color ?? '#888'}
            ids={grid[col]}
            modes={modes[col]}
            byId={byId}
            mapped={mapped}
            learningId={learningId}
            arranging={arranging}
            drag={drag}
            callbacks={callbacks}
          />
        ))}
      </div>
      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-popover flex h-8 max-w-[200px] items-center gap-2 rounded-md px-3 text-xs font-semibold text-fg-primary shadow-popover"
          style={{ left: drag.x + 12, top: drag.y - 40, backgroundColor: tint(drag.color, 0.45), border: `1px solid ${drag.color}` }}
        >
          <LuGripVertical size={14} />
          <span className="truncate">{drag.name}</span>
        </div>
      )}
      {ctx.menu}
    </section>
  )
}

function parseCell(key: string): Cell | null {
  const [col, row] = key.split(':').map(Number)
  return Number.isInteger(col) && Number.isInteger(row) ? { col, row } : null
}

function cellMenu(cl: Cuelist, cell: Cell, mode: SceneMode): MenuEntry[] {
  const pb = usePlaybackStore.getState
  const midi = useMidiStore.getState()
  const learning = midi.isLearning && midi.learnTarget?.type === 'cuelist_go' && midi.learnTarget.id === cl.id
  const setMode = (m: SceneMode) => {
    useExecutorStore.getState().setMode(cell.col, cell.row, m)
    // Keep an existing MIDI mapping's button behaviour in step with the cell
    const mapping = useMidiStore.getState().mappings.find((x) => x.target.type === 'cuelist_go' && x.target.id === cl.id)
    if (mapping) useMidiStore.getState().updateMapping(mapping.id, { options: { ...mapping.options, behavior: m } })
  }
  return [
    { type: 'label', label: cl.name },
    { label: 'GO', icon: LuPlay, onSelect: () => pb().goCuelist(cl.id), disabled: cl.cues.length === 0 },
    { label: 'Back', icon: LuSkipBack, onSelect: () => pb().goBackCuelist(cl.id), disabled: !cl.isPlaying },
    { label: 'Stop', icon: LuSquare, onSelect: () => pb().stopCuelist(cl.id), disabled: !cl.isPlaying },
    { type: 'separator' },
    { type: 'label', label: 'Button mode' },
    ...(['toggle', 'trigger', 'flash'] as SceneMode[]).map((m): MenuEntry => ({
      label: MODE_NAME[m],
      checked: mode === m,
      onSelect: () => setMode(m)
    })),
    { type: 'separator' },
    learning
      ? { label: 'Cancel MIDI learn', icon: LuX, onSelect: () => useMidiStore.getState().cancelLearn() }
      : { label: 'MIDI learn…', icon: LuPiano, description: 'Then press a MIDI key or pad', onSelect: () => startSceneLearn(cl, mode) },
    {
      label: 'Rename…',
      icon: LuPencil,
      onSelect: async () => {
        const name = await prompt({ title: 'Rename scene', label: 'Scene name', defaultValue: cl.name, confirmLabel: 'Rename' })
        if (name) usePlaybackStore.getState().renameCuelist(cl.id, name)
      }
    },
    { label: 'Edit in Scenes', icon: LuSquarePen, onSelect: () => useUiStore.getState().navigateToCuelist(cl.id) }
  ]
}

/** MIDI-learn a scene's GO, then give the new mapping the cell's button mode */
function startSceneLearn(cl: Cuelist, mode: SceneMode) {
  const midi = useMidiStore.getState()
  midi.startLearn({ type: 'cuelist_go', id: cl.id, label: cl.name })
  const unsubscribe = useMidiStore.subscribe((s) => {
    if (s.isLearning) return
    unsubscribe()
    const mapping = s.mappings.find((m) => m.target.type === 'cuelist_go' && m.target.id === cl.id)
    if (mapping && mapping.options.behavior !== mode) {
      setTimeout(() => useMidiStore.getState().updateMapping(mapping.id, { options: { ...mapping.options, behavior: mode } }), 0)
    }
  })
}

// ---------------------------------------------------------------
// Column
// ---------------------------------------------------------------

const ColumnCells = memo(function ColumnCells({ col, title, color, ids, modes, byId, mapped, learningId, arranging, drag, callbacks }: {
  col: number
  title: string
  color: string
  ids: (string | null)[]
  modes: SceneMode[]
  byId: Map<string, Cuelist>
  mapped: Set<string>
  learningId: string | null
  arranging: boolean
  drag: DragState | null
  callbacks: CellCallbacks
}) {
  return (
    <>
      <ColumnHeader col={col} title={title} color={color} />
      {Array.from({ length: ROWS_PER_COLUMN }, (_, row) => {
        const id = ids?.[row] ?? null
        const cl = id ? byId.get(id) ?? null : null
        return (
          <ExecutorCell
            key={row}
            col={col}
            row={row}
            cuelist={cl}
            color={color}
            mode={modes?.[row] ?? 'toggle'}
            midiMapped={!!cl && mapped.has(cl.id)}
            learning={!!cl && learningId === cl.id}
            arranging={arranging}
            dragSource={drag?.from.col === col && drag.from.row === row}
            dropTarget={!!drag && drag.over?.col === col && drag.over.row === row && !(drag.from.col === col && drag.from.row === row)}
            callbacks={callbacks}
          />
        )
      })}
    </>
  )
})

function ColumnHeader({ col, title, color }: { col: number; title: string; color: string }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-left hover:bg-surface-2 [[data-density=touch]_&]:h-8"
        title="Column title & colour"
      >
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className={cn('min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-[0.06em]', title ? 'text-fg-secondary' : 'text-fg-disabled')}>
          {title || `Column ${col + 1}`}
        </span>
        <LuPencil size={11} aria-hidden className="shrink-0 text-fg-disabled opacity-0 group-hover:opacity-100" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="top-start" className="w-[248px] p-3" aria-label={`Column ${col + 1}`}>
        <div className="flex flex-col gap-3">
          <TextInput
            size="sm"
            data-autofocus=""
            aria-label="Column title"
            placeholder={`Column ${col + 1}`}
            value={title}
            onChange={(e) => useExecutorStore.getState().setColumnTitle(col, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false) }}
          />
          <SwatchPicker colors={SWATCH_COLORS} value={color} size="md" onChange={(c) => useExecutorStore.getState().setColumnColor(col, c)} />
        </div>
      </Popover>
    </>
  )
}

// ---------------------------------------------------------------
// Cell
// ---------------------------------------------------------------

type Gesture =
  | { kind: 'pending'; id: number; x: number; y: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'lifted'; id: number; x: number; y: number }
  | { kind: 'holding'; id: number | 'key' }
  | { kind: 'dragging'; id: number }

const ExecutorCell = memo(function ExecutorCell({ col, row, cuelist: cl, color, mode, midiMapped, learning, arranging, dragSource, dropTarget, callbacks }: {
  col: number
  row: number
  cuelist: Cuelist | null
  color: string
  mode: SceneMode
  midiMapped: boolean
  learning: boolean
  arranging: boolean
  dragSource: boolean
  dropTarget: boolean
  callbacks: CellCallbacks
}) {
  const gesture = useRef<Gesture | null>(null)
  const lastPointerType = useRef('mouse')
  const latest = useRef({ cl, mode })
  latest.current = { cl, mode }
  const [lifted, setLifted] = useState(false)
  const cell = useMemo(() => ({ col, row }), [col, row])
  const key = `${col}:${row}`

  const clearTimer = () => {
    const g = gesture.current
    if (g?.kind === 'pending' && g.timer) clearTimeout(g.timer)
  }
  // Released on unmount: a TRIG / FLASH scene never stays on
  useEffect(() => () => {
    clearTimer()
    const { cl: last, mode: lastMode } = latest.current
    if (gesture.current?.kind === 'holding' && last) callbacks.fire(last.id, lastMode, 'up')
    gesture.current = null
  }, [callbacks])

  const menuAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    callbacks.openMenu(cell, r.left + 8, r.top + 8)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = e.pointerType
    if (!cl || gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    if (!arranging && mode !== 'toggle') {
      gesture.current = { kind: 'holding', id: e.pointerId }
      callbacks.fire(cl.id, mode, 'down')
      return
    }
    const touch = e.pointerType === 'touch'
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
      // Finger slid before the long-press: not a tap, not a drag
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
    if (!cl) return
    if (g.kind === 'holding') callbacks.fire(cl.id, mode, 'up')
    else if (g.kind === 'dragging') callbacks.dragEnd(!canceled)
    else if (canceled) return
    else if (g.kind === 'lifted' || arranging) menuAt(e.currentTarget)
    else callbacks.fire(cl.id, mode, 'down') // toggle tap
  }

  if (!cl) {
    return (
      <div
        data-exec-cell={key}
        aria-hidden
        className={cn(
          'rounded border border-dashed',
          dropTarget ? 'border-info-fg bg-info/15' : arranging ? 'border-line-strong' : 'border-line-subtle bg-surface-0/40'
        )}
      />
    )
  }

  const active = cl.isPlaying
  const cue = active ? cl.cues[cl.currentCueIndex] : undefined
  const fadeSeconds = cue ? (cue.delay ?? 0) + (cue.fadeIn ?? 0) : 0
  const learnRing = learning ? 'outline outline-2 -outline-offset-2 outline-midi-fg animate-pulse' : undefined

  return (
    <div
      data-exec-cell={key}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${cl.name}, ${MODE_LABEL[mode]}, ${active ? `playing cue ${cl.currentCueIndex + 1} of ${cl.cues.length}` : 'stopped'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onLostPointerCapture={(e) => end(e, true)}
      onContextMenu={(e) => {
        e.preventDefault()
        // Touch long-press is handled above (lift / drag); right-click and the menu key open options
        if (lastPointerType.current === 'touch') return
        if (e.clientX === 0 && e.clientY === 0) menuAt(e.currentTarget)
        else callbacks.openMenu(cell, e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !arranging) {
          e.preventDefault()
          e.stopPropagation()
          if (gesture.current) return
          if (mode !== 'toggle') gesture.current = { kind: 'holding', id: 'key' }
          callbacks.fire(cl.id, mode, 'down')
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.fire(cl.id, mode, 'up')
        }
      }}
      onBlur={() => {
        if (gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.fire(cl.id, mode, 'up')
        }
      }}
      className={cn(
        'relative flex min-w-0 cursor-pointer touch-none select-none flex-col justify-center overflow-hidden rounded border pl-2.5 pr-1.5 transition-[background-color,box-shadow,transform,opacity] duration-fast',
        !active && 'border-line-subtle bg-surface-2 hover:bg-surface-3',
        dragSource && 'opacity-35',
        lifted && 'scale-[1.04] shadow-popover',
        dropTarget && 'outline outline-2 -outline-offset-2 outline-info-fg',
        arranging && 'cursor-grab',
        learnRing
      )}
      style={active ? {
        backgroundColor: tint(color, cl.flash ? 0.5 : 0.3, '#1a1d21'),
        borderColor: color,
        boxShadow: `0 0 14px ${withAlpha(color, 0.35)}, inset 0 0 0 1px ${withAlpha(color, 0.5)}`
      } : undefined}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color, opacity: active ? 1 : 0.55 }} />
      <div className="flex min-w-0 items-center gap-1">
        <span className={cn('min-w-0 flex-1 truncate text-xs font-semibold leading-4', active ? 'text-white' : 'text-fg-primary')}>{cl.name}</span>
        {arranging && <LuGripVertical size={12} aria-hidden className="shrink-0 text-fg-tertiary" />}
      </div>
      <div className="flex min-w-0 items-center gap-1 leading-3">
        <span className={cn('font-mono text-[10px] tabular', active ? 'text-white/80' : 'text-fg-tertiary')}>
          {formatCuePosition(active ? cl.currentCueIndex : -1, cl.cues.length)}
        </span>
        <span className="flex-1" />
        {midiMapped && <span title="MIDI mapped" className="h-1.5 w-1.5 shrink-0 rounded-full bg-midi-fg" />}
        {mode !== 'toggle' && <Badge size="xs" tone={mode === 'flash' ? 'warning' : 'info'} variant={active ? 'solid' : 'subtle'}>{MODE_LABEL[mode]}</Badge>}
      </div>
      {active && fadeSeconds > 0 && (
        <span
          key={`${cl.currentCueIndex}:${cl.goGeneration ?? 0}`}
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-white/80"
          style={{ animation: `pb-progress ${fadeSeconds}s linear forwards, pb-fade-out 400ms ease ${fadeSeconds}s forwards` }}
        />
      )}
    </div>
  )
})
