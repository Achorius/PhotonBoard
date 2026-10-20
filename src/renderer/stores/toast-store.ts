// ============================================================
// PhotonBoard — Toasts
// Transient notifications rendered by <ToastHost/> (components/ui).
// ui-store.showStatus() feeds the 'status' slot, so every existing
// status message shows up here.
// ============================================================

import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  type: ToastType
  message: string
  /** Optional second line */
  description?: string
  /** ms before it disappears; 0 = until dismissed or replaced */
  duration: number
  action?: ToastAction
  /** Bumped when a toast with the same id is replaced (restarts its timer) */
  version: number
}

export interface ToastOptions {
  /** Same id = replace the existing toast (e.g. "Saving…" → "Saved") */
  id?: string
  description?: string
  duration?: number
  action?: ToastAction
}

const MAX_TOASTS = 4
const DEFAULT_DURATION: Record<ToastType, number> = { info: 3000, success: 2500, warning: 5000, error: 6000 }

interface ToastState {
  toasts: Toast[]
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }))

let seq = 0

export function showToast(type: ToastType, message: string, opts: ToastOptions = {}): string {
  const id = opts.id ?? `toast-${++seq}`
  const next: Toast = {
    id,
    type,
    message,
    description: opts.description,
    duration: opts.duration ?? DEFAULT_DURATION[type],
    action: opts.action,
    version: ++seq
  }
  useToastStore.setState((s) => {
    const rest = s.toasts.filter((t) => t.id !== id)
    return { toasts: [...rest, next].slice(-MAX_TOASTS) }
  })
  return id
}

export function dismissToast(id: string): void {
  useToastStore.setState((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : s))
}

/** toast.success('Saved'), toast.error('Failed', { description }) … */
export const toast = {
  info: (message: string, opts?: ToastOptions) => showToast('info', message, opts),
  success: (message: string, opts?: ToastOptions) => showToast('success', message, opts),
  warning: (message: string, opts?: ToastOptions) => showToast('warning', message, opts),
  error: (message: string, opts?: ToastOptions) => showToast('error', message, opts),
  dismiss: dismissToast
}
