// ============================================================
// PhotonBoard — State snapshot for the Stage window, Companion and
// remote browsers.
//
// The snapshot is SLIM: no per-cue channel values (only cue names /
// times / count) and the DMX mix as a compact base64 string. It is
// rebuilt only when something it contains changed, and pushed to main
//   - at most ~20 Hz for control state (scenes, masters, executor…),
//   - at most ~10 Hz when only the DMX mix or the timeline playhead
//     changed (remote 3D view, remote timeline).
// Never runs in remote mode (a browser must not echo state back).
// ============================================================

import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { getTimelineState, onTimelinePlayStateChange } from './timeline-engine'
import { getMixBuffer, getMixVersion, getProgrammerChannels } from './dmx-mixer'
import { getBridge, isRemoteMode } from './runtime'
import { getContentState, onContentStateChange } from './content-sync'
import { computeProgrammerSummary, type ProgrammerSummary } from './console-programmer'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import type { ContentState } from '@shared/remote-commands'
import { getLocale, onLocaleChange, type Locale } from '@renderer/i18n'

export interface SnapshotCue {
  id: string
  name: string
  number: number
  fadeIn: number
  fadeOut: number
  delay: number
  followTime: number | null
  color?: string
}

export interface SnapshotCuelist {
  id: string
  name: string
  isPlaying: boolean
  faderLevel: number
  currentCueIndex: number
  /** Number of cues (Stage window, Companion) */
  cueCount: number
  /** Cue list without channel values (remote scene views) */
  cues: SnapshotCue[]
  isLooping: boolean
  priority: number
  flash: boolean
}

export interface SnapshotChase {
  id: string
  name: string
  isPlaying: boolean
  bpm: number
  faderLevel: number
  currentStepIndex: number
  stepCount: number
}

export interface StateSnapshot {
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  strobeRate: number
  timelinePlaying: boolean
  /** Timeline playhead (seconds); sent with the DMX part, ~10 Hz while it moves */
  timelineTime?: number
  showName: string
  isDirty: boolean
  /** Console UI language: the Stage window follows it (remote browsers keep their own) */
  language?: Locale
  cuelists: SnapshotCuelist[]
  chases: SnapshotChase[]
  groups: { id: string; name: string; color: string; fixtureCount: number }[]
  selectedFixtureIds: string[]
  fixtureCount: number
  executorGrid: (string | null)[][]
  executorColumns: { title: string; color: string }[]
  executorModes: string[][]
  /** Ids of the running effects (remote effect buttons) */
  runningEffects: string[]
  /** Show content revisions per section: remotes refetch what they did not produce */
  content: ContentState
  /** Console programmer (remote record UI); sent with the DMX part */
  programmer?: ProgrammerSummary
  /** Pre-master DMX mix for remote previews: base64 of universes × 512 bytes */
  dmx?: { universes: number; data: string }
}

let cachedControl: Omit<StateSnapshot, 'dmx'> | null = null

/** Control part of the snapshot (no DMX). Cached until a source store changes. */
export function collectStateSnapshot(): Omit<StateSnapshot, 'dmx'> {
  if (cachedControl) return cachedControl
  const { grandMaster, blackout, blinder, strobe, strobeRate } = useDmxStore.getState()
  const { cuelists, chases } = usePlaybackStore.getState()
  const { showName, isDirty } = useUiStore.getState()
  const { patch, groups, selectedFixtureIds } = usePatchStore.getState()
  const { grid, columns, modes } = useExecutorStore.getState()

  cachedControl = {
    grandMaster,
    blackout,
    blinder,
    strobe,
    strobeRate,
    timelinePlaying: getTimelineState().isPlaying,
    showName,
    isDirty,
    language: getLocale(),
    cuelists: cuelists.map(cl => ({
      id: cl.id,
      name: cl.name,
      isPlaying: cl.isPlaying,
      faderLevel: cl.faderLevel,
      currentCueIndex: cl.currentCueIndex,
      cueCount: cl.cues.length,
      cues: cl.cues.map(c => {
        const cue: SnapshotCue = {
          id: c.id,
          name: c.name,
          number: c.number,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut,
          delay: c.delay,
          followTime: c.followTime
        }
        if (c.color) cue.color = c.color
        return cue
      }),
      isLooping: cl.isLooping,
      priority: cl.priority,
      flash: cl.flash
    })),
    chases: chases.map(ch => ({
      id: ch.id,
      name: ch.name,
      isPlaying: ch.isPlaying,
      bpm: ch.bpm,
      faderLevel: ch.faderLevel,
      currentStepIndex: ch.currentStepIndex,
      stepCount: ch.steps.length
    })),
    groups: groups.filter(g => !g.parentGroupId).map(g => ({
      id: g.id,
      name: g.name,
      color: g.color,
      fixtureCount: g.fixtureIds.length
    })),
    selectedFixtureIds,
    fixtureCount: patch.length,
    executorGrid: grid,
    executorColumns: columns,
    executorModes: modes,
    runningEffects: useEffectsStore.getState().effects.filter(e => e.isRunning).map(e => e.id),
    content: getContentState()
  }
  return cachedControl
}

let cachedDmx: { version: number; value: StateSnapshot['dmx'] } | null = null

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x2000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

/** Decode the `dmx` field of a snapshot into number[][] (remote side). */
export function decodeSnapshotDmx(dmx: unknown): number[][] | null {
  if (!dmx || typeof dmx !== 'object') return null
  const { universes, data } = dmx as { universes?: unknown; data?: unknown }
  if (typeof universes !== 'number' || typeof data !== 'string' || universes < 1 || universes > 16) return null
  let binary: string
  try {
    binary = atob(data)
  } catch {
    return null
  }
  const out: number[][] = []
  for (let u = 0; u < universes; u++) {
    const row = new Array<number>(DMX_CHANNELS_PER_UNIVERSE).fill(0)
    const base = u * DMX_CHANNELS_PER_UNIVERSE
    for (let ch = 0; ch < DMX_CHANNELS_PER_UNIVERSE && base + ch < binary.length; ch++) {
      row[ch] = binary.charCodeAt(base + ch) & 0xff
    }
    out.push(row)
  }
  return out
}

function currentDmx(): StateSnapshot['dmx'] {
  const version = getMixVersion()
  if (cachedDmx && cachedDmx.version === version) return cachedDmx.value
  const mix = getMixBuffer()
  const value = { universes: Math.max(1, Math.floor(mix.length / DMX_CHANNELS_PER_UNIVERSE)), data: encodeBase64(mix) }
  cachedDmx = { version, value }
  return value
}

/** Full snapshot including the DMX mix (Companion / remote browsers). */
let cachedProgrammer: { sig: string; patch: unknown; value: ProgrammerSummary } | null = null

/** Cheap signature of the programmer's channel set and values */
export function programmerSignature(): string {
  let count = 0
  let hash = 0
  for (const [u, chMap] of getProgrammerChannels()) {
    for (const [ch, v] of chMap) {
      count++
      hash = (hash + Math.imul(u * 512 + ch + 1, 2654435761) + v * 7) | 0
    }
  }
  return `${count}:${hash}`
}

function currentProgrammer(): ProgrammerSummary {
  const sig = programmerSignature()
  const patch = usePatchStore.getState().patch
  if (cachedProgrammer && cachedProgrammer.sig === sig && cachedProgrammer.patch === patch) return cachedProgrammer.value
  const value = computeProgrammerSummary()
  cachedProgrammer = { sig, patch, value }
  return value
}

export function collectFullSnapshot(): StateSnapshot {
  const timelineTime = Math.round(getTimelineState().currentTime * 100) / 100
  return { ...collectStateSnapshot(), timelineTime, programmer: currentProgrammer(), dmx: currentDmx() }
}

const CONTROL_INTERVAL_MS = 50 // ~20 Hz
const DMX_INTERVAL_MS = 100 // ~10 Hz

/**
 * Answer state requests from main (Stage window / API) and push the snapshot
 * to remote clients when it changes. Returns a stop function.
 */
export function startStateBroadcast(): () => void {
  if (isRemoteMode()) return () => {}
  const bridge = getBridge()
  if (!bridge) return () => {}

  let controlDirty = true
  let dmxDirty = true
  let lastSent = -Infinity
  let lastDmxSent = -Infinity
  let lastDmxVersion = -1
  let lastTimelineTime = getTimelineState().currentTime
  let lastProgrammerSig = programmerSignature()
  let timer: ReturnType<typeof setTimeout> | null = null

  const send = () => {
    timer = null
    const now = Date.now()
    if (controlDirty || (dmxDirty && now - lastDmxSent >= DMX_INTERVAL_MS)) {
      controlDirty = false
      dmxDirty = false
      lastSent = now
      lastDmxSent = now
      try {
        bridge.api.sendState(collectFullSnapshot())
      } catch (e) {
        console.warn('[State] broadcast failed:', e)
      }
    }
    if (dmxDirty) schedule()
  }

  const schedule = () => {
    if (timer) return
    const now = Date.now()
    const wait = controlDirty
      ? Math.max(0, lastSent + CONTROL_INTERVAL_MS - now)
      : Math.max(0, lastDmxSent + DMX_INTERVAL_MS - now)
    timer = setTimeout(send, wait)
  }

  const onControlChange = () => {
    cachedControl = null
    controlDirty = true
    schedule()
  }

  const unsubs: (() => void)[] = [
    usePlaybackStore.subscribe((s, p) => {
      if (s.cuelists !== p.cuelists || s.chases !== p.chases) onControlChange()
    }),
    useDmxStore.subscribe((s, p) => {
      if (s.grandMaster !== p.grandMaster || s.blackout !== p.blackout || s.blinder !== p.blinder ||
          s.strobe !== p.strobe || s.strobeRate !== p.strobeRate) {
        onControlChange()
      }
      if (s.values !== p.values) {
        // The published mix changed (≤ 25 Hz)
        const v = getMixVersion()
        if (v !== lastDmxVersion) {
          lastDmxVersion = v
          dmxDirty = true
          schedule()
        }
      }
    }),
    useExecutorStore.subscribe((s, p) => {
      if (s.grid !== p.grid || s.columns !== p.columns || s.modes !== p.modes) onControlChange()
    }),
    usePatchStore.subscribe((s, p) => {
      if (s.patch !== p.patch || s.groups !== p.groups || s.selectedFixtureIds !== p.selectedFixtureIds) onControlChange()
    }),
    useUiStore.subscribe((s, p) => {
      if (s.showName !== p.showName || s.isDirty !== p.isDirty) onControlChange()
    }),
    useEffectsStore.subscribe((s, p) => {
      if (s.effects === p.effects) return
      const running = (list: typeof s.effects) => list.filter(e => e.isRunning).map(e => e.id).join(',')
      if (running(s.effects) !== running(p.effects)) onControlChange()
    }),
    onContentStateChange(onControlChange),
    onTimelinePlayStateChange(onControlChange),
    onLocaleChange(onControlChange)
  ]

  // The playhead rides with the DMX part (same ~10 Hz rate)
  // So does the programmer summary (a value equal to the output changes no DMX)
  const timelinePoll = setInterval(() => {
    const t = getTimelineState().currentTime
    const sig = programmerSignature()
    if (t === lastTimelineTime && sig === lastProgrammerSig) return
    lastTimelineTime = t
    lastProgrammerSig = sig
    dmxDirty = true
    schedule()
  }, DMX_INTERVAL_MS)

  // Stage window polls at 30 Hz: answer from the cache (no DMX needed there)
  const offStage = bridge.stage.onRequestState(() => {
    bridge.stage.sendState(collectStateSnapshot())
  }) as unknown as (() => void) | undefined
  // Companion / API polls at a few Hz
  const offApi = bridge.api.onRequestState(() => {
    bridge.api.sendState(collectFullSnapshot())
  }) as unknown as (() => void) | undefined

  schedule()

  return () => {
    for (const u of unsubs) u()
    clearInterval(timelinePoll)
    offStage?.()
    offApi?.()
    if (timer) clearTimeout(timer)
    timer = null
  }
}
