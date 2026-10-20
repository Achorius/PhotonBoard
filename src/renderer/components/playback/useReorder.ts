// ============================================================
// Pointer reordering for table rows (cues, chase steps).
// Drag the grip handle (mouse, pen or finger — the handle is
// touch-none, the rest of the row still scrolls); rows carry
// data-reorder-index. The list auto-scrolls near its edges.
// ============================================================

import { useCallback, useRef, useState } from 'react'
import type React from 'react'

export interface ReorderState {
  from: number
  over: number
}

export function useReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<ReorderState | null>(null)
  const g = useRef<{ id: number; from: number; over: number; scroller: HTMLElement | null; target: HTMLElement } | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const finish = useCallback((e: React.PointerEvent<HTMLElement>, canceled: boolean) => {
    const cur = g.current
    if (!cur || cur.id !== e.pointerId) return
    g.current = null
    try { if (cur.target.hasPointerCapture(e.pointerId)) cur.target.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    setDrag(null)
    if (!canceled && cur.over !== cur.from) onMoveRef.current(cur.from, cur.over)
  }, [])

  const handleProps = useCallback((index: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (g.current || (e.pointerType === 'mouse' && e.button !== 0)) return
      e.preventDefault()
      e.stopPropagation()
      const target = e.currentTarget
      const scroller = target.closest<HTMLElement>('[data-reorder-scroll]')
      g.current = { id: e.pointerId, from: index, over: index, scroller, target }
      try { target.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      setDrag({ from: index, over: index })
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const cur = g.current
      if (!cur || cur.id !== e.pointerId) return
      const scroller = cur.scroller
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        const edge = 32
        if (e.clientY < r.top + edge) scroller.scrollTop -= 12
        else if (e.clientY > r.bottom - edge) scroller.scrollTop += 12
      }
      const root = scroller ?? document.body
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-reorder-index]'))
      if (rows.length === 0) return
      let over = Number(rows[rows.length - 1].dataset.reorderIndex)
      for (const row of rows) {
        const r = row.getBoundingClientRect()
        if (e.clientY < r.bottom) {
          over = Number(row.dataset.reorderIndex)
          break
        }
      }
      if (Number.isFinite(over) && over !== cur.over) {
        cur.over = over
        setDrag({ from: cur.from, over })
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => finish(e, true),
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => finish(e, true)
  }), [finish])

  return { drag, handleProps }
}

/** Drop-indicator class for a row while dragging */
export function dropIndicator(drag: ReorderState | null, index: number): string | undefined {
  if (!drag || drag.over !== index || drag.from === index) return undefined
  return drag.over > drag.from
    ? '[&>td]:shadow-[inset_0_-2px_0_rgb(var(--pb-info-fg))]'
    : '[&>td]:shadow-[inset_0_2px_0_rgb(var(--pb-info-fg))]'
}
