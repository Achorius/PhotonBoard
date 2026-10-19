// Building blocks shared by the Settings sections: page header,
// cards with a title bar, label/description rows.

import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from '@renderer/components/ui'

/** Top of a settings page: title, one-line purpose, optional actions */
export function SettingsPage({ title, description, actions, children }: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-4 pb-8 pt-4 [[data-density=touch]_&]:px-6">
      <div className="flex min-h-control items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-lg font-semibold text-fg-primary">{title}</h2>
          {description && <p className="text-sm text-fg-tertiary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** Bordered card with a title bar */
export function SettingsCard({ title, icon: Icon, subtitle, status, actions, children, className }: {
  title: React.ReactNode
  icon?: IconType
  subtitle?: React.ReactNode
  /** Small status element right after the title (StatusDot + text, Badge…) */
  status?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col overflow-hidden rounded-lg border border-line bg-surface-1', className)}>
      <header className="flex min-h-control-lg flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-4 py-2">
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
            <h3 className="truncate text-sm font-semibold text-fg-primary">{title}</h3>
            {status}
          </div>
          {subtitle && <p className="text-xs text-fg-tertiary">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

/** Label + description on the left, control on the right */
export function SettingRow({ label, description, children, className, htmlFor }: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('flex min-h-row flex-wrap items-center gap-x-6 gap-y-2 border-b border-line-subtle px-4 py-3 last:border-b-0', className)}>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        {htmlFor
          ? <label htmlFor={htmlFor} className="text-sm text-fg-primary">{label}</label>
          : <span className="text-sm text-fg-primary">{label}</span>}
        {description && <span className="text-xs text-fg-tertiary">{description}</span>}
      </div>
      {children && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** Read-only key / value line (About, status details) */
export function InfoRow({ label, children, mono }: { label: React.ReactNode; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid min-h-row grid-cols-[minmax(120px,180px)_minmax(0,1fr)] items-center gap-4 border-b border-line-subtle px-4 py-2 last:border-b-0">
      <span className="text-xs text-fg-tertiary">{label}</span>
      <span className={cn('min-w-0 break-words text-sm text-fg-primary', mono && 'font-mono text-xs')}>{children}</span>
    </div>
  )
}

/** Inline notice inside a card (info / warning / error) */
export function Notice({ tone = 'info', icon: Icon, children, className }: {
  tone?: 'info' | 'warning' | 'danger'
  icon?: IconType
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 text-xs',
        tone === 'info' && 'bg-info/10 text-fg-secondary ring-1 ring-inset ring-info/30',
        tone === 'warning' && 'bg-warning/10 text-fg-secondary ring-1 ring-inset ring-warning/40',
        tone === 'danger' && 'bg-danger/10 text-danger-fg ring-1 ring-inset ring-danger/50',
        className
      )}
    >
      {Icon && (
        <Icon
          size={14}
          aria-hidden
          className={cn('mt-px shrink-0', tone === 'info' ? 'text-info-fg' : tone === 'warning' ? 'text-warning-fg' : 'text-danger-fg')}
        />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
