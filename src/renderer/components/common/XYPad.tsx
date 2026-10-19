// ============================================================
// XYPad — two-axis pad (pan / tilt). Pointer events with capture,
// pointercancel / lost capture handled (usePointerDrag).
//  - press: jump to the point, then follow
//  - `fine` (or Shift / a second finger): relative drag at 1/10 speed
//  - arrows nudge 1% (Shift 10%), Home centres
// Values are 0…max (255 by default, 65535 for 16-bit pan/tilt).
// ============================================================

import { memo, useRef } from 'react'
import { cn, usePointerDrag } from '../ui'
import { useSquareFit } from '../fixtures/useSquareFit'

export interface XYPadProps {
  /** Horizontal value 0…max (pan) */
  x: number
  /** Vertical value 0…max (tilt, up = max) */
  y: number
  onChange: (x: number, y: number) => void
  /** Square size in px (ignored with `fill`) */
  size?: number
  /** Stretch to the parent's size (stays square) */
  fill?: boolean
  label?: string
  /** Value range (default 255) */
  max?: number
  /** Relative, slowed-down drag */
  fine?: boolean
  /** Other positions to show (e.g. the other selected fixtures), same scale */
  markers?: { x: number; y: number }[]
  /** Text under the pad (default: "Pan:x Tilt:y") — false hides it */
  readout?: boolean | string
  onChangeStart?: () => void
  onChangeEnd?: () => void
  className?: string
}

const FINE = 0.1

export const XYPad = memo(function XYPad({
  x, y, onChange, size = 160, fill, label, max = 255, fine, markers, readout = true, onChangeStart, onChangeEnd, className
}: XYPadProps) {
  const padRef = useRef<HTMLDivElement>(null)
  const live = useRef({ x, y })
  const [fitRef, fitSize] = useSquareFit<HTMLDivElement>(!!fill)
  const px = fill ? fitSize ?? 0 : size

  const clamp = (v: number) => Math.max(0, Math.min(max, Math.round(v)))
  const emit = (nx: number, ny: number) => {
    live.current = { x: Math.max(0, Math.min(max, nx)), y: Math.max(0, Math.min(max, ny)) }
    const cx = clamp(live.current.x)
    const cy = clamp(live.current.y)
    if (cx !== x || cy !== y) onChange(cx, cy)
  }
  const fromPoint = (px: number, py: number) => {
    const r = padRef.current!.getBoundingClientRect()
    emit(((px - r.left) / r.width) * max, (1 - (py - r.top) / r.height) * max)
  }

  const drag = usePointerDrag({
    onStart: (s) => {
      onChangeStart?.()
      live.current = { x, y }
      if (!fine && !s.fine) fromPoint(s.x, s.y)
    },
    onMove: (s) => {
      if (fine || s.fine) {
        const r = padRef.current!.getBoundingClientRect()
        emit(live.current.x + (s.mx / r.width) * max * FINE, live.current.y - (s.my / r.height) * max * FINE)
      } else fromPoint(s.x, s.y)
    },
    onEnd: () => onChangeEnd?.()
  })

  const pct = (v: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`
  const pctY = (v: number) => `${(1 - Math.max(0, Math.min(max, v)) / max) * 100}%`
  const toPct = (v: number) => `${Math.round((v / max) * 1000) / 10}`
  const readoutText = typeof readout === 'string' ? readout : readout ? (max > 255 ? `Pan:${toPct(x)}% Tilt:${toPct(y)}%` : `Pan:${x} Tilt:${y}`) : null

  return (
    <div className={cn('flex flex-col items-center gap-1.5', fill && 'h-full w-full min-h-0 min-w-0', className)}>
      {label && <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{label}</span>}
      <div ref={fitRef} className={cn(fill && 'flex min-h-0 w-full flex-1 items-center justify-center')}>
        <div
          ref={padRef}
          role="group"
          tabIndex={0}
          aria-label={`${label ?? 'XY pad'}: ${toPct(x)}%, ${toPct(y)}%`}
          onKeyDown={(e) => {
            const step = (e.shiftKey ? 0.1 : 0.01) * max
            let nx = x
            let ny = y
            if (e.key === 'ArrowLeft') nx -= step
            else if (e.key === 'ArrowRight') nx += step
            else if (e.key === 'ArrowUp') ny += step
            else if (e.key === 'ArrowDown') ny -= step
            else if (e.key === 'Home') { nx = max / 2; ny = max / 2 }
            else return
            e.preventDefault()
            e.stopPropagation()
            onChange(clamp(nx), clamp(ny))
          }}
          {...drag}
          className={cn(
            'relative shrink-0 cursor-crosshair touch-none overflow-hidden rounded-lg bg-surface-0 ring-1 ring-inset ring-line-strong',
            fine && 'ring-accent/60',
            fill && !fitSize && 'invisible'
          )}
          style={{ width: px, height: px }}
        >
          {/* Grid: quarters + centre */}
          {[25, 75].map((p) => (
            <span key={`v${p}`} aria-hidden className="absolute inset-y-0 w-px bg-line-subtle" style={{ left: `${p}%` }} />
          ))}
          {[25, 75].map((p) => (
            <span key={`h${p}`} aria-hidden className="absolute inset-x-0 h-px bg-line-subtle" style={{ top: `${p}%` }} />
          ))}
          <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
          {/* Crosshair */}
          <span aria-hidden className="absolute inset-y-0 w-px bg-accent/40" style={{ left: pct(x) }} />
          <span aria-hidden className="absolute inset-x-0 h-px bg-accent/40" style={{ top: pctY(y) }} />
          {/* Other positions */}
          {markers?.map((m, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-secondary/70 ring-1 ring-surface-0"
              style={{ left: pct(m.x), top: pctY(m.y) }}
            />
          ))}
          {/* Handle */}
          <span
            aria-hidden
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_3px_rgb(var(--pb-accent)/0.25)] ring-2 ring-surface-0 [[data-density=touch]_&]:h-5 [[data-density=touch]_&]:w-5"
            style={{ left: pct(x), top: pctY(y) }}
          />
        </div>
      </div>
      {readoutText && <div className="font-mono text-2xs tabular text-fg-tertiary">{readoutText}</div>}
    </div>
  )
})
