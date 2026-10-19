import { useRef } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from './cn'
import { StatusDot } from './StatusDot'
import type { ItemDomProps } from './Tabs'
import type { Tone } from './tokens'
import { Tooltip } from './Tooltip'

export interface SegmentedItem<T extends string | number> extends ItemDomProps {
  value: T
  label?: React.ReactNode
  icon?: IconType
  /** Accessible name / tooltip (required for icon-only items) */
  title?: string
  /** Count shown after the label */
  badge?: React.ReactNode
  /** Small status dot after the label (true = accent) */
  dot?: Tone | boolean
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string | number> {
  items: SegmentedItem<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'xs' | 'sm' | 'md'
  /** Stretch to the container, items share the width (labels truncate) */
  fullWidth?: boolean
  /** Tighter item padding for narrow panels */
  compact?: boolean
  className?: string
  'aria-label'?: string
}

const SIZE = {
  xs: 'h-control-xs text-2xs',
  sm: 'h-control-sm text-xs',
  md: 'h-control text-sm'
}

/** Mutually exclusive choice (radio group): universe filter, view mode, units… Arrow keys move. */
export function SegmentedControl<T extends string | number>({ items, value, onChange, size = 'sm', fullWidth, compact, className, ...aria }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    for (let i = 1; i <= items.length; i++) {
      const next = (index + dir * i + items.length) % items.length
      if (!items[next].disabled) {
        onChange(items[next].value)
        refs.current[next]?.focus()
        return
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={cn('inline-flex shrink-0 items-stretch gap-0.5 rounded bg-surface-0 p-0.5 ring-1 ring-inset ring-line', fullWidth && 'flex w-full', className)}
    >
      {items.map((item, i) => {
        const { value: itemValue, label, icon: Icon, title, badge, dot, disabled, ...attrs } = item
        const selected = itemValue === value
        const btn = (
          <button
            {...attrs}
            key={String(itemValue)}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={title ?? attrs['aria-label']}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(itemValue)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2.5 font-medium transition-colors duration-fast disabled:opacity-40',
              SIZE[size],
              compact && 'gap-1 px-1.5',
              fullWidth && 'flex-1',
              selected ? 'bg-surface-4 text-fg-primary shadow-raised' : 'text-fg-tertiary hover:text-fg-primary hover:bg-surface-2'
            )}
          >
            {Icon && <Icon size={size === 'md' ? 16 : 14} aria-hidden className="shrink-0" />}
            {label !== undefined && <span className="truncate">{label}</span>}
            {badge !== undefined && badge !== null && (
              <span className={cn('shrink-0 rounded-full bg-surface-4 text-2xs tabular text-fg-secondary', compact ? 'px-1' : 'px-1.5')}>{badge}</span>
            )}
            {dot && <StatusDot tone={dot === true ? 'accent' : dot} />}
          </button>
        )
        return title && label === undefined ? <Tooltip key={String(itemValue)} content={title}>{btn}</Tooltip> : btn
      })}
    </div>
  )
}
