// ============================================================
// Groups panel — create, rename, colour, nest, fill from the
// selection, remove members. Tap a group to select its fixtures.
// Every action is reachable by a visible button or the "…" menu
// (no hover-only controls, no drag-and-drop: works with fingers).
// ============================================================

import { memo, useMemo, useState } from 'react'
import type React from 'react'
import {
  LuArrowUpToLine, LuChevronRight, LuCornerDownRight, LuEllipsis, LuFolderInput, LuFolderPlus, LuListChecks, LuMinus, LuPalette,
  LuPencil, LuPlus, LuTrash2, LuUsers, LuX
} from 'react-icons/lu'
import type { Group, PatchEntry } from '@shared/types'
import {
  Button, DropdownMenu, EmptyState, IconButton, Panel, PanelBody, PanelHeader, Popover, SWATCH_COLORS, SwatchPicker, cn, confirm,
  formatAddress, prompt, toast, usePopover, type MenuEntry
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { nextGroupColor } from './patch-hooks'

export function GroupsPanel({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const groups = usePatchStore((s) => s.groups)
  const patch = usePatchStore((s) => s.patch)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

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

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const createGroup = async (parent?: Group) => {
    const sel = usePatchStore.getState().selectedFixtureIds
    const name = await prompt({
      title: parent ? `New sub-group of ${parent.name}` : 'New group',
      message: sel.length > 0 ? `It will contain the ${sel.length} selected fixture${sel.length === 1 ? '' : 's'}.` : 'Add fixtures later from the patch selection.',
      label: 'Group name',
      placeholder: 'e.g. Back truss',
      confirmLabel: 'Create group'
    })
    if (!name) return
    const store = usePatchStore.getState()
    store.addGroup(name, parent?.color ?? nextGroupColor(store.groups), parent?.id)
    const created = usePatchStore.getState().groups.at(-1)
    if (created && sel.length > 0) store.addToGroup(created.id, sel)
    if (parent) setExpanded((prev) => new Set(prev).add(parent.id))
  }

  const renderLevel = (parentId: string | undefined, depth: number): React.ReactNode =>
    (childrenOf.get(parentId) ?? []).map((g) => (
      <div key={g.id} role="treeitem" aria-expanded={expanded.has(g.id)} aria-level={depth + 1}>
        <GroupRow
          group={g}
          depth={depth}
          expanded={expanded.has(g.id)}
          hasChildren={(childrenOf.get(g.id)?.length ?? 0) > 0}
          selectionKey={selectionKey}
          onToggle={toggle}
          onCreateSub={createGroup}
        />
        {expanded.has(g.id) && (
          <div role="group">
            {g.fixtureIds.map((fid) => {
              const entry = entries.get(fid)
              return entry ? <MemberRow key={fid} groupId={g.id} entry={entry} depth={depth + 1} /> : null
            })}
            {g.fixtureIds.length === 0 && (
              <p className="py-1.5 text-xs text-fg-tertiary" style={{ paddingLeft: 36 + (depth + 1) * 14 }}>No fixtures yet</p>
            )}
            {renderLevel(g.id, depth + 1)}
          </div>
        )}
      </div>
    ))

  return (
    <Panel variant="inset" className={cn('border-l border-line', className)} style={style} aria-label="Groups">
      <PanelHeader
        icon={LuUsers}
        title="Groups"
        count={groups.length || undefined}
        actions={<Button size="sm" variant="ghost" icon={LuFolderPlus} onClick={() => { void createGroup() }}>New</Button>}
      />
      <PanelBody className="py-1">
        {groups.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuUsers}
            title="No groups"
            description="Groups select several fixtures in one tap — Spots, Front wash, Back truss…"
            action={<Button size="sm" variant="primary" icon={LuFolderPlus} onClick={() => { void createGroup() }}>
              {selectedIds.length > 0 ? `Group ${selectedIds.length} selected` : 'New group'}
            </Button>}
          />
        ) : (
          <div role="tree" aria-label="Groups">{renderLevel(undefined, 0)}</div>
        )}
      </PanelBody>
      {selectedIds.length > 0 && groups.length > 0 && (
        <p className="shrink-0 border-t border-line-subtle px-3 py-2 text-xs text-fg-tertiary">
          <span className="text-info-fg">{selectedIds.length} selected</span> — use <LuPlus size={12} aria-label="add" className="inline align-[-2px]" /> on a group to add them.
        </p>
      )}
    </Panel>
  )
}

const GroupRow = memo(function GroupRow({ group: g, depth, expanded, hasChildren, selectionKey, onToggle, onCreateSub }: {
  group: Group
  depth: number
  expanded: boolean
  hasChildren: boolean
  /** Sorted selection ids joined — re-renders rows when the selection changes */
  selectionKey: string
  onToggle: (id: string) => void
  onCreateSub: (parent: Group) => void
}) {
  const colorPop = usePopover()
  const selected = selectionKey ? selectionKey.split(',') : []
  const selCount = selected.length
  const inGroup = selected.filter((id) => g.fixtureIds.includes(id)).length
  const isGroupSelection = g.fixtureIds.length > 0 && selCount === g.fixtureIds.length && inGroup === selCount

  const rename = async () => {
    const name = await prompt({ title: 'Rename group', label: 'Group name', defaultValue: g.name, confirmLabel: 'Rename' })
    if (name && name !== g.name) usePatchStore.getState().updateGroup(g.id, { name })
  }
  const remove = async () => {
    const ok = await confirm({
      title: `Delete group “${g.name}”?`,
      message: 'The fixtures stay patched; only the group is removed. Sub-groups move up one level.',
      confirmLabel: 'Delete group',
      tone: 'danger'
    })
    if (ok) usePatchStore.getState().removeGroup(g.id)
  }

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
      { label: 'Select fixtures', icon: LuListChecks, disabled: g.fixtureIds.length === 0, onSelect: () => store.selectGroup(g.id) },
      { label: sel.length > 0 ? `Add ${sel.length} selected` : 'Add selected', icon: LuPlus, disabled: sel.length === 0 || sel.every((id) => g.fixtureIds.includes(id)), onSelect: () => store.addToGroup(g.id, sel) },
      {
        label: 'Remove selected', icon: LuMinus, disabled: !sel.some((id) => g.fixtureIds.includes(id)),
        onSelect: () => store.removeFromGroup(g.id, sel)
      },
      { type: 'separator' },
      { label: 'Rename…', icon: LuPencil, onSelect: () => { void rename() } },
      { label: 'Colour…', icon: LuPalette, onSelect: () => colorPop.setOpen(true) },
      { label: 'New sub-group…', icon: LuCornerDownRight, onSelect: () => onCreateSub(g) },
      {
        label: 'Move into', icon: LuFolderInput,
        submenu: [
          ...(g.parentGroupId ? [{ label: 'Top level', icon: LuArrowUpToLine, onSelect: () => store.moveSubgroup(g.id, undefined) }] : []),
          ...targets.map((t) => ({ label: t.name, onSelect: () => store.moveSubgroup(g.id, t.id) }))
        ]
      },
      { type: 'separator' },
      { label: 'Delete group…', icon: LuTrash2, danger: true, onSelect: () => { void remove() } }
    ]
  }

  return (
    <div
      className={cn('group/row flex min-h-row items-center gap-1 pr-1.5', isGroupSelection ? 'bg-info/15' : 'hover:bg-surface-2')}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <button
        type="button"
        aria-label={expanded ? `Collapse ${g.name}` : `Expand ${g.name}`}
        onClick={() => onToggle(g.id)}
        className="flex h-control-sm w-control-sm shrink-0 items-center justify-center rounded-sm text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary"
      >
        <LuChevronRight size={14} aria-hidden className={cn('transition-transform duration-fast', expanded && 'rotate-90', !hasChildren && g.fixtureIds.length === 0 && 'opacity-40')} />
      </button>
      <button
        ref={colorPop.anchorRef}
        type="button"
        aria-label={`Colour of ${g.name}`}
        onClick={colorPop.toggle}
        className="flex h-control-sm w-control-sm shrink-0 items-center justify-center rounded-sm hover:bg-surface-3"
      >
        <span aria-hidden className="h-3 w-3 rounded-full ring-1 ring-inset ring-white/10" style={{ backgroundColor: g.color }} />
      </button>
      <button
        type="button"
        onClick={() => (isGroupSelection ? usePatchStore.getState().clearSelection() : usePatchStore.getState().selectGroup(g.id))}
        onDoubleClick={() => { void rename() }}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        title="Select the fixtures of this group"
        aria-pressed={isGroupSelection}
      >
        <span className={cn('truncate text-sm', isGroupSelection ? 'font-medium text-fg-primary' : 'text-fg-primary')}>{g.name}</span>
        {inGroup > 0 && !isGroupSelection && <span className="shrink-0 text-2xs tabular text-info-fg">{inGroup} sel</span>}
      </button>
      <span className="w-6 shrink-0 text-right text-xs tabular text-fg-tertiary">{g.fixtureIds.length}</span>
      {selCount > 0 && inGroup < selCount && (
        <IconButton size="sm" icon={LuPlus} label={`Add ${selCount} selected to ${g.name}`} onClick={() => usePatchStore.getState().addToGroup(g.id, selected)} />
      )}
      <DropdownMenu
        placement="bottom-end"
        items={menu}
        trigger={(p) => <IconButton {...p} size="sm" icon={LuEllipsis} label={`${g.name} actions`} />}
      />
      <Popover {...colorPop.props} aria-label={`Colour of ${g.name}`}>
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

const MemberRow = memo(function MemberRow({ groupId, entry, depth }: { groupId: string; entry: PatchEntry; depth: number }) {
  const selected = usePatchStore((s) => s.selectedFixtureIds.includes(entry.id))
  return (
    <div className={cn('flex min-h-row items-center gap-2 pr-1.5', selected ? 'bg-info/10' : 'hover:bg-surface-2')} style={{ paddingLeft: 22 + depth * 14 }}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        onClick={(e) => usePatchStore.getState().selectFixture(entry.id, e.metaKey || e.ctrlKey || isTouchDensity())}
      >
        <span className={cn('truncate text-xs', selected ? 'text-fg-primary' : 'text-fg-secondary')}>{entry.name}</span>
      </button>
      <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{formatAddress(entry.universe, entry.address)}</span>
      <IconButton
        size="sm"
        icon={LuX}
        label={`Remove ${entry.name} from group`}
        onClick={() => {
          usePatchStore.getState().removeFromGroup(groupId, [entry.id])
          toast.info(`${entry.name} removed from group`, {
            action: { label: 'Undo', onClick: () => usePatchStore.getState().addToGroup(groupId, [entry.id]) }
          })
        }}
      />
    </div>
  )
})

function isTouchDensity(): boolean {
  return document.documentElement.dataset.density === 'touch'
}
