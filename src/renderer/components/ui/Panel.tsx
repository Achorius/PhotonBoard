import { useState } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import { LuChevronRight } from 'react-icons/lu'
import { cn } from './cn'

export interface PanelProps extends React.ComponentPropsWithRef<'section'> {
  /** inset: flush area inside a view (no border/radius) · card: bordered rounded box */
  variant?: 'card' | 'inset'
}

/** A region of a view (list, inspector, editor). Compose with PanelHeader + PanelBody. */
export function Panel({ variant = 'card', className, ...rest }: PanelProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col bg-surface-1',
        variant === 'card' && 'overflow-hidden rounded-lg border border-line',
        className
      )}
      {...rest}
    />
  )
}

export interface PanelHeaderProps {
  title: React.ReactNode
  icon?: IconType
  /** Count or short status after the title */
  count?: React.ReactNode
  /** Secondary line under the title */
  subtitle?: React.ReactNode
  /** Right-aligned controls (IconButtons, SegmentedControl…) */
  actions?: React.ReactNode
  className?: string
}

/** Panel title bar: 13px semibold title, optional icon/count/actions. */
export function PanelHeader({ title, icon: Icon, count, subtitle, actions, className }: PanelHeaderProps) {
  return (
    <header className={cn('flex min-h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5', className)}>
      {Icon && <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-sm font-semibold text-fg-primary">{title}</h2>
          {count !== undefined && count !== null && <span className="text-xs tabular text-fg-tertiary">{count}</span>}
        </div>
        {subtitle && <p className="truncate text-xs text-fg-tertiary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}

/** Scrollable panel content */
export function PanelBody({ className, ...rest }: React.ComponentPropsWithRef<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)} {...rest} />
}

export interface SectionProps {
  title: React.ReactNode
  /** Right side of the section header */
  actions?: React.ReactNode
  /** Collapsible header (chevron) */
  collapsible?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}

/** Group of related fields inside a panel / inspector, with an 11px uppercase label. */
export function Section({ title, actions, collapsible, defaultOpen = true, children, className }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const label = <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{title}</span>
  return (
    <div className={cn('flex flex-col gap-2 border-b border-line-subtle px-3 py-3 last:border-b-0', className)}>
      <div className="flex min-h-control-xs items-center gap-2">
        {collapsible ? (
          <button type="button" className="-ml-1 flex flex-1 items-center gap-1 rounded-sm px-1 text-left hover:bg-surface-2" aria-expanded={open} onClick={() => setOpen(!open)}>
            <LuChevronRight size={12} aria-hidden className={cn('text-fg-tertiary transition-transform duration-fast', open && 'rotate-90')} />
            {label}
          </button>
        ) : (
          <div className="flex-1">{label}</div>
        )}
        {actions}
      </div>
      {(!collapsible || open) && children}
    </div>
  )
}
