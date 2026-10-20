// Workspace views shown in the navigation rail, in rail order.
// Digit shortcuts follow the rail (1…9, 0). Names come from the
// dictionary: t(`shell.tabs.${id}.label`) (rail) / `.title` (tooltips, cheat sheet).

import type { IconType } from 'react-icons'
import {
  LuBox, LuCable, LuClapperboard, LuCrosshair, LuGrid2X2, LuPiano, LuSettings, LuSlidersVertical, LuSparkles, LuTimer
} from 'react-icons/lu'
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
