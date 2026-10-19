import { useRef } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

export interface SegmentedItem<T extends string | number> {
  value: T
  label?: React.ReactNode
  icon?: IconType
  /** Accessible name / tooltip (required for icon-only items) */
  title?: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string | number> {
  items: SegmentedItem<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'xs' | 'sm' | 'md'
  fullWidth?: boolean
  className?: string
  'aria-label'?: string
}

const SIZE = {
  xs: 'h-control-xs text-2xs',
  sm: 'h-control-sm text-xs',
  md: 'h-control text-sm'
}

/** Mutually exclusive choice (radio group): universe filter, view mode, units… Arrow keys move. */
export function SegmentedControl<T extends string | number>({ items, value, onChange, size = 'sm', fullWidth, className, ...aria }: SegmentedControlProps<T>) {
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
        const selected = item.value === value
        const Icon = item.icon
        const btn = (
          <button
            key={String(item.value)}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={item.title}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2.5 font-medium transition-colors duration-fast disabled:opacity-40',
              SIZE[size],
              fullWidth && 'flex-1',
              selected ? 'bg-surface-4 text-fg-primary shadow-raised' : 'text-fg-tertiary hover:text-fg-primary hover:bg-surface-2'
            )}
          >
            {Icon && <Icon size={size === 'md' ? 16 : 14} aria-hidden className="shrink-0" />}
            {item.label !== undefined && <span className="truncate">{item.label}</span>}
          </button>
        )
        return item.title && item.label === undefined ? <Tooltip key={String(item.value)} content={item.title}>{btn}</Tooltip> : btn
      })}
    </div>
  )
}
