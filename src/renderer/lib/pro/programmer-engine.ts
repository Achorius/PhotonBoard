// ============================================================
// PhotonBoard — Programmer engine (pro)
//
// Everything the pro programmer adds on top of the programmer layer of
// the mixer (which keeps holding the values: remote mode, the UI and
// recording keep working unchanged):
//
//   - values with a fade / delay (per value meta, the `time` given, or
//     the programmer time): interpolated per channel on the mixer
//     clock (frame source, order 5) and written through the programmer
//     channel API. 16-bit pairs fade on the combined value. A delayed
//     channel joins the programmer when its delay ends; a fade starts
//     from what the channel shows at that moment.
//   - meta per fixture channel (preset ref, fade, delay), kept while
//     the programmer holds the channel: cleared with the programmer,
//     released with the value; a channel set by hand (a fader) loses
//     its preset ref and timing but remembers the preset as `origin`
//     (Update goes back to it) — recording copies presetId / fade /
//     delay (recordFromProgrammer withMeta).
//   - highlight: a mixer layer after the programmer (never recorded):
//     full, open white, positions untouched; follows the active
//     selection (Next / Prev) while on.
//   - park / group masters / blind: pool-store and pro-store wired to
//     the mixer's flat output arrays.
// ============================================================

import type { CueChannelValue } from '@shared/types'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { getActiveSelection, useSelectionStore } from '@renderer/stores/selection-store'
import {
  getMixValue, getOutputBuffer, getProgrammerValue, registerFrameSource, setBlind, setGroupMasterScale,
  setHighlightChannels, setParked, setProgrammerListener
} from '@renderer/lib/dmx-mixer'
import {
  highlightChannels, programChannel, releaseFixtures as releaseFixtureChannels, setProgrammerOverlay
} from '@renderer/lib/programmer-utils'
import { cueKey, getFixtureIndex, splitCueKey, type FixtureIndex } from '@renderer/lib/fixture-index'
import { segmentProgress, smoothstep } from '@renderer/lib/fade-math'
import { clockNow, isRemoteMode } from '@renderer/lib/runtime'
import { resolvePresetForFixture } from './preset-resolve'
import type { ProgTime } from './contracts'

export interface ProgrammerMeta {
  /** Live preset reference (recorded into cues) */
  presetId?: string
  fade?: number
  delay?: number
  /**
   * The preset the value came from before it was changed by hand: no
   * longer a reference (not recorded), but "Update" still updates it.
   */
  origin?: string
}

export interface AttributeValue {
  fixtureId: string
  channelName: string
  value: number
  meta?: ProgrammerMeta
}

const U = DMX_CHANNELS_PER_UNIVERSE

// ---------------------------------------------------------------- state

/** fixtureId:channelName → meta */
const meta = new Map<string, ProgrammerMeta>()
/** flat index (universe * 512 + channel) → meta key */
const keyByIdx = new Map<number, string>()

interface Fade {
  /** Coarse (or only) channel */
  idx: number
  /** 16-bit fine partner faded with it, or -1 */
  fineIdx: number
  /** Start value (16-bit when fineIdx ≥ 0); -1 = taken when the delay ends */
  from: number
  /** Target (16-bit when fineIdx ≥ 0) */
  to: number
  start: number
  delayMs: number
  fadeMs: number
}

/** Running fades by channel index (a 16-bit pair is listed under both indexes) */
const fades = new Map<number, Fade>()
/** True while the engine writes (its own writes are not "by hand") */
let writing = false

let clock: () => number = clockNow
let remoteTimer: ReturnType<typeof setInterval> | null = null

function fixtureIndex(): FixtureIndex {
  const { patch, fixtures } = usePatchStore.getState()
  return getFixtureIndex(patch, fixtures)
}

function seconds(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 3600) : 0
}

function clampByte(v: number): number {
  return Number.isFinite(v) ? (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)) : 0
}

function write(idx: number, value: number): void {
  writing = true
  try {
    programChannel(Math.floor(idx / U), idx % U, value)
  } finally {
    writing = false
  }
}

function dropFade(idx: number): void {
  const f = fades.get(idx)
  if (!f) return
  fades.delete(f.idx)
  if (f.fineIdx >= 0) fades.delete(f.fineIdx)
}

/** What a channel shows now: its programmer value, else the mix */
function currentValue(idx: number): number {
  const u = Math.floor(idx / U)
  const ch = idx % U
  return getProgrammerValue(u, ch) ?? getMixValue(u, ch) ?? 0
}

// ---------------------------------------------------------------- frame

/** Advance the fades to `now` (mixer clock, ms). Exported for tests. */
export function tickProgrammer(now: number): void {
  if (fades.size === 0) return
  for (const [idx, f] of fades) {
    if (f.idx !== idx) continue // the fine alias of a 16-bit pair
    const t = now - f.start - f.delayMs
    if (t < 0) continue
    const wide = f.fineIdx >= 0
    if (f.from < 0) f.from = wide ? currentValue(f.idx) * 256 + currentValue(f.fineIdx) : currentValue(f.idx)
    const p = smoothstep(segmentProgress(t, f.fadeMs))
    const v = Math.round(f.from + (f.to - f.from) * p)
    if (wide) {
      const v16 = Math.max(0, Math.min(65535, v))
      write(f.idx, v16 >> 8)
      write(f.fineIdx, v16 & 0xff)
    } else {
      write(f.idx, clampByte(v))
    }
    if (p >= 1) {
      fades.delete(f.idx)
      if (wide) fades.delete(f.fineIdx)
    }
  }
  if (fades.size === 0) stopRemoteTimer()
}

function ensureTicking(): void {
  // The console ticks on the mixer clock; a remote has no mixer: its own timer
  if (!isRemoteMode() || remoteTimer) return
  remoteTimer = setInterval(() => tickProgrammer(clock()), 33)
}

function stopRemoteTimer(): void {
  if (remoteTimer) {
    clearInterval(remoteTimer)
    remoteTimer = null
  }
}

// ---------------------------------------------------------------- values

interface Resolved {
  key: string
  idx: number
  /** Coarse key of a 16-bit pair this value is the fine half of */
  coarseKey?: string
  fineKey?: string
  value: number
  fadeS: number
  delayS: number
}

/**
 * Put values in the programmer (fixture channel → DMX address), with their
 * meta. Timing per value: meta fade / delay, else `time`, else the
 * programmer time; no time = written at once.
 */
export function setAttributeValues(values: AttributeValue[], time?: ProgTime): void {
  const progTime = time ?? useProStore.getState().progTime ?? undefined
  const index = fixtureIndex()
  const batch = new Map<string, Resolved>()
  for (const v of values) {
    const key = cueKey(v.fixtureId, v.channelName)
    const addr = index.resolve(key)
    if (!addr) continue
    const idx = addr.universe * U + addr.channel
    const km = index.meta(key)
    const fadeS = seconds(v.meta?.fade ?? progTime?.fade)
    const delayS = seconds(v.meta?.delay ?? progTime?.delay)
    batch.set(key, { key, idx, coarseKey: km.coarseKey, fineKey: km.fineKey, value: clampByte(v.value), fadeS, delayS })

    // meta (what recording copies)
    const m: ProgrammerMeta = {}
    if (v.meta?.presetId !== undefined) m.presetId = v.meta.presetId
    if (fadeS > 0) m.fade = fadeS
    if (delayS > 0) m.delay = delayS
    // keep the key's spelling of the definition (index lookups are case-insensitive)
    const metaK = cueKey(v.fixtureId, v.channelName)
    const old = keyByIdx.get(idx)
    if (old && old !== metaK) meta.delete(old)
    if (m.presetId === undefined) {
      // a new plain value: Update still knows the preset it came from
      const prev = meta.get(metaK)
      const origin = prev?.presetId ?? prev?.origin
      if (origin) m.origin = origin
    }
    keyByIdx.set(idx, metaK)
    if (m.presetId !== undefined || m.fade !== undefined || m.delay !== undefined || m.origin !== undefined) meta.set(metaK, m)
    else meta.delete(metaK)
  }

  const now = clock()
  let started = false
  for (const r of batch.values()) {
    if (r.coarseKey && batch.has(r.coarseKey)) continue // fine half: handled with its coarse channel
    const fine = r.fineKey ? batch.get(r.fineKey) : undefined
    dropFade(r.idx)
    if (fine) dropFade(fine.idx)
    if (r.fadeS === 0 && r.delayS === 0) {
      write(r.idx, r.value)
      if (fine) write(fine.idx, fine.value)
      continue
    }
    // 16-bit when the fine half is part of the change, or already in the programmer (kept)
    let fineIdx = -1
    let fineTarget = 0
    if (fine) {
      fineIdx = fine.idx
      fineTarget = fine.value
    } else if (r.fineKey) {
      const a = index.resolve(r.fineKey)
      const held = a ? getProgrammerValue(a.universe, a.channel) : undefined
      if (a && held !== undefined) {
        fineIdx = a.universe * U + a.channel
        fineTarget = held
      }
    }
    const f: Fade = {
      idx: r.idx,
      fineIdx,
      from: -1,
      to: fineIdx >= 0 ? r.value * 256 + fineTarget : r.value,
      start: now,
      delayMs: r.delayS * 1000,
      fadeMs: r.fadeS * 1000
    }
    fades.set(f.idx, f)
    if (fineIdx >= 0) fades.set(fineIdx, f)
    started = true
  }
  if (started) {
    tickProgrammer(now) // fades with no delay take their start value now
    ensureTicking()
  }
}

/** Apply a preset to fixtures; returns the number of channel values set. */
export function applyPreset(presetId: string, fixtureIds: string[], time?: ProgTime): number {
  const preset = usePlaybackStore.getState().presets.find(p => p.id === presetId)
  if (!preset) return 0
  const { patch, fixtures } = usePatchStore.getState()
  const values: AttributeValue[] = []
  for (const id of fixtureIds) {
    const entry = patch.find(p => p.id === id)
    if (!entry) continue
    const def = fixtures.find(f => f.id === entry.fixtureDefId)
    for (const [channelName, value] of resolvePresetForFixture(preset, entry, def)) {
      values.push({ fixtureId: id, channelName, value, meta: { presetId } })
    }
  }
  setAttributeValues(values, time)
  return values.length
}

/**
 * Mark programmer channels as coming from a preset (after "Store Preset":
 * the programmer now shows that preset, and Update goes back to it).
 */
export function setPresetRef(values: readonly { fixtureId: string; channelName: string }[], presetId: string): void {
  const index = fixtureIndex()
  for (const v of values) {
    const key = cueKey(v.fixtureId, v.channelName)
    const a = index.resolve(key)
    if (!a) continue
    const idx = a.universe * U + a.channel
    if (!fades.has(idx) && getProgrammerValue(a.universe, a.channel) === undefined) continue
    const old = keyByIdx.get(idx)
    if (old && old !== key) meta.delete(old)
    keyByIdx.set(idx, key)
    const { origin: _o, ...rest } = meta.get(key) ?? {}
    meta.set(key, { ...rest, presetId })
  }
}

/** Meta of the channels the programmer holds or is fading in (fixtureId:channelName → meta). */
export function getProgrammerMeta(): ReadonlyMap<string, ProgrammerMeta> {
  for (const [idx, key] of keyByIdx) {
    if (fades.has(idx) || getProgrammerValue(Math.floor(idx / U), idx % U) !== undefined) continue
    meta.delete(key)
    keyByIdx.delete(idx)
  }
  return meta
}

/** Target values of the channels being faded / delayed: universe → channel → value */
export function getProgrammerTargets(): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>()
  const put = (idx: number, v: number) => {
    const u = Math.floor(idx / U)
    let m = out.get(u)
    if (!m) { m = new Map(); out.set(u, m) }
    m.set(idx % U, v)
  }
  for (const [idx, f] of fades) {
    if (f.idx !== idx) continue
    if (f.fineIdx >= 0) {
      put(f.idx, f.to >> 8)
      put(f.fineIdx, f.to & 0xff)
    } else {
      put(f.idx, f.to)
    }
  }
  return out
}

/** True while some programmer value is fading or waiting for its delay */
export function isProgrammerFading(): boolean {
  return fades.size > 0
}

/** Forget all meta and fades (clear programmer). */
export function clearProgrammerMeta(): void {
  meta.clear()
  keyByIdx.clear()
  fades.clear()
  stopRemoteTimer()
}

/** Release these fixtures from the programmer: values, fades still running and meta. Returns channels released. */
export function releaseFixtures(fixtureIds: readonly string[]): number {
  const ids = new Set(fixtureIds)
  for (const [idx, key] of Array.from(keyByIdx)) {
    if (!ids.has(splitCueKey(key)[0])) continue
    dropFade(idx)
    meta.delete(key)
    keyByIdx.delete(idx)
  }
  // fades of channels without meta (no key): by footprint
  if (fades.size > 0) {
    const { patch, getFixtureChannels } = usePatchStore.getState()
    for (const entry of patch) {
      if (!ids.has(entry.id)) continue
      for (const ch of getFixtureChannels(entry)) dropFade(entry.universe * U + ch.absoluteChannel)
    }
  }
  return releaseFixtureChannels(fixtureIds)
}

/** Programmer fade / delay applied to new values (null = none) */
export function setProgrammerTime(t: ProgTime | null): void {
  useProStore.getState().setProgTime(t)
}

// ---------------------------------------------------------------- highlight

let highlightIds: string[] | null = null

function applyHighlight(): void {
  const on = useProStore.getState().highlight
  if (!on) {
    setHighlightChannels(null)
    return
  }
  const ids = highlightIds ?? getActiveSelection()
  setHighlightChannels(ids.length > 0 ? highlightChannels(ids) : null)
}

/**
 * Highlight these fixtures (null / empty = off). While on, the highlight
 * follows the selection (Next / Prev step) when it changes.
 */
export function setHighlight(fixtureIds: string[] | null): void {
  const on = !!fixtureIds && fixtureIds.length > 0
  highlightIds = on ? [...fixtureIds!] : null
  useProStore.getState().setHighlight(on)
  applyHighlight()
}

// ---------------------------------------------------------------- park / group masters

/** Park channels at these values (saved with the show; applied after every master) */
export function park(values: CueChannelValue[]): void {
  usePoolStore.getState().park(values)
}

/** Unpark every channel of these fixtures */
export function unpark(fixtureIds: string[]): void {
  usePoolStore.getState().unpark(fixtureIds)
}

/** Current output (post-master) of every channel of these fixtures, as cue values (park "as is") */
export function outputValuesOf(fixtureIds: readonly string[]): CueChannelValue[] {
  const ids = new Set(fixtureIds)
  const { patch, getFixtureChannels } = usePatchStore.getState()
  const out = getOutputBuffer()
  const values: CueChannelValue[] = []
  for (const entry of patch) {
    if (!ids.has(entry.id)) continue
    for (const ch of getFixtureChannels(entry)) {
      const idx = entry.universe * U + ch.absoluteChannel
      values.push({ fixtureId: entry.id, channelName: ch.name, value: out[idx] ?? 0 })
    }
  }
  return values
}

/** Parked values → flat array for the mixer (null when nothing is parked) */
export function buildParkedArray(parked: readonly CueChannelValue[], index: FixtureIndex): Int16Array | null {
  if (parked.length === 0) return null
  const addrs: [number, number][] = []
  let max = -1
  for (const v of parked) {
    const a = index.resolve(cueKey(v.fixtureId, v.channelName))
    if (!a) continue
    const idx = a.universe * U + a.channel
    addrs.push([idx, clampByte(v.value)])
    if (idx > max) max = idx
  }
  if (addrs.length === 0) return null
  const arr = new Int16Array((Math.floor(max / U) + 1) * U).fill(-1)
  for (const [idx, v] of addrs) arr[idx] = v
  return arr
}

/** Group masters → flat scale array (null when every group master is full) */
export function buildGroupScaleArray(
  groupMasters: Readonly<Record<string, number>>,
  groups: readonly { id: string; fixtureIds: string[] }[],
  channelsOf: (fixtureId: string) => number[]
): Float32Array | null {
  const scaled: [string[], number][] = []
  for (const g of groups) {
    const level = groupMasters[g.id]
    if (level === undefined || !Number.isFinite(level) || level >= 255) continue
    scaled.push([g.fixtureIds, Math.max(0, level) / 255])
  }
  if (scaled.length === 0) return null
  const perFixture = new Map<string, number>()
  for (const [ids, s] of scaled) {
    // a fixture in several scaled groups: the masters multiply
    for (const id of new Set(ids)) perFixture.set(id, (perFixture.get(id) ?? 1) * s)
  }
  const entries: [number[], number][] = []
  let max = -1
  for (const [id, s] of perFixture) {
    const chs = channelsOf(id)
    for (const c of chs) if (c > max) max = c
    entries.push([chs, s])
  }
  if (max < 0) return null
  const arr = new Float32Array((Math.floor(max / U) + 1) * U).fill(1)
  for (const [chs, s] of entries) for (const c of chs) arr[c] = s
  return arr
}

function syncParked(): void {
  setParked(buildParkedArray(usePoolStore.getState().parked, fixtureIndex()))
}

function syncGroupMasters(): void {
  const { patch, groups, getFixtureChannels } = usePatchStore.getState()
  const byId = new Map(patch.map(p => [p.id, p]))
  setGroupMasterScale(buildGroupScaleArray(usePoolStore.getState().groupMasters, groups, (id) => {
    const entry = byId.get(id)
    if (!entry) return []
    return getFixtureChannels(entry)
      .filter(c => c.absoluteChannel >= 0 && c.absoluteChannel < U)
      .map(c => entry.universe * U + c.absoluteChannel)
  }))
}

// ---------------------------------------------------------------- install

/** Programmer change from outside the engine (fader, remote, release, clear) */
function onProgrammerChange(kind: 'set' | 'release' | 'clear', universe: number, channel: number): void {
  if (kind === 'clear') {
    clearProgrammerMeta()
    // A mixer reset (show load) also dropped the highlight layer
    if (useProStore.getState().highlight) applyHighlight()
    return
  }
  if (writing) return
  const idx = universe * U + channel
  dropFade(idx)
  const key = keyByIdx.get(idx)
  if (!key) return
  const m = meta.get(key)
  const origin = m?.presetId ?? m?.origin
  if (kind === 'set' && origin) {
    // set by hand: no longer the preset's value (nor its timing), but Update goes back to it
    meta.set(key, { origin })
  } else {
    meta.delete(key)
    keyByIdx.delete(idx)
  }
}

let uninstall: (() => void) | null = null

/**
 * Wire the engine (idempotent; done when this module loads): mixer frame
 * source, programmer listener, overlay for recording, and the
 * park / group master / blind / highlight subscriptions.
 */
export function installProgrammerEngine(): () => void {
  if (uninstall) return uninstall
  const unregister = registerFrameSource('programmer', tickProgrammer, 5)
  setProgrammerListener(onProgrammerChange)
  setProgrammerOverlay({
    targets: getProgrammerTargets,
    meta: (fixtureId, channelName) => getProgrammerMeta().get(cueKey(fixtureId, channelName))
  })
  const unsubs = [
    usePoolStore.subscribe((s, p) => {
      if (s.parked !== p.parked) syncParked()
      if (s.groupMasters !== p.groupMasters) syncGroupMasters()
    }),
    usePatchStore.subscribe((s, p) => {
      if (s.patch !== p.patch || s.fixtures !== p.fixtures) {
        syncParked()
        syncGroupMasters()
        if (useProStore.getState().highlight) applyHighlight()
      } else if (s.groups !== p.groups) {
        syncGroupMasters()
      }
      if (s.selectedFixtureIds !== p.selectedFixtureIds && useProStore.getState().highlight) {
        highlightIds = null
        applyHighlight()
      }
    }),
    useSelectionStore.subscribe((s, p) => {
      if ((s.step !== p.step || s.matricks !== p.matricks) && useProStore.getState().highlight) {
        highlightIds = null
        applyHighlight()
      }
    }),
    useProStore.subscribe((s, p) => {
      if (s.blind !== p.blind) setBlind(s.blind)
      if (s.highlight !== p.highlight) {
        if (!s.highlight) highlightIds = null
        applyHighlight()
      }
    })
  ]
  setBlind(useProStore.getState().blind)
  syncParked()
  syncGroupMasters()
  applyHighlight()
  uninstall = () => {
    unregister()
    setProgrammerListener(null)
    setProgrammerOverlay(null)
    for (const u of unsubs) u()
    stopRemoteTimer()
    uninstall = null
  }
  return uninstall
}

/** Tests: drive the engine with a fake clock (null = the real one) */
export function __setProgrammerClockForTests(fn: (() => number) | null): void {
  clock = fn ?? clockNow
}

installProgrammerEngine()
