// ============================================================
// Modal — dialog over the app: focus trapped inside, Esc and
// backdrop close it (unless dismissible=false), focus returns to
// the opener. Use ConfirmDialog / confirm() for yes-no questions.
// ============================================================

import { useEffect, useId, useRef } from 'react'
import type React from 'react'
import { LuX } from 'react-icons/lu'
import { cn } from './cn'
import { Portal } from './Portal'
import { IconButton } from './IconButton'
import { focusableIn, useOverlayLayer } from './overlay'
import { t } from '@renderer/i18n'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  /** sm 400 · md 520 · lg 720 · xl 960 · full (editors) */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Buttons, right-aligned (primary last) */
  footer?: React.ReactNode
  /** Esc / backdrop / close button allowed (default true) */
  dismissible?: boolean
  /** Remove body padding (tables, editors that manage their own) */
  flush?: boolean
  className?: string
  children?: React.ReactNode
}

const WIDTH = {
  sm: 'w-[400px]',
  md: 'w-[520px]',
  lg: 'w-[720px]',
  xl: 'w-[960px]',
  full: 'w-[calc(100vw-48px)] h-[calc(100vh-48px)]'
}

export function Modal({ open, onClose, title, description, size = 'md', footer, dismissible = true, flush, className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  useOverlayLayer(open, { onEscape: dismissible ? onClose : () => {} })

  // Initial focus ([data-autofocus] or first field) and focus restore
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    if (panel) {
      const target = panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(panel).find((el) => el.dataset.modalClose === undefined) ?? panel
      target.focus()
    }
    return () => { if (opener?.isConnected) opener.focus() }
  }, [open])

  if (!open) return null

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = focusableIn(panelRef.current)
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-6 animate-fade-in"
        onPointerDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose() }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          onKeyDown={trapTab}
          className={cn('flex max-h-full max-w-full flex-col rounded-xl focus-visible:outline-none bg-surface-overlay shadow-modal animate-pop-in', WIDTH[size], className)}
        >
          <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id={titleId} className="text-lg font-semibold text-fg-primary">{title}</h2>
              {description && <p id={descId} className="text-sm text-fg-secondary">{description}</p>}
            </div>
            {dismissible && <IconButton icon={LuX} label={t('ui.close')} size="sm" onClick={onClose} data-modal-close="" className="-mr-2 -mt-0.5" />}
          </header>
          {children !== undefined && children !== null && (
            <div className={cn('min-h-0 flex-1 overflow-y-auto', !flush && 'px-5 pb-4')}>{children}</div>
          )}
          {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">{footer}</footer>}
        </div>
      </div>
    </Portal>
  )
}
