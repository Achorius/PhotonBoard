import type React from 'react'
import type { IconType } from 'react-icons'
import { LuX } from 'react-icons/lu'
import { cn } from './cn'
import { t } from '@renderer/i18n'

export type InputSize = 'sm' | 'md' | 'lg'

export const INPUT_SIZE: Record<InputSize, string> = {
  sm: 'h-control-sm text-xs',
  md: 'h-control text-sm',
  lg: 'h-control-lg text-base'
}

/** Shared field chrome: inputs, selects, number fields */
export const FIELD_BASE =
  'rounded border bg-surface-0 text-fg-primary transition-colors duration-fast placeholder:text-fg-disabled ' +
  'hover:border-fg-disabled focus-within:border-info-fg focus-within:ring-1 focus-within:ring-info-fg/40'

export interface TextInputProps extends Omit<React.ComponentPropsWithRef<'input'>, 'size'> {
  size?: InputSize
  /** Leading icon (search, tag…) */
  icon?: IconType
  /** Trailing content (unit, button) */
  trailing?: React.ReactNode
  invalid?: boolean
  /** Shows a clear (×) button when there is a value */
  onClear?: () => void
  /** Monospace (addresses, values, commands) */
  mono?: boolean
  /** Class for the wrapper (width, margins) */
  className?: string
  inputClassName?: string
}

/** Single-line text input. Width comes from `className` (defaults to full width). */
export function TextInput({ size = 'md', icon: Icon, trailing, invalid, onClear, mono, className, inputClassName, value, disabled, ...rest }: TextInputProps) {
  const showClear = onClear && value !== undefined && value !== ''
  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 px-2',
        FIELD_BASE,
        INPUT_SIZE[size],
        invalid ? 'border-danger-fg/80' : 'border-line-strong',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {Icon && <Icon size={size === 'lg' ? 16 : 14} aria-hidden className="shrink-0 text-fg-tertiary" />}
      <input
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        className={cn('h-full min-w-0 flex-1 bg-transparent outline-none', mono && 'font-mono', inputClassName)}
        {...rest}
      />
      {showClear && (
        <button type="button" aria-label={t('ui.clear')} onClick={onClear} className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary">
          <LuX size={12} aria-hidden />
        </button>
      )}
      {trailing}
    </div>
  )
}
