// ============================================================
// Overlay stack (modals, popovers, menus): Esc closes only the
// top-most overlay, and global keyboard shortcuts are suspended
// while any overlay is open.
// ============================================================

import { useEffect, useRef } from 'react'

const stack: number[] = []
let nextId = 1

/** True while a modal, popover or menu is open */
export function hasOpenOverlay(): boolean {
  return stack.length > 0
}

/**
 * Register an overlay while `open`. Esc (and `onDismiss` from outside
 * pointer-down when `dismissOnOutside` is set) reaches only the top one.
 */
export function useOverlayLayer(
  open: boolean,
  opts: {
    onEscape?: () => void
    /** Element(s) whose inside clicks do not dismiss (floating panel, its trigger) */
    insideRefs?: Array<React.RefObject<HTMLElement | null>>
    onOutsidePointerDown?: () => void
  }
): void {
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!open) return
    const id = nextId++
    stack.push(id)
    const isTop = () => stack[stack.length - 1] === id

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTop() || !optsRef.current.onEscape) return
      e.preventDefault()
      e.stopPropagation()
      optsRef.current.onEscape()
    }
    const onPointerDown = (e: PointerEvent) => {
      const { onOutsidePointerDown, insideRefs } = optsRef.current
      if (!onOutsidePointerDown || !isTop()) return
      const target = e.target as Node | null
      if (target && insideRefs?.some((r) => r.current?.contains(target))) return
      onOutsidePointerDown()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Focusable descendants in DOM order */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
}
