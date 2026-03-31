import React, { useCallback, useRef } from 'react'

interface XYPadProps {
  x: number // 0-255 (Pan)
  y: number // 0-255 (Tilt)
  onChange: (x: number, y: number) => void
  size?: number
  label?: string
}

export function XYPad({ x, y, onChange, size = 160, label }: XYPadProps) {
  const padRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const updatePosition = useCallback((e: React.PointerEvent) => {
    const pad = padRef.current
    if (!pad) return
    const rect = pad.getBoundingClientRect()
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const py = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
    onChange(Math.round(px * 255), Math.round(py * 255))
  }, [onChange])

  const pxPercent = (x / 255) * 100
  const pyPercent = (1 - y / 255) * 100

  return (
    <div className="flex flex-col items-center gap-1">
      {label && <span className="text-[10px] text-gray-500">{label}</span>}
      <div
        ref={padRef}
        className="relative bg-surface-2 border border-surface-4 rounded cursor-crosshair"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          isDragging.current = true
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          updatePosition(e)
        }}
        onPointerMove={(e) => { if (isDragging.current) updatePosition(e) }}
        onPointerUp={() => { isDragging.current = false }}
      >
        {/* Grid lines */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-400" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-400" />
        </div>
        {/* Crosshair */}
        <div
          className="absolute w-px bg-accent/40"
          style={{ left: `${pxPercent}%`, top: 0, bottom: 0 }}
        />
        <div
          className="absolute h-px bg-accent/40"
          style={{ top: `${pyPercent}%`, left: 0, right: 0 }}
        />
        {/* Dot */}
        <div
          className="absolute w-3 h-3 rounded-full bg-accent border-2 border-white/50 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pxPercent}%`, top: `${pyPercent}%` }}
        />
      </div>
      <div className="text-[10px] font-mono text-gray-400">
        Pan:{x} Tilt:{y}
      </div>
    </div>
  )
}
