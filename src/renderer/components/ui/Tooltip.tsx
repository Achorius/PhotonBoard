// ============================================================
// Tooltip — hover (mouse/pen) after a short delay, or keyboard
// focus. Never on touch: a tap or long-press must not leave a
// bubble over the stage. Wraps ONE child element and merges its
// pointer/focus handlers (no wrapper element, layout untouched).
// ============================================================

import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { Portal } from './Portal'
import { Kbd } from './Kbd'
import { computePosition, type Placement } from './positioning'

const OPEN_DELAY = 450
/** A tooltip opened recently: the next one opens immediately (scanning a toolbar) */
const WARM_WINDOW = 400
let lastClosedAt = 0

export interface TooltipProps {
  content: React.ReactNode
  /** Shortcut shown as key caps after the text ("Mod+S", "B") */
  shortcut?: string
  placement?: Placement
  /** Disable without unwrapping */
  disabled?: boolean
  children: React.ReactElement
}

type ChildProps = {
  onPointerEnter?: (e: React.PointerEvent<HTMLElement>) => void
  onPointerLeave?: (e: React.PointerEvent<HTMLElement>) => void
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void
  'aria-describedby'?: string
}

let tooltipSeq = 0

export function Tooltip({ content, shortcut, placement = 'bottom', disabled, children }: TooltipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef<string>('')
  if (!idRef.current) idRef.current = `pb-tooltip-${++tooltipSeq}`

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const open = (el: HTMLElement, immediate = false) => {
    cancel()
    if (immediate || Date.now() - lastClosedAt < WARM_WINDOW) setAnchor(el)
    else timer.current = setTimeout(() => setAnchor(el), OPEN_DELAY)
  }
  const close = () => {
    cancel()
    setAnchor((a) => {
      if (a) lastClosedAt = Date.now()
      return null
    })
  }
  useEffect(() => cancel, [])

  if (!isValidElement<ChildProps>(children)) return children
  if (disabled || (!content && !shortcut)) return children
  const p = children.props

  return (
    <>
      {cloneElement(children, {
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
          p.onPointerEnter?.(e)
          if (e.pointerType === 'mouse' || e.pointerType === 'pen') open(e.currentTarget)
        },
        onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
          p.onPointerLeave?.(e)
          close()
        },
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          p.onPointerDown?.(e)
          close()
        },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
          p.onFocus?.(e)
          if (e.currentTarget.matches(':focus-visible')) open(e.currentTarget, true)
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
          p.onBlur?.(e)
          close()
        },
        'aria-describedby': anchor ? idRef.current : p['aria-describedby']
      })}
      {anchor && <TooltipBubble id={idRef.current} anchor={anchor} placement={placement} content={content} shortcut={shortcut} />}
    </>
  )
}

function TooltipBubble({ id, anchor, placement, content, shortcut }: {
  id: string
  anchor: HTMLElement
  placement: Placement
  content: React.ReactNode
  shortcut?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor.isConnected) return
    const r = anchor.getBoundingClientRect()
    setPos(computePosition({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: el.offsetWidth, height: el.offsetHeight }, placement, 6))
  }, [anchor, placement, content])

  return (
    <Portal>
      <div
        ref={ref}
        id={id}
        role="tooltip"
        className="pointer-events-none fixed z-tooltip flex max-w-[280px] items-center gap-2 rounded-md bg-surface-5 px-2 py-1 text-xs text-fg-primary shadow-popover animate-fade-in"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      >
        {content && <span>{content}</span>}
        {shortcut && <Kbd keys={shortcut} />}
      </div>
    </Portal>
  )
}
