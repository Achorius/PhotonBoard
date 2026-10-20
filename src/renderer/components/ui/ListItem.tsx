import type React from 'react'
import { cn } from './cn'

export interface ListItemProps extends Omit<React.ComponentPropsWithRef<'div'>, 'title'> {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Icon / swatch / avatar on the left */
  leading?: React.ReactNode
  /** Badges, values or actions on the right */
  trailing?: React.ReactNode
  selected?: boolean
  /** Shows the "active / live" bar (playing scene, running effect) */
  live?: boolean
  disabled?: boolean
  onSelect?: (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => void
}

/**
 * Selectable row for lists (fixtures, scenes, effects, devices).
 * Keyboard: Enter / Space select. Selection = blue bar; live = green bar.
 */
export function ListItem({ title, subtitle, leading, trailing, selected, live, disabled, onSelect, className, ...rest }: ListItemProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(e) => {
        if (!disabled && onSelect && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect(e)
        }
      }}
      className={cn(
        'relative flex min-h-row cursor-pointer items-center gap-2.5 px-3 py-1 outline-offset-[-2px] transition-colors duration-fast',
        selected ? 'bg-info/15 hover:bg-info/20' : 'hover:bg-surface-2',
        disabled && 'cursor-default opacity-50',
        className
      )}
      {...rest}
    >
      {(selected || live) && (
        <span aria-hidden className={cn('absolute inset-y-1 left-0 w-0.5 rounded-full', live ? 'bg-go-fg' : 'bg-info-fg')} />
      )}
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-sm', selected ? 'font-medium text-fg-primary' : 'text-fg-primary')}>{title}</span>
        {subtitle && <span className="truncate text-xs text-fg-tertiary">{subtitle}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
    </div>
  )
}
