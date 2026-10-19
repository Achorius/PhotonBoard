// ============================================================
// Effects view — left column: what the next effect applies to.
// Drives the shared fixture selection (same as the sidebar).
//   Group row: tap = select only this group · checkbox = add / remove
//   Fixture row: tap = add / remove
// ============================================================

import { memo, useMemo } from 'react'
import type React from 'react'
import { LuLayers, LuX } from 'react-icons/lu'
import type { FixtureDefinition, Group, PatchEntry } from '@shared/types'
import { Button, Checkbox, EmptyState, cn, fixtureCategoryIcon, formatAddress } from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'

export function TargetPane() {
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const groups = usePatchStore((s) => s.groups)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const defs = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const sortedPatch = useMemo(() => [...patch].sort((a, b) => a.universe - b.universe || a.address - b.address), [patch])

  const allState: boolean | 'mixed' = selectedIds.length === 0 ? false : patch.every((p) => selected.has(p.id)) ? true : 'mixed'

  const toggleAll = () => {
    const store = usePatchStore.getState()
    if (allState === true) store.clearSelection()
    else store.selectFixtures(patch.map((p) => p.id))
  }

  return (
    <aside aria-label="Effect targets" className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface-1 [[data-density=touch]_&]:w-[264px]">
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <h2 className="text-sm font-semibold text-fg-primary">Targets</h2>
        <span className={cn('text-xs tabular', selectedIds.length ? 'text-info-fg' : 'text-fg-tertiary')}>
          {selectedIds.length}/{patch.length}
        </span>
        <div className="flex-1" />
        {selectedIds.length > 0 && (
          <Button size="xs" variant="ghost" icon={LuX} data-fx-clear-targets onClick={() => usePatchStore.getState().clearSelection()}>
            Clear
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        <TargetRow
          label="All fixtures"
          count={patch.length}
          state={allState}
          onSelect={toggleAll}
          onToggle={toggleAll}
          className="mb-1"
        />

        <SectionLabel>Groups</SectionLabel>
        {groups.length === 0 ? (
          <EmptyState size="sm" icon={LuLayers} title="No groups" description="Create groups in Patch to target sets of fixtures in one tap." className="h-auto" />
        ) : (
          groups.map((g) => <GroupRow key={g.id} group={g} selected={selected} selectedCount={selectedIds.length} />)
        )}

        <SectionLabel>Fixtures</SectionLabel>
        {sortedPatch.map((p) => (
          <FixtureRow key={p.id} entry={p} def={defs.get(p.fixtureDefId)} selected={selected.has(p.id)} />
        ))}
      </div>
    </aside>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{children}</div>
}

function TargetRow({ label, count, color, state, onSelect, onToggle, className, ...rest }: {
  label: string
  count: number
  color?: string
  state: boolean | 'mixed'
  onSelect: () => void
  onToggle: () => void
  className?: string
  [data: `data-${string}`]: string | undefined
}) {
  return (
    <div
      role="option"
      aria-selected={state === true}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() }
      }}
      className={cn(
        'relative mx-1.5 flex h-row cursor-pointer items-center gap-2 rounded px-1.5 outline-offset-[-2px]',
        state === true ? 'bg-info/20 text-fg-primary' : state === 'mixed' ? 'bg-info/10 text-fg-primary' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary',
        className
      )}
      {...rest}
    >
      {state === true && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-info-fg" />}
      <span onClick={(e) => e.stopPropagation()} className="flex">
        <Checkbox checked={state} onChange={onToggle} aria-label={`Add or remove ${label}`} />
      </span>
      {color && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{count}</span>
    </div>
  )
}

const GroupRow = memo(function GroupRow({ group, selected, selectedCount }: { group: Group; selected: Set<string>; selectedCount: number }) {
  const inSel = group.fixtureIds.filter((id) => selected.has(id)).length
  const all = group.fixtureIds.length > 0 && inSel === group.fixtureIds.length
  const state: boolean | 'mixed' = all ? true : inSel > 0 ? 'mixed' : false
  const exact = all && selectedCount === group.fixtureIds.length

  const select = () => {
    const store = usePatchStore.getState()
    if (exact) store.clearSelection()
    else store.selectGroup(group.id)
  }
  const toggle = () => {
    const store = usePatchStore.getState()
    const ids = new Set(store.selectedFixtureIds)
    if (all) for (const id of group.fixtureIds) ids.delete(id)
    else for (const id of group.fixtureIds) ids.add(id)
    store.selectFixtures([...ids])
  }
  return (
    <TargetRow
      label={group.name}
      count={group.fixtureIds.length}
      color={group.color}
      state={state}
      onSelect={select}
      onToggle={toggle}
      data-fx-target-group={group.name}
    />
  )
})

const FixtureRow = memo(function FixtureRow({ entry, def, selected }: { entry: PatchEntry; def: FixtureDefinition | undefined; selected: boolean }) {
  const Icon = fixtureCategoryIcon(def?.categories)
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => usePatchStore.getState().selectFixture(entry.id, true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); usePatchStore.getState().selectFixture(entry.id, true) }
      }}
      className={cn(
        'relative mx-1.5 flex h-row cursor-pointer items-center gap-2 rounded px-1.5 outline-offset-[-2px]',
        selected ? 'bg-info/20 text-fg-primary' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary'
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-info-fg" />}
      <Icon size={14} aria-hidden className={cn('shrink-0', selected ? 'text-info-fg' : 'text-fg-tertiary')} />
      <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
      <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{formatAddress(entry.universe, entry.address)}</span>
    </div>
  )
})
