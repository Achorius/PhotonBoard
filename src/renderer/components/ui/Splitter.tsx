// ============================================================
// Resizable panes: keep the size in state with useResizable() and
// put a <ResizeHandle> on the edge.
//   const side = useResizable({ initial: 280, min: 200, max: 480, storageKey: 'cues.width' })
//   <aside style={{ width: side.size }}>…</aside>
//   <ResizeHandle {...side.handleProps} />
// ============================================================

import { useCallback, useRef, useState } from 'react'
import { cn } from './cn'
import { usePointerDrag } from './usePointerDrag'

export interface ResizableOptions {
  initial: number
  min: number
  max: number
  /** Persist per viewer (localStorage, best effort) */
  storageKey?: string
  /** Which way the handle grows the pane: 1 (handle right of / below the pane) or -1 */
  direction?: 1 | -1
  orientation?: 'horizontal' | 'vertical'
}

export function useResizable({ initial, min, max, storageKey, direction = 1, orientation = 'horizontal' }: ResizableOptions) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      try {
        const stored = Number(window.localStorage.getItem(`photonboard.size.${storageKey}`))
        if (Number.isFinite(stored) && stored >= min && stored <= max) return stored
      } catch { /* ignore */ }
    }
    return initial
  })
  const start = useRef(size)
  const latest = useRef(size)
  latest.current = size
  const persist = useCallback((v: number) => {
    if (!storageKey) return
    try { window.localStorage.setItem(`photonboard.size.${storageKey}`, String(Math.round(v))) } catch { /* ignore */ }
  }, [storageKey])

  const drag = usePointerDrag({
    onStart: () => { start.current = size },
    onMove: (s) => setSize(Math.min(max, Math.max(min, start.current + direction * (orientation === 'horizontal' ? s.dx : s.dy)))),
    onEnd: () => persist(latest.current)
  })

  return {
    size,
    setSize,
    handleProps: {
      orientation,
      drag,
      onReset: () => { setSize(initial); persist(initial) }
    }
  }
}

export interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical'
  drag: ReturnType<typeof usePointerDrag>
  /** Double-click resets */
  onReset?: () => void
  className?: string
}

/** Drag edge between two panes (8px hit area, 1px line). */
export function ResizeHandle({ orientation, drag, onReset, className }: ResizeHandleProps) {
  const horizontal = orientation === 'horizontal'
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      onDoubleClick={onReset}
      {...drag}
      className={cn(
        'group relative z-10 shrink-0 touch-none',
        horizontal ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize',
        className
      )}
    >
      <span
        className={cn(
          'absolute bg-line transition-colors duration-fast group-hover:bg-info-fg group-active:bg-info-fg',
          horizontal ? 'inset-y-0 left-1/2 w-px' : 'inset-x-0 top-1/2 h-px'
        )}
      />
    </div>
  )
}
