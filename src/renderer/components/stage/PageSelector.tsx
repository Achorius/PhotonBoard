// ============================================================
// Executor page selector  ‹ Page 2 ›  — executor bar, Stage window,
// remote stage views. Prop-driven (no store access).
//   ‹ ›          previous / next page (clamped)
//   the label    opens the page list (jump; Pro: new / rename / delete)
//   dots         one per page: current = filled, something playing = green
//   swipe        horizontal finger swipe on the selector (and, through
//                useSwipePaging, on the grid it belongs to)
// ============================================================

import { useRef } from 'react'
import type React from 'react'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { DropdownMenu, IconButton, cn, type MenuEntry } from '@renderer/components/ui'
import { t as tt, useT } from '@renderer/i18n'
import { stepPage, swipeStep } from './executor-surface'

export interface PageInfo {
  name: string
}

/** "Page 2" or the page's own name */
export function pageName(page: PageInfo | undefined, index: number): string {
  return page?.name || tt('pro.executor.pageN', { n: index + 1 })
}

/**
 * Swipe-to-page on a grid: spread the handlers on the grid CONTAINER
 * (pointer events bubble from the cells). Touch / pen only; ignored
 * when the gesture started on a held cell (`[data-hold="1"]`: TRIG /
 * FLASH fire on press) or inside `[data-no-swipe]`.
 */
export function useSwipePaging(onStep: (step: -1 | 1) => void, enabled = true) {
  const start = useRef<{ id: number; x: number; y: number; t: number } | null>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  if (!enabled) return {}
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return
      const target = e.target as Element | null
      if (target?.closest?.('[data-hold="1"], [data-no-swipe]')) { start.current = null; return }
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current
      if (!s || s.id !== e.pointerId) return
      start.current = null
      const step = swipeStep(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t)
      if (step) onStepRef.current(step)
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (start.current?.id === e.pointerId) start.current = null
    }
  }
}

export interface PageSelectorProps {
  pages: readonly PageInfo[]
  current: number
  onChange: (index: number) => void
  /** Pages where something plays (dots turn green) */
  activePages?: readonly boolean[]
  /** Extra menu entries (Pro: new / rename / delete page) */
  menuExtra?: () => MenuEntry[]
  /** bar: executor bar gutter (stacked, narrow) · stage: Stage window / tablet header · phone */
  variant?: 'bar' | 'stage' | 'phone'
  className?: string
}

export function PageSelector({ pages, current, onChange, activePages, menuExtra, variant = 'stage', className }: PageSelectorProps) {
  const t = useT()
  const count = pages.length
  const go = (delta: number) => {
    const next = stepPage(current, delta, count)
    if (next !== current) onChange(next)
  }
  const swipe = useSwipePaging((step) => go(step))
  const name = pageName(pages[current], current)
  const items = (): MenuEntry[] => [
    { type: 'label', label: t('pro.stage.pages.jumpTo') },
    ...pages.map((p, i): MenuEntry => ({
      label: pageName(p, i),
      checked: i === current,
      description: activePages?.[i] ? t('pro.stage.pages.playing') : undefined,
      onSelect: () => onChange(i)
    })),
    ...(menuExtra ? [{ type: 'separator' } as MenuEntry, ...menuExtra()] : [])
  ]
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); go(-1) }
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); go(1) }
  }
  const dots = count > 1 && count <= 12 && (
    <span aria-hidden className="flex items-center justify-center gap-1">
      {pages.map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-[width,background-color] duration-fast',
            i === current ? 'w-3' : 'w-1.5',
            activePages?.[i] ? 'bg-go-fg' : i === current ? 'bg-fg-secondary' : 'bg-fg-disabled/60'
          )}
        />
      ))}
    </span>
  )
  const label = (big: boolean) => (
    <DropdownMenu
      items={items}
      placement={variant === 'bar' ? 'top-start' : 'bottom-start'}
      trigger={(p) => (
        <button
          ref={p.ref}
          type="button"
          onClick={p.onClick}
          aria-haspopup={p['aria-haspopup']}
          aria-expanded={p['aria-expanded']}
          aria-label={t('pro.stage.pages.selectorAria', { name, n: current + 1, count })}
          title={t('pro.stage.pages.selectorTooltip')}
          className={cn(
            'flex min-w-0 flex-col items-center justify-center rounded-md px-1.5 transition-colors duration-fast hover:bg-surface-3 active:bg-surface-4',
            p.active && 'bg-surface-3',
            big ? 'h-control-lg flex-1 gap-0.5' : 'h-control-sm flex-1'
          )}
        >
          <span className={cn('max-w-full truncate font-semibold leading-tight text-fg-primary', big ? 'text-base' : 'text-xs')}>{name}</span>
          {big && <span className="font-mono text-2xs tabular leading-none text-fg-tertiary">{current + 1}/{count}</span>}
        </button>
      )}
    />
  )

  if (variant === 'bar') {
    return (
      <div
        role="group"
        aria-label={t('pro.stage.pages.aria')}
        onKeyDown={onKeyDown}
        {...swipe}
        className={cn('flex w-full touch-pan-y flex-col items-stretch gap-1', className)}
      >
        <div className="flex items-center gap-0.5">
          <IconButton icon={LuChevronLeft} size="sm" variant="ghost" label={t('pro.stage.pages.previous')} disabled={current <= 0} onClick={() => go(-1)} />
          <span className="min-w-0 flex-1 text-center font-mono text-sm font-semibold tabular text-fg-primary">{current + 1}</span>
          <IconButton icon={LuChevronRight} size="sm" variant="ghost" label={t('pro.stage.pages.next')} disabled={current >= count - 1} onClick={() => go(1)} />
        </div>
        {label(false)}
        {dots}
      </div>
    )
  }

  const big = variant === 'stage'
  return (
    <div
      role="group"
      aria-label={t('pro.stage.pages.aria')}
      onKeyDown={onKeyDown}
      {...swipe}
      className={cn(
        'flex min-w-0 touch-pan-y items-center gap-1 rounded-lg bg-surface-0 p-1 ring-1 ring-inset ring-line',
        big ? 'w-[248px]' : 'w-full',
        className
      )}
    >
      <IconButton icon={LuChevronLeft} size={big ? 'lg' : 'md'} variant="ghost" label={t('pro.stage.pages.previous')} disabled={current <= 0} onClick={() => go(-1)} />
      <div className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5">
        {label(big)}
        {!big && dots}
      </div>
      <IconButton icon={LuChevronRight} size={big ? 'lg' : 'md'} variant="ghost" label={t('pro.stage.pages.next')} disabled={current >= count - 1} onClick={() => go(1)} />
    </div>
  )
}
