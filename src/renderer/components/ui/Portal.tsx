import type React from 'react'
import { createPortal } from 'react-dom'

/** Render children at the end of <body> (overlays escape overflow/stacking contexts). */
export function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}
