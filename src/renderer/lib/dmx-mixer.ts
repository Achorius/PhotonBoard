// ============================================================
// PhotonBoard — DMX Mixer
// Central mixing engine: collects all sources (programmer, cuelists,
// chases, effects, timeline) and merges them using HTP/LTP rules,
// then applies the master section (Grand Master, blackout, blinder,
// strobe) in a single OUTPUT STAGE that only touches intensity:
// pan/tilt/gobo/colour-wheel/control channels are never scaled.
//
// Design principle: NO source writes DMX directly. Each source
// registers a layer here; the mixer produces the final frame and
// sends only the channels that changed to the main process.
//
// One clock drives everything: engines register a frame source and
// are updated with the same `now` right before the mix, so fades,
// chases and effects stay in lock-step (and keep running while the
// window is hidden — the loop uses a timer, not rAF).
//
// Pro additions (all inactive unless used — the simple path is
// unchanged):
//   - layer flags: LAYER_SWAP (intensity claimed LTP-style against
//     lower layers), LAYER_SUPER (merged AFTER the programmer),
//   - HIGHLIGHT_LAYER_ID: merged after the programmer, never recorded,
//   - Blind: the programmer (and highlight) leave the output; a
//     preview mix that includes them is produced (getPreviewBuffer),
//   - group masters: a flat per-channel scale on intensity, before GM,
//   - park: a flat per-channel value applied last (after GM).
// Merge order: layers → programmer → super layers → highlight →
// masters (group masters, GM, blackout, strobe, blinder) → park.
// ============================================================

import { useDmxStore, setDmxStoreProgrammerReset } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { DMX_CHANNELS_PER_UNIVERSE, MAX_UNIVERSES, type FixtureDefinition, type PatchEntry } from '@shared/types'
import { getDeviceProfile } from './device-detect'
import { classifyModeChannels, ChannelRole, isIntensityRole } from './channel-classify'
import { clockNow, getBridge, isRemoteMode, sendRemoteCommand, toDmx } from './runtime'

// --------------- Types ---------------

export type LayerPriority = number // 0-100, higher wins for LTP

/** Sparse per-universe channel map: universe → (channel 0-511 → value 0-255) */
export type LayerChannels = Map<number, Map<number, number>>

/** A single source layer contributing DMX values. */
export interface MixerLayer {
  id: string
  /** 0-100. Higher priority wins for LTP channels. */
  priority: LayerPriority
  /** Playback master 0-255. Scales INTENSITY channels only. 0 = layer inactive. */
  master: number
  /** Activation timestamp (ms). Used to break LTP ties at same priority (latest wins). */
  activatedAt: number
  channels: LayerChannels
  /** LAYER_SWAP | LAYER_SUPER (pro priority modes); 0 / undefined = normal */
  flags?: number
}

/** Layer flag: the layer's intensity (HTP) channels are claimed LTP-style against LOWER layers */
export const LAYER_SWAP = 1
/** Layer flag: the layer is merged after the programmer (wins over it) */
export const LAYER_SUPER = 2

/** Flat per-channel description of the patch (index = universe * 512 + channel). */
export interface ChannelInfo {
  universeCount: number
  /** 1 = HTP */
  htp: Uint8Array
  /** ChannelRole */
  role: Uint8Array
  defaults: Uint8Array
  /** -1 = blinder leaves the channel alone */
  blinder: Int16Array
  /** coarse intensity channel → index of its 16-bit fine partner (or -1) */
  fineOf: Int32Array
  /** 1 = this is the fine half of a 16-bit intensity pair (handled with its coarse channel) */
  isFine: Uint8Array
}

export interface MasterState {
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  /** Current strobe phase: true = lit */
  strobeOn: boolean
}

const U = DMX_CHANNELS_PER_UNIVERSE

/** Reserved layer id for the programmer (manual faders). Always wins. */
export const PROGRAMMER_LAYER_ID = '__programmer__'

/** Reserved layer id for Highlight: merged after the programmer, never recorded. */
export const HIGHLIGHT_LAYER_ID = '__highlight__'

// ============================================================
// Pure core (unit-tested)
// ============================================================

export function createChannelInfo(universeCount: number): ChannelInfo {
  const size = universeCount * U
  return {
    universeCount,
    htp: new Uint8Array(size),
    role: new Uint8Array(size),
    defaults: new Uint8Array(size),
    blinder: new Int16Array(size).fill(-1),
    fineOf: new Int32Array(size).fill(-1),
    isFine: new Uint8Array(size)
  }
}

/**
 * Build the channel description of the whole patch. Universe count is at
 * least `minUniverses` and grows to cover every patched universe.
 */
export function buildChannelInfo(
  patch: PatchEntry[],
  fixtures: FixtureDefinition[],
  minUniverses = 1
): ChannelInfo {
  let universeCount = Math.max(1, minUniverses)
  for (const entry of patch) {
    if (Number.isInteger(entry.universe) && entry.universe >= 0 && entry.universe < MAX_UNIVERSES) {
      universeCount = Math.max(universeCount, entry.universe + 1)
    }
  }
  const info = createChannelInfo(universeCount)
  const defsById = new Map(fixtures.map(f => [f.id, f]))

  for (const entry of patch) {
    if (!(entry.universe >= 0 && entry.universe < universeCount)) continue
    const def = defsById.get(entry.fixtureDefId)
    const mode = def?.modes.find(m => m.name === entry.modeName)
    if (!def || !mode) continue
    const classified = classifyModeChannels(def, mode)
    const base = entry.universe * U + entry.address - 1
    classified.forEach((c, i) => {
      const ch = entry.address - 1 + i
      if (ch < 0 || ch >= U) return
      const idx = base + i
      info.htp[idx] = c.htp ? 1 : 0
      info.role[idx] = c.role
      info.defaults[idx] = c.defaultValue
      info.blinder[idx] = c.blinderValue
      if (isIntensityRole(c.role)) {
        if (c.coarseIndex !== -1) info.isFine[idx] = 1
        const fineCh = entry.address - 1 + c.fineIndex
        if (c.fineIndex !== -1 && fineCh < U) info.fineOf[idx] = base + c.fineIndex
      }
    })
  }
  return info
}

function finiteByte(v: number): number {
  // NaN / Infinity never reach the wire
  if (!(v > 0)) return 0
  if (v >= 255) return 255
  return Math.round(v)
}

/** Options of mixLayers (pro features; omitted = the classic mix) */
export interface MixOptions {
  /** Blind: the programmer and the highlight do not reach `out` */
  excludeProgrammer?: boolean
  /** Also produce the mix WITH the programmer and highlight (Blind preview) here */
  preview?: Uint8Array
}

// Scratch reused frame after frame (no per-frame allocation)
let mixState = new Uint8Array(U)
const sortedScratch: MixerLayer[] = []
const superScratch: MixerLayer[] = []

const byPriorityThenLatest = (a: MixerLayer, b: MixerLayer) => (b.priority - a.priority) || (b.activatedAt - a.activatedAt)

// Merge context of the layer being merged: mergeChannel is a plain
// function (Map.forEach callback) so the hot loop allocates nothing.
const EMPTY = new Uint8Array(0)
let mOut: Uint8Array = EMPTY
let mState: Uint8Array = EMPTY
let mHtp: Uint8Array = EMPTY
let mRole: Uint8Array = EMPTY
let mBase = 0
let mScale = 1
/** State an HTP write leaves: 1 = merged, 2 = claimed (swap layer) */
let mHtpMark = 1

function mergeChannel(raw: number, ch: number): void {
  if (ch < 0 || ch >= U) return
  const idx = mBase + ch
  const value = finiteByte(isIntensityRole(mRole[idx] as ChannelRole) ? raw * mScale : raw)
  const st = mState[idx]
  if (mHtp[idx]) {
    if (st === 2) return // claimed by a higher swap layer
    if (st === 0 || value > mOut[idx]) mOut[idx] = value
    mState[idx] = mHtpMark
  } else if (st !== 2) {
    mOut[idx] = value
    mState[idx] = 2
  }
}

/** Raw overlay (programmer / highlight): the layer's values replace the mix */
function overlayRaw(layer: MixerLayer, info: ChannelInfo, out: Uint8Array): void {
  for (const [u, uniMap] of layer.channels) {
    if (u < 0 || u >= info.universeCount) continue
    for (const [ch, raw] of uniMap) {
      if (ch < 0 || ch >= U) continue
      const idx = u * U + ch
      if (idx < out.length) out[idx] = finiteByte(raw)
    }
  }
}

/**
 * Super layers (sorted, highest first) over the mix: they win over
 * everything merged before them; between super layers, HTP channels take
 * the highest value and LTP channels the highest priority / latest layer.
 * `mark` must differ between two calls in the same frame.
 */
function overlaySupers(supers: MixerLayer[], info: ChannelInfo, out: Uint8Array, state: Uint8Array, mark: number): void {
  for (const layer of supers) {
    const scale = Math.min(255, layer.master) / 255
    for (const [u, uniMap] of layer.channels) {
      if (u < 0 || u >= info.universeCount) continue
      for (const [ch, raw] of uniMap) {
        if (ch < 0 || ch >= U) continue
        const idx = u * U + ch
        if (idx >= out.length) continue
        const value = finiteByte(isIntensityRole(info.role[idx] as ChannelRole) ? raw * scale : raw)
        if (state[idx] !== mark) {
          out[idx] = value
          state[idx] = mark
        } else if (info.htp[idx] && value > out[idx]) {
          out[idx] = value
        }
      }
    }
  }
}

/**
 * Merge layers into `out` (pre-master mix, length universeCount*512).
 *
 *  - Every channel starts at its neutral default.
 *  - HTP channels: highest (master-scaled) value across layers.
 *  - LTP channels: highest priority layer wins, latest activation breaks ties.
 *  - A layer's master scales intensity channels only (dimmers, and the
 *    colour emitters of dimmer-less fixtures) — never position/colour/gobo.
 *  - A layer whose master is 0 is inactive (claims no LTP channel).
 *  - LAYER_SWAP: the layer's HTP channels merge HTP with HIGHER layers but
 *    are claimed (LTP-style) against lower ones.
 *  - The programmer always wins over normal layers; LAYER_SUPER layers are
 *    merged after it; the highlight layer comes last.
 *  - `opts.excludeProgrammer` (Blind): programmer and highlight stay out of
 *    `out`; `opts.preview` receives the mix with them.
 */
export function mixLayers(layers: Iterable<MixerLayer>, info: ChannelInfo, out: Uint8Array, opts?: MixOptions): void {
  out.set(info.defaults.subarray(0, out.length))
  const size = Math.min(out.length, info.universeCount * U)

  let programmer: MixerLayer | undefined
  let highlight: MixerLayer | undefined
  const sorted = sortedScratch
  const supers = superScratch
  sorted.length = 0
  supers.length = 0
  for (const layer of layers) {
    if (layer.id === PROGRAMMER_LAYER_ID) { programmer = layer; continue }
    if (layer.id === HIGHLIGHT_LAYER_ID) { highlight = layer; continue }
    if (layer.channels.size === 0 || !(layer.master > 0)) continue
    if ((layer.flags ?? 0) & LAYER_SUPER) supers.push(layer)
    else sorted.push(layer)
  }
  sorted.sort(byPriorityThenLatest)
  if (supers.length > 1) supers.sort(byPriorityThenLatest)

  // 0 = untouched, 1 = HTP written, 2 = claimed (LTP, or HTP by a swap layer)
  if (mixState.length < size) mixState = new Uint8Array(size)
  const state = mixState
  state.fill(0, 0, size)

  mOut = out
  mState = state
  mHtp = info.htp
  mRole = info.role
  for (const layer of sorted) {
    mScale = Math.min(255, layer.master) / 255
    mHtpMark = ((layer.flags ?? 0) & LAYER_SWAP) !== 0 ? 2 : 1
    for (const [u, uniMap] of layer.channels) {
      if (u < 0 || u >= info.universeCount) continue
      mBase = u * U
      uniMap.forEach(mergeChannel)
    }
  }
  mOut = mState = mHtp = mRole = EMPTY

  const preview = opts?.preview
  if (preview) {
    preview.set(out.subarray(0, Math.min(out.length, preview.length)))
    if (programmer) overlayRaw(programmer, info, preview)
    if (supers.length > 0) overlaySupers(supers, info, preview, state, 3)
    if (highlight) overlayRaw(highlight, info, preview)
  }

  const blind = !!opts?.excludeProgrammer
  if (programmer && !blind) overlayRaw(programmer, info, out)
  if (supers.length > 0) overlaySupers(supers, info, out, state, 4)
  if (highlight && !blind) overlayRaw(highlight, info, out)
  sorted.length = 0
  supers.length = 0
}

/** Pro output-stage inputs (flat, index = universe * 512 + channel) */
export interface OutputExtras {
  /** Group master scale 0..1 per channel (only intensity channels use it; before GM) */
  groupScale?: Float32Array | null
  /** Parked value per channel, -1 = not parked (applied last, after every master) */
  parked?: Int16Array | null
}

/**
 * Output stage: apply the master section to the mix. Only intensity channels
 * are affected by group masters / GM / blackout / strobe; the blinder forces
 * dimmers full, shutters open and (dimmer-less fixtures) white/RGB full —
 * nothing else. Precedence: blinder < strobe < blackout (blackout always
 * kills light). Parked channels are written last, untouched by any master.
 */
export function applyMasters(mix: Uint8Array, info: ChannelInfo, masters: MasterState, out: Uint8Array, extras?: OutputExtras): void {
  const size = Math.min(mix.length, out.length, info.role.length)
  const gm = finiteByte(masters.grandMaster) / 255
  const kill = masters.blackout || (masters.strobe && !masters.strobeOn)
  const blinder = masters.blinder
  const groupScale = extras?.groupScale ?? null
  const scaleLen = groupScale ? groupScale.length : 0

  for (let idx = 0; idx < size; idx++) {
    const forced = blinder ? info.blinder[idx] : -1

    if (!isIntensityRole(info.role[idx] as ChannelRole)) {
      out[idx] = forced >= 0 ? forced : mix[idx]
      continue
    }
    if (info.isFine[idx]) continue // written together with its coarse channel

    const scale = idx < scaleLen ? gm * groupScale![idx] : gm
    const fine = info.fineOf[idx]
    if (fine !== -1 && fine < size) {
      // 16-bit intensity: scale the combined value, then split it again
      let v16 = forced >= 0 ? 65535 : Math.round((mix[idx] * 256 + mix[fine]) * scale)
      if (kill) v16 = 0
      out[idx] = v16 >> 8
      out[fine] = v16 & 0xff
    } else {
      let v = forced >= 0 ? forced : Math.round(mix[idx] * scale)
      if (kill) v = 0
      out[idx] = v
    }
  }

  const parked = extras?.parked
  if (parked) {
    const n = Math.min(size, parked.length)
    for (let idx = 0; idx < n; idx++) {
      const p = parked[idx]
      if (p >= 0) out[idx] = p > 255 ? 255 : p
    }
  }
}

/** Strobe phase for a rate in Hz (one lit + one dark half-period per cycle). */
export function strobePhaseAt(now: number, rateHz: number): boolean {
  const rate = Math.max(0.1, Math.min(50, rateHz || 1))
  return Math.floor((now * rate * 2) / 1000) % 2 === 0
}

// ============================================================
// Runtime state
// ============================================================

const layers = new Map<string, MixerLayer>()

let timerId: ReturnType<typeof setInterval> | null = null
let running = false

let channelInfo: ChannelInfo = createChannelInfo(1)
let infoPatchRef: unknown = null
let infoFixturesRef: unknown = null
let infoMinUniverses = -1
let infoVersion = 0

let mixBuf = new Uint8Array(U)
let prevMixBuf = new Uint8Array(U)
let outputBuf = new Uint8Array(U)
/** Last value sent to main per channel (-1 = never sent → first frame sends everything) */
let sentBuf = new Int16Array(U).fill(-1)
let mixVersion = 0
let publishedVersion = -1
let lastPublish = -Infinity
let strobeOn = true

// ---- Pro output state (flat arrays applied in the frame loop) ----
let blind = false
let previewBuf = new Uint8Array(U)
let prevPreviewBuf = new Uint8Array(U)
let previewVersion = 0
let publishedPreviewVersion = -1
let publishedBlind = false
let parkedIdx: Int16Array | null = null
let groupScaleArr: Float32Array | null = null
const outputExtras: OutputExtras = { groupScale: null, parked: null }
const blindMixOptions: MixOptions = { excludeProgrammer: true, preview: previewBuf }

const PUBLISH_INTERVAL_MS = 40 // ~25 Hz for UI meters

// ---- Frame sources (engines) ----

type FrameSource = (now: number) => void
const frameSources: { id: string; order: number; fn: FrameSource }[] = []

/**
 * Register an engine update called once per mixer frame (before mixing),
 * with the frame timestamp. Lower `order` runs first. Returns an unregister fn.
 * Re-registering the same id replaces the previous source.
 */
export function registerFrameSource(id: string, fn: FrameSource, order = 50): () => void {
  const existing = frameSources.findIndex(s => s.id === id)
  if (existing !== -1) frameSources.splice(existing, 1)
  const entry = { id, order, fn }
  frameSources.push(entry)
  frameSources.sort((a, b) => a.order - b.order)
  return () => {
    const i = frameSources.indexOf(entry)
    if (i !== -1) frameSources.splice(i, 1)
  }
}

// --------------- Public API: loop ---------------

/** Start the mixer loop. Call once at app init (never in remote mode). */
export function startMixer(): void {
  if (running || isRemoteMode()) return
  running = true
  let interval = 16
  try {
    const { mixerIntervalMs } = getDeviceProfile()
    if (mixerIntervalMs > 0) interval = mixerIntervalMs
  } catch { /* no DOM: keep default */ }
  timerId = setInterval(() => runMixerFrame(clockNow()), interval)
}

/** Stop the mixer loop. */
export function stopMixer(): void {
  running = false
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
}

export function isMixerRunning(): boolean {
  return running
}

// --------------- Public API: layers ---------------

/**
 * Set or update a layer. Creates it if it doesn't exist.
 * `priority` / `master` are only changed when given (a fade update must not
 * reset the playback fader).
 */
export function setLayer(
  id: string,
  channels: LayerChannels,
  priority?: LayerPriority,
  master?: number,
  flags?: number
): void {
  const existing = layers.get(id)
  if (existing) {
    existing.channels = channels
    if (priority !== undefined) existing.priority = clampPriority(priority)
    if (master !== undefined) existing.master = toDmx(master)
    if (flags !== undefined) existing.flags = flags | 0
  } else {
    const layer: MixerLayer = {
      id,
      priority: clampPriority(priority ?? 50),
      master: master === undefined ? 255 : toDmx(master),
      activatedAt: clockNow(),
      channels
    }
    if (flags) layer.flags = flags | 0
    layers.set(id, layer)
  }
}

/** Set the pro flags of a layer (LAYER_SWAP | LAYER_SUPER; 0 = normal). */
export function setLayerFlags(id: string, flags: number): void {
  const layer = layers.get(id)
  if (layer) layer.flags = Number.isFinite(flags) ? flags | 0 : 0
}

function clampPriority(p: number): number {
  return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 50
}

/** Update only the master fader of a layer. */
export function setLayerMaster(id: string, master: number): void {
  const layer = layers.get(id)
  if (layer) layer.master = toDmx(master)
}

/** Update only the priority of a layer. */
export function setLayerPriority(id: string, priority: number): void {
  const layer = layers.get(id)
  if (layer) layer.priority = clampPriority(priority)
}

/** Mark a layer as most recently activated (LTP: latest takes precedence). */
export function touchLayer(id: string, now = clockNow()): void {
  const layer = layers.get(id)
  if (layer) layer.activatedAt = now
}

/** Remove a layer entirely (release). */
export function removeLayer(id: string): void {
  layers.delete(id)
}

/** Remove every layer whose id starts with `prefix`. */
export function removeLayersWithPrefix(prefix: string): void {
  for (const id of Array.from(layers.keys())) {
    if (id.startsWith(prefix)) layers.delete(id)
  }
}

export function hasLayer(id: string): boolean {
  return layers.has(id)
}

export function getLayerIds(): string[] {
  return Array.from(layers.keys())
}

/**
 * Remove every layer (incl. the programmer). Used on show load / new show:
 * the next frame outputs the patch defaults only.
 */
export function resetMixer(): void {
  layers.clear()
  invalidateChannelInfo()
  notifyProgrammer('clear', -1, -1)
}

// --------------- Public API: programmer ---------------

/**
 * Programmer change notification (the pro programmer engine keeps its
 * fades and preset references in step with what the programmer holds):
 * 'set' / 'release' of one channel, or 'clear' of everything.
 */
export type ProgrammerListener = (kind: 'set' | 'release' | 'clear', universe: number, channel: number) => void

let programmerListener: ProgrammerListener | null = null

/** Install (or remove with null) THE programmer listener. */
export function setProgrammerListener(fn: ProgrammerListener | null): void {
  programmerListener = fn
}

function notifyProgrammer(kind: 'set' | 'release' | 'clear', universe: number, channel: number): void {
  if (!programmerListener) return
  try {
    programmerListener(kind, universe, channel)
  } catch (e) {
    console.error('[Mixer] programmer listener failed:', e)
  }
}

function programmerLayer(): MixerLayer {
  let layer = layers.get(PROGRAMMER_LAYER_ID)
  if (!layer) {
    layer = { id: PROGRAMMER_LAYER_ID, priority: 100, master: 255, activatedAt: 0, channels: new Map() }
    layers.set(PROGRAMMER_LAYER_ID, layer)
  }
  return layer
}

// Remote mode: programmer edits are batched and forwarded to the Pi
const pendingRemoteProgrammer = new Map<number, Map<number, number>>()
let remoteProgrammerTimer: ReturnType<typeof setTimeout> | null = null
const REMOTE_PROGRAMMER_FLUSH_MS = 33

function flushRemoteProgrammer(): void {
  remoteProgrammerTimer = null
  if (pendingRemoteProgrammer.size === 0) return
  const payload: Record<number, Record<number, number>> = {}
  for (const [u, chMap] of pendingRemoteProgrammer) {
    payload[u] = Object.fromEntries(chMap)
  }
  pendingRemoteProgrammer.clear()
  sendRemoteCommand('set-programmer-channels', payload)
}

/** Programmer channels touched locally in remote mode (to hold them against stale broadcasts). */
const remoteTouched = new Map<number, number>() // idx → time

/** True when a remote-mode programmer edit to this channel is recent. */
export function isProgrammerChannelHeld(universe: number, channel: number, holdMs = 400): boolean {
  const t = remoteTouched.get(universe * U + channel)
  return t !== undefined && clockNow() - t < holdMs
}

/** Set a programmer (manual) value. The programmer always has the last word. */
export function setProgrammerChannel(universe: number, channel: number, value: number): void {
  if (!Number.isInteger(universe) || universe < 0 || universe >= MAX_UNIVERSES) return
  if (!Number.isInteger(channel) || channel < 0 || channel >= U) return
  const v = toDmx(value)
  const layer = programmerLayer()
  let uniMap = layer.channels.get(universe)
  if (!uniMap) {
    uniMap = new Map()
    layer.channels.set(universe, uniMap)
  }
  uniMap.set(channel, v)
  if (programmerListener) notifyProgrammer('set', universe, channel)

  if (isRemoteMode()) {
    let pending = pendingRemoteProgrammer.get(universe)
    if (!pending) { pending = new Map(); pendingRemoteProgrammer.set(universe, pending) }
    pending.set(channel, v)
    remoteTouched.set(universe * U + channel, clockNow())
    // Optimistic local display (the Pi broadcast catches up)
    publishRemoteOptimistic(universe, channel, v)
    if (!remoteProgrammerTimer) remoteProgrammerTimer = setTimeout(flushRemoteProgrammer, REMOTE_PROGRAMMER_FLUSH_MS)
  }
}

/** Release one programmer channel (it goes back to playbacks / default). */
export function clearProgrammerChannel(universe: number, channel: number): void {
  const uniMap = layers.get(PROGRAMMER_LAYER_ID)?.channels.get(universe)
  if (uniMap) uniMap.delete(channel)
  notifyProgrammer('release', universe, channel)
  if (isRemoteMode()) {
    pendingRemoteProgrammer.get(universe)?.delete(channel)
    sendRemoteCommand('release-programmer-channels', { [universe]: [channel] })
  }
}

/** Release several programmer channels at once ({ universe: [channels] }). */
export function releaseProgrammerChannels(channels: Record<number, number[]>): void {
  for (const [u, list] of Object.entries(channels)) {
    if (!Array.isArray(list)) continue
    const uniMap = layers.get(PROGRAMMER_LAYER_ID)?.channels.get(Number(u))
    for (const ch of list) {
      uniMap?.delete(ch)
      notifyProgrammer('release', Number(u), ch)
    }
  }
  if (isRemoteMode()) {
    // A set still waiting in the batch would be re-sent after the release
    for (const [u, list] of Object.entries(channels)) {
      const pending = pendingRemoteProgrammer.get(Number(u))
      if (!pending || !Array.isArray(list)) continue
      for (const ch of list) pending.delete(ch)
    }
    sendRemoteCommand('release-programmer-channels', channels)
  }
}

/** Clear all programmer values. */
export function clearProgrammer(): void {
  layers.get(PROGRAMMER_LAYER_ID)?.channels.clear()
  notifyProgrammer('clear', -1, -1)
  if (isRemoteMode()) {
    pendingRemoteProgrammer.clear()
    remoteTouched.clear()
    sendRemoteCommand('clear-programmer')
  }
}

setDmxStoreProgrammerReset(clearProgrammer)

/** Value currently held by the programmer for a channel, if any. */
export function getProgrammerValue(universe: number, channel: number): number | undefined {
  return layers.get(PROGRAMMER_LAYER_ID)?.channels.get(universe)?.get(channel)
}

/**
 * Snapshot of all programmer channels (deep copy).
 * Returns Map<universe, Map<channel, value>> (empty if no programmer values).
 */
export function getProgrammerChannels(): LayerChannels {
  const layer = layers.get(PROGRAMMER_LAYER_ID)
  const copy: LayerChannels = new Map()
  if (!layer) return copy
  for (const [u, chMap] of layer.channels) {
    if (chMap.size > 0) copy.set(u, new Map(chMap))
  }
  return copy
}

export function isProgrammerActive(): boolean {
  const layer = layers.get(PROGRAMMER_LAYER_ID)
  if (!layer) return false
  for (const [, chMap] of layer.channels) {
    if (chMap.size > 0) return true
  }
  return false
}

// --------------- Public API: pro output (highlight, blind, park, group masters) ---------------

/** Replace the highlight layer's values (null / empty = highlight off). Never recorded. */
export function setHighlightChannels(channels: LayerChannels | null): void {
  if (!channels || channels.size === 0) {
    layers.delete(HIGHLIGHT_LAYER_ID)
    return
  }
  const existing = layers.get(HIGHLIGHT_LAYER_ID)
  if (existing) existing.channels = channels
  else layers.set(HIGHLIGHT_LAYER_ID, { id: HIGHLIGHT_LAYER_ID, priority: 100, master: 255, activatedAt: 0, channels })
}

/**
 * Blind: the programmer (and the highlight) stop reaching the output; a
 * preview mix WITH them is produced every frame (getPreviewBuffer).
 */
export function setBlind(on: boolean): void {
  blind = !!on
}

export function isBlindActive(): boolean {
  return blind
}

/** Pre-master mix including the programmer: the Blind preview while Blind is on, else the mix. Do not mutate. */
export function getPreviewBuffer(): Uint8Array {
  return blind ? previewBuf : mixBuf
}

/** Bumped when the preview changes (mix version when not blind) */
export function getPreviewVersion(): number {
  return blind ? previewVersion : mixVersion
}

/**
 * Parked channels: value per channel (index = universe * 512 + channel),
 * -1 = not parked; applied last, after every master. null = none.
 */
export function setParked(idx: Int16Array | null): void {
  parkedIdx = idx
  outputExtras.parked = idx
}

/** Group master scale (0..1) per channel, applied to intensity before the GM. null = none. */
export function setGroupMasterScale(scale: Float32Array | null): void {
  groupScaleArr = scale
  outputExtras.groupScale = scale
}

export function getParked(): Int16Array | null {
  return parkedIdx
}

export function getGroupMasterScale(): Float32Array | null {
  return groupScaleArr
}

// --------------- Public API: frame access ---------------

/** Current channel description of the patch (rebuilt when the patch changes). */
export function getChannelInfo(): ChannelInfo {
  ensureChannelInfo()
  return channelInfo
}

/** Bumped every time the channel description is rebuilt. */
export function getChannelInfoVersion(): number {
  ensureChannelInfo()
  return infoVersion
}

/** Force a rebuild of the channel description on the next frame. */
export function invalidateChannelInfo(): void {
  infoPatchRef = null
  infoFixturesRef = null
}

/** Pre-master mix value of a channel (what the playbacks / programmer produce). */
export function getMixValue(universe: number, channel: number): number | undefined {
  const idx = universe * U + channel
  return idx >= 0 && idx < mixBuf.length ? mixBuf[idx] : undefined
}

/** Post-master output (what is actually sent), flat universeCount*512. Do not mutate. */
export function getOutputBuffer(): Uint8Array {
  return outputBuf
}

/** Pre-master mix, flat universeCount*512. Do not mutate. */
export function getMixBuffer(): Uint8Array {
  return mixBuf
}

/** Counter bumped whenever the mix changes (cheap change detection). */
export function getMixVersion(): number {
  return mixVersion
}

/** Current strobe phase (true = lit). */
export function getStrobePhase(): boolean {
  return strobeOn
}

// --------------- Frame ---------------

function ensureChannelInfo(): void {
  const { patch, fixtures } = usePatchStore.getState()
  const minUniverses = useDmxStore.getState().universeCount
  if (patch === infoPatchRef && fixtures === infoFixturesRef && minUniverses === infoMinUniverses) return
  infoPatchRef = patch
  infoFixturesRef = fixtures
  infoMinUniverses = minUniverses
  channelInfo = buildChannelInfo(patch, fixtures, minUniverses)
  infoVersion++

  const size = channelInfo.universeCount * U
  if (mixBuf.length !== size) {
    const grow = (old: Uint8Array) => { const b = new Uint8Array(size); b.set(old.subarray(0, size)); return b }
    mixBuf = grow(mixBuf)
    prevMixBuf = grow(prevMixBuf)
    outputBuf = grow(outputBuf)
    previewBuf = grow(previewBuf)
    blindMixOptions.preview = previewBuf
    const sent = new Int16Array(size).fill(-1)
    sent.set(sentBuf.subarray(0, size))
    sentBuf = sent
    mixVersion++
  }
  if (channelInfo.universeCount > minUniverses) {
    useDmxStore.setState({ universeCount: channelInfo.universeCount })
    infoMinUniverses = channelInfo.universeCount
  }
}

/**
 * Compute and send one frame. Exported for tests / manual stepping;
 * normally called by the loop.
 */
export function runMixerFrame(now: number): void {
  for (const source of frameSources.slice()) {
    try {
      source.fn(now)
    } catch (e) {
      console.error(`[Mixer] frame source "${source.id}" failed:`, e)
    }
  }

  ensureChannelInfo()
  const info = channelInfo

  if (blind) {
    mixLayers(layers.values(), info, mixBuf, blindMixOptions)
    if (prevPreviewBuf.length !== previewBuf.length) prevPreviewBuf = new Uint8Array(previewBuf.length).fill(0)
    for (let i = 0; i < previewBuf.length; i++) {
      if (previewBuf[i] !== prevPreviewBuf[i]) {
        prevPreviewBuf.set(previewBuf)
        previewVersion++
        break
      }
    }
  } else {
    mixLayers(layers.values(), info, mixBuf)
  }

  let mixChanged = false
  for (let i = 0; i < mixBuf.length; i++) {
    if (mixBuf[i] !== prevMixBuf[i]) { mixChanged = true; break }
  }
  if (mixChanged) {
    prevMixBuf.set(mixBuf)
    mixVersion++
  }

  const dmx = useDmxStore.getState()
  const prevStrobe = strobeOn
  strobeOn = dmx.strobe ? strobePhaseAt(now, dmx.strobeRate) : true
  applyMasters(mixBuf, info, {
    grandMaster: dmx.grandMaster,
    blackout: dmx.blackout,
    blinder: dmx.blinder,
    strobe: dmx.strobe,
    strobeOn
  }, outputBuf, parkedIdx || groupScaleArr ? outputExtras : undefined)

  sendChangedChannels(info.universeCount)

  // Throttled publish of the pre-master mix for the UI (faders, meters, 3D).
  // Blind: the UI shows the preview (the programmer being edited blind).
  const strobeChanged = prevStrobe !== strobeOn
  const changed = blind
    ? previewVersion !== publishedPreviewVersion || !publishedBlind
    : mixVersion !== publishedVersion || publishedBlind
  if ((changed || strobeChanged) && now - lastPublish >= PUBLISH_INTERVAL_MS) {
    publishMix(info.universeCount)
    lastPublish = now
  }
}

function sendChangedChannels(universeCount: number): void {
  const bridge = getBridge()
  if (!bridge) return
  for (let u = 0; u < universeCount; u++) {
    let changed: Record<number, number> | null = null
    const base = u * U
    for (let ch = 0; ch < U; ch++) {
      const v = outputBuf[base + ch]
      if (sentBuf[base + ch] !== v) {
        if (!changed) changed = {}
        changed[ch] = v
        sentBuf[base + ch] = v
      }
    }
    if (changed) {
      try {
        bridge.dmx.setChannels(u, changed)
      } catch (e) {
        console.error('[Mixer] DMX send failed:', e)
        // retry these channels next frame
        for (const ch of Object.keys(changed)) sentBuf[base + Number(ch)] = -1
      }
    }
  }
}

function publishMix(universeCount: number): void {
  const values: number[][] = []
  const source = blind ? previewBuf : mixBuf
  for (let u = 0; u < universeCount; u++) {
    values.push(Array.from(source.subarray(u * U, (u + 1) * U)))
  }
  publishedVersion = mixVersion
  publishedPreviewVersion = previewVersion
  publishedBlind = blind
  useDmxStore.setState({ values, _strobePhase: strobeOn })
}

/** Force every channel to be re-sent on the next frame (e.g. after an output reconfiguration). */
export function resendAllChannels(): void {
  sentBuf.fill(-1)
}

// --------------- Remote optimistic display ---------------

let optimisticTimer: ReturnType<typeof setTimeout> | null = null
const optimistic = new Map<number, number>()

function publishRemoteOptimistic(universe: number, channel: number, value: number): void {
  optimistic.set(universe * U + channel, value)
  if (optimisticTimer) return
  optimisticTimer = setTimeout(() => {
    optimisticTimer = null
    const state = useDmxStore.getState()
    const values = state.values.map(row => row.slice())
    for (const [idx, v] of optimistic) {
      const u = Math.floor(idx / U)
      while (values.length <= u) values.push(new Array(U).fill(0))
      values[u][idx % U] = v
    }
    optimistic.clear()
    useDmxStore.setState({ values })
  }, 16)
}
