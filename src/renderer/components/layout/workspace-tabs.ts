// Workspace views shown in the navigation rail, in rail order.
// Digit shortcuts follow the rail (1…9, 0).

import type { IconType } from 'react-icons'
import {
  LuBox, LuCable, LuClapperboard, LuCrosshair, LuGrid2X2, LuPiano, LuSettings, LuSlidersVertical, LuSparkles, LuTimer
} from 'react-icons/lu'
import type { ViewTab } from '@renderer/stores/ui-store'

export type WorkspaceGroup = 'Setup' | 'Program' | 'Playback' | 'Visualise' | 'System'

export interface WorkspaceTab {
  id: ViewTab
  /** Short rail label */
  label: string
  /** Full name (tooltips, cheat sheet) */
  title: string
  icon: IconType
  shortcut: string
  group: WorkspaceGroup
}

export const WORKSPACE_TABS: WorkspaceTab[] = [
  { id: 'patch', label: 'Patch', title: 'Patch', icon: LuCable, shortcut: '1', group: 'Setup' },
  { id: 'fixtures', label: 'Fixtures', title: 'Fixtures & programmer', icon: LuSlidersVertical, shortcut: '2', group: 'Program' },
  { id: 'effects', label: 'Effects', title: 'Effects', icon: LuSparkles, shortcut: '3', group: 'Program' },
  { id: 'playback', label: 'Scenes', title: 'Scenes & chases', icon: LuClapperboard, shortcut: '4', group: 'Playback' },
  { id: 'live', label: 'Timeline', title: 'Timeline', icon: LuTimer, shortcut: '5', group: 'Playback' },
  { id: 'visualizer', label: '3D', title: '3D visualiser', icon: LuBox, shortcut: '6', group: 'Visualise' },
  { id: 'stage-layout', label: 'Layout', title: 'Stage layout', icon: LuGrid2X2, shortcut: '7', group: 'Visualise' },
  { id: 'midi', label: 'MIDI', title: 'MIDI devices & mappings', icon: LuPiano, shortcut: '8', group: 'System' },
  { id: 'follow', label: 'Follow', title: 'Follow spot', icon: LuCrosshair, shortcut: '9', group: 'System' },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: LuSettings, shortcut: '0', group: 'System' }
]
