import { createContext, useContext } from 'react'
import type React from 'react'
import type { MenuEntry } from '@renderer/components/ui'
import type { TimelineGeometry } from './timeline-model'

export interface CanvasContextValue {
  zoom: number
  g: TimelineGeometry
  /** Time (s, unsnapped) under a client X coordinate */
  timeAt: (clientX: number) => number
  /** Track index under a client Y coordinate (clamped) */
  trackAt: (clientY: number) => number
  /** Snap to the grid / nearby edges (respects the snap setting). `exclude`: clip being edited */
  snap: (t: number, exclude?: string) => number
  openMenu: (e: React.MouseEvent | { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]) => void
}

export const CanvasContext = createContext<CanvasContextValue | null>(null)

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('useCanvas outside TimelineCanvas')
  return ctx
}
