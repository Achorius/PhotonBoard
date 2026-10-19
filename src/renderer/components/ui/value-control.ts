// Shared logic of the continuous controls (Slider, Fader, Encoder).

import { useRef } from 'react'
import type React from 'react'

export function clampValue(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function snapValue(v: number, min: number, max: number, step: number): number {
  const snapped = step > 0 ? Math.round((v - min) / step) * step + min : v
  // Avoid 0.30000000000000004 with fractional steps
  const decimals = step > 0 && step < 1 ? String(step).split('.')[1]?.length ?? 0 : 0
  return clampValue(decimals ? Number(snapped.toFixed(decimals)) : snapped, min, max)
}

/** Fine mode divides pointer movement by this (Shift, or a second finger) */
export const FINE_FACTOR = 0.2

/**
 * Keyboard for role="slider": arrows ±step (Shift ±10 steps), PageUp/Down ±10%,
 * Home/End min/max. Returns the new value or null when the key is not handled.
 */
export function sliderKeyValue(e: React.KeyboardEvent, value: number, min: number, max: number, step: number): number | null {
  const big = Math.max(step, (max - min) / 10)
  const mult = e.shiftKey ? 10 : 1
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowRight': return clampValue(value + step * mult, min, max)
    case 'ArrowDown':
    case 'ArrowLeft': return clampValue(value - step * mult, min, max)
    case 'PageUp': return clampValue(value + big, min, max)
    case 'PageDown': return clampValue(value - big, min, max)
    case 'Home': return min
    case 'End': return max
    default: return null
  }
}

const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_PX = 24

/**
 * Double-tap / double-click detection on pointer-down (works for touch,
 * where `dblclick` is unreliable on touch-action:none surfaces).
 */
export function useDoubleTap(onDoubleTap: (() => void) | undefined) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null)
  return (e: React.PointerEvent): boolean => {
    if (!onDoubleTap) return false
    const now = e.timeStamp
    const prev = last.current
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
      last.current = null
      onDoubleTap()
      return true
    }
    last.current = { t: now, x: e.clientX, y: e.clientY }
    return false
  }
}
