// ============================================================
// Fixture sidebar: searchable patch list with universe filter and
// group chips; selection drives the programmer, 3D and layout views.
// Click = select · Ctrl/Cmd = add/remove · Shift = range.
// Touch density: a tap adds/removes (no modifier keys on a touchscreen).
// ============================================================

import { memo, useMemo, useRef, useState } from 'react'
import { LuCable, LuPlus, LuSearch, LuSearchX, LuX } from 'react-icons/lu'
import type { FixtureDefinition, PatchEntry } from '@shared/types'
import {
  Button, EmptyState, Fader, IconButton, SegmentedControl, Tag, TextInput, Tooltip, cn, fixtureCategoryIcon, formatAddress
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxUniverse } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { getChannelShortLabel, getChannelTypeColor } from '@renderer/lib/fixture-library'
import { COLOR_WHEEL_MAX_DMX, isColorWheelChannel } from '@renderer/lib/dmx-channel-resolver'
import { setProgrammerChannel } from '@renderer/lib/dmx-mixer'

export function PatchPanel() {
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const groups = usePatchStore((s) => s.groups)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const touch = useUiStore((s) => s.density === 'touch')
  const [universe, setUniverse] = useState<number | 'all'>('all')
  const [query, setQuery] = useState('')
  const anchor = useRef<string | null>(null)

  const defs = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const fixtureNumber = useMemo(() => new Map(patch.map((p, i) => [p.id, i + 1])), [patch])
  const universes = useMemo(() => [...new Set(patch.map((p) => p.universe))].sort((a, b) => a - b), [patch])
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return patch
      .filter((p) => universe === 'all' || p.universe === universe)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (defs.get(p.fixtureDefId)?.name.toLowerCase().includes(q) ?? false) || formatAddress(p.universe, p.address).includes(q))
      .sort((a, b) => a.universe - b.universe || a.address - b.address)
  }, [patch, universe, query, defs])

  const onRowSelect = (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const store = usePatchStore.getState()
    if (e.shiftKey && anchor.current) {
      const ids = displayed.map((p) => p.id)
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        store.selectFixtures(e.metaKey || e.ctrlKey ? [...store.selectedFixtureIds, ...range] : range)
        return
      }
    }
    anchor.current = id
    store.selectFixture(id, touch || e.metaKey || e.ctrlKey)
  }

  const openPatch = () => useUiStore.getState().setActiveTab('patch')
  const single = selectedIds.length === 1 ? patch.find((p) => p.id === selectedIds[0]) ?? null : null

  return (
    <aside aria-label="Fixtures" className="flex w-[248px] shrink-0 flex-col border-r border-line bg-surface-1 [[data-density=touch]_&]:w-[296px]">
      <header className="flex h-control-lg shrink-0 items-center gap-2 pl-3 pr-1.5">
        <h2 className="text-sm font-semibold text-fg-primary">Fixtures</h2>
        <span className="text-xs tabular text-fg-tertiary">{patch.length}</span>
        <div className="flex-1" />
        <IconButton icon={LuPlus} label="Add fixtures (Patch)" size="sm" onClick={openPatch} />
        <IconButton icon={LuX} label="Hide fixture list" size="sm" onClick={() => useUiStore.getState().toggleSidebar(false)} />
      </header>

      {patch.length > 0 && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-line-subtle px-2.5 pb-2.5">
          <TextInput
            size="sm"
            icon={LuSearch}
            placeholder="Search name, type, address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQuery(''); e.currentTarget.blur() } }}
            aria-label="Search fixtures"
          />
          {universes.length > 1 && (
            <SegmentedControl
              size="xs"
              fullWidth
              aria-label="Universe"
              value={universe}
              onChange={setUniverse}
              items={[{ value: 'all' as const, label: 'All' }, ...universes.map((u) => ({ value: u, label: `U${u + 1}` }))]}
            />
          )}
          {groups.length > 0 && (
            <div className="flex max-h-[76px] flex-wrap gap-1 overflow-y-auto [[data-density=touch]_&]:max-h-[92px]">
              {groups.map((g) => {
                const inGroup = g.fixtureIds.length > 0 && g.fixtureIds.every((id) => selected.has(id)) && selectedIds.length === g.fixtureIds.length
                return (
                  <Tag
                    key={g.id}
                    color={g.color}
                    selected={inGroup}
                    onClick={() => (inGroup ? usePatchStore.getState().clearSelection() : usePatchStore.getState().selectGroup(g.id))}
                    title={`${g.name} — ${g.fixtureIds.length} fixtures`}
                  >
                    {g.name}
                  </Tag>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div role="listbox" aria-multiselectable="true" aria-label="Patched fixtures" className="min-h-0 flex-1 overflow-y-auto py-1">
        {patch.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuCable}
            title="No fixtures patched"
            description="Add fixtures from the library to start programming."
            action={<Button size="sm" variant="primary" icon={LuPlus} onClick={openPatch}>Add fixtures</Button>}
          />
        ) : displayed.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuSearchX}
            title="No match"
            description={query ? `Nothing matches “${query}”.` : 'No fixture on this universe.'}
            action={<Button size="sm" variant="ghost" onClick={() => { setQuery(''); setUniverse('all') }}>Show all</Button>}
          />
        ) : displayed.map((entry) => (
          <FixtureRow
            key={entry.id}
            entry={entry}
            def={defs.get(entry.fixtureDefId)}
            number={fixtureNumber.get(entry.id) ?? 0}
            selected={selected.has(entry.id)}
            onSelect={onRowSelect}
          />
        ))}
      </div>

      {selectedIds.length > 0 && (
        <div className="flex h-control-lg shrink-0 items-center gap-1 border-t border-line pl-3 pr-1.5">
          <span className="flex-1 text-xs text-info-fg">{selectedIds.length} selected</span>
          <Button size="xs" variant="ghost" onClick={() => usePatchStore.getState().selectFixtures(displayed.map((p) => p.id))}>Select shown</Button>
          <Button size="xs" variant="ghost" onClick={() => usePatchStore.getState().clearSelection()}>Clear</Button>
        </div>
      )}
      {single && <QuickFaders entry={single} def={defs.get(single.fixtureDefId)} />}
    </aside>
  )
}

const FixtureRow = memo(function FixtureRow({ entry, def, number, selected, onSelect }: {
  entry: PatchEntry
  def: FixtureDefinition | undefined
  number: number
  selected: boolean
  onSelect: (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void
}) {
  const Icon = fixtureCategoryIcon(def?.categories)
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      title={def ? `${def.manufacturer} ${def.name} · ${entry.modeName}` : 'Unknown fixture type'}
      onClick={(e) => onSelect(entry.id, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(entry.id, e) }
      }}
      className={cn(
        'relative mx-1.5 flex h-row cursor-pointer items-center gap-2 rounded px-1.5 outline-offset-[-2px]',
        selected ? 'bg-info/20 text-fg-primary' : 'text-fg-secondary hover:bg-surface-2 hover:text-fg-primary'
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-info-fg" />}
      <span className="w-6 shrink-0 text-right font-mono text-2xs tabular text-fg-tertiary">{number}</span>
      <Icon size={14} aria-hidden className={cn('shrink-0', selected ? 'text-info-fg' : 'text-fg-tertiary', !def && 'text-warning-fg')} />
      <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
      <span className="shrink-0 font-mono text-2xs tabular text-fg-tertiary">{formatAddress(entry.universe, entry.address)}</span>
    </div>
  )
})

/** Faders for the single selected fixture (re-renders with its universe, ~25 Hz) */
function QuickFaders({ entry, def }: { entry: PatchEntry; def: FixtureDefinition | undefined }) {
  const values = useDmxUniverse(entry.universe)
  const channels = useMemo(() => usePatchStore.getState().getFixtureChannels(entry), [entry, def])
  if (channels.length === 0) return null
  return (
    <div className="shrink-0 border-t border-line bg-surface-0/60 px-2 pb-2 pt-1.5">
      <div className="mb-1 flex items-center gap-1 px-1">
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{entry.name}</span>
        <Tooltip content="Double-click a fader to reset it">
          <span className="text-2xs text-fg-disabled">{channels.length} ch</span>
        </Tooltip>
      </div>
      <div className="flex h-[150px] gap-1 overflow-x-auto pb-1 [[data-density=touch]_&]:h-[190px]">
        {channels.map((ch) => {
          const chDef = def?.channels[ch.name]
          return (
            <Fader
              key={ch.absoluteChannel}
              value={values[ch.absoluteChannel] ?? 0}
              max={isColorWheelChannel(ch.name) ? COLOR_WHEEL_MAX_DMX : 255}
              defaultValue={chDef?.defaultValue ?? 0}
              onChange={(v) => setProgrammerChannel(entry.universe, ch.absoluteChannel, v)}
              label={getChannelShortLabel(ch.name)}
              color={getChannelTypeColor(chDef?.type ?? 'generic', ch.name)}
              readout={false}
              ticks={false}
              aria-label={ch.name}
            />
          )
        })}
      </div>
    </div>
  )
}
