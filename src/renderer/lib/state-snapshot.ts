// ============================================================
// PhotonBoard — State snapshot for the Stage window, Companion and
// remote browsers.
//
// The snapshot is SLIM: no per-cue channel values (only cue names /
// times / count) and the DMX mix as a compact base64 string. It is
// rebuilt only when something it contains changed, and pushed to main
//   - at most ~20 Hz for control state (scenes, masters, executor…),
//   - at most ~10 Hz when only the DMX mix changed (remote 3D view).
// Never runs in remote mode (a browser must not echo state back).
// ============================================================

import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { getTimelineState, onTimelinePlayStateChange } from './timeline-engine'
import { getMixBuffer, getMixVersion } from './dmx-mixer'
import { getBridge, isRemoteMode } from './runtime'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'

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
  showName: string
  isDirty: boolean
  cuelists: SnapshotCuelist[]
  chases: SnapshotChase[]
  groups: { id: string; name: string; color: string; fixtureCount: number }[]
  selectedFixtureIds: string[]
  fixtureCount: number
  executorGrid: (string | null)[][]
  executorColumns: { title: string; color: string }[]
  executorModes: string[][]
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
    executorModes: modes
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
export function collectFullSnapshot(): StateSnapshot {
  return { ...collectStateSnapshot(), dmx: currentDmx() }
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
    onTimelinePlayStateChange(onControlChange)
  ]

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
    offStage?.()
    offApi?.()
    if (timer) clearTimeout(timer)
    timer = null
  }
}
