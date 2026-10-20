// ============================================================
// Popover — floating panel anchored to an element or a point.
// Closes on outside pointer-down and Esc (top-most only).
//
//   const pop = usePopover()
//   <Button ref={pop.anchorRef} onClick={pop.toggle}>…</Button>
//   <Popover {...pop.props}>content</Popover>
// ============================================================

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { cn } from './cn'
import { Portal } from './Portal'
import { useOverlayLayer } from './overlay'
import { computePosition, type Placement, type Rect } from './positioning'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** Element to attach to, or a fixed rect/point (context menus) */
  anchor: React.RefObject<HTMLElement | null> | Rect | null
  placement?: Placement
  offset?: number
  /** Keep keyboard focus where it is (menus manage their own focus) */
  className?: string
  role?: string
  'aria-label'?: string
  children: React.ReactNode
}

function anchorRect(anchor: PopoverProps['anchor']): Rect | null {
  if (!anchor) return null
  if ('current' in anchor) {
    const el = anchor.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  return anchor
}

export function Popover({ open, onClose, anchor, placement = 'bottom-start', offset = 6, className, role = 'dialog', children, ...aria }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchorEl = anchor && 'current' in anchor ? anchor : null

  useOverlayLayer(open, {
    onEscape: onClose,
    onOutsidePointerDown: onClose,
    insideRefs: anchorEl ? [ref, anchorEl] : [ref]
  })

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const update = () => {
      const r = anchorRect(anchor)
      const el = ref.current
      if (!r || !el) return
      setPos(computePosition(r, { width: el.offsetWidth, height: el.offsetHeight }, placement, offset))
    }
    update()
    const ro = new ResizeObserver(update)
    if (ref.current) ro.observe(ref.current)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [open, anchor, placement, offset])

  if (!open) return null
  return (
    <Portal>
      <div
        ref={ref}
        role={role}
        aria-label={aria['aria-label']}
        className={cn('fixed z-popover rounded-lg bg-surface-overlay shadow-popover animate-pop-in', className)}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      >
        {children}
      </div>
    </Portal>
  )
}

/** State + anchor ref for a popover opened by a trigger element */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const anchorRef = useRef<T>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])
  return {
    open,
    setOpen,
    toggle,
    close,
    anchorRef,
    /** Spread on the trigger for a11y */
    triggerProps: { 'aria-expanded': open, 'aria-haspopup': 'dialog' as const },
    props: { open, onClose: close, anchor: anchorRef }
  }
}
