// ============================================================
// usePointerDrag — one pointer-driven drag gesture (faders, sliders,
// knobs, scrubbing, resize handles). Mouse, pen and touch alike:
//  - pointer capture: the drag continues outside the element
//  - pointercancel / lostpointercapture end the gesture (onEnd canceled=true)
//  - a second finger on the element sets `fine` (precision mode)
// Spread the returned handlers on the drag surface and give it
// `touch-none` (or .touch-none-surface) so the browser does not pan.
// Every drag holds the undo history open: all the edits of one
// gesture are ONE undo step (lib/history-gate.ts).
// ============================================================

import { useEffect, useRef } from 'react'
import type React from 'react'
import { holdHistory } from '@renderer/lib/history-gate'

export interface DragState {
  /** Pointer position (client coordinates) */
  x: number
  y: number
  /** Movement since the gesture started */
  dx: number
  dy: number
  /** Movement since the previous event */
  mx: number
  my: number
  pointerType: string
  /** Shift held, or a second finger is down on the element */
  fine: boolean
  /** The element the handlers are attached to */
  target: HTMLElement
  event: PointerEvent | React.PointerEvent
}

export interface PointerDragOptions {
  /** Return false to ignore this pointer-down (no capture, no drag) */
  onStart?: (s: DragState) => boolean | void
  onMove?: (s: DragState) => void
  onEnd?: (s: DragState, canceled: boolean) => void
  disabled?: boolean
}

export interface PointerDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
  onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => void
}

export function usePointerDrag(opts: PointerDragOptions): PointerDragHandlers {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const g = useRef<{
    id: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    extra: Set<number>
    target: HTMLElement
    release: () => void
  } | null>(null)

  // Unmounted mid-gesture: never leave the undo history held
  useEffect(() => () => { g.current?.release(); g.current = null }, [])

  const state = (e: React.PointerEvent<HTMLElement>, target: HTMLElement): DragState => {
    const cur = g.current!
    return {
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - cur.startX,
      dy: e.clientY - cur.startY,
      mx: e.clientX - cur.lastX,
      my: e.clientY - cur.lastY,
      pointerType: e.pointerType,
      fine: e.shiftKey || cur.extra.size > 0,
      target,
      event: e
    }
  }

  const finish = (e: React.PointerEvent<HTMLElement>, canceled: boolean) => {
    const cur = g.current
    if (!cur || e.pointerId !== cur.id) {
      cur?.extra.delete(e.pointerId)
      return
    }
    const s = state(e, cur.target)
    g.current = null
    cur.release()
    try {
      if (cur.target.hasPointerCapture(e.pointerId)) cur.target.releasePointerCapture(e.pointerId)
    } catch { /* already released */ }
    optsRef.current.onEnd?.(s, canceled)
  }

  return {
    onPointerDown: (e) => {
      if (optsRef.current.disabled) return
      if (g.current) {
        // Another finger on the same control → precision mode
        if (e.pointerId !== g.current.id) g.current.extra.add(e.pointerId)
        return
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.currentTarget
      g.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, extra: new Set(), target, release: () => {} }
      if (optsRef.current.onStart?.(state(e, target)) === false) {
        g.current = null
        return
      }
      if (g.current) g.current.release = holdHistory()
      try { target.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    },
    onPointerMove: (e) => {
      const cur = g.current
      if (!cur || e.pointerId !== cur.id) return
      const s = state(e, cur.target)
      cur.lastX = e.clientX
      cur.lastY = e.clientY
      optsRef.current.onMove?.(s)
    },
    onPointerUp: (e) => finish(e, false),
    onPointerCancel: (e) => finish(e, true),
    onLostPointerCapture: (e) => finish(e, true)
  }
}
