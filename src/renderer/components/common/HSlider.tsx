import React, { useCallback, useRef } from 'react'

interface HSliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  color?: string
  className?: string
}

/**
 * Horizontal slider built with divs (no native <input type="range">).
 * Works reliably in Electron without webkit pseudo-element issues.
 */
export function HSlider({
  value,
  onChange,
  min = 0,
  max = 255,
  step = 1,
  color = '#e85d04',
  className = ''
}: HSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const range = max - min

  const computeValue = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    let ratio = (clientX - rect.left) / rect.width
    ratio = Math.max(0, Math.min(1, ratio))
    let val = min + ratio * range
    // Snap to step
    if (step >= 1) {
      val = Math.round(val / step) * step
    } else {
      val = Math.round(val / step) * step
      val = parseFloat(val.toFixed(10)) // avoid floating point drift
    }
    val = Math.max(min, Math.min(max, val))
    onChangeRef.current(val)
  }, [min, range, max, step])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    computeValue(e.clientX)
  }, [computeValue])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    computeValue(e.clientX)
  }, [computeValue])

  const handlePointerUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const percent = range > 0 ? ((value - min) / range) * 100 : 0

  return (
    <div
      ref={trackRef}
      className={`relative rounded-full cursor-pointer ${className}`}
      style={{ height: 6, backgroundColor: '#3a3a4a' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Fill */}
      <div
        className="absolute rounded-full left-0 top-0 bottom-0"
        style={{
          width: `${percent}%`,
          backgroundColor: color,
          opacity: 0.6
        }}
      />
      {/* Thumb */}
      <div
        className="absolute rounded-full shadow-lg"
        style={{
          left: `calc(${percent}% - 6px)`,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 12,
          height: 12,
          backgroundColor: color,
          border: '1px solid rgba(255,255,255,0.3)'
        }}
      />
    </div>
  )
}
