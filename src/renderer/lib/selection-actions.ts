// ============================================================
// PhotonBoard — Keyboard actions on the current selection
//
// Views say what is selected and how to delete / duplicate /
// rename it; the global keyboard handler (hooks/useKeyboardShortcuts)
// and the Edit menu call the ACTIVE registration:
//
//   Delete / Backspace   deleteSelection()     confirm (danger) + Undo toast
//   Mod+D                duplicateSelection()
//   F2 / Enter           renameSelection()
//
// In a view:
//
//   const listRef = useRef<HTMLDivElement>(null)
//   useSelectionActions({
//     label: () => t('scenes.selection.scene', { name: cl.name }),  // en 'scene “Intro”', fr 'la scène « Intro »'
//     canDelete: () => !!cl,
//     delete: () => usePlaybackStore.getState().removeCuelist(cl.id),   // synchronous store changes
//     duplicate: () => usePlaybackStore.getState().duplicateCuelist(cl.id),
//     rename: () => startRename(cl.id)
//   }, { scope: listRef })
//   <div ref={listRef}>…</div>
//
// Which registration is active: the one whose `scope` element holds the
// last click / focus (the innermost when nested — the cue table inside the
// Scenes view wins over the scene list). When the last interaction was in
// no scope (top bar, empty space), the most recently mounted or used
// registration without `requireFocus`. `null` actions = nothing selected:
// the keys do nothing (they never fall through to another registration).
// ============================================================

import { useEffect, useRef, type RefObject } from 'react'
import { t } from '@renderer/i18n'
import { confirm } from '@renderer/components/ui/dialogs'
import { formatShortcut } from '@renderer/components/ui/Kbd'
import { showToast } from '@renderer/stores/toast-store'
import { historyStep, undoStep } from './history'

export interface ConfirmDeleteOptions {
  title?: string
  message?: string
  confirmLabel?: string
}

export interface SelectionActions {
  /**
   * The selection as a noun phrase that reads after "Delete …?" and "Deleted: …":
   * en 'scene “Intro”' / '3 fixtures', fr 'la scène « Intro »' / '3 projecteurs'.
   */
  label: () => string
  /** False = nothing deletable selected (Delete does nothing). Default: `delete` is defined. */
  canDelete?: () => boolean
  /** Remove the selection (SYNCHRONOUS store changes): recorded as ONE undo step, with an Undo toast. */
  delete?: () => void
  /**
   * Ask first (default true — the danger confirm dialog). false for trivial items that
   * are cheap to recreate (an empty cue, a marker); an object customises the dialog.
   */
  confirmDelete?: boolean | ConfirmDeleteOptions
  canDuplicate?: () => boolean
  /** Mod+D — recorded as one undo step */
  duplicate?: () => void
  canRename?: () => boolean
  /** F2 / Enter — usually opens an inline editor or prompt() */
  rename?: () => void
}

export interface SelectionScopeOptions {
  /** Element of this selection (list, table, canvas…): clicking / focusing inside it makes it active */
  scope?: RefObject<HTMLElement | null>
  /** Only active while the last interaction is inside `scope` — never the fallback (executor bar) */
  requireFocus?: boolean
}

interface Registration {
  id: number
  get: () => SelectionActions | null
  scope?: RefObject<HTMLElement | null>
  requireFocus: boolean
  activatedAt: number
}

const registrations = new Map<number, Registration>()
let regSeq = 0
let clock = 0
let lastInteraction: Element | null = null
let tracking = false

function onInteraction(e: Event): void {
  const target = e.target instanceof Element ? e.target : null
  // Clicks inside dialogs / menus (portals) do not move the keyboard context
  if (target?.closest('[role="dialog"], [role="menu"], [role="listbox"][data-popover]')) return
  lastInteraction = target
  const hit = innermostContaining(target)
  if (hit) hit.activatedAt = ++clock
}

function ensureTracking(): void {
  if (tracking || typeof document === 'undefined') return
  tracking = true
  document.addEventListener('pointerdown', onInteraction, true)
  document.addEventListener('focusin', onInteraction, true)
}

function innermostContaining(target: Element | null): Registration | null {
  if (!target) return null
  let best: Registration | null = null
  for (const r of registrations.values()) {
    const el = r.scope?.current
    if (!el || !el.contains(target)) continue
    if (!best || (best.scope?.current?.contains(el) ?? false)) best = r
  }
  return best
}

/** The registration the keyboard acts on (see the header). */
function activeRegistration(): Registration | null {
  const inScope = innermostContaining(lastInteraction?.isConnected ? lastInteraction : null)
  if (inScope) return inScope
  let best: Registration | null = null
  for (const r of registrations.values()) {
    if (r.requireFocus) continue
    if (!best || r.activatedAt > best.activatedAt) best = r
  }
  return best
}

/** Register selection actions outside React. Returns the unregister function. */
export function registerSelectionActions(get: () => SelectionActions | null, options: SelectionScopeOptions = {}): () => void {
  ensureTracking()
  const id = ++regSeq
  registrations.set(id, { id, get, scope: options.scope, requireFocus: !!options.requireFocus, activatedAt: ++clock })
  return () => { registrations.delete(id) }
}

/**
 * Hook: while the component is mounted, Delete / Mod+D / F2 act on `actions`
 * (`null` = nothing selected). Pass a fresh object every render — the latest
 * one is used, nothing re-registers.
 */
export function useSelectionActions(actions: SelectionActions | null, options: SelectionScopeOptions = {}): void {
  const latest = useRef(actions)
  latest.current = actions
  const { scope, requireFocus } = options
  useEffect(() => registerSelectionActions(() => latest.current, { scope, requireFocus }), [scope, requireFocus])
}

/** Actions of the active selection, or null (Edit menu: enable / label its items). */
export function getActiveSelection(): SelectionActions | null {
  try {
    return activeRegistration()?.get() ?? null
  } catch (e) {
    console.error('[Selection] actions failed:', e)
    return null
  }
}

export function canDeleteSelection(): boolean {
  const a = getActiveSelection()
  return !!a?.delete && (a.canDelete?.() ?? true)
}

export function canDuplicateSelection(): boolean {
  const a = getActiveSelection()
  return !!a?.duplicate && (a.canDuplicate?.() ?? true)
}

export function canRenameSelection(): boolean {
  const a = getActiveSelection()
  return !!a?.rename && (a.canRename?.() ?? true)
}

export interface DeleteWithUndoOptions {
  /** Noun phrase (see SelectionActions.label) */
  label: string
  /** Synchronous store changes */
  run: () => void
  confirm?: boolean | ConfirmDeleteOptions
}

/**
 * The one way to delete something a user created: optional danger confirm,
 * one undo step, then "Deleted: … — Undo" toast. Use it for Delete keys,
 * "…" menu items and trash buttons alike. Resolves true when deleted.
 */
export async function deleteWithUndo(opts: DeleteWithUndoOptions): Promise<boolean> {
  const ask = opts.confirm ?? true
  if (ask) {
    const o = typeof ask === 'object' ? ask : {}
    const ok = await confirm({
      title: o.title ?? t('edit.confirmDeleteTitle', { what: opts.label }),
      message: o.message ?? t('edit.confirmDeleteMessage', { keys: formatShortcut('Mod+Z') }),
      confirmLabel: o.confirmLabel ?? t('edit.confirmDeleteAction'),
      tone: 'danger'
    })
    if (!ok) return false
  }
  const step = historyStep(t('shell.editMenu.deleteWhat', { what: opts.label }), opts.run)
  showToast('info', t('edit.deleted', { what: opts.label }), {
    id: 'history',
    duration: 6000,
    action: step ? { label: t('common.undo'), onClick: () => { undoStep(step.id) } } : undefined
  })
  return true
}

let deleting = false

/** Delete / Backspace: delete the active selection. Resolves true when something was deleted. */
export async function deleteSelection(): Promise<boolean> {
  if (deleting) return false
  const a = getActiveSelection()
  if (!a?.delete || !(a.canDelete?.() ?? true)) return false
  deleting = true
  try {
    return await deleteWithUndo({ label: a.label(), run: a.delete, confirm: a.confirmDelete })
  } finally {
    deleting = false
  }
}

/** Mod+D: duplicate the active selection (one undo step). */
export function duplicateSelection(): boolean {
  const a = getActiveSelection()
  if (!a?.duplicate || !(a.canDuplicate?.() ?? true)) return false
  const label = a.label()
  historyStep(t('shell.editMenu.duplicateWhat', { what: label }), a.duplicate)
  return true
}

/** F2 / Enter: rename the active selection. */
export function renameSelection(): boolean {
  const a = getActiveSelection()
  if (!a?.rename || !(a.canRename?.() ?? true)) return false
  a.rename()
  return true
}

/** Test helper */
export function __resetSelectionActionsForTests(): void {
  registrations.clear()
  lastInteraction = null
}
