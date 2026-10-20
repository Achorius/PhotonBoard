// ============================================================
// Groups panel — create, rename, colour, nest, fill from the
// selection, remove members. Tap a group to select its fixtures
// (it also becomes the panel's selection: Delete / F2 act on it).
// Every action is reachable by a visible button or the "…" menu
// (no hover-only controls, no drag-and-drop: works with fingers).
// ============================================================

import { memo, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  LuArrowUpToLine, LuChevronRight, LuCornerDownRight, LuEllipsis, LuFolderInput, LuFolderPlus, LuListChecks, LuMinus, LuPalette,
  LuPencil, LuPlus, LuTrash2, LuUsers, LuX
} from 'react-icons/lu'
import type { Group, PatchEntry } from '@shared/types'
import {
  Button, DropdownMenu, EmptyState, IconButton, Panel, PanelBody, PanelHeader, Popover, SWATCH_COLORS, SwatchPicker, cn,
  formatAddress, formatShortcut, prompt, toast, usePopover, type MenuEntry
} from '@renderer/components/ui'
import { t as tr, useT } from '@renderer/i18n'
import { historyStep, undoStep } from '@renderer/lib/history'
import { deleteWithUndo, useSelectionActions } from '@renderer/lib/selection-actions'
import { usePatchStore } from '@renderer/stores/patch-store'
import { nextGroupColor } from './patch-hooks'

async function renameGroup(g: Group): Promise<void> {
  const name = await prompt({ title: tr('patch.groups.renameTitle'), label: tr('patch.shared.groupName'), defaultValue: g.name, confirmLabel: tr('common.rename') })
  if (name && name !== g.name) usePatchStore.getState().updateGroup(g.id, { name })
}

function groupLabel(g: Group): string {
  return tr('patch.selection.group', { name: g.name })
}

function deleteGroupConfirm() {
  return { message: tr('patch.groups.deleteMessage', { keys: formatShortcut('Mod+Z') }), confirmLabel: tr('patch.groups.deleteAction') }
}

/** Delete a group (confirm, one undo step, Undo toast). Its fixtures stay patched. */
function deleteGroup(g: Group): void {
  void deleteWithUndo({ label: groupLabel(g), confirm: deleteGroupConfirm(), run: () => usePatchStore.getState().removeGroup(g.id) })
}

export function GroupsPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const t = useT()
  const groups = usePatchStore((s) => s.groups)
  const patch = usePatchStore((s) => s.patch)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // The group last tapped in this panel: Delete / F2 act on it
  const [activeId, setActiveId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const entries = useMemo(() => new Map(patch.map((p) => [p.id, p])), [patch])
  // Groups whose parent is gone are shown at the top level (never lost)
  const childrenOf = useMemo(() => {
    const map = new Map<string | undefined, Group[]>()
    for (const g of groups) {
      const parent = g.parentGroupId && byId.has(g.parentGroupId) ? g.parentGroupId : undefined
      const list = map.get(parent)
      if (list) list.push(g)
      else map.set(parent, [g])
    }
    return map
  }, [groups, byId])
  const selectionKey = useMemo(() => [...selectedIds].sort().join(','), [selectedIds])
  const active = activeId ? byId.get(activeId) ?? null : null

  useSelectionActions(active ? {
    label: () => groupLabel(active),
    delete: () => usePatchStore.getState().removeGroup(active.id),
    confirmDelete: deleteGroupConfirm(),
    rename: () => { void renameGroup(active) }
  } : null, { scope: panelRef })

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const createGroup = async (parent?: Group) => {
    const sel = usePatchStore.getState().selectedFixtureIds
    const name = await prompt({
      title: parent ? tr('patch.groups.newSubTitle', { name: parent.name }) : tr('patch.shared.newGroup'),
      message: sel.length > 0 ? tr('patch.groups.newMessage', { count: sel.length }) : tr('patch.groups.newMessageEmpty'),
      label: tr('patch.shared.groupName'),
      placeholder: tr('patch.groups.namePlaceholder'),
      confirmLabel: tr('patch.shared.createGroup')
    })
    if (!name) return
    const store = usePatchStore.getState()
    store.addGroup(name, parent?.color ?? nextGroupColor(store.groups), parent?.id)
    const created = usePatchStore.getState().groups.at(-1)
    if (created && sel.length > 0) store.addToGroup(created.id, sel)
    if (created) setActiveId(created.id)
    if (parent) setExpanded((prev) => new Set(prev).add(parent.id))
  }

  const renderLevel = (parentId: string | undefined, depth: number): React.ReactNode =>
    (childrenOf.get(parentId) ?? []).map((g) => (
      <div key={g.id} role="treeitem" aria-expanded={expanded.has(g.id)} aria-level={depth + 1} aria-selected={g.id === activeId}>
        <GroupRow
          group={g}
          depth={depth}
          expanded={expanded.has(g.id)}
          active={g.id === activeId}
          hasChildren={(childrenOf.get(g.id)?.length ?? 0) > 0}
          selectionKey={selectionKey}
          onToggle={toggle}
          onActivate={setActiveId}
          onCreateSub={createGroup}
        />
        {expanded.has(g.id) && (
          <div role="group">
            {g.fixtureIds.map((fid) => {
              const entry = entries.get(fid)
              return entry ? <MemberRow key={fid} groupId={g.id} entry={entry} depth={depth + 1} onTap={() => setActiveId(null)} /> : null
            })}
            {g.fixtureIds.length === 0 && (
              <p className="py-1.5 text-xs text-fg-tertiary" style={{ paddingLeft: 36 + (depth + 1) * 14 }}>{t('patch.groups.noFixturesYet')}</p>
            )}
            {renderLevel(g.id, depth + 1)}
          </div>
        )}
      </div>
    ))

  return (
    <div ref={panelRef} className="contents">
      <Panel variant="inset" className={cn('border-l border-line', className)} style={style} aria-label={t('common.groups')} data-groups-panel="">
        <PanelHeader
          icon={LuUsers}
          title={t('common.groups')}
          count={groups.length || undefined}
          actions={<Button size="sm" variant="ghost" icon={LuFolderPlus} onClick={() => { void createGroup() }}>{t('common.new')}</Button>}
        />
        <PanelBody className="py-1">
          {groups.length === 0 ? (
            <EmptyState
              size="sm"
              icon={LuUsers}
              title={t('patch.groups.emptyTitle')}
              description={t('patch.groups.emptyDescription')}
              action={<Button size="sm" variant="primary" icon={LuFolderPlus} onClick={() => { void createGroup() }}>
                {selectedIds.length > 0 ? t('patch.groups.groupSelected', { count: selectedIds.length }) : t('patch.shared.newGroup')}
              </Button>}
            />
          ) : (
            <div role="tree" aria-label={t('common.groups')}>{renderLevel(undefined, 0)}</div>
          )}
        </PanelBody>
        {selectedIds.length > 0 && groups.length > 0 && (
          <p className="shrink-0 border-t border-line-subtle px-3 py-2 text-xs text-fg-tertiary">
            {t.rich('patch.groups.footerHint', {
              selected: <span className="text-info-fg">{t('common.selected', { count: selectedIds.length })}</span>,
              icon: <LuPlus size={12} aria-label={t('patch.groups.addIcon')} className="inline align-[-2px]" />
            })}
          </p>
        )}
      </Panel>
    </div>
  )
}

const GroupRow = memo(function GroupRow({ group: g, depth, expanded, active, hasChildren, selectionKey, onToggle, onActivate, onCreateSub }: {
  group: Group
  depth: number
  expanded: boolean
  /** The panel's selection (Delete / F2): shows its delete button */
  active: boolean
  hasChildren: boolean
  /** Sorted selection ids joined — re-renders rows when the selection changes */
  selectionKey: string
  onToggle: (id: string) => void
  onActivate: (id: string) => void
  onCreateSub: (parent: Group) => void
}) {
  const t = useT() // memo leaf: re-render on a language change
  const colorPop = usePopover()
  const selected = selectionKey ? selectionKey.split(',') : []
  const selCount = selected.length
  const inGroup = selected.filter((id) => g.fixtureIds.includes(id)).length
  const isGroupSelection = g.fixtureIds.length > 0 && selCount === g.fixtureIds.length && inGroup === selCount

  const menu = (): MenuEntry[] => {
    const store = usePatchStore.getState()
    const sel = store.selectedFixtureIds
    const descendants = new Set<string>([g.id])
    let grew = true
    while (grew) {
      grew = false
      for (const x of store.groups) if (x.parentGroupId && descendants.has(x.parentGroupId) && !descendants.has(x.id)) { descendants.add(x.id); grew = true }
    }
    const targets = store.groups.filter((x) => !descendants.has(x.id) && x.id !== g.parentGroupId)
    return [
      { label: tr('patch.groups.menu.selectFixtures'), icon: LuListChecks, disabled: g.fixtureIds.length === 0, onSelect: () => store.selectGroup(g.id) },
      {
        label: sel.length > 0 ? tr('patch.groups.menu.addSelectedCount', { count: sel.length }) : tr('patch.groups.menu.addSelected'),
        icon: LuPlus, disabled: sel.length === 0 || sel.every((id) => g.fixtureIds.includes(id)), onSelect: () => store.addToGroup(g.id, sel)
      },
      {
        label: tr('patch.groups.menu.removeSelected'), icon: LuMinus, disabled: !sel.some((id) => g.fixtureIds.includes(id)),
        onSelect: () => store.removeFromGroup(g.id, sel)
      },
      { type: 'separator' },
      { label: tr('common.renameEllipsis'), icon: LuPencil, shortcut: 'F2', onSelect: () => { void renameGroup(g) } },
      { label: tr('patch.groups.menu.colour'), icon: LuPalette, onSelect: () => colorPop.setOpen(true) },
      { label: tr('patch.groups.menu.newSub'), icon: LuCornerDownRight, onSelect: () => onCreateSub(g) },
      {
        label: tr('patch.groups.menu.moveInto'), icon: LuFolderInput,
        submenu: [
          ...(g.parentGroupId ? [{ label: tr('patch.groups.menu.topLevel'), icon: LuArrowUpToLine, onSelect: () => store.moveSubgroup(g.id, undefined) }] : []),
          ...targets.map((x) => ({ label: x.name, onSelect: () => store.moveSubgroup(g.id, x.id) }))
        ]
      },
      { type: 'separator' },
      { label: tr('patch.groups.menu.deleteGroup'), icon: LuTrash2, danger: true, shortcut: 'Backspace', onSelect: () => deleteGroup(g) }
    ]
  }

  return (
    <div
      className={cn('group/row relative flex min-h-row items-center gap-1 pr-1.5', isGroupSelection ? 'bg-info/15' : 'hover:bg-surface-2')}
      style={{ paddingLeft: 4 + depth * 14 }}
      data-group-row={g.id}
    >
      {active && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-info-fg" />}
      <button
        type="button"
        aria-label={expanded ? t('patch.groups.collapse', { name: g.name }) : t('patch.groups.expand', { name: g.name })}
        onClick={() => onToggle(g.id)}
        className="flex h-control-sm w-control-sm shrink-0 items-center justify-center rounded-sm text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary"
      >
        <LuChevronRight size={14} aria-hidden className={cn('transition-transform duration-fast', expanded && 'rotate-90', !hasChildren && g.fixtureIds.length === 0 && 'opacity-40')} />
      </button>
      <button
        ref={colorPop.anchorRef}
        type="button"
        aria-label={t('patch.groups.colourOf', { name: g.name })}
        onClick={colorPop.toggle}
        className="flex h-control-sm w-control-sm shrink-0 items-center justify-center rounded-sm hover:bg-surface-3"
      >
        <span aria-hidden className="h-3 w-3 rounded-full ring-1 ring-inset ring-white/10" style={{ backgroundColor: g.color }} />
      </button>
      <button
        type="button"
        onClick={() => {
          onActivate(g.id)
          if (isGroupSelection) usePatchStore.getState().clearSelection()
          else usePatchStore.getState().selectGroup(g.id)
        }}
        onDoubleClick={() => { void renameGroup(g) }}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        title={t('patch.groups.selectTitle')}
        aria-pressed={isGroupSelection}
      >
        <span className={cn('truncate text-sm', isGroupSelection || active ? 'font-medium text-fg-primary' : 'text-fg-primary')}>{g.name}</span>
        {inGroup > 0 && !isGroupSelection && <span className="shrink-0 text-2xs tabular text-info-fg">{t('patch.groups.selCount', { count: inGroup })}</span>}
      </button>
      <span className="w-6 shrink-0 text-right text-xs tabular text-fg-tertiary">{g.fixtureIds.length}</span>
      {selCount > 0 && inGroup < selCount && (
        <IconButton size="sm" icon={LuPlus} label={t('patch.groups.addTo', { count: selCount, name: g.name })} onClick={() => usePatchStore.getState().addToGroup(g.id, selected)} />
      )}
      {active && (
        <IconButton size="sm" icon={LuTrash2} label={t('patch.groups.deleteAria', { name: g.name })} shortcut="Backspace" onClick={() => deleteGroup(g)} />
      )}
      <DropdownMenu
        placement="bottom-end"
        items={menu}
        trigger={(p) => <IconButton {...p} size="sm" icon={LuEllipsis} label={t('patch.shared.actionsFor', { name: g.name })} />}
      />
      <Popover {...colorPop.props} aria-label={t('patch.groups.colourOf', { name: g.name })}>
        <div className="p-2">
          <SwatchPicker
            colors={SWATCH_COLORS}
            value={g.color}
            onChange={(c) => { usePatchStore.getState().updateGroup(g.id, { color: c }); colorPop.close() }}
          />
        </div>
      </Popover>
    </div>
  )
})

const MemberRow = memo(function MemberRow({ groupId, entry, depth, onTap }: { groupId: string; entry: PatchEntry; depth: number; onTap: () => void }) {
  const t = useT() // memo leaf: re-render on a language change
  const selected = usePatchStore((s) => s.selectedFixtureIds.includes(entry.id))
  return (
    <div className={cn('flex min-h-row items-center gap-2 pr-1.5', selected ? 'bg-info/10' : 'hover:bg-surface-2')} style={{ paddingLeft: 22 + depth * 14 }}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        onClick={(e) => { onTap(); usePatchStore.getState().selectFixture(entry.id, e.metaKey || e.ctrlKey || isTouchDensity()) }}
      >
        <span className={cn('truncate text-xs', selected ? 'text-fg-primary' : 'text-fg-secondary')}>{entry.name}</span>
      </button>
      <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{formatAddress(entry.universe, entry.address)}</span>
      <IconButton
        size="sm"
        icon={LuX}
        label={t('patch.groups.removeMember', { name: entry.name })}
        onClick={() => {
          const step = historyStep(tr('patch.groups.memberRemovedStep', { name: entry.name }), () => usePatchStore.getState().removeFromGroup(groupId, [entry.id]))
          toast.info(tr('patch.groups.memberRemoved', { name: entry.name }), {
            id: 'history',
            action: step ? { label: tr('common.undo'), onClick: () => { undoStep(step.id) } } : undefined
          })
        }}
      />
    </div>
  )
})

function isTouchDensity(): boolean {
  return document.documentElement.dataset.density === 'touch'
}
