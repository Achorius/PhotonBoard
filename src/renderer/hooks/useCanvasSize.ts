// Keeps a <canvas> backing store at its wrapper's CSS size × devicePixelRatio.
// Reallocates only when the size or the DPR changes (ResizeObserver, plus a
// resolution media query for a window moved to another screen).

import { useEffect, useRef } from 'react'
import type React from 'react'

export interface CanvasSize {
  /** CSS pixels */
  w: number
  h: number
  dpr: number
}

/**
 * Returns the current size (CSS px + DPR) as a ref, for drawing and hit tests.
 * `onResize` runs after each reallocation: draw synchronously there, a resized
 * canvas is blank until redrawn.
 */
export function useCanvasSize(
  wrapRef: React.RefObject<HTMLElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  onResize: (size: CanvasSize) => void
): React.RefObject<CanvasSize> {
  const size = useRef<CanvasSize>({ w: 0, h: 0, dpr: 1 })
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      const dpr = window.devicePixelRatio || 1
      const prev = size.current
      if (w === prev.w && h === prev.h && dpr === prev.dpr) return
      size.current = { w, h, dpr }
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      onResizeRef.current(size.current)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    // A resolution query only reports leaving its DPR: re-arm it for the new one
    let mq: MediaQueryList | null = null
    const onDpr = () => { watchDpr(); resize() }
    const watchDpr = () => {
      mq?.removeEventListener?.('change', onDpr)
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      mq.addEventListener?.('change', onDpr)
    }
    watchDpr()
    resize()
    return () => {
      ro.disconnect()
      mq?.removeEventListener?.('change', onDpr)
    }
  }, [wrapRef, canvasRef])

  return size
}
