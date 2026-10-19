import { useEffect, useRef, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuCircleCheck, LuCircleAlert, LuInfo, LuTriangleAlert, LuX } from 'react-icons/lu'
import { cn } from './cn'
import { usePointerDrag } from './usePointerDrag'
import { dismissToast, useToastStore, type Toast, type ToastType } from '@renderer/stores/toast-store'

const ICON: Record<ToastType, IconType> = {
  info: LuInfo,
  success: LuCircleCheck,
  warning: LuTriangleAlert,
  error: LuCircleAlert
}

const ICON_COLOR: Record<ToastType, string> = {
  info: 'text-info-fg',
  success: 'text-go-fg',
  warning: 'text-warning-fg',
  error: 'text-danger-fg'
}

/**
 * Toast stack: bottom-right of its positioned parent (bottom-centre on phones).
 * The shell mounts it over the view area, so it never covers the top-bar
 * actions, the executor bar or the status bar. Mount once.
 * Post with `toast.success(...)` or ui-store `showStatus(...)`.
 * Tap or swipe sideways to dismiss.
 */
export function ToastHost({ placement = 'bottom' }: {
  /** 'top' where the bottom edge holds live controls (phone stage view: Blackout) */
  placement?: 'top' | 'bottom'
}) {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute z-toast flex w-[360px] max-w-[calc(100%-24px)] flex-col items-stretch gap-2',
        placement === 'top' ? 'top-3 sm:top-16' : 'bottom-3',
        'left-1/2 -translate-x-1/2 sm:left-auto sm:right-3 sm:translate-x-0'
      )}
    >
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}

/** Horizontal travel that dismisses a toast */
const SWIPE_DISMISS_PX = 72
const TAP_SLOP_PX = 6

function ToastItem({ toast }: { toast: Toast }) {
  const [hover, setHover] = useState(false)
  const [offset, setOffset] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = offset !== null
  const Icon = ICON[toast.type]

  // (Re)start the timer when the toast is replaced; pause while hovered or dragged
  useEffect(() => {
    if (toast.duration <= 0 || hover || dragging) return
    timer.current = setTimeout(() => dismissToast(toast.id), toast.duration)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [toast.id, toast.version, toast.duration, hover, dragging])

  // Swipe sideways (or tap) to dismiss; buttons inside keep their own clicks
  const drag = usePointerDrag({
    onStart: (s) => {
      if ((s.event.target as HTMLElement).closest('button')) return false
      setOffset(0)
    },
    onMove: (s) => setOffset(s.dx),
    onEnd: (s, canceled) => {
      setOffset(null)
      if (canceled) return
      const tap = Math.abs(s.dx) < TAP_SLOP_PX && Math.abs(s.dy) < TAP_SLOP_PX
      if (tap || Math.abs(s.dx) > SWIPE_DISMISS_PX) dismissToast(toast.id)
    }
  })

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true) }}
      onPointerLeave={() => setHover(false)}
      {...drag}
      style={offset ? { transform: `translateX(${offset}px)`, opacity: Math.max(0.2, 1 - Math.abs(offset) / (SWIPE_DISMISS_PX * 2)) } : undefined}
      className={cn(
        'pointer-events-auto flex w-full cursor-pointer touch-pan-y select-none items-start gap-2.5 rounded-lg bg-surface-overlay py-2.5 pl-3 pr-1.5 shadow-popover animate-toast-in',
        !dragging && 'transition-[transform,opacity] duration',
        toast.type === 'error' && 'ring-1 ring-inset ring-danger/50'
      )}
    >
      <Icon size={16} aria-hidden className={cn('mt-0.5 shrink-0', ICON_COLOR[toast.type])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
        <p className="break-words text-sm font-medium text-fg-primary">{toast.message}</p>
        {toast.description && <p className="break-words text-xs text-fg-secondary">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            className="mt-1 self-start text-xs font-semibold text-accent-fg hover:underline"
            onClick={() => { toast.action!.onClick(); dismissToast(toast.id) }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-tertiary hover:bg-surface-4 hover:text-fg-primary [[data-density=touch]_&]:h-8 [[data-density=touch]_&]:w-8"
      >
        <LuX size={14} aria-hidden />
      </button>
    </div>
  )
}
