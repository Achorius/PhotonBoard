// ============================================================
// Encoder — rotary knob for endless-feeling parameters (pan/tilt
// fine, speed, phase). Drag up/down to turn (Shift / 2nd finger =
// fine), wheel while focused, arrows, double-tap resets.
// ============================================================

import { memo, useEffect, useRef } from 'react'
import { cn } from './cn'
import { usePointerDrag } from './usePointerDrag'
import { FINE_FACTOR, clampValue, sliderKeyValue, snapValue, useDoubleTap } from './value-control'
import type React from 'react'

export interface EncoderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  defaultValue?: number
  label?: React.ReactNode
  /** Readout under the knob */
  format?: (value: number) => string
  color?: string
  /** px of vertical drag for the full range (default 200) */
  sensitivity?: number
  size?: number
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

const SWEEP = 270
const START = 135 // degrees from +x axis, clockwise (SVG)

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
  const [x1, y1] = p(from)
  const [x2, y2] = p(to)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

export const Encoder = memo(function Encoder({
  value,
  onChange,
  min = 0,
  max = 255,
  step = 1,
  defaultValue,
  label,
  format,
  color,
  sensitivity = 200,
  size = 44,
  disabled,
  className,
  ...aria
}: EncoderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef(value)
  const range = max - min || 1
  const doubleTap = useDoubleTap(defaultValue !== undefined ? () => onChange(defaultValue) : undefined)

  const emit = (v: number) => {
    live.current = clampValue(v, min, max)
    const next = snapValue(live.current, min, max, step)
    if (next !== value) onChange(next)
  }

  const drag = usePointerDrag({
    disabled,
    onStart: (s) => {
      if (doubleTap(s.event as React.PointerEvent)) return false
      live.current = value
      ref.current?.focus()
    },
    onMove: (s) => emit(live.current - (s.my / sensitivity) * range * (s.fine ? FINE_FACTOR : 1))
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return
      e.preventDefault()
      emit(value + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 10 : 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const ratio = clampValue((value - min) / range, 0, 1)
  const angle = START + ratio * SWEEP
  const c = size / 2
  const r = c - 4
  const fill = color ?? 'rgb(var(--pb-accent))'

  return (
    <div className={cn('flex shrink-0 select-none flex-col items-center gap-1', disabled && 'pointer-events-none opacity-40', className)}>
      <div
        ref={ref}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria['aria-label'] ?? (typeof label === 'string' ? label : undefined)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format?.(value)}
        onKeyDown={(e) => {
          const v = sliderKeyValue(e, value, min, max, step)
          if (v === null) return
          e.preventDefault()
          emit(v)
        }}
        {...drag}
        className="cursor-ns-resize touch-none rounded-full"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} aria-hidden>
          <path d={arc(c, c, r, START, START + SWEEP)} stroke="rgb(var(--pb-surface-0))" strokeWidth={4} fill="none" strokeLinecap="round" />
          {ratio > 0 && <path d={arc(c, c, r, START, angle)} stroke={fill} strokeWidth={4} fill="none" strokeLinecap="round" />}
          <circle cx={c} cy={c} r={r - 6} fill="rgb(var(--pb-surface-4))" stroke="rgb(var(--pb-line-strong))" />
          <line
            x1={c + (r - 14) * Math.cos((angle * Math.PI) / 180)}
            y1={c + (r - 14) * Math.sin((angle * Math.PI) / 180)}
            x2={c + (r - 7) * Math.cos((angle * Math.PI) / 180)}
            y2={c + (r - 7) * Math.sin((angle * Math.PI) / 180)}
            stroke="rgb(var(--pb-fg-primary))"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      {format && <span className="font-mono text-2xs tabular text-fg-secondary">{format(value)}</span>}
      {label !== undefined && <span className="max-w-[64px] truncate text-2xs text-fg-tertiary">{label}</span>}
    </div>
  )
})
