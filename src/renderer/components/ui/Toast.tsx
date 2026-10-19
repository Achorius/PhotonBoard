import { useEffect, useRef, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuCircleCheck, LuCircleAlert, LuInfo, LuTriangleAlert, LuX } from 'react-icons/lu'
import { cn } from './cn'
import { Portal } from './Portal'
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
 * Toast stack (top-right, under the top bar — never over the executors).
 * Mount once. Post with `toast.success(...)` or ui-store `showStatus(...)`.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <Portal>
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-3 z-toast flex w-[360px] max-w-[calc(100vw-24px)] flex-col items-end gap-2"
        style={{ top: 'calc(var(--pb-topbar-h) + 8px)' }}
      >
        {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
    </Portal>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const [hover, setHover] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const Icon = ICON[toast.type]

  // (Re)start the timer when the toast is replaced; pause while hovered
  useEffect(() => {
    if (toast.duration <= 0 || hover) return
    timer.current = setTimeout(() => dismissToast(toast.id), toast.duration)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [toast.id, toast.version, toast.duration, hover])

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true) }}
      onPointerLeave={() => setHover(false)}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-2.5 rounded-lg bg-surface-overlay py-2.5 pl-3 pr-1.5 shadow-popover animate-toast-in',
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
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-tertiary hover:bg-surface-4 hover:text-fg-primary"
      >
        <LuX size={14} aria-hidden />
      </button>
    </div>
  )
}
