// ============================================================
// Menus: <DropdownMenu> on a trigger, useContextMenu() for
// right-click / long-press. Items support icons, shortcuts,
// checked state, danger, disabled, and drill-down submenus
// (static or loaded on open — e.g. "Open Recent").
// Keyboard: ↑ ↓ Home End move, Enter/Space select, → opens a
// submenu, ← / Backspace goes back, Esc closes.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import { LuCheck, LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { cn } from './cn'
import { Popover } from './Popover'
import { Spinner } from './Spinner'
import { formatShortcut } from './Kbd'
import { pointRect, type Placement, type Rect } from './positioning'

export type MenuEntry =
  | {
      type?: 'item'
      label: string
      icon?: IconType
      /** "Mod+S" — display only, bind it in useKeyboardShortcuts */
      shortcut?: string
      description?: string
      onSelect?: () => void
      disabled?: boolean
      danger?: boolean
      /** Checkmark (menuitemcheckbox) */
      checked?: boolean
      /** Drill-down: items, or a loader called when opened */
      submenu?: MenuEntry[] | (() => Promise<MenuEntry[]>)
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }

type Item = Extract<MenuEntry, { label: string; type?: 'item' }>

function isItem(e: MenuEntry): e is Item {
  return e.type === undefined || e.type === 'item'
}

export interface MenuProps {
  items: MenuEntry[]
  onClose: () => void
  className?: string
}

/** Menu list (normally used through DropdownMenu / useContextMenu) */
export function Menu({ items, onClose, className }: MenuProps) {
  const [stack, setStack] = useState<{ title: string; items: MenuEntry[] | null }[]>([])
  const level = stack[stack.length - 1]
  const entries = level ? level.items : items
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const selectable = (entries ?? []).map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0)

  useEffect(() => {
    setActive(selectable[0] ?? -1)
    listRef.current?.focus()
  }, [stack.length, entries])

  const openSub = useCallback(async (item: Item) => {
    const sub = item.submenu!
    if (Array.isArray(sub)) { setStack((s) => [...s, { title: item.label, items: sub }]); return }
    setStack((s) => [...s, { title: item.label, items: null }])
    let loaded: MenuEntry[]
    try { loaded = await sub() } catch { loaded = [] }
    setStack((s) => s.map((l, i) => (i === s.length - 1 && l.title === item.label ? { ...l, items: loaded } : l)))
  }, [])

  const choose = (item: Item) => {
    if (item.disabled) return
    if (item.submenu) { void openSub(item); return }
    onClose()
    item.onSelect?.()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pos = selectable.indexOf(active)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (selectable.length === 0) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive(selectable[(pos + d + selectable.length) % selectable.length])
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(e.key === 'Home' ? selectable[0] : selectable[selectable.length - 1])
    } else if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && entries)) {
      const entry = entries?.[active]
      if (entry && isItem(entry) && (e.key !== 'ArrowRight' || entry.submenu)) {
        e.preventDefault()
        choose(entry)
      }
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && stack.length > 0) {
      e.preventDefault()
      setStack((s) => s.slice(0, -1))
    }
  }

  return (
    <div
      ref={listRef}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn('flex max-h-[min(480px,calc(100vh-32px))] min-w-[200px] max-w-[320px] flex-col overflow-y-auto py-1 outline-none', className)}
    >
      {level && (
        <>
          <button
            type="button"
            className="mx-1 flex h-control-sm items-center gap-1.5 rounded px-2 text-left text-xs font-semibold text-fg-secondary hover:bg-surface-3"
            onClick={() => setStack((s) => s.slice(0, -1))}
          >
            <LuChevronLeft size={14} aria-hidden />
            {level.title}
          </button>
          <div role="separator" className="my-1 h-px bg-line-subtle" />
        </>
      )}
      {entries === null ? (
        <div className="flex h-control items-center gap-2 px-3 text-xs text-fg-tertiary"><Spinner size={14} /> Loading…</div>
      ) : entries.length === 0 ? (
        <div className="flex h-control items-center px-3 text-xs text-fg-tertiary">Nothing here</div>
      ) : entries.map((entry, i) => {
        if (entry.type === 'separator') return <div key={i} role="separator" className="my-1 h-px bg-line-subtle" />
        if (entry.type === 'label') return <div key={i} className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{entry.label}</div>
        const Icon = entry.icon
        return (
          <button
            key={i}
            type="button"
            role={entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={entry.checked}
            aria-haspopup={entry.submenu ? 'menu' : undefined}
            aria-disabled={entry.disabled || undefined}
            tabIndex={-1}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !entry.disabled) setActive(i) }}
            onClick={() => choose(entry)}
            className={cn(
              'mx-1 flex min-h-control shrink-0 items-center gap-2.5 rounded px-2 py-1 text-left text-sm',
              entry.disabled ? 'cursor-default text-fg-disabled' : entry.danger ? 'text-danger-fg' : 'text-fg-primary',
              i === active && !entry.disabled && (entry.danger ? 'bg-danger/15' : 'bg-surface-4')
            )}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {entry.checked ? <LuCheck size={14} aria-hidden /> : Icon ? <Icon size={15} aria-hidden className={entry.danger ? undefined : 'text-fg-secondary'} /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col py-1">
              <span className="truncate">{entry.label}</span>
              {entry.description && <span className="truncate text-xs text-fg-tertiary">{entry.description}</span>}
            </span>
            {entry.shortcut && <span className="shrink-0 pl-4 text-xs text-fg-tertiary">{formatShortcut(entry.shortcut)}</span>}
            {entry.submenu && <LuChevronRight size={14} aria-hidden className="shrink-0 text-fg-tertiary" />}
          </button>
        )
      })}
    </div>
  )
}

export interface DropdownMenuProps {
  items: MenuEntry[] | (() => MenuEntry[])
  /** Render the trigger; spread `props` on a Button (ref, onClick, aria). */
  trigger: (props: {
    ref: React.RefObject<HTMLButtonElement | null>
    onClick: () => void
    'aria-haspopup': 'menu'
    'aria-expanded': boolean
    active: boolean
  }) => React.ReactNode
  placement?: Placement
}

/** Menu opened by a button (File menu, "More" actions…) */
export function DropdownMenu({ items, trigger, placement = 'bottom-start' }: DropdownMenuProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  // Items are resolved when the menu opens (fresh state, stable while open)
  const [openItems, setOpenItems] = useState<MenuEntry[] | null>(null)
  const close = useCallback(() => {
    setOpenItems(null)
    anchorRef.current?.focus()
  }, [])
  const toggle = () => setOpenItems((cur) => (cur ? null : typeof items === 'function' ? items() : items))
  return (
    <>
      {trigger({ ref: anchorRef, onClick: toggle, 'aria-haspopup': 'menu', 'aria-expanded': !!openItems, active: !!openItems })}
      <Popover open={!!openItems} onClose={close} anchor={anchorRef} placement={placement} role="presentation">
        {openItems && <Menu items={openItems} onClose={close} />}
      </Popover>
    </>
  )
}

/** Where a context menu opens: a mouse/pointer event, or a synthetic point */
export interface MenuPoint {
  clientX: number
  clientY: number
  preventDefault: () => void
  stopPropagation?: () => void
}

const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP = 8

// One long press can be pending at a time (primary finger), so the state is shared
const press: { timer: ReturnType<typeof setTimeout> | null; x: number; y: number; firedAt: number } = { timer: null, x: 0, y: 0, firedAt: 0 }

function cancelPress() {
  if (press.timer) clearTimeout(press.timer)
  press.timer = null
}

/** A long press just opened a menu: swallow the click / native contextmenu that follow it */
const justLongPressed = () => performance.now() - press.firedAt < 800

/**
 * Handlers that call `onMenu` on right-click **and** on a touch / pen long-press
 * (iOS Safari never fires `contextmenu`; Chromium on touchscreens does, the
 * duplicate is ignored). The click that ends a long press is swallowed.
 * Spread on the target; don't combine with your own pointer/click handlers of the same name.
 *   <tr {...contextMenuHandlers((e) => openRowMenu(id, e))}>
 */
export function contextMenuHandlers(onMenu: (e: MenuPoint) => void) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      if (justLongPressed()) { e.preventDefault(); return }
      // Chromium's own touch long-press got there first: same gesture, one menu
      if (press.timer) { cancelPress(); press.firedAt = performance.now() }
      onMenu(e)
    },
    onPointerDown: (e: React.PointerEvent) => {
      cancelPress()
      if (e.pointerType === 'mouse' || !e.isPrimary) return
      const { clientX, clientY } = e
      press.x = clientX
      press.y = clientY
      press.timer = setTimeout(() => {
        press.timer = null
        press.firedAt = performance.now()
        onMenu({ clientX, clientY, preventDefault: () => {} })
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (press.timer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancelPress()
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onClickCapture: (e: React.MouseEvent) => {
      if (justLongPressed()) { e.preventDefault(); e.stopPropagation() }
    }
  }
}

/**
 * Context menu at the pointer (right-click, or long-press on touch).
 *   const ctx = useContextMenu()
 *   <div {...ctx.bind(items)}> … {ctx.menu}                    // right-click + long-press
 *   <div onContextMenu={(e) => ctx.open(e, [...items])}> …      // right-click (Chromium long-press)
 */
export function useContextMenu() {
  const [state, setState] = useState<{ at: Rect; items: MenuEntry[] } | null>(null)
  const close = useCallback(() => setState(null), [])
  const open = useCallback((e: MenuPoint, items: MenuEntry[]) => {
    e.preventDefault()
    e.stopPropagation?.()
    setState({ at: pointRect(e.clientX, e.clientY), items })
  }, [])
  /** Trigger handlers: items now, or built when the menu opens */
  const bind = useCallback((items: MenuEntry[] | (() => MenuEntry[])) => (
    contextMenuHandlers((e) => open(e, typeof items === 'function' ? items() : items))
  ), [open])
  const menu = (
    <Popover open={!!state} onClose={close} anchor={state?.at ?? null} placement="bottom-start" offset={2} role="presentation">
      {state && <Menu items={state.items} onClose={close} />}
    </Popover>
  )
  return { open, close, bind, isOpen: !!state, menu }
}
