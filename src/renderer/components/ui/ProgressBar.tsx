import { cn } from './cn'
import type { Tone } from './tokens'

const FILL: Record<Tone, string> = {
  neutral: 'bg-fg-tertiary',
  accent: 'bg-accent',
  go: 'bg-go',
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info-fg',
  midi: 'bg-midi'
}

export interface ProgressBarProps {
  /** 0…1; omit for indeterminate */
  value?: number
  tone?: Tone
  /** Custom fill colour (overrides tone) */
  color?: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/** Determinate progress (fades, uploads, timeline position). */
export function ProgressBar({ value, tone = 'accent', color, size = 'sm', className, ...aria }: ProgressBarProps) {
  const h = size === 'xs' ? 'h-0.5' : size === 'sm' ? 'h-1' : 'h-2'
  const pct = value === undefined ? undefined : Math.max(0, Math.min(1, value)) * 100
  return (
    <div
      role="progressbar"
      aria-label={aria['aria-label']}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === undefined ? undefined : Math.round(pct)}
      className={cn('relative w-full overflow-hidden rounded-full bg-surface-0', h, className)}
    >
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full', !color && FILL[tone], pct === undefined && 'w-1/3 animate-pulse')}
        style={{ width: pct === undefined ? undefined : `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}

export interface LevelMeterProps {
  /** 0…1 */
  value: number
  orientation?: 'vertical' | 'horizontal'
  color?: string
  className?: string
  'aria-label'?: string
}

/**
 * Output level indicator (channel output, audio input). Pass a value that is
 * already throttled (≤ 30 Hz) — the meter itself does no animation work.
 */
export function LevelMeter({ value, orientation = 'vertical', color, className, ...aria }: LevelMeterProps) {
  const pct = `${Math.max(0, Math.min(1, value)) * 100}%`
  const vertical = orientation === 'vertical'
  return (
    <div
      role="meter"
      aria-label={aria['aria-label']}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className={cn('relative overflow-hidden rounded-sm bg-surface-0 ring-1 ring-inset ring-line', vertical ? 'h-full w-1.5' : 'h-1.5 w-full', className)}
    >
      <div
        className={cn('absolute', vertical ? 'inset-x-0 bottom-0' : 'inset-y-0 left-0', !color && (vertical ? 'bg-gradient-to-t' : 'bg-gradient-to-r') + ' from-go via-go to-warning')}
        style={vertical ? { height: pct, backgroundColor: color } : { width: pct, backgroundColor: color }}
      />
    </div>
  )
}
