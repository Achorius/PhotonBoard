// ============================================================
// Slider — horizontal continuous control (levels, speed, size).
// Tap/click jumps to the position, drag follows; Shift or a second
// finger = fine. Double-tap resets to `defaultValue`.
// ============================================================

import { memo, useRef } from 'react'
import type React from 'react'
import { cn } from './cn'
import { usePointerDrag } from './usePointerDrag'
import { FINE_FACTOR, clampValue, sliderKeyValue, snapValue, useDoubleTap } from './value-control'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Double-tap / double-click resets to this */
  defaultValue?: number
  /** Custom double-tap action (instead of resetting to defaultValue) */
  onDoubleTap?: () => void
  /** Fill colour (CSS colour). Default: accent */
  color?: string
  /** Fill from the centre (bipolar values: pan offset, fan) */
  bipolar?: boolean
  /** Readout after the track; true = default % / value format */
  showValue?: boolean | ((value: number) => string)
  disabled?: boolean
  onChangeStart?: () => void
  onChangeEnd?: () => void
  className?: string
  'aria-label'?: string
}

export const Slider = memo(function Slider({
  value,
  onChange,
  min = 0,
  max = 255,
  step = 1,
  defaultValue,
  onDoubleTap,
  color,
  bipolar,
  showValue,
  disabled,
  onChangeStart,
  onChangeEnd,
  className,
  ...aria
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const live = useRef(value)
  const range = max - min || 1
  const doubleTap = useDoubleTap(onDoubleTap ?? (defaultValue !== undefined ? () => onChange(defaultValue) : undefined))

  const emit = (v: number) => {
    const next = snapValue(v, min, max, step)
    live.current = v
    if (next !== value) onChange(next)
  }
  const fromX = (x: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return min + clampValue((x - r.left) / r.width, 0, 1) * range
  }

  const drag = usePointerDrag({
    disabled,
    onStart: (s) => {
      if (doubleTap(s.event as React.PointerEvent)) return false
      onChangeStart?.()
      live.current = value
      if (!s.fine) emit(fromX(s.x))
    },
    onMove: (s) => {
      if (s.fine) {
        const w = trackRef.current!.getBoundingClientRect().width
        emit(clampValue(live.current + (s.mx / w) * range * FINE_FACTOR, min, max))
      } else emit(fromX(s.x))
    },
    onEnd: () => onChangeEnd?.()
  })

  const pct = clampValue((value - min) / range, 0, 1) * 100
  const fillColor = color ?? 'rgb(var(--pb-accent))'
  const formatted = typeof showValue === 'function' ? showValue(value) : showValue ? (max === 255 && min === 0 ? `${Math.round(pct)}%` : String(value)) : null

  return (
    <div className={cn('flex min-w-0 items-center gap-2', disabled && 'pointer-events-none opacity-40', className)}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria['aria-label']}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatted ?? undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          const v = sliderKeyValue(e, value, min, max, step)
          if (v === null) return
          e.preventDefault()
          if (v !== value) onChange(snapValue(v, min, max, step))
        }}
        {...drag}
        className="group relative flex h-control-sm min-w-[48px] flex-1 cursor-pointer touch-none items-center rounded-sm focus-visible:outline-offset-0"
      >
        <div ref={trackRef} className="relative h-1 w-full rounded-full bg-surface-0 ring-1 ring-inset ring-line [[data-density=touch]_&]:h-1.5">
          <div
            className="absolute inset-y-0 rounded-full"
            style={{
              left: bipolar ? `${Math.min(pct, 50)}%` : 0,
              width: bipolar ? `${Math.abs(pct - 50)}%` : `${pct}%`,
              backgroundColor: fillColor
            }}
          />
        </div>
        <div
          className="pointer-events-none absolute top-1/2 rounded-full border-2 border-surface-0 shadow-[0_1px_3px_rgb(0_0_0/0.6)] transition-transform duration-fast group-active:scale-110"
          style={{
            width: 'var(--pb-slider-thumb)',
            height: 'var(--pb-slider-thumb)',
            left: `calc(${pct}% - var(--pb-slider-thumb) / 2)`,
            transform: 'translateY(-50%)',
            backgroundColor: fillColor === 'rgb(var(--pb-accent))' ? 'rgb(var(--pb-fg-primary))' : fillColor
          }}
        />
      </div>
      {formatted !== null && <span className="w-10 shrink-0 text-right font-mono text-2xs tabular text-fg-secondary">{formatted}</span>}
    </div>
  )
})
