// Place a floating element (popover, menu, tooltip) next to an anchor,
// flipping to the other side and clamping inside the viewport.

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'
export type Placement = Side | `${Side}-${Align}`

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const MARGIN = 8

export function pointRect(x: number, y: number): Rect {
  return { left: x, top: y, width: 0, height: 0 }
}

export function computePosition(
  anchor: Rect,
  size: { width: number; height: number },
  placement: Placement,
  offset = 6
): { left: number; top: number; side: Side } {
  const [sideRaw, alignRaw] = placement.split('-') as [Side, Align | undefined]
  const align: Align = alignRaw ?? 'center'
  const vw = window.innerWidth
  const vh = window.innerHeight

  let side = sideRaw
  // Flip when the preferred side has no room and the opposite has more
  if (side === 'bottom' && anchor.top + anchor.height + offset + size.height > vh - MARGIN && anchor.top > vh - anchor.top - anchor.height) side = 'top'
  else if (side === 'top' && anchor.top - offset - size.height < MARGIN && vh - anchor.top - anchor.height > anchor.top) side = 'bottom'
  else if (side === 'right' && anchor.left + anchor.width + offset + size.width > vw - MARGIN && anchor.left > vw - anchor.left - anchor.width) side = 'left'
  else if (side === 'left' && anchor.left - offset - size.width < MARGIN && vw - anchor.left - anchor.width > anchor.left) side = 'right'

  let left: number
  let top: number
  if (side === 'top' || side === 'bottom') {
    top = side === 'bottom' ? anchor.top + anchor.height + offset : anchor.top - offset - size.height
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.left + anchor.width - size.width : anchor.left + anchor.width / 2 - size.width / 2
  } else {
    left = side === 'right' ? anchor.left + anchor.width + offset : anchor.left - offset - size.width
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.top + anchor.height - size.height : anchor.top + anchor.height / 2 - size.height / 2
  }
  left = Math.max(MARGIN, Math.min(left, vw - size.width - MARGIN))
  top = Math.max(MARGIN, Math.min(top, vh - size.height - MARGIN))
  return { left, top, side }
}
