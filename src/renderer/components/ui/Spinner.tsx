import { cn } from './cn'

export interface SpinnerProps {
  size?: number
  className?: string
  /** Accessible label (announced) */
  label?: string
}

/** Indeterminate activity indicator (inherits the text colour) */
export function Spinner({ size = 16, className, label = 'Loading' }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      className={cn('animate-spin shrink-0', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export interface SkeletonProps {
  className?: string
  /** Number of text lines (stacked) — omit for a single block sized by className */
  lines?: number
}

/** Loading placeholder with a subtle shimmer */
export function Skeleton({ className, lines }: SkeletonProps) {
  const block = 'rounded bg-surface-3 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.04),transparent)] bg-[length:200px_100%] bg-no-repeat animate-[pb-shimmer_1.4s_linear_infinite]'
  if (!lines) return <div aria-hidden className={cn(block, className ?? 'h-4 w-full')} />
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn(block, 'h-3')} style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}
