// ============================================================
// Fixtures & programmer — live control of the selected fixtures.
//  - Attributes: Intensity + Position / Colour / Beam / Control / All,
//    built from the channels the selection actually has; edits apply
//    to every selected fixture, mixed values show as a range.
//  - Faders: one strip per fixture, one fader per channel.
//  - Sheet: spreadsheet of the patch with live values.
//  - DMX: the 512 raw channels of a universe (expert mode).
// Orange = in the programmer. Release (per attribute, feature or
// selection) hands channels back to playbacks; Clear is in the top bar.
// Subscriptions: patch / selection here; live values only in leaves.
// ============================================================

import { useEffect, useMemo } from 'react'
import {
  LuBoxes, LuCable, LuChevronDown, LuEraser, LuGrid3X3, LuListChecks, LuLocateFixed, LuMousePointerClick,
  LuPanelLeftOpen, LuSlidersHorizontal, LuSlidersVertical, LuTable
} from 'react-icons/lu'
import {
  Badge, Button, DropdownMenu, EmptyState, SegmentedControl, Tag, toast, type MenuEntry
} from '@renderer/components/ui'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { locateFixtures, releaseFixtures, useProgrammerStore, useProgrammerWatch } from '@renderer/lib/programmer-utils'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { buildProgrammerModel } from './programmer-model'
import { useProgrammerView, type ProgrammerMode } from './programmer-view-store'
import { ProgrammerAttributes } from './ProgrammerAttributes'
import { FixtureStrips } from './FixtureStrips'
import { FixtureSheet } from './FixtureSheet'
import { DmxGrid } from './DmxGrid'
import { ChannelMenuProvider } from './channel-menu'

const MODES: { value: ProgrammerMode; label: string; icon: typeof LuTable; title: string }[] = [
  { value: 'attributes', label: 'Attributes', icon: LuSlidersHorizontal, title: 'Program by attribute (intensity, position, colour, beam)' },
  { value: 'faders', label: 'Faders', icon: LuSlidersVertical, title: 'Channel faders per fixture' },
  { value: 'sheet', label: 'Sheet', icon: LuTable, title: 'Spreadsheet of every fixture' },
  { value: 'dmx', label: 'DMX', icon: LuGrid3X3, title: 'Raw DMX channels of a universe' }
]

export function FixtureControlView() {
  useProgrammerWatch()
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const mode = useProgrammerView((s) => s.mode)
  const unit = useProgrammerView((s) => s.unit)
  const universe = useUiStore((s) => s.selectedUniverse)
  const universeCount = useDmxStore((s) => s.universeCount)

  const defs = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const byId = useMemo(() => new Map(patch.map((p) => [p.id, p])), [patch])
  const numbers = useMemo(() => new Map(patch.map((p, i) => [p.id, i + 1])), [patch])
  const selectedEntries = useMemo(() => selectedIds.map((id) => byId.get(id)).filter((e) => e !== undefined), [selectedIds, byId])
  const model = useMemo(() => buildProgrammerModel(selectedEntries, fixtures), [selectedEntries, fixtures])

  const universes = useMemo(() => {
    const n = Math.max(universeCount, ...patch.map((p) => p.universe + 1), 1)
    return Array.from({ length: n }, (_, i) => i)
  }, [universeCount, patch])

  // Follow the selection to its universe (Faders / DMX)
  const firstUniverse = selectedEntries[0]?.universe
  useEffect(() => {
    if (firstUniverse !== undefined && firstUniverse !== useUiStore.getState().selectedUniverse) {
      useUiStore.getState().setSelectedUniverse(firstUniverse)
    }
  }, [firstUniverse])

  const stripEntries = useMemo(
    () => patch.filter((p) => p.universe === universe).sort((a, b) => a.address - b.address),
    [patch, universe]
  )

  const hasPatch = patch.length > 0
  const count = selectedEntries.length

  const locate = () => {
    locateFixtures(selectedIds)
    toast.info(`Locate: ${count} fixture${count > 1 ? 's' : ''} open, white, centred`, { description: 'Release or Clear to bring them back.' })
  }

  return (
    <ChannelMenuProvider>
      <div className="flex h-full flex-col">
        <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="text-sm font-semibold text-fg-primary">Programmer</h2>
          <SelectionSummary names={selectedEntries.map((e) => e.name)} />
          <div className="min-w-2 flex-1" />
          <div className="flex shrink-0 items-center gap-1.5">
            <SegmentedControl
              size="sm"
              aria-label="View"
              value={mode}
              onChange={(m) => useProgrammerView.getState().setMode(m)}
              items={MODES.map((m) => ({ value: m.value, label: <span data-mode={m.value} className="hidden lg:inline">{m.label}</span>, icon: m.icon, title: m.title }))}
            />
            {(mode === 'faders' || mode === 'dmx') && universes.length > 1 && (
              <SegmentedControl
                size="sm"
                aria-label="Universe"
                value={universe}
                onChange={(u) => useUiStore.getState().setSelectedUniverse(u)}
                items={universes.map((u) => ({ value: u, label: `U${u + 1}`, title: `Universe ${u + 1}` }))}
              />
            )}
            <SegmentedControl
              size="sm"
              aria-label="Values in"
              value={unit}
              onChange={(u) => useProgrammerView.getState().setUnit(u)}
              items={[{ value: 'percent', label: '%', title: 'Percent' }, { value: 'dmx', label: 'DMX', title: 'DMX 0–255' }]}
            />
            <GroupMenu />
            <Button
              size="sm"
              icon={LuLocateFixed}
              data-action="locate"
              disabled={count === 0}
              onClick={locate}
              tooltip="Locate: selected fixtures at full, open white, centred (into the programmer)"
              labelClassName="hidden xl:inline"
              aria-label="Locate selected fixtures"
            >
              Locate
            </Button>
            <ReleaseSelectionButton ids={selectedIds} />
          </div>
        </header>

        {!hasPatch && mode !== 'dmx' ? (
          <EmptyState
            icon={LuCable}
            title="No fixtures patched"
            description="Patch fixtures to program them by attribute, or drive raw DMX channels directly."
            action={
              <>
                <Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('patch')}>Add fixtures</Button>
                <Button icon={LuGrid3X3} onClick={() => useProgrammerView.getState().setMode('dmx')}>Raw DMX</Button>
              </>
            }
          />
        ) : mode === 'attributes' ? (
          count === 0 ? (
            <NoSelection />
          ) : model.attributes.length === 0 ? (
            <EmptyState icon={LuBoxes} title="Nothing to program" description="The selected fixtures have no known channels (missing fixture definition?)." />
          ) : (
            <ProgrammerAttributes model={model} defs={defs} />
          )
        ) : mode === 'faders' ? (
          <FixtureStrips
            entries={stripEntries}
            defs={defs}
            numbers={numbers}
            selectedIds={selectedIds}
            emptyTitle={`No fixtures on universe ${universe + 1}`}
            emptyDescription="Pick another universe above, or patch fixtures on this one."
          />
        ) : mode === 'sheet' ? (
          <FixtureSheet />
        ) : (
          <DmxGrid key={universe} universe={universe} />
        )}
      </div>
    </ChannelMenuProvider>
  )
}

function SelectionSummary({ names }: { names: string[] }) {
  if (names.length === 0) return <span className="truncate text-xs text-fg-tertiary">No selection</span>
  const text = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Badge tone="info" mono>{names.length}</Badge>
      <span className="truncate text-xs text-fg-secondary" title={names.join(', ')}>{text}</span>
    </span>
  )
}

function GroupMenu() {
  const items = (): MenuEntry[] => {
    const { groups, patch } = usePatchStore.getState()
    const store = usePatchStore.getState()
    return [
      { label: 'All fixtures', icon: LuListChecks, description: `${patch.length} fixtures`, onSelect: () => store.selectAll(), disabled: patch.length === 0 },
      ...(groups.length > 0 ? [{ type: 'separator' as const }, { type: 'label' as const, label: 'Groups' }] : []),
      ...groups.map((g) => ({
        label: g.name,
        description: `${g.fixtureIds.length} fixtures`,
        onSelect: () => store.selectGroup(g.id),
        disabled: g.fixtureIds.length === 0
      })),
      { type: 'separator' },
      { label: 'Clear selection', onSelect: () => store.clearSelection() }
    ]
  }
  return (
    <DropdownMenu
      items={items}
      placement="bottom-end"
      trigger={(p) => (
        <Button {...p} size="sm" variant="ghost" icon={LuBoxes} iconRight={LuChevronDown} labelClassName="hidden xl:inline" aria-label="Select a group">
          Select
        </Button>
      )}
    />
  )
}

function ReleaseSelectionButton({ ids }: { ids: string[] }) {
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  // Any channel of the selection in the programmer?
  const active = useProgrammerStore((s) => {
    if (s.version < 0 || ids.length === 0) return false
    const set = new Set(ids)
    for (const e of patch) {
      if (!set.has(e.id)) continue
      const n = fixtures.find((f) => f.id === e.fixtureDefId)?.modes.find((m) => m.name === e.modeName)?.channels.length ?? 0
      for (let i = 0; i < n; i++) if (getProgrammerValue(e.universe, e.address - 1 + i) !== undefined) return true
    }
    return false
  })
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={LuEraser}
      disabled={!active}
      onClick={() => releaseFixtures(ids)}
      tooltip="Release the selected fixtures from the programmer"
      labelClassName="hidden xl:inline"
      aria-label="Release selected fixtures"
    >
      Release
    </Button>
  )
}

function NoSelection() {
  const groups = usePatchStore((s) => s.groups)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  return (
    <EmptyState
      icon={LuMousePointerClick}
      title="Select fixtures to program"
      description="Pick fixtures in the fixture list, or select a group. Attributes appear for the channels the selection has."
      action={
        <div className="flex max-w-xl flex-col items-center gap-3">
          {groups.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {groups.map((g) => (
                <Tag key={g.id} color={g.color} onClick={() => usePatchStore.getState().selectGroup(g.id)} title={`${g.fixtureIds.length} fixtures`}>
                  {g.name}
                </Tag>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button icon={LuListChecks} onClick={() => usePatchStore.getState().selectAll()}>Select all</Button>
            {!sidebarOpen && (
              <Button icon={LuPanelLeftOpen} onClick={() => useUiStore.getState().toggleSidebar(true)}>Show fixture list</Button>
            )}
          </div>
        </div>
      }
    />
  )
}
