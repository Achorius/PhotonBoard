// ============================================================
// PhotonBoard — Remote State Sync (browser side)
//   Pi → browser: state broadcasts are mirrored into the local stores
//                 (RUNTIME state only: playing, faders, masters, DMX…)
//   browser → Pi: store ACTIONS forward commands themselves when
//                 running remotely (see lib/runtime.ts); show CONTENT
//                 edits (scenes, patch, executor layout…) travel both
//                 ways through lib/content-sync.ts.
// Only active in remote mode (browser, no Electron).
//
// Fields the user is changing right now (fader drags…) are held for a
// moment: broadcasts produced before the Pi received the change would
// otherwise make the control jump back.
//
// Pro (v3 snapshot): the console's executor page (a page change made
// here is sent as 'set-executor-page'), Blind / Highlight, speed master
// BPMs and the command-line log are mirrored. The executor pages
// themselves (cells, names) are show content: content sync.
//
// Console side (Electron, not remote): the same hook starts the touch
// surface broadcast to the Stage window (stage-surface-broadcast.ts).
// ============================================================

import { useEffect } from 'react'
import type { Chase, Cuelist, Effect, SpeedMaster } from '@shared/types'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useProStore, type CliLogEntry } from '@renderer/stores/pro-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { decodeSnapshotDmx } from '@renderer/lib/state-snapshot'
import { isProgrammerChannelHeld } from '@renderer/lib/dmx-mixer'
import { onShowApplied, withoutDirtyTracking } from '@renderer/lib/show-io'
import { getTimelineState, mirrorTimelineState } from '@renderer/lib/timeline-engine'
import { installRemoteContentSync, onConsoleContentState } from '@renderer/lib/content-sync'
import { mirrorProgrammerSummary } from '@renderer/lib/console-programmer'
import { getBridge, isLocallyHeld, isRemoteMode, markLocalChange, sendRemoteCommand } from '@renderer/lib/runtime'
import { startStageSurfaceBroadcast } from '@renderer/components/stage/pages/stage-surface-broadcast'

/** True when running in browser (remote mode) */
export function isRemote(): boolean {
  return isRemoteMode()
}

/** Last Pi broadcast, re-applied after a show is (re)loaded in the browser */
let lastRemoteState: unknown = null

type Obj = Record<string, any>

function hasId(v: unknown): v is Obj & { id: string } {
  return !!v && typeof v === 'object' && typeof (v as Obj).id === 'string'
}

function clampByte(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : fallback
}

/**
 * Runtime state of the scenes (playing, cue, fader, flash). Their CONTENT
 * (names, cues, settings) comes from the console through the content sync
 * (lib/content-sync.ts) — never from the slim broadcast, which has no cue values.
 */
function mirrorCuelists(raw: unknown[]): void {
  const local = usePlaybackStore.getState().cuelists
  const byId = new Map(raw.filter(hasId).map((pi: Obj) => [pi.id as string, pi]))
  let changed = false
  const next: Cuelist[] = local.map((cl) => {
    const pi = byId.get(cl.id)
    if (!pi) return cl
    const faderLevel = isLocallyHeld(`fader:${cl.id}`) ? cl.faderLevel : clampByte(pi.faderLevel, cl.faderLevel)
    const currentCueIndex = typeof pi.currentCueIndex === 'number' ? pi.currentCueIndex : cl.currentCueIndex
    const isPlaying = typeof pi.isPlaying === 'boolean' ? pi.isPlaying : cl.isPlaying
    const flash = typeof pi.flash === 'boolean' ? pi.flash : cl.flash
    if (faderLevel === cl.faderLevel && currentCueIndex === cl.currentCueIndex && isPlaying === cl.isPlaying && flash === cl.flash) return cl
    changed = true
    return { ...cl, faderLevel, currentCueIndex, isPlaying, flash }
  })
  if (changed) usePlaybackStore.setState({ cuelists: next })
}

/** Runtime state of the chases (playing, step, tempo, level). Content: see mirrorCuelists. */
function mirrorChases(raw: unknown[]): void {
  const local = usePlaybackStore.getState().chases
  const byId = new Map(raw.filter(hasId).map((pi: Obj) => [pi.id as string, pi]))
  let changed = false
  const next: Chase[] = local.map((ch) => {
    const pi = byId.get(ch.id)
    if (!pi) return ch
    const isPlaying = typeof pi.isPlaying === 'boolean' ? pi.isPlaying : ch.isPlaying
    const bpm = isLocallyHeld(`chaseBpm:${ch.id}`) ? ch.bpm : typeof pi.bpm === 'number' ? pi.bpm : ch.bpm
    const faderLevel = isLocallyHeld(`chaseFader:${ch.id}`) ? ch.faderLevel : clampByte(pi.faderLevel, ch.faderLevel)
    const currentStepIndex = typeof pi.currentStepIndex === 'number' ? pi.currentStepIndex : ch.currentStepIndex
    if (isPlaying === ch.isPlaying && bpm === ch.bpm && faderLevel === ch.faderLevel && currentStepIndex === ch.currentStepIndex) return ch
    changed = true
    return { ...ch, isPlaying, bpm, faderLevel, currentStepIndex }
  })
  if (changed) usePlaybackStore.setState({ chases: next })
}

/** Which effects run on the console (effect buttons) */
function mirrorRunningEffects(raw: unknown[]): void {
  const running = new Set(raw.filter((id): id is string => typeof id === 'string'))
  const local = useEffectsStore.getState().effects
  let changed = false
  const next: Effect[] = local.map((e) => {
    const on = isLocallyHeld(`effect:${e.id}`) ? e.isRunning : running.has(e.id)
    if (on === e.isRunning) return e
    changed = true
    return { ...e, isRunning: on }
  })
  if (changed) useEffectsStore.setState({ effects: next })
}

function mirrorMasters(data: Obj): void {
  const dmx = useDmxStore.getState()
  const patch: Partial<{ grandMaster: number; blackout: boolean; blinder: boolean; strobe: boolean; strobeRate: number }> = {}
  if (typeof data.grandMaster === 'number' && !isLocallyHeld('grandMaster')) {
    const gm = clampByte(data.grandMaster, dmx.grandMaster)
    if (gm !== dmx.grandMaster) patch.grandMaster = gm
  }
  for (const key of ['blackout', 'blinder', 'strobe'] as const) {
    if (typeof data[key] === 'boolean' && data[key] !== dmx[key] && !isLocallyHeld(key)) patch[key] = data[key]
  }
  if (typeof data.strobeRate === 'number' && data.strobeRate !== dmx.strobeRate && !isLocallyHeld('strobeRate')) {
    patch.strobeRate = data.strobeRate
  }
  if (Object.keys(patch).length > 0) useDmxStore.setState(patch)
}

function mirrorDmx(data: Obj): void {
  let values = decodeSnapshotDmx(data.dmx)
  if (!values && Array.isArray(data.dmxValues)) {
    // Older consoles: number[][]
    values = data.dmxValues.map((universe: unknown) =>
      Array.isArray(universe) ? universe.map((v) => clampByte(v, 0)) : new Array(512).fill(0)
    )
  }
  if (!values) return
  // Keep channels the user is moving right now
  const current = useDmxStore.getState().values
  for (let u = 0; u < values.length; u++) {
    for (let ch = 0; ch < values[u].length; ch++) {
      if (isProgrammerChannelHeld(u, ch)) values[u][ch] = current[u]?.[ch] ?? values[u][ch]
    }
  }
  useDmxStore.setState({ values, universeCount: Math.max(useDmxStore.getState().universeCount, values.length) })
}

// ---------------------------------------------------------------
// Pro: executor page, Blind / Highlight, speed masters, command line
// ---------------------------------------------------------------

/** Page the console shows (re-applied when the pages content arrives later) */
let consolePage: number | null = null
/** True while a console value is being written (not a local change: never sent back) */
let mirroringPage = false

function applyConsolePage(): void {
  if (consolePage === null || isLocallyHeld('executorPage')) return
  const ex = useExecutorStore.getState()
  if (ex.currentPage === consolePage || consolePage >= ex.pages.length) return
  mirroringPage = true
  try { ex.setPage(consolePage) } finally { mirroringPage = false }
}

function mirrorExecutorPage(data: Obj): void {
  if (typeof data.executorPage !== 'number' || !Number.isInteger(data.executorPage) || data.executorPage < 0) return
  consolePage = data.executorPage
  applyConsolePage()
}

function mirrorPro(data: Obj): void {
  const pro = useProStore.getState()
  if (typeof data.blind === 'boolean' && data.blind !== pro.blind && !isLocallyHeld('blind')) pro.setBlind(data.blind)
  if (typeof data.highlight === 'boolean' && data.highlight !== pro.highlight && !isLocallyHeld('highlight')) pro.setHighlight(data.highlight)
  if (Array.isArray(data.cliLog)) {
    const lines = data.cliLog.filter((l: unknown): l is CliLogEntry => !!l && typeof l === 'object' && typeof (l as Obj).id === 'number' && typeof (l as Obj).text === 'string')
    const cur = useProStore.getState().cliLog
    const same = lines.length === cur.length && lines.every((l: CliLogEntry, i: number) => l.id === cur[i].id && l.message === cur[i].message)
    if (!same) {
      useProStore.setState({
        cliLog: lines.map((l: CliLogEntry) => {
          const e: CliLogEntry = {
            id: l.id, time: Number(l.time) || 0, text: l.text, ok: !!l.ok, message: String(l.message ?? ''),
            level: l.level === 'warning' || l.level === 'error' ? l.level : 'info'
          }
          if (typeof l.origin === 'string') e.origin = l.origin
          return e
        })
      })
    }
  }
}

/** Speed master BPMs (live values, not content: the rest comes with content sync) */
function mirrorSpeedMasters(raw: unknown[]): void {
  const byId = new Map(raw.filter(hasId).map((m: Obj) => [m.id as string, m]))
  const local = usePoolStore.getState().speedMasters
  let changed = false
  const next: SpeedMaster[] = local.map((m) => {
    const pi = byId.get(m.id)
    if (!pi || typeof pi.bpm !== 'number' || !Number.isFinite(pi.bpm) || pi.bpm === m.bpm || isLocallyHeld(`speedBpm:${m.id}`)) return m
    changed = true
    return { ...m, bpm: pi.bpm }
  })
  if (changed) usePoolStore.setState({ speedMasters: next })
}

/** Group master levels (saved with the show, but moved live: mirrored like faders) */
function mirrorGroupMasters(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const cur = usePoolStore.getState().groupMasters
  const next: Record<string, number> = {}
  for (const [id, v] of Object.entries(raw as Obj)) {
    if (typeof v === 'number' && Number.isFinite(v)) next[id] = clampByte(v, 255)
  }
  for (const id of Object.keys(cur)) {
    if (isLocallyHeld(`groupMaster:${id}`)) next[id] = cur[id]
  }
  const keys = Object.keys(next)
  if (keys.length === Object.keys(cur).length && keys.every((k) => cur[k] === next[k])) return
  usePoolStore.setState({ groupMasters: next })
}

/** What the console's column faders show (column levels, rates… live on the console only) */
function mirrorColumnFaders(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const pro = useProStore.getState()
  const next: Record<string, number> = {}
  for (const [key, v] of Object.entries(raw as Obj)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    next[key] = isLocallyHeld(`column:${key}`) && key in pro.columnFaders ? pro.columnFaders[key] : clampByte(v, 255)
  }
  pro.setColumnFaders(next)
}

/** Apply one Pi state broadcast to the local stores. */
export function applyRemoteState(data: unknown): void {
  if (!data || typeof data !== 'object') return
  lastRemoteState = data
  const d = data as Obj
  try {
    withoutDirtyTracking(() => {
      if (Array.isArray(d.cuelists)) mirrorCuelists(d.cuelists)
      if (Array.isArray(d.chases)) mirrorChases(d.chases)
      if (Array.isArray(d.runningEffects)) mirrorRunningEffects(d.runningEffects)
      mirrorMasters(d)
      mirrorDmx(d)
      mirrorExecutorPage(d)
      mirrorPro(d)
      if (Array.isArray(d.speedMasters)) mirrorSpeedMasters(d.speedMasters)
      if (d.groupMasters) mirrorGroupMasters(d.groupMasters)
      if (d.columnFaders) mirrorColumnFaders(d.columnFaders)
      if (typeof d.timelinePlaying === 'boolean') {
        const local = getTimelineState()
        // Hold what this remote just did (Play / Stop / seek) until the console catches up
        const playing = isLocallyHeld('timelinePlaying') ? local.isPlaying : d.timelinePlaying
        const time = isLocallyHeld('timelineTime') || typeof d.timelineTime !== 'number' ? local.currentTime : d.timelineTime
        if (playing !== local.isPlaying || time !== local.currentTime) mirrorTimelineState(time, playing)
      }
      if (d.programmer) mirrorProgrammerSummary(d.programmer)
      const ui = useUiStore.getState()
      if (typeof d.showName === 'string' && d.showName !== ui.showName) ui.setShowName(d.showName)
      if (typeof d.isDirty === 'boolean' && d.isDirty !== ui.isDirty) ui.setDirty(d.isDirty)
    })
  } catch (e) {
    console.error('[Remote] Failed to apply state:', e)
  }
  // Show content the console changed (or a remote did): fetch what we did not produce
  if (d.content) onConsoleContentState(d.content)
}

/**
 * Hook: bidirectional sync between a remote browser and the console.
 * Call once in the root App component.
 */
export function useRemoteSync(): void {
  // ---- Pi → browser ----
  useEffect(() => {
    if (!isRemoteMode()) return
    const off = getBridge()?.remote.onState(applyRemoteState) as unknown as (() => void) | undefined
    // Loading the show for display resets runtime fields: restore the Pi's live state
    const offApplied = onShowApplied(() => {
      if (lastRemoteState) applyRemoteState(lastRemoteState)
    })
    return () => { off?.(); offApplied() }
  }, [])

  // ---- browser → Pi: executor page changes made here ('set-executor-page') ----
  useEffect(() => {
    if (!isRemoteMode()) return
    return useExecutorStore.subscribe((s, p) => {
      if (s.pages !== p.pages) {
        // Pages content arrived / changed: the console's page may exist now
        applyConsolePage()
        return
      }
      if (s.currentPage === p.currentPage || mirroringPage) return
      markLocalChange('executorPage')
      consolePage = s.currentPage
      sendRemoteCommand('set-executor-page', s.currentPage)
    })
  }, [])

  // ---- browser ↔ Pi: show content edits (scenes, cues, patch, executor layout…) ----
  useEffect(() => installRemoteContentSync(), [])

  // ---- console → Stage window: touch surface data (executor pages, stage pages) ----
  useEffect(() => (isRemoteMode() ? undefined : startStageSurfaceBroadcast()), [])
}
