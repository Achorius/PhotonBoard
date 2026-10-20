// ============================================================
// Pro executor menus (executor bar cells, stage page designer):
// button function, assign object, column fader function, pages.
// Built when the menu opens (fresh store state). Every change is ONE
// named undo step.
// ============================================================

import { LuCrosshair, LuLink2, LuPencil, LuPlus, LuSlidersHorizontal, LuTrash2, LuX } from 'react-icons/lu'
import type { ExecutorButtonFn, ExecutorCell, ExecutorColumnFader, ExecutorTargetKind } from '@shared/types'
import { prompt, type MenuEntry, type SelectOption } from '@renderer/components/ui'
import { t } from '@renderer/i18n'
import { historyStep } from '@renderer/lib/history'
import { deleteWithUndo } from '@renderer/lib/selection-actions'
import { selectExecutor } from '@renderer/lib/pro/executor-actions'
import type { ExecutorRef } from '@renderer/lib/pro/contracts'
import { useExecutorStore, MAX_PAGES } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { BUTTON_FNS, EXEC_ROWS, TARGET_KINDS, defaultFn, faderKey, parseFaderKey } from './executor-surface'
import { KIND_ICON, kindLabel } from './cell-visuals'
import { pageName } from './PageSelector'

/** Objects of a kind, for pickers: id, label ("3 · Verse"), in pool order */
export function objectsOf(kind: ExecutorTargetKind): { id: string; label: string; color?: string }[] {
  const named = (n: number | undefined, name: string) => (n ? `${n} · ${name || t('common.untitled')}` : name || t('common.untitled'))
  switch (kind) {
    case 'cuelist': return usePlaybackStore.getState().cuelists.map((c) => ({ id: c.id, label: named(c.number, c.name) }))
    case 'chase': return usePlaybackStore.getState().chases.map((c) => ({ id: c.id, label: named(c.number, c.name) }))
    case 'effect': return useEffectsStore.getState().effects.map((e) => ({ id: e.id, label: named(e.number, e.name) }))
    case 'macro': return usePoolStore.getState().macros.map((m) => ({ id: m.id, label: named(m.number, m.name), color: m.color }))
    case 'group': return usePatchStore.getState().groups.filter((g) => !g.parentGroupId).map((g) => ({ id: g.id, label: named(g.number, g.name), color: g.color }))
    case 'speed': return usePoolStore.getState().speedMasters.map((m) => ({ id: m.id, label: named(m.number, m.name) }))
  }
}

export function fnLabel(fn: ExecutorButtonFn): string {
  return t(`pro.stage.fn.${fn}`)
}

/** Put an object in a cell (one undo step) */
export function assignToCell(ref: ExecutorRef, target: { kind: ExecutorTargetKind; id: string } | null): void {
  const ex = useExecutorStore.getState()
  const prev = ex.pages[ref.page]?.cells[ref.col]?.[ref.row] ?? null
  const cell: ExecutorCell | null = target ? { kind: target.kind, id: target.id, mode: prev && prev.kind === target.kind ? prev.mode : 'toggle' } : null
  historyStep(target ? t('pro.stage.undo.assign') : t('pro.stage.undo.removeFromCell'), () => {
    useExecutorStore.getState().assignCell(ref.page, ref.col, ref.row, cell)
  })
}

/** Button function submenu */
export function buttonFnMenu(ref: ExecutorRef, cell: ExecutorCell): MenuEntry {
  const current = cell.button
  const set = (fn: ExecutorButtonFn | undefined) => historyStep(t('pro.stage.undo.buttonFn'), () => {
    useExecutorStore.getState().setCellButton(ref.page, ref.col, ref.row, fn)
  })
  return {
    label: t('pro.stage.menu.buttonFn'),
    description: fnLabel(current ?? defaultFn(cell.mode)),
    submenu: [
      { label: t('pro.stage.menu.fnFromMode', { fn: fnLabel(defaultFn(cell.mode)) }), checked: !current, onSelect: () => set(undefined) },
      { type: 'separator' },
      ...BUTTON_FNS.map((fn): MenuEntry => ({ label: fnLabel(fn), description: t(`pro.stage.fnHint.${fn}`), checked: current === fn, onSelect: () => set(fn) }))
    ]
  }
}

/** Assign submenu: one submenu per object kind */
export function assignMenu(ref: ExecutorRef, cell: ExecutorCell | null): MenuEntry {
  return {
    label: cell ? t('pro.stage.menu.assignOther') : t('pro.stage.menu.assign'),
    icon: LuLink2,
    submenu: TARGET_KINDS.map((kind): MenuEntry => {
      const list = objectsOf(kind)
      return {
        label: kindLabel(kind),
        icon: KIND_ICON[kind],
        disabled: list.length === 0,
        description: list.length === 0 ? t('pro.stage.menu.noneOfKind') : undefined,
        submenu: list.map((o): MenuEntry => ({
          label: o.label,
          checked: !!cell && cell.kind === kind && cell.id === o.id,
          onSelect: () => assignToCell(ref, { kind, id: o.id })
        }))
      }
    })
  }
}

/** Column fader functions as options (value = faderKey) */
export function columnFaderOptions(): SelectOption<string>[] {
  const rows = Array.from({ length: EXEC_ROWS }, (_, r) => r)
  const groups = objectsOf('group')
  const speeds = objectsOf('speed')
  return [
    { value: 'column', label: t('pro.stage.fader.column') },
    ...rows.map((r) => ({ value: `cell:${r}`, label: t('pro.stage.fader.cell', { n: r + 1 }) })),
    { value: 'grandmaster', label: t('pro.stage.fader.grandmaster') },
    ...groups.map((g) => ({ value: `group:${g.id}`, label: t('pro.stage.fader.group', { name: g.label }) })),
    ...speeds.map((s) => ({ value: `speed:${s.id}`, label: t('pro.stage.fader.speed', { name: s.label }) })),
    ...rows.map((r) => ({ value: `rate:${r}`, label: t('pro.stage.fader.rate', { n: r + 1 }) })),
    ...rows.map((r) => ({ value: `xfade:${r}`, label: t('pro.stage.fader.xfade', { n: r + 1 }) }))
  ]
}

export function setColumnFaderFn(page: number, col: number, key: string): void {
  historyStep(t('pro.stage.undo.columnFader'), () => {
    useExecutorStore.getState().setColumnFader(page, col, parseFaderKey(key))
  })
}

/** Column fader submenu (cell menus) */
export function columnFaderMenu(page: number, col: number): MenuEntry {
  const current = faderKey(useExecutorStore.getState().pages[page]?.columns[col]?.fader as ExecutorColumnFader | undefined)
  const options = columnFaderOptions()
  return {
    label: t('pro.stage.menu.columnFader', { n: col + 1 }),
    icon: LuSlidersHorizontal,
    description: options.find((o) => o.value === current)?.label,
    submenu: options.map((o): MenuEntry => ({ label: o.label, checked: o.value === current, onSelect: () => setColumnFaderFn(page, col, o.value) }))
  }
}

/** Pro entries of a cell menu (after the cell's own entries) */
export function proCellEntries(ref: ExecutorRef, cell: ExecutorCell | null): MenuEntry[] {
  const selected = useProStore.getState().selectedExecutor
  const isSelected = !!selected && selected.page === ref.page && selected.col === ref.col && selected.row === ref.row
  const out: MenuEntry[] = [{ type: 'label', label: t('pro.stage.menu.proSection', { slot: `${ref.page + 1}.${ref.col * EXEC_ROWS + ref.row + 1}` }) }]
  if (cell) out.push(buttonFnMenu(ref, cell))
  out.push(assignMenu(ref, cell))
  out.push(columnFaderMenu(ref.page, ref.col))
  if (cell) {
    out.push(isSelected
      ? { label: t('pro.stage.menu.unselectGoTarget'), icon: LuX, onSelect: () => selectExecutor(null) }
      : { label: t('pro.stage.menu.selectGoTarget'), icon: LuCrosshair, description: t('pro.stage.menu.selectGoTargetHint'), onSelect: () => selectExecutor(ref) })
  }
  if (cell && cell.kind !== 'cuelist') {
    out.push({ label: t('pro.stage.menu.removeFromCell'), icon: LuX, onSelect: () => assignToCell(ref, null) })
  }
  return out
}

// ---------------------------------------------------------------
// Pages (Pro)
// ---------------------------------------------------------------

export function addExecutorPage(): void {
  let index = -1
  historyStep(t('pro.stage.undo.addPage'), () => { index = useExecutorStore.getState().addPage() })
  if (index >= 0) useExecutorStore.getState().setPage(index)
}

export async function renameExecutorPage(index: number): Promise<void> {
  const page = useExecutorStore.getState().pages[index]
  if (!page) return
  const name = await prompt({
    title: t('pro.stage.pages.renameTitle'),
    label: t('pro.stage.pages.renameLabel'),
    defaultValue: page.name,
    placeholder: pageName(page, index),
    confirmLabel: t('common.rename')
  })
  if (name === null || name === undefined) return
  historyStep(t('pro.stage.undo.renamePage'), () => useExecutorStore.getState().renamePage(index, name))
}

export function deleteExecutorPage(index: number): void {
  const page = useExecutorStore.getState().pages[index]
  if (!page || useExecutorStore.getState().pages.length <= 1) return
  void deleteWithUndo({
    label: t('pro.stage.pages.pageLabel', { name: pageName(page, index) }),
    run: () => useExecutorStore.getState().removePage(index),
    confirm: { message: t('pro.stage.pages.deleteMessage') }
  })
}

/** Page entries for the page selector menu (Pro) */
export function pageMenuExtra(current: number): MenuEntry[] {
  const count = useExecutorStore.getState().pages.length
  return [
    { label: t('pro.stage.pages.add'), icon: LuPlus, disabled: count >= MAX_PAGES, onSelect: addExecutorPage },
    { label: t('pro.stage.pages.rename'), icon: LuPencil, onSelect: () => { void renameExecutorPage(current) } },
    { label: t('pro.stage.pages.delete'), icon: LuTrash2, danger: true, disabled: count <= 1, onSelect: () => deleteExecutorPage(current) }
  ]
}
