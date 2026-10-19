import type React from 'react'
import type { IconType } from 'react-icons'
import { cn } from './cn'

export interface EmptyStateProps {
  icon?: IconType
  title: React.ReactNode
  description?: React.ReactNode
  /** Primary action (usually one <Button variant="primary">) and optional secondary */
  action?: React.ReactNode
  /** compact: inside sidebars / small panels */
  size?: 'md' | 'sm'
  className?: string
}

/**
 * Shown instead of an empty list / canvas: what is missing, why it matters,
 * and the one action that fixes it ("No fixtures patched — Add fixtures").
 */
export function EmptyState({ icon: Icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  const sm = size === 'sm'
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center text-center', sm ? 'gap-2 p-4' : 'gap-3 p-8', className)}>
      {Icon && (
        <div className={cn('flex items-center justify-center rounded-xl bg-surface-2 text-fg-tertiary ring-1 ring-inset ring-line', sm ? 'h-9 w-9' : 'h-12 w-12')}>
          <Icon size={sm ? 18 : 24} aria-hidden />
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className={cn('font-semibold text-fg-primary', sm ? 'text-sm' : 'text-base')}>{title}</h3>
        {description && <p className={cn('text-fg-tertiary', sm ? 'text-xs' : 'text-sm')}>{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}
