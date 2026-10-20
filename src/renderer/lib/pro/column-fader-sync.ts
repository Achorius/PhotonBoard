// ============================================================
// PhotonBoard — Column fader values (console)
//
// Keeps pro-store.columnFaders = what every column fader shows
// (executor-actions.columnFaderValues: column levels, cell masters,
// GM, group / speed masters, rates, X-fade), recomputed when one of
// its sources changes (coalesced to one pass per task). The executor
// bar, stage pages, the Stage window (surface data) and remote
// browsers (state snapshot) all read that one map. Console only: a
// remote browser mirrors the console's map (hooks/useRemoteSync).
// ============================================================

import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useProStore } from '@renderer/stores/pro-store'
import { subscribeColumnLevels } from '@renderer/lib/playback-controller'
import { isRemoteMode } from '@renderer/lib/runtime'
import { columnFaderValues } from './executor-actions'

let stop: (() => void) | null = null

/** Recompute now (tests, show load) */
export function refreshColumnFaders(): void {
  useProStore.getState().setColumnFaders(columnFaderValues())
}

/** Start keeping pro-store.columnFaders up to date (idempotent; console only) */
export function startColumnFaderSync(): () => void {
  if (stop) return stop
  if (isRemoteMode()) return () => {}
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      refreshColumnFaders()
    })
  }
  const unsubs = [
    useExecutorStore.subscribe((s, p) => { if (s.pages !== p.pages) schedule() }),
    usePlaybackStore.subscribe((s, p) => { if (s.cuelists !== p.cuelists || s.chases !== p.chases) schedule() }),
    usePoolStore.subscribe((s, p) => { if (s.groupMasters !== p.groupMasters || s.speedMasters !== p.speedMasters) schedule() }),
    useDmxStore.subscribe((s, p) => { if (s.grandMaster !== p.grandMaster) schedule() }),
    subscribeColumnLevels(schedule)
  ]
  refreshColumnFaders()
  stop = () => {
    for (const u of unsubs) u()
    stop = null
  }
  return stop
}
