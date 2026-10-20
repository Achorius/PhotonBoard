// ============================================================
// NumberField — numeric entry for times, levels, addresses, BPM.
//  - type a value (Enter / blur commits, Esc reverts)
//  - drag horizontally on the field to scrub (Shift / 2nd finger = fine)
//  - ↑ ↓ step (Shift ×10, Alt ×0.1), wheel steps while focused
//  - clamps to min/max, rounds to `step`
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { cn } from './cn'
import { FIELD_BASE, INPUT_SIZE, type InputSize } from './TextInput'
import { usePointerDrag } from './usePointerDrag'

export interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Decimals shown (default: from step) */
  precision?: number
  /** Unit suffix: "s", "%", "BPM", "°" */
  unit?: string
  /** Inline label before the number (e.g. "In", "Out", "Delay") — also the scrub handle */
  label?: string
  size?: InputSize
  disabled?: boolean
  /** Pixels per step while scrubbing (default 4) */
  scrubPixels?: number
  className?: string
  /** Id of the input — for `<Field>{(id) => <NumberField id={id} … />}</Field>` */
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** Fires on scrub start/end — e.g. to batch undo or hold remote sync */
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

const SCRUB_THRESHOLD = 3

function decimalsOf(step: number): number {
  const s = String(step)
  return s.includes('.') ? s.split('.')[1].length : 0
}

export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision,
  unit,
  label,
  size = 'md',
  disabled,
  scrubPixels = 4,
  className,
  id,
  onScrubStart,
  onScrubEnd,
  ...aria
}: NumberFieldProps) {
  const decimals = precision ?? decimalsOf(step)
  const format = (v: number) => (Number.isFinite(v) ? v.toFixed(decimals) : '')
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrub = useRef<{ start: number; scrubbing: boolean; acc: number } | null>(null)

  const clamp = (v: number) => {
    const snapped = Math.round(v / step) * step
    return Math.min(max, Math.max(min, Number(snapped.toFixed(Math.max(decimals, decimalsOf(step))))))
  }
  const commit = (raw: string) => {
    setDraft(null)
    const parsed = parseFloat(raw.replace(',', '.'))
    if (Number.isFinite(parsed)) {
      const v = clamp(parsed)
      if (v !== value) onChange(v)
    }
  }
  const nudge = (e: { shiftKey: boolean; altKey: boolean }, dir: number) => {
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const v = clamp(value + dir * step * mult)
    if (v !== value) onChange(v)
  }

  // Wheel only while focused (never hijack panel scrolling); needs a non-passive listener
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return
      e.preventDefault()
      nudge(e, e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const drag = usePointerDrag({
    disabled,
    onStart: () => {
      if (document.activeElement === inputRef.current) return false // typing: let the caret move
      scrub.current = { start: value, scrubbing: false, acc: 0 }
    },
    onMove: (s) => {
      const st = scrub.current
      if (!st) return
      if (!st.scrubbing) {
        if (Math.abs(s.dx) < SCRUB_THRESHOLD) return
        st.scrubbing = true
        onScrubStart?.()
      }
      st.acc += (s.mx / scrubPixels) * (s.fine ? 0.1 : 1)
      const v = clamp(st.start + st.acc * step)
      if (v !== value) onChange(v)
    },
    onEnd: (_s, canceled) => {
      const st = scrub.current
      scrub.current = null
      if (st?.scrubbing) onScrubEnd?.()
      else if (!canceled && st) {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
  })

  const focused = draft !== null
  return (
    <div
      {...(focused ? null : drag)}
      className={cn(
        'flex min-w-0 items-center gap-1.5 px-2',
        FIELD_BASE,
        'border-line-strong',
        INPUT_SIZE[size],
        !focused && !disabled && 'cursor-ew-resize touch-none',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {label && <span className="shrink-0 text-xs text-fg-tertiary">{label}</span>}
      <input
        ref={inputRef}
        id={id}
        inputMode="decimal"
        aria-label={aria['aria-label'] ?? (id ? undefined : label)}
        aria-describedby={aria['aria-describedby']}
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        disabled={disabled}
        value={draft ?? format(value)}
        onFocus={() => setDraft(format(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur() }
          else if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); e.currentTarget.blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            setDraft(null)
            nudge(e, e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        className={cn('h-full w-full min-w-0 flex-1 bg-transparent text-right font-mono tabular outline-none', !focused && 'pointer-events-none')}
      />
      {unit && <span className="shrink-0 text-xs text-fg-tertiary">{unit}</span>}
    </div>
  )
}
