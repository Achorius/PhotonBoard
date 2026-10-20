// ============================================================
// Pools (Pro view): Presets (one row per family), Groups, Macros and
// Speed masters as grandMA-style numbered tiles.
//   tap         apply preset / select group / run macro / tap tempo
//   tap "+"     store the programmer (selection for groups) / new object
//   right-click or long-press   Store (scope) · Update · Label · Colour
//               · Renumber · Assign · Delete
//   keyboard    Delete / Mod+D / F2 act on the last tapped tile
// ============================================================

import { useRef } from 'react'
import { LuGauge, LuLayers, LuListVideo, LuPalette, LuUsers } from 'react-icons/lu'
import { Badge, Tabs, type TabItem } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useSelectionActions, type SelectionActions } from '@renderer/lib/selection-actions'
import { useProgrammerWatch } from '@renderer/lib/programmer-utils'
import { usePresetMetaWatch } from '@renderer/components/fixtures/preset-meta'
import { usePoolsView, type PoolsTab } from './pools-view-store'
import { PresetPool } from './PresetPool'
import { GroupPool } from './GroupPool'
import { MacroPool } from './MacroPool'
import { SpeedPool } from './SpeedPool'
import {
  duplicateMacro, duplicatePreset, groupLabel, macroLabel, presetLabel, renameGroup, renamePreset, renameSpeedMaster, speedLabel, stopMacro, updateMacro
} from './pool-actions'
import { askLabel } from './PoolDialogs'

/** Selection actions (Delete, Mod+D, F2) of the selected tile */
function tileActions(sel: { kind: string; id: string } | null): SelectionActions | null {
  if (!sel) return null
  switch (sel.kind) {
    case 'preset': {
      const p = usePlaybackStore.getState().presets.find((x) => x.id === sel.id)
      if (!p) return null
      return {
        label: () => presetLabel(p),
        delete: () => usePoolStore.getState().removePreset(p.id),
        duplicate: () => { duplicatePreset(p.id) },
        rename: () => { void askLabel(presetLabel(p), p.name).then((n) => { if (n !== null) renamePreset(p.id, n) }) }
      }
    }
    case 'group': {
      const g = usePatchStore.getState().groups.find((x) => x.id === sel.id)
      if (!g) return null
      return {
        label: () => groupLabel(g),
        delete: () => usePatchStore.getState().removeGroup(g.id),
        rename: () => { void askLabel(groupLabel(g), g.name).then((n) => { if (n) renameGroup(g.id, n) }) }
      }
    }
    case 'macro': {
      const m = usePoolStore.getState().macros.find((x) => x.id === sel.id)
      if (!m) return null
      return {
        label: () => macroLabel(m.id),
        delete: () => { stopMacro(m.id); usePoolStore.getState().removeMacro(m.id) },
        duplicate: () => { duplicateMacro(m.id) },
        rename: () => { void askLabel(macroLabel(m.id), m.name).then((n) => { if (n !== null) updateMacro(m.id, { name: n }) }) }
      }
    }
    case 'speed': {
      const m = usePoolStore.getState().speedMasters.find((x) => x.id === sel.id)
      if (!m) return null
      return {
        label: () => speedLabel(m.id),
        delete: () => usePoolStore.getState().removeSpeedMaster(m.id),
        rename: () => { void askLabel(speedLabel(m.id), m.name).then((n) => { if (n !== null) renameSpeedMaster(m.id, n) }) }
      }
    }
    default:
      return null
  }
}

export function PoolsView() {
  useProgrammerWatch()
  usePresetMetaWatch()
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const tab = usePoolsView((s) => s.tab)
  const selected = usePoolsView((s) => s.selected)
  const selectionCount = usePatchStore((s) => s.selectedFixtureIds.length)
  const presetCount = usePlaybackStore((s) => s.presets.length)
  const groupCount = usePatchStore((s) => s.groups.length)
  const macroCount = usePoolStore((s) => s.macros.length)
  const speedCount = usePoolStore((s) => s.speedMasters.length)
  useSelectionActions(tileActions(selected), { scope: rootRef })

  const items: TabItem<PoolsTab>[] = [
    { id: 'presets', icon: LuPalette, label: t('pro.pools.tabs.presets'), badge: presetCount || undefined, 'data-tab': 'presets' },
    { id: 'groups', icon: LuUsers, label: t('pro.pools.tabs.groups'), badge: groupCount || undefined, 'data-tab': 'groups' },
    { id: 'macros', icon: LuListVideo, label: t('pro.pools.tabs.macros'), badge: macroCount || undefined, 'data-tab': 'macros' },
    { id: 'speed', icon: LuGauge, label: t('pro.pools.tabs.speed'), badge: speedCount || undefined, 'data-tab': 'speed' }
  ]

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-pools-tab={tab}>
      <header className="flex h-control-lg shrink-0 items-center gap-3 border-b border-line px-3">
        <LuLayers size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <h2 className="shrink-0 text-sm font-semibold text-fg-primary">{t('pro.pools.title')}</h2>
        <div className="min-w-0 flex-1 self-end">
          <Tabs items={items} value={tab} onChange={(id) => usePoolsView.getState().setTab(id)} aria-label={t('pro.pools.tabsAria')} />
        </div>
        <Badge tone={selectionCount > 0 ? 'info' : 'neutral'} className="shrink-0">{t('pro.pools.selection', { count: selectionCount })}</Badge>
      </header>
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === 'presets' && <PresetPool />}
        {tab === 'groups' && <GroupPool />}
        {tab === 'macros' && <MacroPool />}
        {tab === 'speed' && <SpeedPool />}
      </div>
    </div>
  )
}
