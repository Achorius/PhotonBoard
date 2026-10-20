// Small presentational pieces shared by the patch table, map, dialogs.

import { memo } from 'react'
import type React from 'react'
import { LuChevronDown, LuCircleAlert, LuInfo, LuTriangleAlert } from 'react-icons/lu'
import type { Group } from '@shared/types'
import { cn, withAlpha } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { UNIVERSE_SIZE } from './patch-utils'

/** Compact group chips for table rows: up to `max` chips then "+N" */
export const GroupChips = memo(function GroupChips({ groups, max = 2 }: { groups: readonly Group[] | undefined; max?: number }) {
  const t = useT()
  if (!groups || groups.length === 0) return <span className="text-xs text-fg-disabled" aria-label={t('patch.parts.noGroup')}>–</span>
  const shown = groups.slice(0, max)
  return (
    <span className="flex min-w-0 items-center gap-1" title={groups.map((g) => g.name).join(', ')}>
      {shown.map((g) => (
        <span
          key={g.id}
          className="inline-flex h-5 min-w-0 max-w-[112px] shrink items-center gap-1 rounded-full border border-line px-1.5 text-2xs font-medium text-fg-secondary"
          style={{ backgroundColor: safeAlpha(g.color, 0.14) }}
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
          <span className="truncate">{g.name}</span>
        </span>
      ))}
      {groups.length > max && <span className="shrink-0 text-2xs tabular text-fg-tertiary">+{groups.length - max}</span>}
    </span>
  )
})

/** withAlpha() only understands hex; older shows store hsl() group colours */
export function safeAlpha(color: string, alpha: number): string {
  return color.startsWith('#') ? withAlpha(color, alpha) : 'transparent'
}

/** Inline notice (dialogs, panels) */
export function Notice({ tone, title, children, action, className }: {
  tone: 'danger' | 'warning' | 'info'
  title: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const Icon = tone === 'danger' ? LuCircleAlert : tone === 'warning' ? LuTriangleAlert : LuInfo
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3 py-2.5 ring-1 ring-inset',
        tone === 'danger' ? 'bg-danger/10 ring-danger/40' : tone === 'warning' ? 'bg-warning/10 ring-warning/40' : 'bg-info/10 ring-info/40',
        className
      )}
    >
      <Icon size={16} aria-hidden className={cn('mt-px shrink-0', tone === 'danger' ? 'text-danger-fg' : tone === 'warning' ? 'text-warning-fg' : 'text-info-fg')} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-fg-primary">{title}</p>
        {children && <div className="text-xs text-fg-secondary">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5 self-center">{action}</div>}
    </div>
  )
}

export interface StripSegment {
  key: string
  address: number
  count: number
  kind: 'existing' | 'new' | 'conflict'
  label?: string
}

/** Borderless native select for dense table cells (mode column). Clicks don't select the row. */
export function InlineSelect({ value, onChange, options, 'aria-label': ariaLabel }: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  'aria-label': string
}) {
  return (
    <span className="relative -ml-2 flex h-control-sm min-w-0 items-center rounded hover:bg-surface-3 focus-within:ring-1 focus-within:ring-info-fg/60">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-full w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pl-2 pr-6 text-sm text-fg-secondary outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface-overlay text-fg-primary">{o.label}</option>
        ))}
      </select>
      <LuChevronDown size={12} aria-hidden className="pointer-events-none absolute right-1.5 text-fg-tertiary" />
    </span>
  )
}

/** One universe as a thin 512-slot bar: existing ranges grey, new ones accent, conflicts red. */
export function UniverseStrip({ segments, label, className }: { segments: StripSegment[]; label: React.ReactNode; className?: string }) {
  const t = useT()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-2xs text-fg-tertiary">
        <span className="font-semibold uppercase tracking-[0.06em]">{label}</span>
        <span className="font-mono tabular">1 – {UNIVERSE_SIZE}</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-sm bg-surface-0 ring-1 ring-inset ring-line" role="img" aria-label={t('patch.parts.usage', { count: segments.length })}>
        {segments.map((s) => {
          const start = Math.max(1, s.address)
          const end = Math.min(UNIVERSE_SIZE, s.address + s.count - 1)
          if (end < start) return null
          return (
            <span
              key={s.key}
              title={s.label}
              className={cn(
                'absolute inset-y-0 border-l border-surface-0',
                s.kind === 'existing' ? 'bg-surface-5' : s.kind === 'new' ? 'bg-accent' : 'bg-danger'
              )}
              style={{ left: `${((start - 1) / UNIVERSE_SIZE) * 100}%`, width: `max(2px, ${((end - start + 1) / UNIVERSE_SIZE) * 100}%)` }}
            />
          )
        })}
      </div>
    </div>
  )
}
