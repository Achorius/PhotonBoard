import { cn } from './cn'
import type { Tone } from './tokens'

const COLOR: Record<Tone, string> = {
  neutral: 'bg-fg-disabled',
  accent: 'bg-accent',
  go: 'bg-go-fg',
  danger: 'bg-danger-fg',
  warning: 'bg-warning',
  info: 'bg-info-fg',
  midi: 'bg-midi-fg'
}

export interface StatusDotProps {
  tone?: Tone
  /** Soft halo pulse (something is live / needs attention) */
  pulse?: boolean
  size?: 'sm' | 'md'
  /** Screen-reader text (the dot alone carries no information) */
  label?: string
  className?: string
}

/** Coloured health / activity dot. Always pair with text or a label. */
export function StatusDot({ tone = 'neutral', pulse, size = 'sm', label, className }: StatusDotProps) {
  const s = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'
  return (
    <span className={cn('relative inline-flex shrink-0', s, className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', COLOR[tone])} />}
      <span className={cn('relative inline-flex rounded-full', s, COLOR[tone])} />
    </span>
  )
}
