import type React from 'react'
import type { IconType } from 'react-icons'
import { LuX } from 'react-icons/lu'
import { cn } from './cn'
import type { Tone } from './tokens'

const SUBTLE: Record<Tone, string> = {
  neutral: 'bg-surface-4 text-fg-secondary',
  accent: 'bg-accent/15 text-accent-fg',
  go: 'bg-go/15 text-go-fg',
  danger: 'bg-danger/20 text-danger-fg',
  warning: 'bg-warning/15 text-warning-fg',
  info: 'bg-info/20 text-info-fg',
  midi: 'bg-midi/20 text-midi-fg'
}

const SOLID: Record<Tone, string> = {
  neutral: 'bg-surface-5 text-fg-primary',
  accent: 'bg-accent text-on-accent',
  go: 'bg-go text-on-go',
  danger: 'bg-danger text-on-danger',
  warning: 'bg-warning text-on-warning',
  info: 'bg-info text-on-info',
  midi: 'bg-midi text-on-midi'
}

const OUTLINE: Record<Tone, string> = {
  neutral: 'ring-line-strong text-fg-secondary',
  accent: 'ring-accent/60 text-accent-fg',
  go: 'ring-go/60 text-go-fg',
  danger: 'ring-danger/70 text-danger-fg',
  warning: 'ring-warning/60 text-warning-fg',
  info: 'ring-info/70 text-info-fg',
  midi: 'ring-midi/70 text-midi-fg'
}

export interface BadgeProps {
  tone?: Tone
  variant?: 'subtle' | 'solid' | 'outline'
  size?: 'xs' | 'sm'
  icon?: IconType
  /** Monospace (counts, DMX values, mode codes like TRIG) */
  mono?: boolean
  className?: string
  children: React.ReactNode
  title?: string
}

/** Small status label: "LIVE", "TRIG", "3 outputs", "MIDI". Not interactive. */
export function Badge({ tone = 'neutral', variant = 'subtle', size = 'sm', icon: Icon, mono, className, children, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm font-semibold leading-none',
        size === 'xs' ? 'h-4 px-1 text-[10px] tracking-[0.04em]' : 'h-5 px-1.5 text-2xs',
        mono && 'font-mono',
        variant === 'solid' ? SOLID[tone] : variant === 'outline' ? cn('ring-1 ring-inset', OUTLINE[tone]) : SUBTLE[tone],
        className
      )}
    >
      {Icon && <Icon size={size === 'xs' ? 10 : 12} aria-hidden />}
      {children}
    </span>
  )
}

export interface TagProps {
  children: React.ReactNode
  /** User colour (group, column) shown as a dot */
  color?: string
  selected?: boolean
  onClick?: () => void
  onRemove?: () => void
  className?: string
  title?: string
}

/** Chip for user-defined things (groups, filters). Clickable and/or removable. */
export function Tag({ children, color, selected, onClick, onRemove, className, title }: TagProps) {
  const body = (
    <>
      {color && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="truncate">{children}</span>
    </>
  )
  const base = cn(
    'inline-flex h-control-xs max-w-full shrink-0 items-center gap-1.5 rounded-full border text-xs font-medium transition-colors duration-fast',
    selected ? 'border-info-fg/60 bg-info/20 text-fg-primary' : 'border-line bg-surface-2 text-fg-secondary',
    className
  )
  return (
    <span className={cn(base, onRemove ? 'pl-2.5 pr-1' : 'px-2.5', !onClick && 'cursor-default')} title={title}>
      {onClick ? (
        <button type="button" aria-pressed={selected} onClick={onClick} className="-mx-1 flex min-w-0 items-center gap-1.5 self-stretch px-1 hover:text-fg-primary">
          {body}
        </button>
      ) : body}
      {onRemove && (
        <button type="button" aria-label="Remove" onClick={onRemove} className="flex h-5 w-5 items-center justify-center rounded-full text-fg-tertiary hover:bg-surface-4 hover:text-fg-primary">
          <LuX size={12} aria-hidden />
        </button>
      )}
    </span>
  )
}
