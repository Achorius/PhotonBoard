import React, { useCallback, useRef } from 'react'

interface FaderProps {
  value: number // 0-255
  onChange: (value: number) => void
  label?: string
  color?: string
  vertical?: boolean
  size?: 'sm' | 'md' | 'lg'
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
  size = 'md',
  showValue = true,
  onDoubleClick,
  className = ''
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const heights = { sm: 80, md: 120, lg: 180 }
  const widths = { sm: 28, md: 36, lg: 44 }
  const height = vertical ? heights[size] : 24
  const width = vertical ? widths[size] : heights[size]

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    updateValue(e)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    updateValue(e)
  }, [])

  const handlePointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const updateValue = useCallback((e: React.PointerEvent) => {
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
    onChange(Math.round(ratio * 255))
  }, [vertical, onChange])

  const percent = (value / 255) * 100
  const displayValue = Math.round(percent)

  return (
    <div
      className={`flex ${vertical ? 'flex-col items-center gap-1' : 'flex-row items-center gap-2'} ${className}`}
      onDoubleClick={onDoubleClick}
    >
      {showValue && (
        <span className="text-[10px] font-mono text-gray-400 w-8 text-center tabular-nums">
          {displayValue}%
        </span>
      )}
      <div
        ref={trackRef}
        className="relative rounded-full cursor-pointer"
        style={{
          width: vertical ? 6 : width,
          height: vertical ? height : 6,
          backgroundColor: '#1a1a25'
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
            width: vertical ? widths[size] - 4 : 10,
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
        <span className="text-[9px] text-gray-500 text-center w-full truncate">
          {label}
        </span>
      )}
    </div>
  )
}
