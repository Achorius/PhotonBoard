import React, { useCallback, useRef, useState } from 'react'

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
  draggingActive: boolean
  onGo: () => void
  onStop: () => void
  onFader: (level: number) => void
  onLongPressStart: () => void
  onPointerEnter: () => void
  onDrop: () => void
  onCancelDrag: () => void
}

function SceneCell({
  cuelist, color, isDragSource, isDragOver, draggingActive,
  onGo, onStop, onFader, onLongPressStart, onPointerEnter, onDrop, onCancelDrag
}: CellProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const downPos = useRef<{ x: number; y: number } | null>(null)

  const handleFaderPointer = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    onFader(Math.round(y * 255))
  }, [onFader])

  const onFaderDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handleFaderPointer(e)
  }, [handleFaderPointer])

  const onFaderMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) handleFaderPointer(e)
  }, [handleFaderPointer])

  const onFaderUp = useCallback(() => {
    dragging.current = false
  }, [])

  // Cell-wide pointer handlers for long-press drag detection
  const onCellPointerDown = useCallback((e: React.PointerEvent) => {
    if (!cuelist) return
    longPressFired.current = false
    downPos.current = { x: e.clientX, y: e.clientY }
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      onLongPressStart()
    }, LONG_PRESS_MS)
  }, [cuelist, onLongPressStart])

  const onCellPointerMove = useCallback((e: React.PointerEvent) => {
    // Cancel pending long-press if user moves significantly before threshold
    if (!longPressFired.current && downPos.current && longPressTimer.current) {
      const dx = e.clientX - downPos.current.x
      const dy = e.clientY - downPos.current.y
      if (Math.hypot(dx, dy) > 8) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
    // While dragging is active globally, reporting hovered cell
    if (draggingActive) onPointerEnter()
  }, [draggingActive, onPointerEnter])

  const onCellPointerUp = useCallback(() => {
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

  const onCellPointerCancel = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressFired.current = false
    if (draggingActive) onCancelDrag()
    downPos.current = null
  }, [draggingActive, onCancelDrag])

  // Empty cell — still a drop target while dragging
  if (!cuelist) {
    return (
      <div
        className={`rounded-md border border-dashed transition-colors ${
          isDragOver ? '' : 'bg-surface-0/50'
        }`}
        style={{
          borderColor: isDragOver ? color + 'aa' : color + '30',
          backgroundColor: isDragOver ? color + '20' : undefined
        }}
        onPointerEnter={() => { if (draggingActive) onPointerEnter() }}
        onPointerUp={onCellPointerUp}
      />
    )
  }

  const pct = Math.round((cuelist.faderLevel / 255) * 100)
  const isActive = cuelist.isPlaying

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
        '--tw-ring-color': color
      }}
      onPointerDown={onCellPointerDown}
      onPointerMove={onCellPointerMove}
      onPointerUp={onCellPointerUp}
      onPointerCancel={onCellPointerCancel}
      onPointerEnter={() => { if (draggingActive) onPointerEnter() }}
    >
      {/* Scene name */}
      <div
        className="px-1 py-1 text-center border-b shrink-0"
        style={{ borderColor: color + '40' }}
      >
        <div
          className="text-[11px] font-bold truncate leading-tight"
          style={{ color: isActive ? '#fff' : color + 'dd' }}
        >
          {cuelist.name}
        </div>
        {cuelist.cueCount > 1 && (
          <div className="text-[8px] text-gray-500 leading-none">
            {cuelist.currentCueIndex + 1}/{cuelist.cueCount}
          </div>
        )}
      </div>

      {/* Fader */}
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
            style={{
              height: `${pct}%`,
              background: `linear-gradient(to top, ${color}, ${color}cc)`
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white/85 font-mono drop-shadow">{pct}</span>
          </div>
        </div>
      </div>

      {/* GO / STOP button */}
      <button
        className="shrink-0 py-1.5 mx-1 mb-1 rounded text-[11px] font-black uppercase tracking-wide transition-all active:scale-95 text-white"
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

export function ExecutorGrid({ cuelists, grid, columns, onGo, onStop, onFader, onSwap }: Props) {
  const cuelistById = new Map(cuelists.map(cl => [cl.id, cl]))
  const [dragSource, setDragSource] = useState<{ col: number; row: number } | null>(null)
  const [dragOver, setDragOver] = useState<{ col: number; row: number } | null>(null)

  const handleLongPressStart = useCallback((col: number, row: number) => {
    setDragSource({ col, row })
    setDragOver({ col, row })
  }, [])

  const handleDrop = useCallback((col: number, row: number) => {
    if (dragSource) onSwap(dragSource, { col, row })
    setDragSource(null)
    setDragOver(null)
  }, [dragSource, onSwap])

  const cancelDrag = useCallback(() => {
    setDragSource(null)
    setDragOver(null)
  }, [])

  return (
    <div
      className="flex-1 p-2 min-h-0 overflow-hidden"
      onPointerLeave={cancelDrag}
    >
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
              draggingActive={dragSource !== null}
              onGo={() => cuelist && onGo(cuelist.id)}
              onStop={() => cuelist && onStop(cuelist.id)}
              onFader={(level) => cuelist && onFader(cuelist.id, level)}
              onLongPressStart={() => handleLongPressStart(col, row)}
              onPointerEnter={() => setDragOver({ col, row })}
              onDrop={() => handleDrop(col, row)}
              onCancelDrag={cancelDrag}
            />
          )
        })}
      </div>
    </div>
  )
}
