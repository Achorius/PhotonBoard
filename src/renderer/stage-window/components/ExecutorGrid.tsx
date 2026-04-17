import React, { useCallback, useRef } from 'react'

interface CuelistInfo {
  id: string
  name: string
  isPlaying: boolean
  faderLevel: number
  currentCueIndex: number
  cueCount: number
}

interface Props {
  cuelists: CuelistInfo[]
  onGo: (id: string) => void
  onStop: (id: string) => void
  onFader: (id: string, level: number) => void
}

function SceneCell({ cuelist, onGo, onStop, onFader }: {
  cuelist: CuelistInfo
  onGo: () => void
  onStop: () => void
  onFader: (level: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const handleFaderPointer = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    onFader(Math.round(y * 255))
  }, [onFader])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handleFaderPointer(e)
  }, [handleFaderPointer])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) handleFaderPointer(e)
  }, [handleFaderPointer])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  const pct = Math.round((cuelist.faderLevel / 255) * 100)
  const isActive = cuelist.isPlaying

  return (
    <div className={`flex flex-col rounded-md overflow-hidden border transition-all min-h-0 ${
      isActive
        ? 'border-green-500/60 bg-surface-2 shadow-[0_0_10px_rgba(34,197,94,0.15)]'
        : 'border-surface-3 bg-surface-1'
    }`}>
      {/* Scene name */}
      <div className="px-1 py-1 text-center border-b border-surface-3 shrink-0">
        <div className={`text-[11px] font-bold truncate leading-tight ${isActive ? 'text-white' : 'text-gray-400'}`}>
          {cuelist.name}
        </div>
        {cuelist.cueCount > 1 && (
          <div className="text-[8px] text-gray-600 leading-none">
            {cuelist.currentCueIndex + 1}/{cuelist.cueCount}
          </div>
        )}
      </div>

      {/* Fader */}
      <div className="flex-1 flex items-stretch px-1 py-1 min-h-0">
        <div
          ref={trackRef}
          className="w-6 mx-auto rounded relative cursor-pointer overflow-hidden touch-none"
          style={{ background: '#0f0f18', border: '1px solid #333' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
            style={{
              height: `${pct}%`,
              background: isActive
                ? 'linear-gradient(to top, #22c55e, #4ade80)'
                : 'linear-gradient(to top, #555, #777)'
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white/80 font-mono drop-shadow">{pct}</span>
          </div>
        </div>
      </div>

      {/* GO / STOP button */}
      <button
        className={`shrink-0 py-1.5 mx-1 mb-1 rounded text-[11px] font-black uppercase tracking-wide transition-all active:scale-95 ${
          isActive
            ? 'bg-red-600/80 text-white hover:bg-red-500'
            : 'bg-green-600/80 text-white hover:bg-green-500'
        }`}
        onClick={() => isActive ? onStop() : onGo()}
      >
        {isActive ? 'STOP' : 'GO'}
      </button>
    </div>
  )
}

function EmptyCell() {
  return (
    <div className="rounded-md border border-surface-3/30 border-dashed bg-surface-0/50" />
  )
}

// Match main app's ExecutorBar layout: 8 columns × 4 rows = 32 scenes
const COLUMN_COUNT = 8
const ROWS_PER_COLUMN = 4

export function ExecutorGrid({ cuelists, onGo, onStop, onFader }: Props) {
  const cols = COLUMN_COUNT
  const rows = ROWS_PER_COLUMN
  const totalSlots = cols * rows

  return (
    <div className="flex-1 p-2 min-h-0 overflow-hidden">
      <div
        className="grid gap-1.5 h-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
        }}
      >
        {Array.from({ length: totalSlots }, (_, i) => {
          const cuelist = cuelists[i]
          if (!cuelist) return <EmptyCell key={i} />
          return (
            <SceneCell
              key={cuelist.id}
              cuelist={cuelist}
              onGo={() => onGo(cuelist.id)}
              onStop={() => onStop(cuelist.id)}
              onFader={(level) => onFader(cuelist.id, level)}
            />
          )
        })}
      </div>
    </div>
  )
}
