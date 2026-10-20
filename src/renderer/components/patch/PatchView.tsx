// ============================================================
// Patch view — the setup workspace:
//   Fixtures  patch table (sort, multi-select, rename, re-address,
//             mode, duplicate, groups, delete, conflicts)
//   DMX map   512-slot grid per universe (occupancy, conflicts)
//   Library   fixture types, modes / channels, editor, import, OFL
// with the Groups panel on the right and the "Add fixtures" flow.
// ============================================================

import { useState } from 'react'
import { LuFileUp, LuGrid3X3, LuLibrary, LuPanelRight, LuPlus, LuTable2, LuTriangleAlert } from 'react-icons/lu'
import { Badge, Button, ResizeHandle, Tabs, ToggleButton, useResizable } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { canImportFiles, importFixtureFiles, usePatchAnalysis } from './patch-hooks'
import { PatchTable } from './PatchTable'
import { UniverseMap } from './UniverseMap'
import { LibraryView } from './LibraryView'
import { GroupsPanel } from './GroupsPanel'
import { AddFixturesDialog, type AddFixturesRequest } from './AddFixturesDialog'

type PatchTab = 'fixtures' | 'map' | 'library'

const TAB_KEY = 'photonboard.patch.tab'
const GROUPS_KEY = 'photonboard.patch.groups'

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key) as T | null
    if (v && allowed.includes(v)) return v
  } catch { /* ignore */ }
  return fallback
}

function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}

export function PatchView() {
  const t = useT()
  const { patch, conflicts, universes } = usePatchAnalysis()
  const [tab, setTabState] = useState<PatchTab>(() => readPref(TAB_KEY, ['fixtures', 'map', 'library'] as const, 'fixtures'))
  // Groups panel: shown by default on wide screens; the viewer's choice is remembered
  const [showGroups, setShowGroupsState] = useState(() => readPref(GROUPS_KEY, ['on', 'off'] as const, window.innerWidth >= 1280 ? 'on' : 'off') === 'on')
  const [adding, setAdding] = useState<AddFixturesRequest | null>(null)
  const groupsPane = useResizable({ initial: 296, min: 220, max: 420, storageKey: 'patch.groups', direction: -1 })

  const setTab = (next: PatchTab) => { setTabState(next); writePref(TAB_KEY, next) }
  const setShowGroups = (on: boolean) => { setShowGroupsState(on); writePref(GROUPS_KEY, on ? 'on' : 'off') }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-control-lg shrink-0 items-center gap-3 border-b border-line px-3">
        <h1 className="text-sm font-semibold text-fg-primary">{t('patch.view.title')}</h1>
        <span className="hidden text-xs tabular text-fg-tertiary xl:inline">
          {t('patch.view.summary', { fixtures: t('common.fixtureCount', { count: patch.length }), universes: t('common.universeCount', { count: universes.length }) })}
        </span>
        <Tabs
          variant="pill"
          size="sm"
          aria-label={t('patch.view.tabsAria')}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'fixtures', label: t('patch.view.tabs.fixtures'), icon: LuTable2, 'data-patch-tab': 'fixtures' },
            { id: 'map', label: t('patch.view.tabs.map'), icon: LuGrid3X3, 'data-patch-tab': 'map' },
            { id: 'library', label: t('patch.view.tabs.library'), icon: LuLibrary, 'data-patch-tab': 'library' }
          ]}
        />
        {conflicts.size > 0 && tab !== 'library' && (
          <Badge tone="danger" icon={LuTriangleAlert} title={t('patch.view.conflictsTitle')}>
            {t('patch.view.conflicts', { count: conflicts.size })}
          </Badge>
        )}
        <div className="flex-1" />
        {tab !== 'library' && (
          <ToggleButton
            size="sm"
            variant="ghost"
            tone="neutral"
            icon={LuPanelRight}
            pressed={showGroups}
            onPressedChange={setShowGroups}
            labelClassName="hidden xl:inline"
            aria-label={t('patch.view.groupsPanel')}
          >
            {t('common.groups')}
          </ToggleButton>
        )}
        {canImportFiles() && tab !== 'library' && (
          <Button size="sm" variant="ghost" icon={LuFileUp} labelClassName="hidden xl:inline" aria-label={t('patch.view.importAria')} tooltip={t('patch.view.importTooltip')} onClick={() => { void importFixtureFiles() }}>
            {t('common.import')}
          </Button>
        )}
        <Button size="sm" variant="primary" icon={LuPlus} onClick={() => setAdding({})} data-action="add-fixtures">{t('patch.view.addFixtures')}</Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-w-0 flex-1">
          {tab === 'fixtures' && <PatchTable onAddFixtures={() => setAdding({})} />}
          {tab === 'map' && <UniverseMap onAddAt={(universe, address) => setAdding({ universe, address })} />}
          {tab === 'library' && <LibraryView onPatch={(defId) => setAdding({ defId })} />}
        </div>
        {showGroups && tab !== 'library' && (
          <>
            <ResizeHandle {...groupsPane.handleProps} />
            <GroupsPanel className="shrink-0" style={{ width: groupsPane.size }} />
          </>
        )}
      </div>

      {adding && <AddFixturesDialog request={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}
