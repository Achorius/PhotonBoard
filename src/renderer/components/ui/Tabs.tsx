import { useRef } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from './cn'
import { StatusDot } from './StatusDot'
import type { Tone } from './tokens'

/** Extra attributes forwarded to an item's button: `'data-tab': 'cues'`, `'aria-describedby': …` */
export type ItemDomProps = React.AriaAttributes & { [key: `data-${string}`]: string | number | boolean | undefined }

export interface TabItem<T extends string> extends ItemDomProps {
  id: T
  label: React.ReactNode
  icon?: IconType
  /** Count or status shown after the label */
  badge?: React.ReactNode
  /** Small status dot after the label (true = accent): unsaved, live, error… */
  dot?: Tone | boolean
  disabled?: boolean
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** line: underline (panel headers) · pill: filled (compact toolbars) */
  variant?: 'line' | 'pill'
  size?: 'sm' | 'md'
  /** Share the width equally and truncate labels (narrow side panels) */
  fit?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Tab strip for switching panels inside a view (Cues / Chases, Inputs / Mappings…).
 * Render the panel yourself with role="tabpanel" and aria-labelledby={`tab-${id}`}.
 */
export function Tabs<T extends string>({ items, value, onChange, variant = 'line', size = 'md', fit, className, ...aria }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    for (let i = 1; i <= items.length; i++) {
      const next = (index + dir * i + items.length) % items.length
      if (!items[next].disabled) {
        onChange(items[next].id)
        refs.current[next]?.focus()
        return
      }
    }
  }

  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      className={cn('flex min-w-0 items-stretch', variant === 'line' ? 'gap-1 border-b border-line' : 'gap-1', className)}
    >
      {items.map((item, i) => {
        const { id, label, icon: Icon, badge, dot, disabled, ...attrs } = item
        const selected = id === value
        return (
          <button
            {...attrs}
            key={id}
            id={`tab-${id}`}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium transition-colors duration-fast disabled:opacity-40',
              size === 'sm' ? 'h-control-sm px-2.5 text-xs' : 'h-control px-3 text-sm',
              fit && 'min-w-0 flex-1 basis-0 justify-center gap-1 px-1.5',
              variant === 'line'
                ? cn('-mb-px border-b-2', selected ? 'border-accent text-fg-primary' : 'border-transparent text-fg-tertiary hover:text-fg-primary')
                : cn('rounded', selected ? 'bg-surface-4 text-fg-primary' : 'text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary')
            )}
          >
            {Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden className="shrink-0" />}
            {fit ? <span className="truncate">{label}</span> : label}
            {badge !== undefined && badge !== null && (
              <span className={cn('shrink-0 rounded-full bg-surface-4 text-2xs tabular text-fg-secondary', fit ? 'px-1' : 'px-1.5')}>{badge}</span>
            )}
            {dot && <StatusDot tone={dot === true ? 'accent' : dot} />}
          </button>
        )
      })}
    </div>
  )
}
