// ============================================================
// Stage page grid — draws a StagePage (cols × rows of widgets) and,
// in arrange mode, edits it:
//   tap a widget            select it (inspector)
//   mouse: drag             move it          (touch: long-press, then drag)
//   corner handle           resize it
//   tap an empty cell       add a widget there
//   arrows (selected)       move · Shift+arrows resize
// A move / resize that would cover another widget or leave the page is
// shown in red and dropped. Nothing fires while arranging.
// ============================================================

import { memo, useRef, useState } from 'react'
import type React from 'react'
import { LuPlus } from 'react-icons/lu'
import type { StagePage, StageWidget } from '@shared/types'
import { cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { StageWidgetView, type WidgetContext } from './StageWidgets'
import { clampRect, rectFits, type Rect } from './page-layout'

const LONG_PRESS_MS = 400
const DRAG_THRESHOLD = 6

export interface StagePageGridProps {
  page: StagePage
  ctx: WidgetContext
  arranging?: boolean
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** Move / resize committed (already checked to fit) */
  onCommit?: (id: string, rect: Rect) => void
  /** Empty cell tapped (arrange): add a widget at x, y */
  onAddAt?: (x: number, y: number, anchor: DOMRect) => void
  className?: string
}

type Edit = { id: string; rect: Rect; valid: boolean }

export function StagePageGrid({ page, ctx, arranging = false, selectedId = null, onSelect, onCommit, onAddAt, className }: StagePageGridProps) {
  const t = useT()
  const gridRef = useRef<HTMLDivElement>(null)
  const [edit, setEditState] = useState<Edit | null>(null)
  const editRef = useRef<Edit | null>(null)
  const setEdit = (e: Edit | null) => { editRef.current = e; setEditState(e) }
  const gap = ctx.size === 'lg' ? 8 : 6

  /** Grid step (cell + gap) in px */
  const step = () => {
    const r = gridRef.current?.getBoundingClientRect()
    if (!r) return { x: 1, y: 1 }
    return { x: (r.width + gap) / page.cols, y: (r.height + gap) / page.rows }
  }
  const propose = (w: StageWidget, rect: Rect) => {
    const r = clampRect(page, rect)
    setEdit({ id: w.id, rect: r, valid: rectFits(page, r, w.id) })
  }
  const commit = () => {
    const e = editRef.current
    setEdit(null)
    if (e && e.valid) onCommit?.(e.id, e.rect)
  }

  // Background cells (arrange): tap = add here
  const occupied = new Set<string>()
  if (arranging) {
    for (const w of page.widgets) for (let x = w.x; x < w.x + w.w; x++) for (let y = w.y; y < w.y + w.h; y++) occupied.add(`${x}:${y}`)
  }

  return (
    <div
      ref={gridRef}
      className={cn('relative grid min-h-0 min-w-0 flex-1', ctx.size === 'lg' ? 'gap-2' : 'gap-1.5', arranging && 'rounded-lg bg-info/[0.05]', className)}
      style={{ gridTemplateColumns: `repeat(${page.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${page.rows}, minmax(0, 1fr))` }}
      onPointerDown={(e) => { if (arranging && e.target === e.currentTarget) onSelect?.(null) }}
    >
      {arranging && Array.from({ length: page.cols * page.rows }, (_, i) => {
        const x = i % page.cols
        const y = Math.floor(i / page.cols)
        if (occupied.has(`${x}:${y}`)) return null
        return (
          <button
            key={`cell-${x}-${y}`}
            type="button"
            aria-label={t('pro.stage.designer.addAt', { x: x + 1, y: y + 1 })}
            onClick={(e) => onAddAt?.(x, y, e.currentTarget.getBoundingClientRect())}
            className="group flex min-h-0 min-w-0 items-center justify-center rounded-md border border-dashed border-line text-fg-disabled transition-colors duration-fast hover:border-info-fg hover:bg-info/10 hover:text-info-fg"
            style={{ gridColumn: `${x + 1} / span 1`, gridRow: `${y + 1} / span 1` }}
          >
            <LuPlus size={16} aria-hidden className="opacity-0 transition-opacity group-hover:opacity-100 [[data-density=touch]_&]:opacity-50" />
          </button>
        )
      })}
      {page.widgets.map((w) => (
        <WidgetCell
          key={w.id}
          widget={w}
          ctx={ctx}
          arranging={arranging}
          selected={selectedId === w.id}
          editing={edit?.id === w.id}
          step={step}
          onSelect={onSelect}
          onPropose={propose}
          onCommit={commit}
          onCancel={() => setEdit(null)}
          onKeyCommit={(rect) => {
            const r = clampRect(page, rect)
            if (rectFits(page, r, w.id)) onCommit?.(w.id, r)
          }}
        />
      ))}
      {edit && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none z-10 rounded-lg border-2 border-dashed',
            edit.valid ? 'border-info-fg bg-info/15' : 'border-danger-fg bg-danger/15'
          )}
          style={{ gridColumn: `${edit.rect.x + 1} / span ${edit.rect.w}`, gridRow: `${edit.rect.y + 1} / span ${edit.rect.h}` }}
        />
      )}
    </div>
  )
}

type Gesture =
  | { kind: 'pending'; id: number; x: number; y: number; touch: boolean; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'lifted'; id: number; x: number; y: number }
  | { kind: 'moving'; id: number; x: number; y: number; sx: number; sy: number }
  | { kind: 'resizing'; id: number; x: number; y: number; sx: number; sy: number }

const WidgetCell = memo(function WidgetCell({ widget, ctx, arranging, selected, editing, step, onSelect, onPropose, onCommit, onCancel, onKeyCommit }: {
  widget: StageWidget
  ctx: WidgetContext
  arranging: boolean
  selected: boolean
  editing: boolean
  step: () => { x: number; y: number }
  onSelect?: (id: string | null) => void
  onPropose: (w: StageWidget, rect: Rect) => void
  onCommit: () => void
  onCancel: () => void
  onKeyCommit: (rect: Rect) => void
}) {
  const t = useT()
  const gesture = useRef<Gesture | null>(null)
  const [lifted, setLifted] = useState(false)
  const placement = { gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }

  if (!arranging) {
    return (
      <div className="min-h-0 min-w-0" style={placement} data-widget={widget.id}>
        <StageWidgetView widget={widget} ctx={ctx} />
      </div>
    )
  }

  const clearTimer = () => {
    const g = gesture.current
    if (g?.kind === 'pending' && g.timer) clearTimeout(g.timer)
  }

  const startMove = (g: { id: number; x: number; y: number }, cx: number, cy: number) => {
    const s = step()
    gesture.current = { kind: 'moving', id: g.id, x: g.x, y: g.y, sx: s.x, sy: s.y }
    setLifted(false)
    onSelect?.(widget.id)
    move(cx, cy)
  }
  const move = (cx: number, cy: number) => {
    const g = gesture.current
    if (!g || (g.kind !== 'moving' && g.kind !== 'resizing')) return
    const dx = Math.round((cx - g.x) / g.sx)
    const dy = Math.round((cy - g.y) / g.sy)
    if (g.kind === 'moving') onPropose(widget, { x: widget.x + dx, y: widget.y + dy, w: widget.w, h: widget.h })
    else onPropose(widget, { x: widget.x, y: widget.y, w: Math.max(1, widget.w + dx), h: Math.max(1, widget.h + dy) })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const touch = e.pointerType !== 'mouse'
    const g: Gesture = { kind: 'pending', id: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: null }
    if (touch) {
      g.timer = setTimeout(() => {
        if (gesture.current === g) {
          gesture.current = { kind: 'lifted', id: g.id, x: g.x, y: g.y }
          setLifted(true)
          onSelect?.(widget.id)
          navigator.vibrate?.(10)
        }
      }, LONG_PRESS_MS)
    }
    gesture.current = g
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    if (g.kind === 'moving' || g.kind === 'resizing') { move(e.clientX, e.clientY); return }
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_THRESHOLD) return
    if (g.kind === 'pending' && g.touch) {
      // Finger slid before the long-press: a scroll, not a move
      clearTimer()
      gesture.current = null
      return
    }
    clearTimer()
    startMove(g, e.clientX, e.clientY)
  }
  const end = (e: React.PointerEvent<HTMLDivElement>, canceled: boolean) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    clearTimer()
    gesture.current = null
    setLifted(false)
    if (g.kind === 'moving' || g.kind === 'resizing') {
      if (canceled) onCancel()
      else onCommit()
      return
    }
    if (!canceled) onSelect?.(widget.id)
  }

  const onHandleDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (gesture.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.stopPropagation()
    const host = e.currentTarget.parentElement as HTMLDivElement | null
    try { host?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const s = step()
    gesture.current = { kind: 'resizing', id: e.pointerId, x: e.clientX, y: e.clientY, sx: s.x, sy: s.y }
    onSelect?.(widget.id)
    onPropose(widget, { x: widget.x, y: widget.y, w: widget.w, h: widget.h })
  }

  return (
    <div
      data-widget={widget.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={t('pro.stage.designer.widgetAria', { kind: t(`pro.stage.widgetKinds.${widget.kind}`), x: widget.x + 1, y: widget.y + 1, w: widget.w, h: widget.h })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e, false)}
      onPointerCancel={(e) => end(e, true)}
      onLostPointerCapture={(e) => end(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null
        if (!d) return
        e.preventDefault()
        e.stopPropagation()
        onKeyCommit(e.shiftKey
          ? { x: widget.x, y: widget.y, w: Math.max(1, widget.w + d[0]), h: Math.max(1, widget.h + d[1]) }
          : { x: widget.x + d[0], y: widget.y + d[1], w: widget.w, h: widget.h })
      }}
      onFocus={() => onSelect?.(widget.id)}
      className={cn(
        'relative min-h-0 min-w-0 cursor-grab touch-none select-none rounded-lg transition-[transform,box-shadow,opacity] duration-fast',
        selected ? 'z-[5] outline outline-2 outline-offset-2 outline-info-fg' : 'hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-line-strong',
        editing && 'opacity-50',
        lifted && 'z-10 scale-[1.03] shadow-popover'
      )}
      style={placement}
    >
      <div className="pointer-events-none h-full w-full">
        <StageWidgetView widget={widget} ctx={{ ...ctx, interactive: false }} />
      </div>
      {selected && (
        <span
          aria-hidden
          onPointerDown={onHandleDown}
          className="absolute -bottom-1.5 -right-1.5 z-10 flex h-5 w-5 cursor-nwse-resize items-center justify-center rounded-full border-2 border-surface-0 bg-info-fg shadow-raised [[data-density=touch]_&]:h-8 [[data-density=touch]_&]:w-8"
        />
      )}
    </div>
  )
})
