import type React from 'react'
import { LuChevronDown } from 'react-icons/lu'
import { cn } from './cn'
import { FIELD_BASE, INPUT_SIZE, type InputSize } from './TextInput'

export interface SelectOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

export interface SelectProps<T extends string> extends Omit<React.ComponentPropsWithRef<'select'>, 'size' | 'onChange' | 'value'> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  size?: InputSize
  /** Wrapper class (width) */
  className?: string
}

/**
 * Drop-down choice. Uses the native <select> on purpose: the OS picker is
 * accessible and finger-friendly on the Pi, tablets and phones.
 */
export function Select<T extends string>({ value, onChange, options, size = 'md', className, disabled, ...rest }: SelectProps<T>) {
  return (
    <div className={cn('relative flex min-w-0 items-center', FIELD_BASE, 'border-line-strong', INPUT_SIZE[size], disabled && 'pointer-events-none opacity-50', className)}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-full w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pl-2 pr-7 outline-none"
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-surface-overlay text-fg-primary">
            {o.label}
          </option>
        ))}
      </select>
      <LuChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 text-fg-tertiary" />
    </div>
  )
}
