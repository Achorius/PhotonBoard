import React, { useCallback, useRef } from 'react'

interface Props {
  value: number
  onChange: (value: number) => void
}

export function GrandMasterFader({ value, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const handlePointer = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    onChange(Math.round(y * 255))
  }, [onChange])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    handlePointer(e)
  }, [handlePointer])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) handlePointer(e)
  }, [handlePointer])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  const pct = Math.round((value / 255) * 100)
  const fillHeight = `${pct}%`

  return (
    <div className="flex-1 flex flex-col items-center px-2 py-3 min-h-0">
      <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-2">GM</span>

      {/* Fader track */}
      <div
        ref={trackRef}
        className="w-16 flex-1 rounded-lg relative cursor-pointer overflow-hidden"
        style={{ background: '#1a1a25', border: '2px solid #333' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Fill */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-b-md transition-[height] duration-75"
          style={{
            height: fillHeight,
            background: `linear-gradient(to top, #e85d04, #f48c06)`,
            boxShadow: pct > 0 ? '0 0 20px rgba(232, 93, 4, 0.4)' : 'none'
          }}
        />

        {/* Thumb line */}
        <div
          className="absolute left-1 right-1 h-1 rounded-full bg-white shadow-lg"
          style={{ bottom: `calc(${fillHeight} - 2px)` }}
        />

        {/* Value overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-black text-white drop-shadow-lg font-mono">{pct}</span>
        </div>
      </div>

      <span className="text-xs text-gray-500 mt-1">%</span>
    </div>
  )
}
