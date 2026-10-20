// Workspace views shown in the navigation rail, in rail order.
// Digit shortcuts follow the rail (1…9, 0). Names come from the
// dictionary: t(`shell.tabs.${id}.label`) (rail) / `.title` (tooltips, cheat sheet).
// The Pro view adds rail entries (PRO_WORKSPACE_TABS, no digit shortcut,
// names in pro.pools.nav): Pools after Effects, Stage pages after Timeline.

import type { IconType } from 'react-icons'
import {
  LuBox, LuCable, LuClapperboard, LuCrosshair, LuGrid2X2, LuLayers, LuLayoutDashboard, LuPiano, LuSettings, LuSlidersVertical, LuSparkles, LuTimer
} from 'react-icons/lu'
import type { TranslationKey } from '@renderer/i18n'
import type { ViewTab } from '@renderer/stores/ui-store'

export type WorkspaceGroup = 'Setup' | 'Program' | 'Playback' | 'Visualise' | 'System'

/** Views that have a rail entry (and a name in shell.tabs) */
export type WorkspaceTabId = 'patch' | 'fixtures' | 'effects' | 'playback' | 'live' | 'visualizer' | 'stage-layout' | 'midi' | 'follow' | 'settings'

export interface WorkspaceTab {
  id: WorkspaceTabId & ViewTab
  icon: IconType
  shortcut: string
  group: WorkspaceGroup
}

export const WORKSPACE_TABS: WorkspaceTab[] = [
  { id: 'patch', icon: LuCable, shortcut: '1', group: 'Setup' },
  { id: 'fixtures', icon: LuSlidersVertical, shortcut: '2', group: 'Program' },
  { id: 'effects', icon: LuSparkles, shortcut: '3', group: 'Program' },
  { id: 'playback', icon: LuClapperboard, shortcut: '4', group: 'Playback' },
  { id: 'live', icon: LuTimer, shortcut: '5', group: 'Playback' },
  { id: 'visualizer', icon: LuBox, shortcut: '6', group: 'Visualise' },
  { id: 'stage-layout', icon: LuGrid2X2, shortcut: '7', group: 'Visualise' },
  { id: 'midi', icon: LuPiano, shortcut: '8', group: 'System' },
  { id: 'follow', icon: LuCrosshair, shortcut: '9', group: 'System' },
  { id: 'settings', icon: LuSettings, shortcut: '0', group: 'System' }
]

/** Views only in the Pro view */
export type ProWorkspaceTabId = 'pools' | 'stage'

export interface ProWorkspaceTab {
  id: ProWorkspaceTabId & ViewTab
  icon: IconType
  group: WorkspaceGroup
  /** Rail position: right after this view */
  after: WorkspaceTabId
}

export const PRO_WORKSPACE_TABS: ProWorkspaceTab[] = [
  { id: 'pools', icon: LuLayers, group: 'Program', after: 'effects' },
  { id: 'stage', icon: LuLayoutDashboard, group: 'Playback', after: 'live' }
]

const PRO_TAB_IDS: ReadonlySet<ViewTab> = new Set(PRO_WORKSPACE_TABS.map((t) => t.id))

/** True for views that only exist in the Pro view */
export function isProOnlyTab(tab: ViewTab): boolean {
  return PRO_TAB_IDS.has(tab)
}

/** One rail entry */
export interface RailTab {
  id: ViewTab
  icon: IconType
  group: WorkspaceGroup
  shortcut?: string
  labelKey: TranslationKey
  titleKey: TranslationKey
}

/** Rail entries in order: the workspace views, plus the Pro ones when `pro` */
export function railTabs(pro: boolean): RailTab[] {
  const out: RailTab[] = []
  for (const tab of WORKSPACE_TABS) {
    out.push({ id: tab.id, icon: tab.icon, group: tab.group, shortcut: tab.shortcut, labelKey: `shell.tabs.${tab.id}.label`, titleKey: `shell.tabs.${tab.id}.title` })
    if (!pro) continue
    for (const p of PRO_WORKSPACE_TABS) {
      if (p.after === tab.id) out.push({ id: p.id, icon: p.icon, group: p.group, labelKey: `pro.pools.nav.${p.id}.label`, titleKey: `pro.pools.nav.${p.id}.title` })
    }
  }
  return out
}
