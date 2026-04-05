import React, { useCallback, useRef } from 'react'

// Uniform fader width used everywhere — single source of truth
export const FADER_WIDTH = 28
export const FADER_GAP = 6

interface FaderProps {
  value: number // 0-255
  onChange: (value: number) => void
  label?: string
  color?: string
  vertical?: boolean
  showValue?: boolean
  onDoubleClick?: () => void
  className?: string
}

export function Fader({
  value,
  onChange,
  label,
  color = '#e85d04',
  vertical = true,
  showValue = true,
  onDoubleClick,
  className = ''
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const computeValue = useCallback((e: React.PointerEvent) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()

    let ratio: number
    if (vertical) {
      ratio = 1 - (e.clientY - rect.top) / rect.height
    } else {
      ratio = (e.clientX - rect.left) / rect.width
    }
    ratio = Math.max(0, Math.min(1, ratio))
    onChangeRef.current(Math.round(ratio * 255))
  }, [vertical])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    computeValue(e)
  }, [computeValue])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    computeValue(e)
  }, [computeValue])

  const handlePointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const percent = (value / 255) * 100
  const displayValue = Math.round(percent)

  return (
    <div
      className={`flex ${vertical ? 'flex-col items-center gap-1' : 'flex-row items-center gap-2'} ${vertical ? 'h-full' : ''} ${className}`}
      style={{ width: vertical ? FADER_WIDTH : undefined }}
      onDoubleClick={onDoubleClick}
    >
      {showValue && (
        <span className="text-[10px] font-mono text-gray-400 text-center tabular-nums shrink-0" style={{ width: FADER_WIDTH }}>
          {displayValue}%
        </span>
      )}
      <div
        ref={trackRef}
        className={`relative rounded-full cursor-pointer ${vertical ? 'flex-1 min-h-[60px]' : ''}`}
        style={{
          width: vertical ? 6 : 180,
          ...(vertical ? {} : { height: 6 }),
          backgroundColor: '#0d0d14'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Fill */}
        <div
          className="absolute rounded-full transition-none"
          style={vertical ? {
            bottom: 0,
            left: 0,
            right: 0,
            height: `${percent}%`,
            backgroundColor: color,
            opacity: 0.6
          } : {
            left: 0,
            top: 0,
            bottom: 0,
            width: `${percent}%`,
            backgroundColor: color,
            opacity: 0.6
          }}
        />
        {/* Thumb */}
        <div
          className="absolute rounded-sm shadow-lg transition-none"
          style={vertical ? {
            bottom: `calc(${percent}% - 5px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: FADER_WIDTH - 4,
            height: 10,
            backgroundColor: color,
            border: '1px solid rgba(255,255,255,0.3)'
          } : {
            left: `calc(${percent}% - 5px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 10,
            height: 20,
            backgroundColor: color,
            border: '1px solid rgba(255,255,255,0.3)'
          }}
        />
      </div>
      {label && (
        <span className="text-[9px] text-gray-500 text-center truncate shrink-0" style={{ width: FADER_WIDTH }}>
          {label}
        </span>
      )}
    </div>
  )
}
