import type React from 'react'
import { useId } from 'react'
import { cn } from './cn'

export interface FieldProps {
  label: React.ReactNode
  /** Help text under the control */
  hint?: React.ReactNode
  /** Validation message (replaces hint, red) */
  error?: React.ReactNode
  /** inline: label left (inspectors) · stacked: label above (forms) */
  layout?: 'inline' | 'stacked'
  /** Receives the generated id → put it on the control for <label htmlFor> */
  children: React.ReactNode | ((id: string) => React.ReactNode)
  className?: string
}

/** Label + control + hint. Keeps inspector rows aligned (label column 96px). */
export function Field({ label, hint, error, layout = 'inline', children, className }: FieldProps) {
  const id = useId()
  const control = typeof children === 'function' ? children(id) : children
  const message = error ? <p className="text-xs text-danger-fg">{error}</p> : hint ? <p className="text-xs text-fg-tertiary">{hint}</p> : null
  if (layout === 'stacked') {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={id} className="text-xs font-medium text-fg-secondary">{label}</label>
        {control}
        {message}
      </div>
    )
  }
  return (
    <div className={cn('grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-1', className)}>
      <label htmlFor={id} className="truncate text-xs text-fg-secondary">{label}</label>
      <div className="min-w-0">{control}</div>
      {message && <div className="col-start-2">{message}</div>}
    </div>
  )
}
