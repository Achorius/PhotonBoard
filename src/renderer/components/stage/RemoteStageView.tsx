// ============================================================
// PhotonBoard — Remote Stage View
// Full-screen stage control UI for browser/mobile/tablet.
// Mirrors the Electron Stage window: 8×4 colored scene grid,
// long-press drag-to-reorder. Falls back to a 4×2 paged grid
// on phone-sized screens.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useExecutorStore, COLUMN_COUNT, ROWS_PER_COLUMN } from '@renderer/stores/executor-store'
import { isRemote } from '@renderer/hooks/useRemoteSync'

const pb = () => (window as any).photonboard

function sendCommand(type: string, payload?: any) {
  if (isRemote()) {
    pb()?.remote?.sendCommand(type, payload)
  } else {
    pb()?.stage?.sendCommand?.({ type, payload })
  }
}

const LONG_PRESS_MS = 350
const PHONE_BREAKPOINT = 640

// Phone view splits the full 8×4 matrix into 4 pages of 4×2:
//   page 0 → cols 0-3, rows 0-1 (top-left quadrant)
//   page 1 → cols 4-7, rows 0-1 (top-right)
//   page 2 → cols 0-3, rows 2-3 (bottom-left)
//   page 3 → cols 4-7, rows 2-3 (bottom-right)
const PHONE_PAGES = [
  { colStart: 0, rowStart: 0, label: '1' },
  { colStart: 4, rowStart: 0, label: '2' },
  { colStart: 0, rowStart: 2, label: '3' },
  { colStart: 4, rowStart: 2, label: '4' }
]

// ── Hooks ───────────────────────────────────────────────────

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < PHONE_BREAKPOINT
  )
  useEffect(() => {
    const onResize = () => setIsPhone(window.innerWidth < PHONE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isPhone
}

// ── Grand Master Fader ──────────────────────────────────────

function GrandMaster() {
  const grandMaster = useDmxStore(s => s.grandMaster)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const compute = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = 1 - (e.clientY - rect.top) / rect.height
    const val = Math.max(0, Math.min(255, Math.round(ratio * 255)))
    sendCommand('set-grand-master', val)
  }, [])

  const pct = Math.round((grandMaster / 255) * 100)

  return (
    <div className="flex flex-col items-center gap-1 p-2 flex-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Grand Master</span>
      <span className="text-lg font-bold tabular-nums text-white">{pct}%</span>
      <div
        ref={trackRef}
        className="relative flex-1 rounded-lg cursor-pointer"
        style={{ width: 40, backgroundColor: '#0f0f18', border: '1px solid #333', touchAction: 'none' }}
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); compute(e) }}
        onPointerMove={(e) => { if (dragging.current) compute(e) }}
        onPointerUp={() => { dragging.current = false }}
      >
        <div className="absolute bottom-0 left-0 right-0 rounded-b-lg" style={{
          height: `${pct}%`,
          background: 'linear-gradient(to top, #e85d04, #f59e0b)',
          opacity: 0.7,
        }} />
        <div className="absolute left-0 right-0" style={{
          bottom: `calc(${pct}% - 4px)`,
          height: 8,
          backgroundColor: '#e85d04',
          borderRadius: 3,
          border: '1px solid rgba(255,255,255,0.3)',
          boxShadow: '0 0 6px #e85d0488',
        }} />
      </div>
    </div>
  )
}

// ── Master Buttons ──────────────────────────────────────────

function MasterButtons() {
  const blackout = useDmxStore(s => s.blackout)

  return (
    <div className="flex flex-col gap-1.5 p-2 border-t border-surface-3">
      <button
        className="py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors"
        style={{
          backgroundColor: blackout ? '#dc2626' : '#1a1a2e',
          color: blackout ? '#fff' : '#888',
          border: `1px solid ${blackout ? '#dc2626' : '#333'}`,
          boxShadow: blackout ? '0 0 12px #dc262688' : 'none',
        }}
        onClick={() => sendCommand('toggle-blackout')}
      >
        Blackout
      </button>
      <button
        className="py-2 rounded-md text-xs font-bold uppercase tracking-wider"
        style={{ backgroundColor: '#1a1a2e', color: '#888', border: '1px solid #333' }}
        onClick={() => sendCommand('clear-programmer')}
      >
        Clear
      </button>
    </div>
  )
}

// ── Group Buttons ───────────────────────────────────────────

function GroupBar() {
  const groups = usePatchStore(s => s.groups).filter(g => !g.parentGroupId)
  if (groups.length === 0) return null

  return (
    <div className="flex gap-1 p-1.5 overflow-x-auto border-b border-surface-3 shrink-0">
      {groups.map(g => (
        <button
          key={g.id}
          className="px-2.5 py-1 rounded text-[10px] font-medium whitespace-nowrap"
          style={{ backgroundColor: g.color || '#333', color: '#fff', border: 'none', opacity: 0.8 }}
          onClick={() => sendCommand('select-group', g.id)}
        >
          {g.name}
        </button>
      ))}
      <button
        className="px-2.5 py-1 rounded text-[10px] text-gray-400"
        style={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
        onClick={() => sendCommand('clear-selection')}
      >
        Clear
      </button>
    </div>
  )
}

// ── Scene Cell (button + fader, colored per column) ─────────

interface SceneCellProps {
  cuelist: { id: string; name: string; isPlaying: boolean; faderLevel: number; currentCueIndex: number; cueCount: number } | null
  color: string
  isDragSource: boolean
  isDragOver: boolean
  draggingActive: boolean
  compact: boolean
  onGo: () => void
  onStop: () => void
  onFader: (level: number) => void
  onLongPressStart: () => void
  onPointerEnter: () => void
  onDrop: () => void
  onCancelDrag: () => void
}

function SceneCell({
  cuelist, color, isDragSource, isDragOver, draggingActive, compact,
  onGo, onStop, onFader, onLongPressStart, onPointerEnter, onDrop, onCancelDrag
}: SceneCellProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  const handleFader = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = 1 - (e.clientY - rect.top) / rect.height
    onFader(Math.max(0, Math.min(255, Math.round(ratio * 255))))
  }, [onFader])

  const onFaderDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handleFader(e)
  }, [handleFader])
  const onFaderMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) handleFader(e)
  }, [handleFader])
  const onFaderUp = useCallback(() => { dragging.current = false }, [])

  const onCellDown = useCallback((e: React.PointerEvent) => {
    if (!cuelist) return
    longPressFired.current = false
    downPos.current = { x: e.clientX, y: e.clientY }
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      onLongPressStart()
    }, LONG_PRESS_MS)
  }, [cuelist, onLongPressStart])

  const onCellMove = useCallback((e: React.PointerEvent) => {
    if (!longPressFired.current && downPos.current && longPressTimer.current) {
      const dx = e.clientX - downPos.current.x
      const dy = e.clientY - downPos.current.y
      if (Math.hypot(dx, dy) > 8) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
    if (draggingActive) onPointerEnter()
  }, [draggingActive, onPointerEnter])

  const onCellUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (longPressFired.current) {
      onDrop()
      longPressFired.current = false
    } else if (draggingActive) {
      onCancelDrag()
    }
    downPos.current = null
  }, [draggingActive, onDrop, onCancelDrag])

  const onCellCancel = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressFired.current = false
    if (draggingActive) onCancelDrag()
    downPos.current = null
  }, [draggingActive, onCancelDrag])

  if (!cuelist) {
    return (
      <div
        className="rounded-md border border-dashed transition-colors"
        style={{
          borderColor: isDragOver ? color + 'aa' : color + '30',
          backgroundColor: isDragOver ? color + '20' : 'rgba(15,15,24,0.4)'
        }}
        onPointerEnter={() => { if (draggingActive) onPointerEnter() }}
        onPointerUp={onCellUp}
      />
    )
  }

  const pct = Math.round((cuelist.faderLevel / 255) * 100)
  const isActive = cuelist.isPlaying

  const nameSize = compact ? 'text-[12px]' : 'text-[11px]'
  const goSize = compact ? 'text-xs py-2' : 'text-[11px] py-1.5'
  const faderWidth = compact ? 'w-8' : 'w-6'

  return (
    <div
      className={`flex flex-col rounded-md overflow-hidden border transition-all min-h-0 select-none ${
        isDragSource ? 'opacity-40 scale-95' : ''
      } ${isDragOver ? 'ring-2' : ''}`}
      style={{
        backgroundColor: isActive ? color + '30' : color + '12',
        borderColor: isActive ? color + 'aa' : color + '40',
        boxShadow: isActive ? `0 0 10px ${color}55` : undefined,
        // @ts-expect-error tailwind ringColor via CSS var
        '--tw-ring-color': color,
        touchAction: 'none'
      }}
      onPointerDown={onCellDown}
      onPointerMove={onCellMove}
      onPointerUp={onCellUp}
      onPointerCancel={onCellCancel}
      onPointerEnter={() => { if (draggingActive) onPointerEnter() }}
    >
      <div className="px-1 py-1 text-center border-b shrink-0" style={{ borderColor: color + '40' }}>
        <div className={`${nameSize} font-bold truncate leading-tight`} style={{ color: isActive ? '#fff' : color + 'dd' }}>
          {cuelist.name}
        </div>
        {cuelist.cueCount > 1 && (
          <div className="text-[8px] text-gray-500 leading-none">
            {cuelist.currentCueIndex + 1}/{cuelist.cueCount}
          </div>
        )}
      </div>

      <div className="flex-1 flex items-stretch px-1 py-1 min-h-0">
        <div
          ref={trackRef}
          className={`${faderWidth} mx-auto rounded relative cursor-pointer overflow-hidden touch-none`}
          style={{ background: '#0f0f18', border: `1px solid ${color}55` }}
          onPointerDown={onFaderDown}
          onPointerMove={onFaderMove}
          onPointerUp={onFaderUp}
        >
          <div
            className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
            style={{ height: `${pct}%`, background: `linear-gradient(to top, ${color}, ${color}cc)` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white/85 font-mono drop-shadow">{pct}</span>
          </div>
        </div>
      </div>

      <button
        className={`shrink-0 ${goSize} mx-1 mb-1 rounded font-black uppercase tracking-wide transition-all active:scale-95 text-white`}
        style={{
          backgroundColor: isActive ? '#dc2626' : color,
          boxShadow: isActive ? '0 0 8px #dc262666' : `0 0 6px ${color}66`
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); isActive ? onStop() : onGo() }}
      >
        {isActive ? 'STOP' : 'GO'}
      </button>
    </div>
  )
}

// ── Executor Grid ───────────────────────────────────────────

function ExecutorGridRemote({ phone, page }: { phone: boolean; page: number }) {
  const cuelists = usePlaybackStore(s => s.cuelists)
  const grid = useExecutorStore(s => s.grid)
  const columns = useExecutorStore(s => s.columns)
  const swapCellsLocal = useExecutorStore(s => s.swapCells)

  const cuelistById = new Map(cuelists.map(cl => [cl.id, cl]))

  const [dragSource, setDragSource] = useState<{ col: number; row: number } | null>(null)
  const [dragOver, setDragOver] = useState<{ col: number; row: number } | null>(null)

  const handleSwap = useCallback((from: { col: number; row: number }, to: { col: number; row: number }) => {
    // Optimistically apply locally for instant feedback; the next state broadcast
    // from the host will reconcile.
    swapCellsLocal(from, to)
    sendCommand('swap-cells', { from, to })
  }, [swapCellsLocal])

  const onLongPressStart = useCallback((col: number, row: number) => {
    setDragSource({ col, row })
    setDragOver({ col, row })
  }, [])

  const onDrop = useCallback((col: number, row: number) => {
    if (dragSource) handleSwap(dragSource, { col, row })
    setDragSource(null)
    setDragOver(null)
  }, [dragSource, handleSwap])

  const cancelDrag = useCallback(() => {
    setDragSource(null)
    setDragOver(null)
  }, [])

  // Decide bounds based on phone vs full mode
  const visibleCols = phone ? 4 : COLUMN_COUNT
  const visibleRows = phone ? 2 : ROWS_PER_COLUMN
  const colStart = phone ? PHONE_PAGES[page].colStart : 0
  const rowStart = phone ? PHONE_PAGES[page].rowStart : 0

  const cells: React.ReactNode[] = []
  for (let r = 0; r < visibleRows; r++) {
    for (let c = 0; c < visibleCols; c++) {
      const col = colStart + c
      const row = rowStart + r
      const sceneId = grid[col]?.[row] ?? null
      const cuelist = sceneId ? cuelistById.get(sceneId) ?? null : null
      const color = columns[col]?.color ?? '#888'
      const isSrc = dragSource?.col === col && dragSource?.row === row
      const isOver = dragSource !== null && dragOver?.col === col && dragOver?.row === row && !isSrc
      cells.push(
        <SceneCell
          key={`${col}-${row}`}
          cuelist={cuelist
            ? { id: cuelist.id, name: cuelist.name, isPlaying: cuelist.isPlaying, faderLevel: cuelist.faderLevel, currentCueIndex: cuelist.currentCueIndex, cueCount: cuelist.cues.length }
            : null}
          color={color}
          isDragSource={isSrc}
          isDragOver={isOver}
          draggingActive={dragSource !== null}
          compact={phone}
          onGo={() => cuelist && sendCommand('go-cuelist', cuelist.id)}
          onStop={() => cuelist && sendCommand('stop-cuelist', cuelist.id)}
          onFader={(level) => cuelist && sendCommand('set-cuelist-fader', { id: cuelist.id, level })}
          onLongPressStart={() => onLongPressStart(col, row)}
          onPointerEnter={() => setDragOver({ col, row })}
          onDrop={() => onDrop(col, row)}
          onCancelDrag={cancelDrag}
        />
      )
    }
  }

  return (
    <div className="flex-1 p-2 min-h-0 overflow-hidden" onPointerLeave={cancelDrag}>
      <div
        className="grid gap-1.5 h-full"
        style={{
          gridTemplateColumns: `repeat(${visibleCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${visibleRows}, minmax(0, 1fr))`
        }}
      >
        {cells}
      </div>
    </div>
  )
}

// ── Phone-only page navigation ──────────────────────────────

function PageNav({ page, onPrev, onNext }: { page: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-b border-surface-3 shrink-0 bg-surface-1">
      <button
        className="w-9 h-9 rounded-md bg-surface-2 active:bg-surface-3 text-white text-lg font-bold disabled:opacity-30"
        onClick={onPrev}
        disabled={page === 0}
      >
        ‹
      </button>
      <div className="flex items-center gap-1 text-xs text-gray-300">
        {PHONE_PAGES.map((_, i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${i === page ? 'bg-orange-500' : 'bg-gray-600'}`}
          />
        ))}
        <span className="ml-2 font-mono">{PHONE_PAGES[page].label}/4</span>
      </div>
      <button
        className="w-9 h-9 rounded-md bg-surface-2 active:bg-surface-3 text-white text-lg font-bold disabled:opacity-30"
        onClick={onNext}
        disabled={page === PHONE_PAGES.length - 1}
      >
        ›
      </button>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────

export function RemoteStageView() {
  const showName = useUiStore(s => s.showName)
  const isPhone = useIsPhone()
  const [page, setPage] = useState(0)

  if (isPhone) {
    return (
      <div className="flex flex-col h-full w-full bg-surface-0 overflow-hidden">
        {/* Top bar: show name + page nav (replaces left sidebar on phone) */}
        <div className="flex items-center gap-1 px-2 py-1 bg-surface-1 border-b border-surface-3 shrink-0">
          <span className="text-[10px] text-gray-500 truncate flex-1">{showName}</span>
          <button
            className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-surface-2 text-gray-300 active:bg-red-600 active:text-white"
            onClick={() => sendCommand('toggle-blackout')}
          >
            BO
          </button>
          <button
            className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-surface-2 text-gray-300"
            onClick={() => sendCommand('clear-programmer')}
          >
            Clr
          </button>
        </div>
        <PageNav
          page={page}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(PHONE_PAGES.length - 1, p + 1))}
        />
        <GroupBar />
        <ExecutorGridRemote phone page={page} />
      </div>
    )
  }

  // Tablet / desktop: same layout as Stage window
  return (
    <div className="flex h-full w-full bg-surface-0 overflow-hidden">
      <div className="w-20 shrink-0 flex flex-col border-r border-surface-3 bg-surface-1">
        <div className="p-1.5 text-center border-b border-surface-3">
          <div className="text-[9px] text-gray-500 truncate">{showName}</div>
        </div>
        <GrandMaster />
        <MasterButtons />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <GroupBar />
        <ExecutorGridRemote phone={false} page={0} />
      </div>
    </div>
  )
}
