import React, { useCallback, useEffect, useRef, useState } from 'react'

interface CuelistInfo {
  id: string
  name: string
  isPlaying: boolean
  faderLevel: number
  currentCueIndex: number
  cueCount: number
}

interface ColumnMeta {
  title: string
  color: string
}

interface Props {
  cuelists: CuelistInfo[]
  grid: (string | null)[][]
  columns: ColumnMeta[]
  onGo: (id: string) => void
  onStop: (id: string) => void
  onFader: (id: string, level: number) => void
  onSwap: (from: { col: number; row: number }, to: { col: number; row: number }) => void
}

// Match main app's ExecutorBar layout: 8 columns × 4 rows = 32 scenes
const COLUMN_COUNT = 8
const ROWS_PER_COLUMN = 4
const LONG_PRESS_MS = 350

interface CellProps {
  cuelist: CuelistInfo | null
  col: number
  row: number
  color: string
  isDragSource: boolean
  isDragOver: boolean
  onGo: () => void
  onStop: () => void
  onFader: (level: number) => void
  onLongPressStart: (col: number, row: number, target: Element, pointerId: number) => void
}

function SceneCell({
  cuelist, col, row, color, isDragSource, isDragOver,
  onGo, onStop, onFader, onLongPressStart
}: CellProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const faderDragging = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  const handleFader = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    onFader(Math.round(y * 255))
  }, [onFader])

  const onFaderDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation() // exclusive: fader controls fader, not drag
    faderDragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handleFader(e)
  }, [handleFader])
  const onFaderMove = useCallback((e: React.PointerEvent) => {
    if (faderDragging.current) handleFader(e)
  }, [handleFader])
  const onFaderUp = useCallback(() => { faderDragging.current = false }, [])

  // Cell-wide pointer down: starts long-press timer (the parent grid takes
  // over once long-press fires).
  const onCellPointerDown = useCallback((e: React.PointerEvent) => {
    if (!cuelist) return
    longPressFired.current = false
    downPos.current = { x: e.clientX, y: e.clientY }
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    const target = e.target as Element
    const pointerId = e.pointerId
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      // Release implicit pointer capture so the parent grid can detect
      // pointermove on cells we drag over.
      try { target.releasePointerCapture?.(pointerId) } catch { /* noop */ }
      onLongPressStart(col, row, target, pointerId)
    }, LONG_PRESS_MS)
  }, [cuelist, col, row, onLongPressStart])

  const onCellPointerMove = useCallback((e: React.PointerEvent) => {
    if (longPressFired.current || !downPos.current || !longPressTimer.current) return
    const dx = e.clientX - downPos.current.x
    const dy = e.clientY - downPos.current.y
    if (Math.hypot(dx, dy) > 8) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const onCellPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    downPos.current = null
    // longPressFired is reset on next pointerdown — let button onClick check it
  }, [])

  // Empty cell — just a drop target marker
  if (!cuelist) {
    return (
      <div
        data-cell-col={col}
        data-cell-row={row}
        className="rounded-md border border-dashed transition-colors"
        style={{
          borderColor: isDragOver ? color + 'aa' : color + '30',
          backgroundColor: isDragOver ? color + '20' : 'rgba(15,15,24,0.4)'
        }}
      />
    )
  }

  const pct = Math.round((cuelist.faderLevel / 255) * 100)
  const isActive = cuelist.isPlaying

  return (
    <div
      data-cell-col={col}
      data-cell-row={row}
      className={`flex flex-col rounded-md overflow-hidden border transition-all min-h-0 select-none ${
        isDragSource ? 'opacity-40 scale-95' : ''
      } ${isDragOver ? 'ring-2' : ''}`}
      style={{
        backgroundColor: isActive ? color + '30' : color + '12',
        borderColor: isActive ? color + 'aa' : color + '40',
        boxShadow: isActive ? `0 0 10px ${color}55` : undefined,
        touchAction: 'none',
        // @ts-expect-error tailwind ringColor via CSS var
        '--tw-ring-color': color
      }}
      onPointerDown={onCellPointerDown}
      onPointerMove={onCellPointerMove}
      onPointerUp={onCellPointerUp}
    >
      <div className="px-1 py-1 text-center border-b shrink-0" style={{ borderColor: color + '40' }}>
        <div className="text-[11px] font-bold truncate leading-tight" style={{ color: isActive ? '#fff' : color + 'dd' }}>
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
          className="w-6 mx-auto rounded relative cursor-pointer overflow-hidden touch-none"
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
        className="shrink-0 py-1.5 mx-1 mb-1 rounded text-[11px] font-black uppercase tracking-wide transition-all active:scale-95 text-white"
        style={{
          backgroundColor: isActive ? '#dc2626' : color,
          boxShadow: isActive ? '0 0 8px #dc262666' : `0 0 6px ${color}66`,
          touchAction: 'none'
        }}
        onClick={(e) => {
          e.stopPropagation()
          // Suppress click that immediately follows a long-press / drag gesture
          if (longPressFired.current) {
            longPressFired.current = false
            return
          }
          isActive ? onStop() : onGo()
        }}
      >
        {isActive ? 'STOP' : 'GO'}
      </button>
    </div>
  )
}

export function ExecutorGrid({ cuelists, grid, columns, onGo, onStop, onFader, onSwap }: Props) {
  const cuelistById = new Map(cuelists.map(cl => [cl.id, cl]))
  const [dragSource, setDragSource] = useState<{ col: number; row: number } | null>(null)
  const [dragOver, setDragOver] = useState<{ col: number; row: number } | null>(null)
  const dragSourceRef = useRef<{ col: number; row: number } | null>(null)

  const startDrag = useCallback((col: number, row: number, _target: Element, _pointerId: number) => {
    dragSourceRef.current = { col, row }
    setDragSource({ col, row })
    setDragOver({ col, row })
  }, [])

  // While drag is active, listen for pointer movement at document level
  // and use elementFromPoint to find the cell under the finger.
  useEffect(() => {
    if (!dragSource) return

    const findCell = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      if (!el) return null
      const cell = el.closest('[data-cell-col]') as HTMLElement | null
      if (!cell) return null
      const col = parseInt(cell.dataset.cellCol || '', 10)
      const row = parseInt(cell.dataset.cellRow || '', 10)
      if (Number.isNaN(col) || Number.isNaN(row)) return null
      return { col, row }
    }

    const onMove = (e: PointerEvent) => {
      const cell = findCell(e.clientX, e.clientY)
      setDragOver(cell)
    }

    const finish = (e: PointerEvent) => {
      const cell = findCell(e.clientX, e.clientY)
      const src = dragSourceRef.current
      if (src && cell && (cell.col !== src.col || cell.row !== src.row)) {
        onSwap(src, cell)
      }
      dragSourceRef.current = null
      setDragSource(null)
      setDragOver(null)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
    }
  }, [dragSource, onSwap])

  return (
    <div className="flex-1 p-2 min-h-0 overflow-hidden">
      <div
        className="grid gap-1.5 h-full"
        style={{
          gridTemplateColumns: `repeat(${COLUMN_COUNT}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${ROWS_PER_COLUMN}, minmax(0, 1fr))`
        }}
      >
        {Array.from({ length: COLUMN_COUNT * ROWS_PER_COLUMN }, (_, i) => {
          const col = i % COLUMN_COUNT
          const row = Math.floor(i / COLUMN_COUNT)
          const sceneId = grid[col]?.[row] ?? null
          const cuelist = sceneId ? cuelistById.get(sceneId) ?? null : null
          const color = columns[col]?.color ?? '#888'
          const isSrc = dragSource?.col === col && dragSource?.row === row
          const isOver = dragSource !== null && dragOver?.col === col && dragOver?.row === row && !isSrc
          return (
            <SceneCell
              key={`${col}-${row}`}
              cuelist={cuelist}
              col={col}
              row={row}
              color={color}
              isDragSource={isSrc}
              isDragOver={isOver}
              onGo={() => cuelist && onGo(cuelist.id)}
              onStop={() => cuelist && onStop(cuelist.id)}
              onFader={(level) => cuelist && onFader(cuelist.id, level)}
              onLongPressStart={startDrag}
            />
          )
        })}
      </div>
    </div>
  )
}
