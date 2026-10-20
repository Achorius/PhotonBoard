import type React from 'react'
import { LuCheck, LuMinus } from 'react-icons/lu'
import { cn } from './cn'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label (clicking it toggles too) */
  label?: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** On/off setting that applies immediately (Settings, inspector flags). */
export function Switch({ checked, onChange, label, description, disabled, className, ...aria }: SwitchProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast disabled:opacity-40',
        '[[data-density=touch]_&]:h-7 [[data-density=touch]_&]:w-12',
        checked ? 'bg-accent' : 'bg-surface-5'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-fast',
          '[[data-density=touch]_&]:h-6 [[data-density=touch]_&]:w-6',
          checked ? 'translate-x-[18px] [[data-density=touch]_&]:translate-x-[22px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
  if (!label) return <span className={className}>{control}</span>
  return (
    <label className={cn('flex min-h-control cursor-pointer items-center justify-between gap-3', disabled && 'cursor-default opacity-60', className)}>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm text-fg-primary">{label}</span>
        {description && <span className="text-xs text-fg-tertiary">{description}</span>}
      </span>
      {control}
    </label>
  )
}

export interface CheckboxProps {
  checked: boolean | 'mixed'
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/** Selection in lists / multi-choice. 'mixed' for partial selection. */
export function Checkbox({ checked, onChange, label, disabled, className, ...aria }: CheckboxProps) {
  const on = checked === true
  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-fast disabled:opacity-40',
        '[[data-density=touch]_&]:h-6 [[data-density=touch]_&]:w-6',
        checked ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-surface-0 hover:border-fg-disabled'
      )}
    >
      {checked === 'mixed' ? <LuMinus size={12} aria-hidden /> : on ? <LuCheck size={12} strokeWidth={3} aria-hidden /> : null}
    </button>
  )
  if (!label) return <span className={cn('inline-flex', className)}>{box}</span>
  return (
    <label className={cn('inline-flex min-h-control-sm cursor-pointer items-center gap-2 text-sm text-fg-primary', disabled && 'cursor-default opacity-60', className)}>
      {box}
      {label}
    </label>
  )
}
