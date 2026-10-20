// ============================================================
// PhotonBoard — Console → Stage window: the touch surface data
// (every executor page with its cells, stage pages, pools) the slim
// state snapshot does not carry.
//
// Sent on the Stage window channel as `{ __stageSurface: SurfaceData }`
// next to the snapshot, only while the Stage window polls (it asks
// for state at 30 Hz while open, never otherwise), only when something
// changed (≤ 20 Hz), and again when the window (re)appears.
// Console only (never in a remote browser).
// ============================================================

import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { STAGE_SURFACE_KEY, buildSurfaceData, type StageSurfaceMessage, type SurfaceData } from './surface-data'

export { STAGE_SURFACE_KEY, isStageSurfaceMessage, type StageSurfaceMessage } from './surface-data'

/** Surface data from the current store state */
export function collectSurfaceData(): SurfaceData {
  const ex = useExecutorStore.getState()
  const pb = usePlaybackStore.getState()
  const pool = usePoolStore.getState()
  const patch = usePatchStore.getState()
  const dmx = useDmxStore.getState()
  return buildSurfaceData({
    pages: ex.pages,
    currentPage: ex.currentPage,
    selectedExecutor: useProStore.getState().selectedExecutor,
    selectedCuelistId: pb.selectedCuelistId,
    cuelists: pb.cuelists,
    chases: pb.chases,
    effects: useEffectsStore.getState().effects,
    macros: pool.macros,
    presets: pb.presets,
    groups: patch.groups,
    selectedFixtureIds: patch.selectedFixtureIds,
    groupMasters: pool.groupMasters,
    speedMasters: pool.speedMasters,
    stagePages: pool.stagePages,
    grandMaster: dmx.grandMaster,
    blackout: dmx.blackout,
    blinder: dmx.blinder,
    strobe: dmx.strobe
  })
}

const MIN_INTERVAL_MS = 50
/** A request after this silence = the window just (re)opened: resend */
const REOPEN_GAP_MS = 500
/** Resent anyway this often (a window that missed a message catches up) */
const KEEPALIVE_MS = 3000

let stop: (() => void) | null = null

/** Start answering the Stage window. Idempotent; returns a stop function. */
export function startStageSurfaceBroadcast(): () => void {
  if (stop) return stop
  if (isRemoteMode()) return () => {}
  const bridge = getBridge()
  if (!bridge) return () => {}

  let dirty = true
  let lastSent = -Infinity
  let lastRequest = -Infinity
  const markDirty = () => { dirty = true }

  const unsubs: (() => void)[] = [
    useExecutorStore.subscribe((s, p) => { if (s.pages !== p.pages || s.currentPage !== p.currentPage) markDirty() }),
    usePlaybackStore.subscribe((s, p) => {
      if (s.cuelists !== p.cuelists || s.chases !== p.chases || s.presets !== p.presets || s.selectedCuelistId !== p.selectedCuelistId) markDirty()
    }),
    useEffectsStore.subscribe((s, p) => { if (s.effects !== p.effects) markDirty() }),
    usePoolStore.subscribe((s, p) => {
      if (s.macros !== p.macros || s.speedMasters !== p.speedMasters || s.stagePages !== p.stagePages || s.groupMasters !== p.groupMasters) markDirty()
    }),
    usePatchStore.subscribe((s, p) => { if (s.groups !== p.groups || s.selectedFixtureIds !== p.selectedFixtureIds) markDirty() }),
    useDmxStore.subscribe((s, p) => {
      if (s.grandMaster !== p.grandMaster || s.blackout !== p.blackout || s.blinder !== p.blinder || s.strobe !== p.strobe) markDirty()
    }),
    useProStore.subscribe((s, p) => { if (s.selectedExecutor !== p.selectedExecutor) markDirty() })
  ]

  const off = bridge.stage.onRequestState(() => {
    const now = Date.now()
    const reopened = now - lastRequest > REOPEN_GAP_MS
    lastRequest = now
    if (!reopened && !(dirty && now - lastSent >= MIN_INTERVAL_MS) && now - lastSent < KEEPALIVE_MS) return
    dirty = false
    lastSent = now
    try {
      const msg: StageSurfaceMessage = { [STAGE_SURFACE_KEY]: collectSurfaceData() }
      bridge.stage.sendState(msg)
    } catch (e) {
      console.warn('[Stage] surface broadcast failed:', e)
    }
  }) as unknown as (() => void) | undefined

  stop = () => {
    for (const u of unsubs) u()
    off?.()
    stop = null
  }
  return stop
}
