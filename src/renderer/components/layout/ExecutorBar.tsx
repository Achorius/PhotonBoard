// ============================================================
// Executor bar — 8 columns × 4 executors of the current PAGE
// (bottom of the app).
//
// Play (default) — every press goes through lib/pro/executor-actions
// (executorPress), the same path as MIDI, the Stage window, remotes
// and the command line:
//   TOG   tap = GO / STOP          (fires on release)
//   TRIG  plays while held (finger, mouse or Space/Enter)
//   FLASH full level while held
//   Pro button functions: GO, GO-, OFF, SELECT… (tap), SWAP (held)
//   Right-click (mouse) or long-press (touch, tap cells) → options;
//   mouse-drag a tap cell, or long-press then drag on touch, to move it.
// Arrange: nothing fires; drag any cell to move it, tap for options
// (Pro: button function, assign object, column fader — empty cells too).
// Pages: ‹ Page 2 › in the gutter when more than one page exists (Pro:
// always, with new / rename / delete); swipe sideways on the grid
// (touch) or PageUp / PageDown with focus in the bar.
// Pro: optional thin column-fader row (pickup ghosts from MIDI).
// Keyboard (lib/selection-actions.ts) on the focused cell: Delete /
// Backspace deletes the SCENE (confirm + Undo) — every scene always has
// a cell (auto-placement), so there is no "empty the cell" action;
// F2 renames it, Mod+D duplicates it.
// ============================================================

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  LuArrowLeftRight, LuCheck, LuCrosshair, LuGripVertical, LuPencil, LuPiano, LuPlay, LuPlus, LuSkipBack, LuSlidersHorizontal, LuSquare,
  LuSquarePen, LuTrash2, LuX
} from 'react-icons/lu'
import type { Cuelist, ExecutorButtonFn, ExecutorCell, ExecutorTargetKind } from '@shared/types'
import {
  Badge, IconButton, Popover, SWATCH_COLORS, Select, SwatchPicker, TextInput, cn, formatCuePosition, formatPercent, prompt,
  tint, useContextMenu, usePointerDrag, withAlpha, type MenuEntry
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { COLUMN_COUNT, ROWS_PER_COLUMN, useExecutorStore, type SceneMode } from '@renderer/stores/executor-store'
import { setSceneMode, startSceneLearn } from '@renderer/components/playback/scene-meta'
import { t, useT } from '@renderer/i18n'
import { deleteWithUndo, useSelectionActions } from '@renderer/lib/selection-actions'
import { useSurfaceData, pressExecutor, setExecutorPage, getStoreActions } from '@renderer/components/stage/pages/surface-store'
import { indexSurface, pageIsActive, resolveCell, surfaceColumnFader, type ResolvedCell, type SurfaceIndex } from '@renderer/components/stage/pages/surface-data'
import { faderKey, isHoldFn, stepPage } from '@renderer/components/stage/executor-surface'
import { KIND_ICON, cellName, fnBadge, fnBadgeTone } from '@renderer/components/stage/cell-visuals'
import { PageSelector, useSwipePaging } from '@renderer/components/stage/PageSelector'
import { columnFaderOptions, pageMenuExtra, proCellEntries, setColumnFaderFn } from '@renderer/components/stage/executor-menus'
import { useColumnGhost } from '@renderer/components/stage/controller-ghosts'

const modeLabel = (mode: SceneMode) => t(`shell.executors.modeShort.${mode}`)

/** Noun phrase for the confirm dialog / Undo toast ("scene “Intro”" / "la scène « Intro »") */
function sceneLabel(cl: Cuelist): string {
  return t('shell.executors.sceneLabel', { name: cl.name })
}

/** Delete a scene (confirm + one undo step + Undo toast) */
export function deleteSceneWithUndo(cl: Cuelist): Promise<boolean> {
  return deleteWithUndo({ label: sceneLabel(cl), run: () => usePlaybackStore.getState().removeCuelist(cl.id) })
}

async function renameScene(cl: Cuelist): Promise<void> {
  const name = await prompt({ title: t('shell.executors.renameTitle'), label: t('shell.executors.renameLabel'), defaultValue: cl.name, confirmLabel: t('common.rename') })
  if (name) usePlaybackStore.getState().renameCuelist(cl.id, name)
}

/** Scene of the executor cell that has keyboard focus */
function focusedCellScene(): Cuelist | null {
  const el = typeof document !== 'undefined' ? document.activeElement?.closest<HTMLElement>('[data-exec-cell]') : null
  const cell = el ? parseCell(el.dataset.execCell!) : null
  if (!cell) return null
  const id = useExecutorStore.getState().grid[cell.col]?.[cell.row]
  return id ? usePlaybackStore.getState().cuelists.find((c) => c.id === id) ?? null : null
}

/** Pro: the thin column-fader row is shown (per machine) */
const FADERS_PREF = 'photonboard.ui.execFaders'
function readFadersPref(): boolean {
  try { return localStorage.getItem(FADERS_PREF) === '1' } catch { return false }
}
function writeFadersPref(on: boolean): void {
  try { localStorage.setItem(FADERS_PREF, on ? '1' : '0') } catch { /* ignore */ }
}

const LONG_PRESS_MS = 450
const DRAG_THRESHOLD = 6

type Cell = { col: number; row: number }

/** Cells that act while held (scenes, chases, effects with TRIG / FLASH / SWAP) */
function holdCell(kind: ExecutorTargetKind, fn: ExecutorButtonFn): boolean {
  return kind !== 'macro' && kind !== 'group' && kind !== 'speed' && isHoldFn(fn)
}

interface DragState {
  from: Cell
  name: string
  color: string
  x: number
  y: number
  over: Cell | null
}

interface CellCallbacks {
  fire: (cell: Cell, phase: 'down' | 'up') => void
  dragStart: (from: Cell, x: number, y: number) => void
  dragMove: (x: number, y: number) => void
  dragEnd: (drop: boolean) => void
  openMenu: (cell: Cell, x: number, y: number) => void
}

export function ExecutorBar() {
  const tr = useT()
  const sectionRef = useRef<HTMLElement>(null)
  const proMode = useUiStore((s) => s.proMode)
  const data = useSurfaceData()
  const index = useMemo(() => indexSurface(data), [data])
  const pageIndex = data.currentPage
  const page = data.executorPages[pageIndex]
  const pageCount = data.executorPages.length
  const mappings = useMidiStore((s) => s.mappings)
  const learningId = useMidiStore((s) => (s.isLearning && s.learnTarget?.type === 'cuelist_go' ? s.learnTarget.id ?? null : null))
  const [arranging, setArranging] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [fadersOn, setFadersOn] = useState(readFadersPref)
  const ctx = useContextMenu()
  const showFaders = proMode && fadersOn
  const showPages = pageCount > 1 || proMode

  // Delete / F2 / Mod+D on the focused cell (only while a cell has the focus)
  useSelectionActions({
    label: () => { const cl = focusedCellScene(); return cl ? sceneLabel(cl) : '' },
    canDelete: () => !!focusedCellScene(),
    delete: () => { const cl = focusedCellScene(); if (cl) usePlaybackStore.getState().removeCuelist(cl.id) },
    canRename: () => !!focusedCellScene(),
    rename: () => { const cl = focusedCellScene(); if (cl) void renameScene(cl) },
    canDuplicate: () => !!focusedCellScene(),
    duplicate: () => { const cl = focusedCellScene(); if (cl) usePlaybackStore.getState().duplicateCuelist(cl.id) }
  }, { scope: sectionRef, requireFocus: true })

  // Slot assignment for new / deleted scenes: startExecutorAutoSync (executor-store), started by App

  const mapped = useMemo(() => new Set(mappings.filter((m) => m.target.type === 'cuelist_go' && m.target.id).map((m) => m.target.id!)), [mappings])
  const anyPlaying = data.cuelists.some((c) => c.isPlaying)
  const activePages = useMemo(() => data.executorPages.map((p) => pageIsActive(index, p)), [index, data.executorPages])
  const selected = data.selectedExecutor && data.selectedExecutor.page === pageIndex ? data.selectedExecutor : null

  // Resolved cells of the current page ([col][row])
  const cells = useMemo(() => Array.from({ length: COLUMN_COUNT }, (_, col) =>
    Array.from({ length: ROWS_PER_COLUMN }, (_, row) => resolveCell(index, page?.cells[col]?.[row]))), [index, page])

  // Stable callbacks for the memoised cells (read fresh state through refs)
  const state = useRef({ cells, drag, pageIndex, proMode, arranging })
  state.current = { cells, drag, pageIndex, proMode, arranging }

  const callbacks = useMemo<CellCallbacks>(() => ({
    fire: (cell, phase) => pressExecutor({ page: state.current.pageIndex, col: cell.col, row: cell.row }, phase),
    dragStart: (from, x, y) => {
      const c = state.current.cells[from.col]?.[from.row]
      if (!c) return
      setDrag({ from, name: cellName(c), color: c.color ?? useExecutorStore.getState().columns[from.col]?.color ?? '#888', x, y, over: null })
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
      const p = state.current.pageIndex
      const raw = useExecutorStore.getState().pages[p]?.cells[cell.col]?.[cell.row] ?? null
      const items = cellMenu(raw, { page: p, col: cell.col, row: cell.row }, state.current.proMode)
      if (items.length) ctx.open({ clientX: x, clientY: y, preventDefault: () => {} }, items)
    }
  }), [ctx.open])

  const goPage = (step: number) => {
    const next = stepPage(pageIndex, step, pageCount)
    if (next !== pageIndex) setExecutorPage(next)
  }
  const swipe = useSwipePaging((s) => goPage(s), pageCount > 1 && !arranging && !drag)

  return (
    <section
      ref={sectionRef}
      aria-label={tr('shell.executors.aria')}
      onKeyDown={(e) => {
        if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && pageCount > 1) {
          e.preventDefault()
          goPage(e.key === 'PageUp' ? -1 : 1)
        }
      }}
      className="relative flex shrink-0 border-t border-line bg-surface-1"
    >
      <div
        className={cn(
          'flex shrink-0 flex-col items-center gap-1 border-r border-line-subtle py-1.5',
          showPages ? 'w-[84px] px-1 [[data-density=touch]_&]:w-[112px]' : 'w-11 [[data-density=touch]_&]:w-14'
        )}
      >
        <div className={cn('flex items-center gap-1', showPages ? 'flex-row flex-wrap justify-center' : 'flex-col')}>
          <IconButton
            icon={arranging ? LuCheck : LuArrowLeftRight}
            label={arranging ? tr('shell.executors.doneArranging') : tr('shell.executors.arrange')}
            tooltip={arranging ? tr('shell.executors.doneTooltip') : tr('shell.executors.arrangeTooltip')}
            size="sm"
            active={arranging}
            tone="info"
            onClick={() => setArranging((a) => !a)}
          />
          <IconButton
            icon={LuSquare}
            label={tr('shell.executors.releaseAll')}
            tooltip={tr('shell.executors.releaseAllTooltip')}
            size="sm"
            disabled={!anyPlaying}
            onClick={() => usePlaybackStore.getState().releaseAll()}
            className={anyPlaying ? 'text-danger-fg' : undefined}
          />
          {proMode && (
            <IconButton
              icon={LuSlidersHorizontal}
              label={fadersOn ? tr('pro.stage.faders.hide') : tr('pro.stage.faders.show')}
              tooltip={tr('pro.stage.faders.tooltip')}
              size="sm"
              active={fadersOn}
              onClick={() => setFadersOn((on) => { writeFadersPref(!on); return !on })}
            />
          )}
        </div>
        {showPages && (
          <PageSelector
            variant="bar"
            className="mt-auto"
            pages={data.executorPages}
            current={pageIndex}
            activePages={activePages}
            onChange={setExecutorPage}
            menuExtra={proMode ? () => pageMenuExtra(pageIndex) : undefined}
          />
        )}
      </div>
      <div
        {...swipe}
        className={cn('grid min-w-0 flex-1 grid-cols-8 gap-1 p-1.5', arranging && 'bg-info/[0.04]')}
        style={{
          gridTemplateRows: `auto repeat(${ROWS_PER_COLUMN}, var(--pb-executor-row-h))${showFaders ? ' auto' : ''}`,
          gridAutoFlow: 'column'
        }}
      >
        {Array.from({ length: COLUMN_COUNT }, (_, col) => (
          <ColumnCells
            key={col}
            col={col}
            pageIndex={pageIndex}
            title={page?.columns[col]?.title ?? ''}
            color={page?.columns[col]?.color ?? '#888'}
            faderKeyValue={faderKey(page?.columns[col]?.fader)}
            cells={cells[col]}
            index={showFaders ? index : undefined}
            mapped={mapped}
            learningId={learningId}
            arranging={arranging}
            proMode={proMode}
            showFader={showFaders}
            selectedRow={selected && selected.col === col ? selected.row : -1}
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

/** Options menu of a cell (null = an empty cell: Pro only) */
function cellMenu(cell: ExecutorCell | null, ref: { page: number; col: number; row: number }, proMode: boolean): MenuEntry[] {
  const pro = proMode ? proCellEntries(ref, cell) : []
  if (!cell) return pro
  const entries = cell.kind === 'cuelist' ? sceneEntries(cell, ref) : objectEntries(cell, ref)
  if (!entries.length) return pro
  return pro.length ? [...entries, { type: 'separator' }, ...pro] : entries
}

function sceneEntries(cell: ExecutorCell, ref: { page: number; col: number; row: number }): MenuEntry[] {
  const pb = usePlaybackStore.getState
  const cl = pb().cuelists.find((c) => c.id === cell.id)
  if (!cl) return []
  const mode = cell.mode
  const midi = useMidiStore.getState()
  const learning = midi.isLearning && midi.learnTarget?.type === 'cuelist_go' && midi.learnTarget.id === cl.id
  return [
    { type: 'label', label: cl.name },
    { label: t('common.go'), icon: LuPlay, onSelect: () => pb().goCuelist(cl.id), disabled: cl.cues.length === 0 },
    { label: t('shell.executors.back'), icon: LuSkipBack, onSelect: () => pb().goBackCuelist(cl.id), disabled: !cl.isPlaying },
    { label: t('common.stop'), icon: LuSquare, onSelect: () => pb().stopCuelist(cl.id), disabled: !cl.isPlaying },
    { type: 'separator' },
    { type: 'label', label: t('shell.executors.buttonMode') },
    ...(['toggle', 'trigger', 'flash'] as SceneMode[]).map((m): MenuEntry => ({
      label: t(`shell.executors.modeName.${m}`),
      checked: mode === m,
      onSelect: () => {
        if (ref.page === useExecutorStore.getState().currentPage) setSceneMode(cl.id, ref, m)
      }
    })),
    { type: 'separator' },
    learning
      ? { label: t('shell.executors.cancelLearn'), icon: LuX, onSelect: () => useMidiStore.getState().cancelLearn() }
      : { label: t('shell.executors.learn'), icon: LuPiano, description: t('shell.executors.learnDescription'), onSelect: () => startSceneLearn(cl, mode) },
    { label: t('shell.executors.rename'), icon: LuPencil, shortcut: 'F2', onSelect: () => { void renameScene(cl) } },
    { label: t('shell.executors.editInScenes'), icon: LuSquarePen, onSelect: () => useUiStore.getState().navigateToCuelist(cl.id) },
    { type: 'separator' },
    { label: t('shell.executors.deleteScene'), icon: LuTrash2, danger: true, shortcut: 'Backspace', onSelect: () => { void deleteSceneWithUndo(cl) } }
  ]
}

/** Chases, effects, macros, groups, speed masters: their quick actions + mode */
function objectEntries(cell: ExecutorCell, ref: { page: number; col: number; row: number }): MenuEntry[] {
  const actions = getStoreActions()
  const out: MenuEntry[] = []
  const modeEntries = (): MenuEntry[] => [
    { type: 'separator' },
    { type: 'label', label: t('shell.executors.buttonMode') },
    ...(['toggle', 'trigger', 'flash'] as SceneMode[]).map((m): MenuEntry => ({
      label: t(`shell.executors.modeName.${m}`),
      checked: cell.mode === m,
      onSelect: () => { if (ref.page === useExecutorStore.getState().currentPage) useExecutorStore.getState().setMode(ref.col, ref.row, m) }
    }))
  ]
  switch (cell.kind) {
    case 'chase': {
      const ch = usePlaybackStore.getState().chases.find((c) => c.id === cell.id)
      if (!ch) return []
      out.push({ type: 'label', label: ch.name })
      out.push(ch.isPlaying
        ? { label: t('common.stop'), icon: LuSquare, onSelect: () => usePlaybackStore.getState().toggleChase(ch.id, false) }
        : { label: t('common.play'), icon: LuPlay, onSelect: () => usePlaybackStore.getState().toggleChase(ch.id, true) })
      out.push(...modeEntries())
      return out
    }
    case 'effect': {
      const fx = useEffectsStore.getState().effects.find((e) => e.id === cell.id)
      if (!fx) return []
      out.push({ type: 'label', label: fx.name })
      out.push(fx.isRunning
        ? { label: t('common.stop'), icon: LuSquare, onSelect: () => useEffectsStore.getState().setEffectRunning(fx.id, false) }
        : { label: t('common.play'), icon: LuPlay, onSelect: () => useEffectsStore.getState().setEffectRunning(fx.id, true) })
      out.push(...modeEntries())
      return out
    }
    case 'macro':
      return [{ label: t('pro.stage.menu.runMacro'), icon: LuPlay, onSelect: () => actions.macro(cell.id) }]
    case 'group':
      return [{ label: t('pro.stage.menu.selectGroup'), icon: LuPlay, onSelect: () => actions.group(cell.id) }]
    case 'speed':
      return actions.speedTap ? [{ label: t('pro.stage.menu.tap'), icon: LuPlay, onSelect: () => actions.speedTap?.(cell.id) }] : []
    default:
      return []
  }
}

// ---------------------------------------------------------------
// Column
// ---------------------------------------------------------------

const ColumnCells = memo(function ColumnCells({
  col, pageIndex, title, color, faderKeyValue, cells, index, mapped, learningId, arranging, proMode, showFader, selectedRow, drag, callbacks
}: {
  col: number
  pageIndex: number
  title: string
  color: string
  faderKeyValue: string
  cells: (ResolvedCell | null)[]
  /** Only with the fader row */
  index?: SurfaceIndex
  mapped: Set<string>
  learningId: string | null
  arranging: boolean
  proMode: boolean
  showFader: boolean
  selectedRow: number
  drag: DragState | null
  callbacks: CellCallbacks
}) {
  return (
    <>
      <ColumnHeader col={col} pageIndex={pageIndex} title={title} color={color} proMode={proMode} faderKeyValue={faderKeyValue} />
      {Array.from({ length: ROWS_PER_COLUMN }, (_, row) => {
        const c = cells[row]
        return (
          <ExecutorCellView
            key={row}
            col={col}
            row={row}
            filled={!!c}
            kind={c?.kind ?? 'cuelist'}
            fn={c?.fn ?? 'toggle'}
            customFn={!!c && c.fn !== (c.mode === 'trigger' ? 'temp' : c.mode === 'flash' ? 'flash' : 'toggle')}
            mode={c?.mode ?? 'toggle'}
            name={c ? cellName(c) : ''}
            missing={!!c?.missing}
            active={!!c?.active}
            flash={!!c?.flash}
            posIndex={c?.position?.index ?? -2}
            posCount={c?.position?.count ?? 0}
            cueFade={c?.cueFade ?? 0}
            goGeneration={c?.goGeneration ?? 0}
            number={c?.number}
            color={c?.color ?? color}
            midiMapped={!!c && c.kind === 'cuelist' && mapped.has(c.id)}
            learning={!!c && c.kind === 'cuelist' && learningId === c.id}
            selected={selectedRow === row}
            arranging={arranging}
            proArrange={proMode && arranging}
            dragSource={drag?.from.col === col && drag.from.row === row}
            dropTarget={!!drag && drag.over?.col === col && drag.over.row === row && !(drag.from.col === col && drag.from.row === row)}
            callbacks={callbacks}
          />
        )
      })}
      {showFader && index && <ColumnFaderCell col={col} pageIndex={pageIndex} color={color} index={index} />}
    </>
  )
})

function ColumnHeader({ col, pageIndex, title, color, proMode, faderKeyValue }: {
  col: number
  pageIndex: number
  title: string
  color: string
  proMode: boolean
  faderKeyValue: string
}) {
  const t = useT()
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
        title={t('shell.executors.columnHeaderTooltip')}
      >
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className={cn('min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-[0.06em]', title ? 'text-fg-secondary' : 'text-fg-disabled')}>
          {title || t('shell.executors.columnN', { n: col + 1 })}
        </span>
        <LuPencil size={11} aria-hidden className="shrink-0 text-fg-disabled opacity-0 group-hover:opacity-100" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement="top-start" className="w-[248px] p-3" aria-label={t('shell.executors.columnN', { n: col + 1 })}>
        <div className="flex flex-col gap-3">
          <TextInput
            size="sm"
            data-autofocus=""
            aria-label={t('shell.executors.columnTitle')}
            placeholder={t('shell.executors.columnN', { n: col + 1 })}
            value={title}
            onChange={(e) => useExecutorStore.getState().setColumnTitle(col, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false) }}
          />
          <SwatchPicker colors={SWATCH_COLORS} value={color} size="md" onChange={(c) => useExecutorStore.getState().setColumnColor(col, c)} />
          {proMode && open && (
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.stage.fader.label')}</span>
              <Select
                size="sm"
                aria-label={t('pro.stage.fader.label')}
                value={faderKeyValue}
                options={columnFaderOptions()}
                onChange={(v) => setColumnFaderFn(pageIndex, col, v)}
              />
            </label>
          )}
        </div>
      </Popover>
    </>
  )
}

// ---------------------------------------------------------------
// Column fader (Pro, optional row): relative horizontal drag, double-tap
// = full; a dashed tick shows where an unsynced MIDI fader is (pickup)
// ---------------------------------------------------------------

function ColumnFaderCell({ col, pageIndex, color, index }: { col: number; pageIndex: number; color: string; index: SurfaceIndex }) {
  const t = useT()
  // What the fader drives, by its function (column level, cell master, GM, group / speed master, rate, X-fade)
  const level = surfaceColumnFader(index.data, pageIndex, col)
  const ghost = useColumnGhost(pageIndex, col)
  const onChange = (v: number) => getStoreActions().columnFader(pageIndex, col, v)
  return <MiniFader value={level ?? 0} color={color} ghost={ghost} disabled={level === null} label={t('pro.stage.faders.columnAria', { n: col + 1 })} onChange={onChange} />
}

const MiniFader = memo(function MiniFader({ value, color, ghost, disabled, label, onChange }: {
  value: number
  color: string
  ghost: number | null
  disabled: boolean
  label: string
  onChange: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef(0)
  const lastTap = useRef(0)
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }
  const drag = usePointerDrag({
    disabled,
    onStart: (s) => {
      const now = s.event.timeStamp
      if (now - lastTap.current < 300) { lastTap.current = 0; latest.current.onChange(255); return false }
      lastTap.current = now
      start.current = latest.current.value
    },
    onMove: (s) => {
      const w = ref.current?.getBoundingClientRect().width || 1
      const next = Math.max(0, Math.min(255, Math.round(start.current + (s.dx / w) * 255 * (s.fine ? 0.2 : 1))))
      if (next !== latest.current.value) latest.current.onChange(next)
    }
  })
  const pct = Math.round((value / 255) * 100)
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={255}
      aria-valuenow={value}
      aria-valuetext={formatPercent(value)}
      data-no-swipe=""
      title={label}
      onKeyDown={(e) => {
        if (disabled) return
        const step = e.shiftKey ? 25 : 5
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); onChange(Math.min(255, value + step)) }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); onChange(Math.max(0, value - step)) }
      }}
      {...drag}
      className={cn(
        'relative h-5 min-w-0 touch-none overflow-hidden rounded-sm bg-surface-0 ring-1 ring-inset ring-line [[data-density=touch]_&]:h-8',
        disabled ? 'opacity-40' : 'cursor-ew-resize'
      )}
    >
      {!disabled && <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, backgroundColor: withAlpha(color, 0.45) }} />}
      {ghost !== null && !disabled && (
        <div aria-hidden className="absolute inset-y-0.5 -translate-x-1/2 border-l-2 border-dashed border-fg-primary/70" style={{ left: `${Math.round((ghost / 255) * 100)}%` }} />
      )}
      {!disabled && <div className="absolute inset-y-0.5 w-1 -translate-x-1/2 rounded-full bg-fg-primary" style={{ left: `max(4px, min(calc(100% - 4px), ${pct}%))` }} />}
      {!disabled && (
        <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center font-mono text-[10px] tabular text-fg-secondary">{pct}</span>
      )}
    </div>
  )
})

// ---------------------------------------------------------------
// Cell
// ---------------------------------------------------------------

type Gesture =
  | { kind: 'pending'; id: number; x: number; y: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'lifted'; id: number; x: number; y: number }
  | { kind: 'holding'; id: number | 'key' }
  | { kind: 'dragging'; id: number }

const ExecutorCellView = memo(function ExecutorCellView({
  col, row, filled, kind, fn, customFn, mode, name, missing, active, flash, posIndex, posCount, cueFade, goGeneration, number, color,
  midiMapped, learning, selected, arranging, proArrange, dragSource, dropTarget, callbacks
}: {
  col: number
  row: number
  filled: boolean
  kind: ExecutorTargetKind
  fn: ExecutorButtonFn
  /** A Pro button function is set (not the mode's default) */
  customFn: boolean
  mode: SceneMode
  name: string
  missing: boolean
  active: boolean
  flash: boolean
  /** -2 = no position (macros…), -1 = stopped */
  posIndex: number
  posCount: number
  cueFade: number
  goGeneration: number
  number?: number
  color: string
  midiMapped: boolean
  learning: boolean
  /** GO / Back target (pro-store selectedExecutor) */
  selected: boolean
  arranging: boolean
  /** Pro arrange: empty cells open the assign menu */
  proArrange: boolean
  dragSource: boolean
  dropTarget: boolean
  callbacks: CellCallbacks
}) {
  const t = useT()
  const gesture = useRef<Gesture | null>(null)
  const lastPointerType = useRef('mouse')
  const hold = filled && holdCell(kind, fn)
  const [lifted, setLifted] = useState(false)
  const cell = useMemo(() => ({ col, row }), [col, row])
  const key = `${col}:${row}`

  const clearTimer = () => {
    const g = gesture.current
    if (g?.kind === 'pending' && g.timer) clearTimeout(g.timer)
  }
  const tap = () => {
    callbacks.fire(cell, 'down')
    callbacks.fire(cell, 'up')
  }
  // Released on unmount: a TRIG / FLASH cell never stays on
  useEffect(() => () => {
    clearTimer()
    if (gesture.current?.kind === 'holding') callbacks.fire(cell, 'up')
    gesture.current = null
  }, [callbacks, cell])

  const menuAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    callbacks.openMenu(cell, r.left + 8, r.top + 8)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = e.pointerType
    if (!filled || gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    if (!arranging && hold) {
      gesture.current = { kind: 'holding', id: e.pointerId }
      callbacks.fire(cell, 'down')
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
      // Finger slid before the long-press: not a tap, not a drag (maybe a page swipe)
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
    if (!filled) return
    if (g.kind === 'holding') callbacks.fire(cell, 'up')
    else if (g.kind === 'dragging') callbacks.dragEnd(!canceled)
    else if (canceled) return
    else if (g.kind === 'lifted' || arranging) menuAt(e.currentTarget)
    else tap() // tap cells fire on release
  }

  if (!filled) {
    if (proArrange) {
      return (
        <button
          type="button"
          data-exec-cell={key}
          aria-label={t('pro.stage.menu.assignCell', { col: col + 1, row: row + 1 })}
          onClick={(e) => menuAt(e.currentTarget)}
          className={cn(
            'group flex items-center justify-center rounded border border-dashed text-fg-disabled transition-colors duration-fast hover:border-info-fg hover:text-info-fg',
            dropTarget ? 'border-info-fg bg-info/15' : 'border-line-strong'
          )}
        >
          <LuPlus size={14} aria-hidden className="opacity-0 group-hover:opacity-100 [[data-density=touch]_&]:opacity-60" />
        </button>
      )
    }
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

  const Icon = kind === 'cuelist' ? null : KIND_ICON[kind]
  const badge = customFn ? fnBadge(fn, kind) : mode !== 'toggle' && (kind === 'cuelist' || kind === 'chase' || kind === 'effect') ? modeLabel(mode) : null
  const badgeTone = customFn ? fnBadgeTone(fn) : mode === 'flash' ? 'warning' : 'info'
  const fadeSeconds = active && kind === 'cuelist' ? cueFade : 0
  const learnRing = learning ? 'outline outline-2 -outline-offset-2 outline-midi-fg animate-pulse' : undefined

  return (
    <div
      data-exec-cell={key}
      data-hold={hold && !arranging ? '1' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={active && posIndex >= 0
        ? t('shell.executors.cellPlaying', { name, mode: badge ?? modeLabel('toggle'), cue: posIndex + 1, count: posCount })
        : t('shell.executors.cellStopped', { name, mode: badge ?? modeLabel('toggle') })}
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
          if (hold) {
            gesture.current = { kind: 'holding', id: 'key' }
            callbacks.fire(cell, 'down')
          } else tap()
        }
      }}
      onKeyUp={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.fire(cell, 'up')
        }
      }}
      onBlur={() => {
        if (gesture.current?.kind === 'holding' && gesture.current.id === 'key') {
          gesture.current = null
          callbacks.fire(cell, 'up')
        }
      }}
      className={cn(
        'relative flex min-w-0 cursor-pointer touch-none select-none flex-col justify-center overflow-hidden rounded border pl-2.5 pr-1.5 transition-[background-color,box-shadow,transform,opacity] duration-fast',
        !active && 'border-line-subtle bg-surface-2 hover:bg-surface-3',
        missing && 'opacity-60',
        dragSource && 'opacity-35',
        lifted && 'scale-[1.04] shadow-popover',
        dropTarget && 'outline outline-2 -outline-offset-2 outline-info-fg',
        selected && !dropTarget && !learning && 'outline outline-2 -outline-offset-2 outline-info-fg/80',
        arranging && 'cursor-grab',
        learnRing
      )}
      style={active ? {
        backgroundColor: tint(color, flash ? 0.5 : 0.3, '#1a1d21'),
        borderColor: color,
        boxShadow: `0 0 14px ${withAlpha(color, 0.35)}, inset 0 0 0 1px ${withAlpha(color, 0.5)}`
      } : undefined}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: color, opacity: active ? 1 : 0.55 }} />
      <div className="flex min-w-0 items-center gap-1">
        {Icon && <Icon size={11} aria-hidden className={cn('shrink-0', active ? 'text-white/80' : 'text-fg-tertiary')} />}
        <span className={cn('min-w-0 flex-1 truncate text-xs font-semibold leading-4', missing ? 'italic text-fg-tertiary' : active ? 'text-white' : 'text-fg-primary')}>{name}</span>
        {arranging && <LuGripVertical size={12} aria-hidden className="shrink-0 text-fg-tertiary" />}
      </div>
      <div className="flex min-w-0 items-center gap-1 leading-3">
        {posIndex >= -1 ? (
          <span className={cn('font-mono text-[10px] tabular', active ? 'text-white/80' : 'text-fg-tertiary')}>
            {formatCuePosition(posIndex, posCount)}
          </span>
        ) : number !== undefined ? (
          <span className="font-mono text-[10px] tabular text-fg-tertiary">{number}</span>
        ) : null}
        <span className="flex-1" />
        {midiMapped && <span title={t('shell.executors.midiMapped')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-midi-fg" />}
        {selected && <span title={t('pro.stage.goTargetMark')} className="flex shrink-0 text-info-fg"><LuCrosshair size={12} aria-hidden /></span>}
        {badge && <Badge size="xs" tone={badgeTone} variant={active ? 'solid' : 'subtle'}>{badge}</Badge>}
      </div>
      {fadeSeconds > 0 && (
        <span
          key={`${posIndex}:${goGeneration}`}
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-white/80"
          style={{ animation: `pb-progress ${fadeSeconds}s linear forwards, pb-fade-out 400ms ease ${fadeSeconds}s forwards` }}
        />
      )}
    </div>
  )
})
