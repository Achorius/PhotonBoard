// ============================================================
// usePress — momentary ("hold") buttons: Blinder, Strobe, Flash,
// TRIG executors. onPress fires on pointer-down (finger or mouse),
// onRelease exactly once when the pointer is released, canceled,
// loses capture, or the button loses focus / unmounts.
// Keyboard: Space / Enter held = pressed (auto-repeat ignored).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type React from 'react'

export interface PressOptions {
  onPress: () => void
  onRelease: () => void
  disabled?: boolean
}

export interface PressHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
  onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
  onKeyUp: (e: React.KeyboardEvent<HTMLElement>) => void
  onBlur: () => void
  /** Long-press on touch would open the context menu */
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void
}

export function usePress(opts: PressOptions): [PressHandlers, boolean] {
  const optsRef = useRef(opts)
  optsRef.current = opts
  const active = useRef<number | 'key' | null>(null)
  const [pressed, setPressed] = useState(false)

  const press = (source: number | 'key') => {
    if (active.current !== null || optsRef.current.disabled) return
    active.current = source
    setPressed(true)
    optsRef.current.onPress()
  }
  const release = () => {
    if (active.current === null) return
    active.current = null
    setPressed(false)
    optsRef.current.onRelease()
  }

  // Never leave a blinder on because the component went away mid-press
  useEffect(() => () => {
    if (active.current !== null) {
      active.current = null
      optsRef.current.onRelease()
    }
  }, [])

  const pointerEnd = (e: React.PointerEvent<HTMLElement>) => {
    if (active.current === e.pointerId) release()
  }

  return [{
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      press(e.pointerId)
    },
    onPointerUp: pointerEnd,
    onPointerCancel: pointerEnd,
    onLostPointerCapture: pointerEnd,
    onKeyDown: (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      e.preventDefault()
      if (!e.repeat) press('key')
    },
    onKeyUp: (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && active.current === 'key') {
        e.preventDefault()
        release()
      }
    },
    onBlur: release,
    onContextMenu: (e) => e.preventDefault()
  }, pressed]
}
