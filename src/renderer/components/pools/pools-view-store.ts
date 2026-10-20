// Per-viewer state of the Pools view: the open tab (remembered) and the
// tile the keyboard acts on (Delete, Mod+D, F2) — the last one tapped.

import { create } from 'zustand'

export type PoolsTab = 'presets' | 'groups' | 'macros' | 'speed'
export type PoolKind = 'preset' | 'group' | 'macro' | 'speed'

const TABS: readonly PoolsTab[] = ['presets', 'groups', 'macros', 'speed']
const KEY = 'photonboard.pools.tab'

function readTab(): PoolsTab {
  try {
    const v = localStorage.getItem(KEY) as PoolsTab | null
    return v && TABS.includes(v) ? v : 'presets'
  } catch {
    return 'presets'
  }
}

interface PoolsViewState {
  tab: PoolsTab
  /** Tile the selection actions act on */
  selected: { kind: PoolKind; id: string } | null
  setTab: (tab: PoolsTab) => void
  select: (kind: PoolKind, id: string) => void
  clearSelected: () => void
}

export const usePoolsView = create<PoolsViewState>((set) => ({
  tab: readTab(),
  selected: null,
  setTab: (tab) => {
    try { localStorage.setItem(KEY, tab) } catch { /* storage unavailable */ }
    set({ tab, selected: null })
  },
  select: (kind, id) => set({ selected: { kind, id } }),
  clearSelected: () => set({ selected: null })
}))
