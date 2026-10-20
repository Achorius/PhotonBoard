// ============================================================
// Hue / saturation wheel: hue around (red at the top, clockwise),
// saturation from the centre (white) to the rim. Pointer capture with
// cancel handling (usePointerDrag); Shift / second finger = fine.
// ============================================================

import { memo, useRef } from 'react'
import { cn, formatPercent, usePointerDrag } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { useSquareFit } from '@renderer/hooks/useSquareFit'

export interface ColourWheelProps {
  /** 0…360 */
  hue: number
  /** 0…1 */
  sat: number
  /** Brightness 0…1 — darkens the wheel to preview it (default 1) */
  value?: number
  onChange: (hue: number, sat: number) => void
  /** px; omit with `fill` */
  size?: number
  fill?: boolean
  /** Other colours to show (hue/sat), e.g. the other selected fixtures */
  markers?: { hue: number; sat: number }[]
  onChangeStart?: () => void
  onChangeEnd?: () => void
  className?: string
  'aria-label'?: string
}

const WHEEL_BG = [
  'radial-gradient(closest-side, rgb(255 255 255), rgb(255 255 255 / 0))',
  'conic-gradient(from 0deg, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))'
].join(', ')

export const ColourWheel = memo(function ColourWheel({
  hue, sat, value = 1, onChange, size = 200, fill, markers, onChangeStart, onChangeEnd, className, ...aria
}: ColourWheelProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef({ hue, sat })
  const [fitRef, fitSize] = useSquareFit<HTMLDivElement>(!!fill)
  const px = fill ? fitSize ?? 0 : size

  const fromPoint = (px: number, py: number, fine: boolean) => {
    const r = ref.current!.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const radius = r.width / 2
    let h = (Math.atan2(px - cx, -(py - cy)) * 180) / Math.PI
    if (h < 0) h += 360
    let s = Math.min(1, Math.hypot(px - cx, py - cy) / radius)
    if (fine) {
      // Precision: move a tenth of the way towards the pointer
      const dh = ((h - live.current.hue + 540) % 360) - 180
      h = (live.current.hue + dh * 0.1 + 360) % 360
      s = live.current.sat + (s - live.current.sat) * 0.1
    }
    live.current = { hue: h, sat: s }
    onChange(Math.round(h * 10) / 10, Math.round(s * 1000) / 1000)
  }

  const drag = usePointerDrag({
    onStart: (s) => {
      onChangeStart?.()
      live.current = { hue, sat }
      fromPoint(s.x, s.y, s.fine)
    },
    onMove: (s) => fromPoint(s.x, s.y, s.fine),
    onEnd: () => onChangeEnd?.()
  })

  const pos = (h: number, s: number) => {
    const a = (h * Math.PI) / 180
    return { left: `${50 + Math.sin(a) * s * 50}%`, top: `${50 - Math.cos(a) * s * 50}%` }
  }

  return (
    <div ref={fitRef} className={cn(fill && 'flex h-full w-full min-h-0 min-w-0 items-center justify-center', className)}>
      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label={aria['aria-label'] ?? t('fixtures.colour.wheelValueAria', { hue: Math.round(hue), sat: formatPercent(sat, 1) })}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 2
          if (e.key === 'ArrowLeft') onChange((hue - step + 360) % 360, sat)
          else if (e.key === 'ArrowRight') onChange((hue + step) % 360, sat)
          else if (e.key === 'ArrowUp') onChange(hue, Math.min(1, sat + step / 100))
          else if (e.key === 'ArrowDown') onChange(hue, Math.max(0, sat - step / 100))
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
        {...drag}
        className={cn('relative shrink-0 cursor-crosshair touch-none rounded-full ring-1 ring-line-strong', fill && !fitSize && 'invisible')}
        style={{ width: px, height: px, backgroundImage: WHEEL_BG }}
      >
        {value < 1 && (
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-surface-0" style={{ opacity: Math.min(0.85, 1 - value) }} />
        )}
        {markers?.map((m, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-surface-0 bg-fg-primary/70"
            style={pos(m.hue, m.sat)}
          />
        ))}
        <span
          aria-hidden
          className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-fg-primary shadow-[0_0_0_1px_rgb(0_0_0/0.6),0_2px_6px_rgb(0_0_0/0.5)] [[data-density=touch]_&]:h-6 [[data-density=touch]_&]:w-6"
          style={{ ...pos(hue, sat), backgroundColor: `hsl(${hue} 100% ${100 - sat * 50}%)` }}
        />
      </div>
    </div>
  )
})
