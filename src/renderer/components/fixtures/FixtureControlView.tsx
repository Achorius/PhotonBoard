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
// Keyboard: nothing here is deletable — Delete / Backspace do nothing in
// this view (a null selection registration keeps them from reaching
// another view's selection); Mod+Backspace clears the programmer (global).
// Subscriptions: patch / selection here; live values only in leaves.
// ============================================================

import { useEffect, useMemo, useRef } from 'react'
import {
  LuBoxes, LuCable, LuChevronDown, LuEraser, LuGrid3X3, LuListChecks, LuLocateFixed, LuMousePointerClick,
  LuPanelLeftOpen, LuSlidersHorizontal, LuSlidersVertical, LuTable
} from 'react-icons/lu'
import {
  Badge, Button, DropdownMenu, EmptyState, SegmentedControl, Tag, toast, type MenuEntry
} from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { locateFixtures, releaseFixtures, useProgrammerStore, useProgrammerWatch } from '@renderer/lib/programmer-utils'
import { useSelectionActions } from '@renderer/lib/selection-actions'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { buildProgrammerModel } from './programmer-model'
import { useProgrammerView, type ProgrammerMode } from './programmer-view-store'
import { ProgrammerAttributes } from './ProgrammerAttributes'
import { FixtureStrips } from './FixtureStrips'
import { FixtureSheet } from './FixtureSheet'
import { DmxGrid } from './DmxGrid'
import { ChannelMenuProvider } from './channel-menu'

const MODES: { value: ProgrammerMode; icon: typeof LuTable }[] = [
  { value: 'attributes', icon: LuSlidersHorizontal },
  { value: 'faders', icon: LuSlidersVertical },
  { value: 'sheet', icon: LuTable },
  { value: 'dmx', icon: LuGrid3X3 }
]

export function FixtureControlView() {
  useProgrammerWatch()
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  // The programmer has no deletable objects: clicking here makes Delete / Backspace
  // (and Mod+D, F2) do nothing instead of acting on another view's selection.
  useSelectionActions(null, { scope: rootRef })
  const patch = usePatchStore((s) => s.patch)
  const fixtures = usePatchStore((s) => s.fixtures)
  const selectedIds = usePatchStore((s) => s.selectedFixtureIds)
  const mode = useProgrammerView((s) => s.mode)
  const unit = useProgrammerView((s) => s.unit)
  const universe = useUiStore((s) => s.selectedUniverse)

  const defs = useMemo(() => new Map(fixtures.map((f) => [f.id, f])), [fixtures])
  const byId = useMemo(() => new Map(patch.map((p) => [p.id, p])), [patch])
  const numbers = useMemo(() => new Map(patch.map((p, i) => [p.id, i + 1])), [patch])
  const selectedEntries = useMemo(() => selectedIds.map((id) => byId.get(id)).filter((e) => e !== undefined), [selectedIds, byId])
  const model = useMemo(() => buildProgrammerModel(selectedEntries, fixtures), [selectedEntries, fixtures])

  const universes = useMemo(() => {
    const n = Math.max(...patch.map((p) => p.universe + 1), 1)
    return Array.from({ length: n }, (_, i) => i)
  }, [patch])

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
    toast.info(translate('fixtures.locate.toast', { count }), { description: translate('fixtures.locate.toastDescription') })
  }

  return (
    <ChannelMenuProvider>
      <div ref={rootRef} className="flex h-full flex-col">
        <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="shrink-0 text-sm font-semibold text-fg-primary">{t('common.programmer')}</h2>
          <SelectionSummary names={selectedEntries.map((e) => e.name)} />
          <div className="min-w-2 flex-1" />
          <div className="flex shrink-0 items-center gap-1.5">
            <SegmentedControl
              size="sm"
              aria-label={t('fixtures.modes.aria')}
              value={mode}
              onChange={(m) => useProgrammerView.getState().setMode(m)}
              items={MODES.map((m) => ({
                value: m.value,
                label: <span data-mode={m.value} className="hidden lg:inline">{t(`fixtures.modes.${m.value}`)}</span>,
                icon: m.icon,
                title: t(`fixtures.modes.${m.value}Title`)
              }))}
            />
            {(mode === 'faders' || mode === 'dmx') && universes.length > 1 && (
              <SegmentedControl
                size="sm"
                aria-label={t('fixtures.universeAria')}
                value={universe}
                onChange={(u) => useUiStore.getState().setSelectedUniverse(u)}
                items={universes.map((u) => ({ value: u, label: `U${u + 1}`, title: t('common.universeN', { n: u + 1 }) }))}
              />
            )}
            <SegmentedControl
              size="sm"
              aria-label={t('fixtures.unit.aria')}
              value={unit}
              onChange={(u) => useProgrammerView.getState().setUnit(u)}
              items={[{ value: 'percent', label: '%', title: t('fixtures.unit.percent') }, { value: 'dmx', label: 'DMX', title: t('fixtures.unit.dmx') }]}
            />
            <GroupMenu />
            <Button
              size="sm"
              icon={LuLocateFixed}
              data-action="locate"
              disabled={count === 0}
              onClick={locate}
              tooltip={t('fixtures.locate.tooltip')}
              labelClassName="hidden xl:inline"
              aria-label={t('fixtures.locate.aria')}
            >
              {t('fixtures.locate.label')}
            </Button>
            <ReleaseSelectionButton ids={selectedIds} />
          </div>
        </header>

        {!hasPatch && mode !== 'dmx' ? (
          <EmptyState
            icon={LuCable}
            title={t('fixtures.empty.noPatchTitle')}
            description={t('fixtures.empty.noPatchDescription')}
            action={
              <>
                <Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('patch')}>{t('fixtures.empty.addFixtures')}</Button>
                <Button icon={LuGrid3X3} onClick={() => useProgrammerView.getState().setMode('dmx')}>{t('fixtures.empty.rawDmx')}</Button>
              </>
            }
          />
        ) : mode === 'attributes' ? (
          count === 0 ? (
            <NoSelection />
          ) : model.attributes.length === 0 ? (
            <EmptyState icon={LuBoxes} title={t('fixtures.empty.nothingTitle')} description={t('fixtures.empty.nothingDescription')} />
          ) : (
            <ProgrammerAttributes model={model} defs={defs} />
          )
        ) : mode === 'faders' ? (
          <FixtureStrips
            entries={stripEntries}
            defs={defs}
            numbers={numbers}
            selectedIds={selectedIds}
            emptyTitle={t('fixtures.empty.universeTitle', { n: universe + 1 })}
            emptyDescription={t('fixtures.empty.universeDescription')}
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
  const t = useT()
  if (names.length === 0) return <span className="truncate text-xs text-fg-tertiary">{t('fixtures.noSelection')}</span>
  const text = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Badge tone="info" mono>{names.length}</Badge>
      <span className="truncate text-xs text-fg-secondary" title={names.join(', ')}>{text}</span>
    </span>
  )
}

function GroupMenu() {
  const t = useT()
  const items = (): MenuEntry[] => {
    const { groups, patch } = usePatchStore.getState()
    const store = usePatchStore.getState()
    return [
      {
        label: translate('fixtures.groupMenu.allFixtures'),
        icon: LuListChecks,
        description: translate('common.fixtureCount', { count: patch.length }),
        onSelect: () => store.selectAll(),
        disabled: patch.length === 0
      },
      ...(groups.length > 0 ? [{ type: 'separator' as const }, { type: 'label' as const, label: translate('common.groups') }] : []),
      ...groups.map((g) => ({
        label: g.name,
        description: translate('common.fixtureCount', { count: g.fixtureIds.length }),
        onSelect: () => store.selectGroup(g.id),
        disabled: g.fixtureIds.length === 0
      })),
      { type: 'separator' },
      { label: translate('fixtures.groupMenu.clearSelection'), onSelect: () => store.clearSelection() }
    ]
  }
  return (
    <DropdownMenu
      items={items}
      placement="bottom-end"
      trigger={(p) => (
        <Button {...p} data-action="select-group" size="sm" variant="ghost" icon={LuBoxes} iconRight={LuChevronDown} labelClassName="hidden xl:inline" aria-label={t('fixtures.groupMenu.aria')}>
          {t('common.select')}
        </Button>
      )}
    />
  )
}

function ReleaseSelectionButton({ ids }: { ids: string[] }) {
  const t = useT()
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
      tooltip={t('fixtures.release.selectionTooltip')}
      labelClassName="hidden xl:inline"
      aria-label={t('fixtures.release.selectionAria')}
    >
      {t('fixtures.release.label')}
    </Button>
  )
}

function NoSelection() {
  const t = useT()
  const groups = usePatchStore((s) => s.groups)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  return (
    <EmptyState
      icon={LuMousePointerClick}
      title={t('fixtures.empty.selectTitle')}
      description={t('fixtures.empty.selectDescription')}
      action={
        <div className="flex max-w-xl flex-col items-center gap-3">
          {groups.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {groups.map((g) => (
                <Tag key={g.id} color={g.color} onClick={() => usePatchStore.getState().selectGroup(g.id)} title={t('common.fixtureCount', { count: g.fixtureIds.length })}>
                  {g.name}
                </Tag>
              ))}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button icon={LuListChecks} onClick={() => usePatchStore.getState().selectAll()}>{t('common.selectAll')}</Button>
            {!sidebarOpen && (
              <Button icon={LuPanelLeftOpen} onClick={() => useUiStore.getState().toggleSidebar(true)}>{t('fixtures.empty.showFixtureList')}</Button>
            )}
          </div>
        </div>
      }
    />
  )
}
