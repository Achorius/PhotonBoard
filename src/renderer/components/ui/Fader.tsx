// ============================================================
// Fader — vertical console fader.
//  - grab the cap: relative drag (no jump); touch the track: jump, then drag
//  - Shift or a second finger on the fader: fine (×0.2)
//  - double-tap / double-click: reset to `defaultValue`
//  - keyboard: ↑ ↓ (Shift ×10), PageUp/Down, Home/End
// Only this component re-renders while dragging.
// ============================================================

import { memo, useRef } from 'react'
import type React from 'react'
import { cn } from './cn'
import { usePointerDrag } from './usePointerDrag'
import { FINE_FACTOR, clampValue, sliderKeyValue, snapValue, useDoubleTap } from './value-control'

export interface FaderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Double-tap / double-click target */
  defaultValue?: number
  /** Custom double-tap action (instead of resetting to defaultValue) */
  onDoubleTap?: () => void
  /** Label under the fader (channel name, executor) */
  label?: React.ReactNode
  /** Level fill colour — use the channel-type colour */
  color?: string
  /** Readout above the track: 'percent' (default), 'dmx', a formatter, or false */
  readout?: 'percent' | 'dmx' | false | ((value: number) => string)
  /** Draw scale ticks (0/25/50/75/100) */
  ticks?: boolean
  disabled?: boolean
  onChangeStart?: () => void
  onChangeEnd?: () => void
  className?: string
  'aria-label'?: string
}

const TICKS = [0, 25, 50, 75, 100]

export const Fader = memo(function Fader({
  value,
  onChange,
  min = 0,
  max = 255,
  step = 1,
  defaultValue,
  onDoubleTap,
  label,
  color,
  readout = 'percent',
  ticks = true,
  disabled,
  onChangeStart,
  onChangeEnd,
  className,
  ...aria
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const capRef = useRef<HTMLDivElement>(null)
  const live = useRef(value)
  const range = max - min || 1
  const doubleTap = useDoubleTap(onDoubleTap ?? (defaultValue !== undefined ? () => onChange(defaultValue) : undefined))

  const emit = (v: number) => {
    live.current = clampValue(v, min, max)
    const next = snapValue(live.current, min, max, step)
    if (next !== value) onChange(next)
  }

  const drag = usePointerDrag({
    disabled,
    onStart: (s) => {
      if (doubleTap(s.event as React.PointerEvent)) return false
      onChangeStart?.()
      live.current = value
      const onCap = capRef.current?.contains(s.event.target as Node)
      if (!onCap && !s.fine) {
        const r = trackRef.current!.getBoundingClientRect()
        emit(min + clampValue(1 - (s.y - r.top) / r.height, 0, 1) * range)
      }
    },
    onMove: (s) => {
      const h = trackRef.current!.getBoundingClientRect().height || 1
      emit(live.current - (s.my / h) * range * (s.fine ? FINE_FACTOR : 1))
    },
    onEnd: () => onChangeEnd?.()
  })

  const ratio = clampValue((value - min) / range, 0, 1)
  const pct = ratio * 100
  const fill = color ?? 'rgb(var(--pb-accent))'
  const text = typeof readout === 'function'
    ? readout(value)
    : readout === 'dmx' ? String(Math.round(value)) : readout === 'percent' ? `${Math.round(pct)}` : null

  return (
    <div
      className={cn('flex h-full w-fader shrink-0 select-none flex-col items-center gap-1', disabled && 'pointer-events-none opacity-40', className)}
    >
      {text !== null && (
        <span className={cn('h-4 w-full text-center font-mono text-2xs leading-4 tabular', value > min ? 'text-fg-primary' : 'text-fg-tertiary')}>
          {text}
        </span>
      )}
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-orientation="vertical"
        aria-label={aria['aria-label'] ?? (typeof label === 'string' ? label : undefined)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${Math.round(pct)}%`}
        onKeyDown={(e) => {
          const v = sliderKeyValue(e, value, min, max, step)
          if (v === null) return
          e.preventDefault()
          if (v !== value) onChange(snapValue(v, min, max, step))
        }}
        {...drag}
        className="relative w-full min-h-[64px] flex-1 cursor-grab touch-none rounded-sm active:cursor-grabbing"
      >
        {/* Travel = track height minus the cap, so the cap never overflows */}
        <div ref={trackRef} className="absolute inset-x-0" style={{ top: 'calc(var(--pb-fader-cap-h) / 2)', bottom: 'calc(var(--pb-fader-cap-h) / 2)' }}>
          {ticks && TICKS.map((t) => (
            <span key={t} aria-hidden className="absolute left-0 h-px w-[22%] bg-line-strong" style={{ bottom: `${t}%` }} />
          ))}
          {ticks && TICKS.map((t) => (
            <span key={`r${t}`} aria-hidden className="absolute right-0 h-px w-[22%] bg-line-strong" style={{ bottom: `${t}%` }} />
          ))}
          <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 overflow-hidden rounded-full bg-surface-0 ring-1 ring-inset ring-line">
            <div className="absolute inset-x-0 bottom-0 rounded-full" style={{ height: `${pct}%`, backgroundColor: fill }} />
          </div>
          <div
            ref={capRef}
            aria-hidden
            className="absolute left-1/2 flex w-[calc(100%-2px)] -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-[3px] border border-line-strong bg-gradient-to-b from-surface-5 to-surface-4 shadow-[0_2px_4px_rgb(0_0_0/0.6)]"
            style={{ bottom: `${pct}%`, height: 'var(--pb-fader-cap-h)' }}
          >
            <span className="h-0.5 w-3/5 rounded-full" style={{ backgroundColor: value > min ? fill : 'rgb(var(--pb-fg-disabled))' }} />
          </div>
        </div>
      </div>
      {label !== undefined && label !== null && (
        <span className="w-full truncate text-center text-2xs leading-4 text-fg-tertiary" title={typeof label === 'string' ? label : undefined}>
          {label}
        </span>
      )}
    </div>
  )
})
