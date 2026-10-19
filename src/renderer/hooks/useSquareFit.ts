// Size of the largest square that fits an element (ResizeObserver).
// For pads / wheels that fill their panel and must stay round / square.

import { useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'

export function useSquareFit<T extends HTMLElement>(enabled = true, min = 120): [React.RefObject<T | null>, number | null] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const measure = () => {
      const s = Math.max(min, Math.floor(Math.min(el.clientWidth, el.clientHeight)))
      setSize((cur) => (cur === s ? cur : s))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled, min])
  return [ref, size]
}
