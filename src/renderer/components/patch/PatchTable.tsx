// ============================================================
// Patch table — every patched fixture with number, name, type,
// mode, address, channel count and groups. Sortable columns,
// multi-select (click / Ctrl-Cmd / Shift range; touch: tap
// toggles), inline rename (double-click, F2, menu), mode change,
// re-address dialog, duplicate, groups, delete. Overlapping
// addresses are flagged in red.
// ============================================================

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  LuCable, LuCopy, LuEllipsis, LuFolderMinus, LuFolderPlus, LuHash, LuPencil, LuPlus, LuSearch, LuSearchX, LuSlidersHorizontal,
  LuTrash2, LuTriangleAlert, LuX
} from 'react-icons/lu'
import type { FixtureDefinition, Group, PatchEntry } from '@shared/types'
import {
  Button, DropdownMenu, EmptyState, IconButton, SegmentedControl, Table, TBody, Td, Th, THead, TextInput, ToggleButton, Tooltip, Tr,
  cn, confirm, contextMenuHandlers, fixtureCategoryIcon, formatAddressRange, prompt, toast, useContextMenu, type MenuEntry, type MenuPoint
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { duplicateFixtures, nextGroupColor, useGroupsByFixture, usePatchAnalysis, useRowSelection } from './patch-hooks'
import { GroupChips, InlineSelect } from './patch-parts'
import type { ConflictInfo } from './patch-utils'
import { AddressDialog } from './AddressDialog'

type SortKey = 'number' | 'name' | 'type' | 'mode' | 'address' | 'channels'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const SORT_STORAGE = 'photonboard.patch.sort'

function loadSort(): Sort {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SORT_STORAGE) ?? 'null')
    if (raw && typeof raw.key === 'string' && (raw.dir === 'asc' || raw.dir === 'desc')) return raw
  } catch { /* ignore */ }
  return { key: 'address', dir: 'asc' }
}

export function PatchTable({ onAddFixtures }: { onAddFixtures: () => void }) {
  const analysis = usePatchAnalysis()
  const { patch, defs, byId, conflicts, numbers, universes } = analysis
  const groupsByFixture = useGroupsByFixture()
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const [query, setQuery] = useState('')
  const [universe, setUniverse] = useState<number | 'all'>('all')
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [sort, setSortState] = useState<Sort>(loadSort)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [addressIds, setAddressIds] = useState<string[] | null>(null)
  const ctx = useContextMenu()
  const ctxOpen = ctx.open
  const tableRef = useRef<HTMLDivElement>(null)

  const setSort = (key: SortKey) => {
    const next: Sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    setSortState(next)
    try { window.localStorage.setItem(SORT_STORAGE, JSON.stringify(next)) } catch { /* ignore */ }
  }

  useEffect(() => { if (conflicts.size === 0) setConflictsOnly(false) }, [conflicts.size])
  useEffect(() => { if (universe !== 'all' && !universes.includes(universe)) setUniverse('all') }, [universes, universe])

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = patch.filter((p) => {
      if (universe !== 'all' && p.universe !== universe) return false
      if (conflictsOnly && !conflicts.has(p.id)) return false
      if (!q) return true
      const def = defs.get(p.fixtureDefId)
      const f = byId.get(p.id)
      return p.name.toLowerCase().includes(q) ||
        (def?.name.toLowerCase().includes(q) ?? false) ||
        (def?.manufacturer.toLowerCase().includes(q) ?? false) ||
        p.modeName.toLowerCase().includes(q) ||
        (f ? formatAddressRange(f.universe, f.address, f.count).includes(q) : false) ||
        String(numbers.get(p.id)) === q
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const byAddress = (a: PatchEntry, b: PatchEntry) => a.universe - b.universe || a.address - b.address
    const cmp: Record<SortKey, (a: PatchEntry, b: PatchEntry) => number> = {
      number: (a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || byAddress(a, b),
      type: (a, b) => (defs.get(a.fixtureDefId)?.name ?? '').localeCompare(defs.get(b.fixtureDefId)?.name ?? '') || byAddress(a, b),
      mode: (a, b) => a.modeName.localeCompare(b.modeName, undefined, { numeric: true }) || byAddress(a, b),
      address: byAddress,
      channels: (a, b) => (byId.get(a.id)?.count ?? 0) - (byId.get(b.id)?.count ?? 0) || byAddress(a, b)
    }
    // Copy before sorting: the store array must never be mutated (its order drives fixture numbers and the 3D auto layout)
    return [...rows].sort((a, b) => cmp[sort.key](a, b) * dir)
  }, [patch, query, universe, conflictsOnly, conflicts, defs, byId, numbers, sort])

  const displayedIds = useMemo(() => displayed.map((p) => p.id), [displayed])
  const onSelect = useRowSelection(displayedIds)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  // ---- actions on a set of fixtures ----
  const targetIds = useCallback((id?: string) => {
    const sel = usePatchStore.getState().selectedFixtureIds
    return id && !sel.includes(id) ? [id] : sel
  }, [])

  const removeWithConfirm = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const names = usePatchStore.getState().patch.filter((p) => ids.includes(p.id)).map((p) => p.name)
    const ok = await confirm({
      title: ids.length === 1 ? `Delete “${names[0]}”?` : `Delete ${ids.length} fixtures?`,
      message: ids.length === 1
        ? 'The fixture is removed from the patch and its groups. Scenes keep their stored values.'
        : `${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''} will be removed from the patch and their groups.`,
      confirmLabel: ids.length === 1 ? 'Delete fixture' : `Delete ${ids.length} fixtures`,
      tone: 'danger'
    })
    if (!ok) return
    usePatchStore.getState().removeFixtures(ids)
    toast.success(ids.length === 1 ? `Deleted ${names[0]}` : `Deleted ${ids.length} fixtures`)
  }, [])

  const newGroupFrom = useCallback(async (ids: string[]) => {
    const name = await prompt({
      title: 'New group',
      message: `With ${ids.length === 1 ? 'this fixture' : `these ${ids.length} fixtures`}.`,
      label: 'Group name',
      placeholder: 'e.g. Front wash',
      confirmLabel: 'Create group'
    })
    if (!name) return
    const store = usePatchStore.getState()
    store.addGroup(name, nextGroupColor(store.groups))
    const created = usePatchStore.getState().groups.at(-1)
    if (created) store.addToGroup(created.id, ids)
    toast.success(`Group “${name}” created`)
  }, [])

  const groupMenu = useCallback((ids: string[]): MenuEntry[] => {
    const allGroups = usePatchStore.getState().groups
    const entries: MenuEntry[] = allGroups.map((g) => {
      const all = ids.every((id) => g.fixtureIds.includes(id))
      return {
        label: g.name,
        checked: all,
        onSelect: () => (all ? usePatchStore.getState().removeFromGroup(g.id, ids) : usePatchStore.getState().addToGroup(g.id, ids))
      }
    })
    return [
      ...(entries.length > 0 ? [{ type: 'label' as const, label: 'Toggle membership' }, ...entries, { type: 'separator' as const }] : []),
      { label: 'New group from selection…', icon: LuFolderPlus, onSelect: () => { void newGroupFrom(ids) } },
      {
        label: 'Remove from all groups', icon: LuFolderMinus,
        disabled: !allGroups.some((g) => ids.some((id) => g.fixtureIds.includes(id))),
        onSelect: () => { for (const g of usePatchStore.getState().groups) usePatchStore.getState().removeFromGroup(g.id, ids) }
      }
    ]
  }, [newGroupFrom])

  const rowMenu = useCallback((id: string): MenuEntry[] => {
    const ids = targetIds(id)
    const store = usePatchStore.getState()
    const entries = store.patch.filter((p) => ids.includes(p.id))
    const defIds = new Set(entries.map((e) => e.fixtureDefId))
    const def = defIds.size === 1 ? store.fixtures.find((f) => f.id === [...defIds][0]) : undefined
    const many = ids.length > 1
    return [
      ...(many ? [{ type: 'label' as const, label: `${ids.length} fixtures` }] : []),
      { label: 'Rename', icon: LuPencil, shortcut: 'F2', disabled: many, onSelect: () => setRenaming(id) },
      { label: many ? 'Address…' : 'Change address…', icon: LuHash, onSelect: () => setAddressIds(ids) },
      {
        label: 'Mode', icon: LuSlidersHorizontal, disabled: !def || def.modes.length < 2,
        submenu: def?.modes.map((m) => ({
          label: m.name,
          description: `${m.channelCount} channels`,
          checked: entries.every((e) => e.modeName === m.name),
          onSelect: () => changeMode(ids, m.name)
        })) ?? []
      },
      { label: 'Duplicate', icon: LuCopy, shortcut: 'Mod+D', onSelect: () => { duplicateFixtures(ids) } },
      { label: 'Groups', icon: LuFolderPlus, submenu: groupMenu(ids) },
      { type: 'separator' },
      { label: many ? `Delete ${ids.length} fixtures…` : 'Delete…', icon: LuTrash2, danger: true, shortcut: 'Delete', onSelect: () => { void removeWithConfirm(ids) } }
    ]
  }, [groupMenu, removeWithConfirm, targetIds])

  const openRowMenu = useCallback((id: string, e: MenuPoint) => {
    const sel = usePatchStore.getState().selectedFixtureIds
    if (!sel.includes(id)) usePatchStore.getState().selectFixtures([id])
    ctxOpen(e, rowMenu(id))
  }, [ctxOpen, rowMenu])

  const onTableKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    const mod = e.metaKey || e.ctrlKey
    const sel = usePatchStore.getState().selectedFixtureIds
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault(); e.stopPropagation()
      usePatchStore.getState().selectFixtures(displayedIds)
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault(); e.stopPropagation()
      if (!e.repeat && sel.length > 0) duplicateFixtures(sel)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && sel.length > 0) {
      e.preventDefault(); e.stopPropagation()
      if (!e.repeat) void removeWithConfirm(sel)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = Array.from(tableRef.current?.querySelectorAll<HTMLElement>('tr[data-row]') ?? [])
      const i = rows.indexOf(document.activeElement as HTMLElement)
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        e.preventDefault()
        next.focus()
        const id = next.dataset.row!
        if (e.shiftKey) onSelect(id, { shiftKey: true, metaKey: false, ctrlKey: false })
        else usePatchStore.getState().selectFixtures([id])
      }
    }
  }

  const commitRename = useCallback((id: string, value: string) => {
    setRenaming(null)
    const name = value.trim()
    if (name) usePatchStore.getState().updateFixture(id, { name })
  }, [])

  const openAddress = useCallback((id: string) => setAddressIds(targetIds(id)), [targetIds])

  const sortProps = (key: SortKey) => ({
    sort: sort.key === key ? sort.dir : null,
    onSort: () => setSort(key)
  })
  const selCount = selectedIds.length
  const totalChannels = analysis.items.reduce((n, f) => n + f.count, 0)

  if (patch.length === 0) {
    return (
      <EmptyState
        icon={LuCable}
        title="No fixtures patched"
        description="Pick fixture types from the library, choose how many and where — addresses are assigned automatically."
        action={<Button variant="primary" icon={LuPlus} onClick={onAddFixtures}>Add fixtures</Button>}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filters + selection actions */}
      <div className="flex min-h-control-lg shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-1.5">
        <div className="w-56 [[data-density=touch]_&]:w-72">
        <TextInput
          size="sm"
          icon={LuSearch}
          placeholder="Search name, type, mode, address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); e.currentTarget.blur() } }}
          aria-label="Search patch"
        />
        </div>
        {universes.length > 1 && (
          <SegmentedControl
            size="sm"
            aria-label="Universe"
            value={universe}
            onChange={setUniverse}
            items={[{ value: 'all' as const, label: 'All' }, ...universes.map((u) => ({ value: u, label: `U${u + 1}` }))]}
          />
        )}
        {conflicts.size > 0 && (
          <ToggleButton size="sm" tone="danger" icon={LuTriangleAlert} pressed={conflictsOnly} onPressedChange={setConflictsOnly}>
            {conflicts.size} conflict{conflicts.size === 1 ? '' : 's'}
          </ToggleButton>
        )}
        <div className="flex-1" />
        {selCount > 0 ? (
          <div className="flex items-center gap-1" role="toolbar" aria-label="Selected fixtures">
            <span className="mr-1 text-xs tabular text-info-fg">{selCount} selected</span>
            <Button size="sm" variant="ghost" icon={LuHash} labelClassName="hidden xl:inline" aria-label="Address" onClick={() => setAddressIds(selectedIds)}>Address</Button>
            <Button size="sm" variant="ghost" icon={LuCopy} labelClassName="hidden xl:inline" aria-label="Duplicate" onClick={() => duplicateFixtures(selectedIds)}>Duplicate</Button>
            <DropdownMenu
              placement="bottom-end"
              items={() => groupMenu(usePatchStore.getState().selectedFixtureIds)}
              trigger={(p) => <Button {...p} size="sm" variant="ghost" icon={LuFolderPlus} labelClassName="hidden xl:inline" aria-label="Groups">Groups</Button>}
            />
            <Button size="sm" variant="danger-outline" icon={LuTrash2} labelClassName="hidden xl:inline" aria-label="Delete" onClick={() => { void removeWithConfirm(selectedIds) }}>Delete</Button>
            <IconButton size="sm" icon={LuX} label="Clear selection" onClick={() => usePatchStore.getState().clearSelection()} />
          </div>
        ) : (
          <span className="text-xs tabular text-fg-tertiary">
            {patch.length} fixture{patch.length === 1 ? '' : 's'} · {totalChannels} channels
          </span>
        )}
      </div>

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto" onKeyDown={onTableKeyDown}>
        {displayed.length === 0 ? (
          <EmptyState
            icon={LuSearchX}
            title="No match"
            description={query ? `No patched fixture matches “${query}”.` : 'No fixture matches these filters.'}
            action={<Button variant="ghost" onClick={() => { setQuery(''); setUniverse('all'); setConflictsOnly(false) }}>Show all fixtures</Button>}
          />
        ) : (
          <Table aria-label="Patched fixtures" aria-multiselectable="true" role="grid" className="min-w-[760px] table-fixed">
            <colgroup>
              <col className="w-14" />
              <col className="w-[16%]" />
              <col />
              <col className="w-[10%]" />
              <col className="w-36 [[data-density=touch]_&]:w-40" />
              <col className="w-14" />
              <col className="w-[14%]" />
              <col className="w-11 [[data-density=touch]_&]:w-14" />
            </colgroup>
            <THead>
              <Tr>
                <Th align="right" {...sortProps('number')}>#</Th>
                <Th {...sortProps('name')}>Name</Th>
                <Th {...sortProps('type')}>Type</Th>
                <Th {...sortProps('mode')}>Mode</Th>
                <Th {...sortProps('address')}>Address</Th>
                <Th align="right" {...sortProps('channels')}>Ch</Th>
                <Th>Groups</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </Tr>
            </THead>
            <TBody>
              {displayed.map((entry) => {
                const f = byId.get(entry.id)
                return (
                  <PatchRow
                    key={entry.id}
                    entry={entry}
                    def={defs.get(entry.fixtureDefId)}
                    number={numbers.get(entry.id) ?? 0}
                    count={f?.count ?? 1}
                    conflict={conflictText(conflicts.get(entry.id), patch)}
                    groups={groupsByFixture.get(entry.id)}
                    selected={selected.has(entry.id)}
                    renaming={renaming === entry.id}
                    onSelect={onSelect}
                    onMenu={openRowMenu}
                    onRename={setRenaming}
                    onCommitRename={commitRename}
                    onAddress={openAddress}
                    onModeChange={changeModeForRow}
                  />
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
      {ctx.menu}
      {addressIds && <AddressDialog ids={addressIds} onClose={() => setAddressIds(null)} />}
    </div>
  )
}

function conflictText(info: ConflictInfo | undefined, patch: PatchEntry[]): string | null {
  if (!info) return null
  const parts: string[] = []
  if (info.with.length > 0) {
    const names = info.with.map((id) => patch.find((p) => p.id === id)?.name ?? '?')
    parts.push(`Overlaps ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`)
  }
  if (info.overflow) parts.push('Runs past channel 512')
  return parts.join(' · ')
}

/** Change the mode of fixtures; warns when the new footprint creates overlaps */
function changeMode(ids: string[], modeName: string) {
  const store = usePatchStore.getState()
  const updates: Record<string, { modeName: string }> = {}
  for (const id of ids) updates[id] = { modeName }
  store.updateFixtures(updates)
  warnNewConflicts(ids)
}

function changeModeForRow(id: string, modeName: string) {
  const sel = usePatchStore.getState().selectedFixtureIds
  const entry = usePatchStore.getState().patch.find((p) => p.id === id)
  // Apply to the whole selection when it shares the fixture type
  const ids = sel.includes(id)
    ? usePatchStore.getState().patch.filter((p) => sel.includes(p.id) && p.fixtureDefId === entry?.fixtureDefId).map((p) => p.id)
    : [id]
  changeMode(ids, modeName)
}

function warnNewConflicts(ids: string[]) {
  const { patch, fixtures } = usePatchStore.getState()
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  const count = (p: PatchEntry) => defs.get(p.fixtureDefId)?.modes.find((m) => m.name === p.modeName)?.channelCount ?? 1
  const changed = patch.filter((p) => ids.includes(p.id))
  const hits = changed.filter((c) => c.address + count(c) - 1 > 512 || patch.some((o) => o.id !== c.id && o.universe === c.universe &&
    c.address <= o.address + count(o) - 1 && o.address <= c.address + count(c) - 1))
  if (hits.length > 0) {
    toast.warning(hits.length === 1 ? `${hits[0].name} now overlaps another fixture` : `${hits.length} fixtures now overlap others`, {
      description: 'The new mode uses more channels. Re-address them to fix the conflict.',
      action: { label: 'Select them', onClick: () => usePatchStore.getState().selectFixtures(hits.map((h) => h.id)) }
    })
  }
}

interface PatchRowProps {
  entry: PatchEntry
  def: FixtureDefinition | undefined
  number: number
  count: number
  conflict: string | null
  groups: Group[] | undefined
  selected: boolean
  renaming: boolean
  onSelect: (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void
  onMenu: (id: string, e: MenuPoint) => void
  onRename: (id: string | null) => void
  onCommitRename: (id: string, value: string) => void
  onAddress: (id: string) => void
  onModeChange: (id: string, mode: string) => void
}

const PatchRow = memo(function PatchRow({
  entry, def, number, count, conflict, groups, selected, renaming, onSelect, onMenu, onRename, onCommitRename, onAddress, onModeChange
}: PatchRowProps) {
  const Icon = fixtureCategoryIcon(def?.categories)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <Tr
      data-row={entry.id}
      selected={selected}
      interactive
      tabIndex={0}
      aria-selected={selected}
      className={cn('outline-offset-[-2px]', conflict && !selected && 'bg-danger/[0.07] hover:bg-danger/10')}
      onClick={(e) => onSelect(entry.id, e)}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button, select, input')) onRename(entry.id) }}
      {...contextMenuHandlers((e) => onMenu(entry.id, e))}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(entry.id, e) }
        else if (e.key === 'F2') { e.preventDefault(); onRename(entry.id) }
      }}
    >
      <Td align="right" mono className={cn('text-fg-tertiary', conflict && 'shadow-[inset_2px_0_0_rgb(var(--pb-danger-fg))]')}>{number}</Td>
      <Td className="overflow-hidden">
        {renaming ? (
          <RenameInput initial={entry.name} onDone={(v) => (v === null ? onRename(null) : onCommitRename(entry.id, v))} />
        ) : (
          <span className="block truncate font-medium text-fg-primary">{entry.name}</span>
        )}
      </Td>
      <Td className="overflow-hidden">
        <span className="flex min-w-0 items-center gap-2" title={def ? `${def.manufacturer} ${def.name}` : 'Fixture type missing from the library'}>
          <Icon size={14} aria-hidden className={cn('shrink-0', def ? 'text-fg-tertiary' : 'text-warning-fg')} />
          {def ? (
            <span className="min-w-0 truncate text-fg-secondary">
              {def.name} <span className="text-xs text-fg-tertiary">{def.manufacturer}</span>
            </span>
          ) : (
            <span className="truncate text-warning-fg">Missing type</span>
          )}
        </span>
      </Td>
      <Td className="overflow-hidden">
        {def && def.modes.length > 1 ? (
          <InlineSelect
            aria-label={`Mode of ${entry.name}`}
            value={entry.modeName}
            onChange={(v) => onModeChange(entry.id, v)}
            options={def.modes.map((m) => ({ value: m.name, label: m.name }))}
          />
        ) : (
          <span className="block truncate text-fg-secondary">{entry.modeName}</span>
        )}
      </Td>
      <Td>
        <Tooltip content={conflict ?? 'Change address'}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddress(entry.id) }}
            onDoubleClick={stop}
            className={cn(
              '-ml-2 inline-flex h-control-sm items-center gap-1.5 rounded px-2 font-mono text-xs tabular hover:bg-surface-3',
              conflict ? 'text-danger-fg' : 'text-fg-primary'
            )}
            aria-label={`Address ${formatAddressRange(entry.universe, entry.address, count)}${conflict ? ` — conflict: ${conflict}` : ''}`}
          >
            {conflict && <LuTriangleAlert size={12} aria-hidden />}
            {formatAddressRange(entry.universe, entry.address, count)}
          </button>
        </Tooltip>
      </Td>
      <Td align="right" mono muted>{count}</Td>
      <Td className="overflow-hidden"><GroupChips groups={groups} /></Td>
      <Td align="center" className="px-1">
        <IconButton
          size="sm"
          icon={LuEllipsis}
          label={`Actions for ${entry.name}`}
          onDoubleClick={stop}
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(entry.id, { clientX: r.left, clientY: r.bottom, preventDefault: () => {}, stopPropagation: () => {} })
          }}
        />
      </Td>
    </Tr>
  )
})

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      autoFocus
      aria-label="Fixture name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
      className="-ml-1.5 h-control-sm w-full rounded border border-info-fg bg-surface-0 px-1.5 text-sm text-fg-primary outline-none ring-1 ring-info-fg/40"
    />
  )
}
