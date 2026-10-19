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
}

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

/**
 * Merge layers into `out` (pre-master mix, length universeCount*512).
 *
 *  - Every channel starts at its neutral default.
 *  - HTP channels: highest (master-scaled) value across layers.
 *  - LTP channels: highest priority layer wins, latest activation breaks ties.
 *  - A layer's master scales intensity channels only (dimmers, and the
 *    colour emitters of dimmer-less fixtures) — never position/colour/gobo.
 *  - A layer whose master is 0 is inactive (claims no LTP channel).
 *  - The programmer always wins.
 */
export function mixLayers(layers: Iterable<MixerLayer>, info: ChannelInfo, out: Uint8Array): void {
  out.set(info.defaults.subarray(0, out.length))
  const size = Math.min(out.length, info.universeCount * U)

  let programmer: MixerLayer | undefined
  const sorted: MixerLayer[] = []
  for (const layer of layers) {
    if (layer.id === PROGRAMMER_LAYER_ID) { programmer = layer; continue }
    if (layer.channels.size === 0 || !(layer.master > 0)) continue
    sorted.push(layer)
  }
  sorted.sort((a, b) => (b.priority - a.priority) || (b.activatedAt - a.activatedAt))

  // 0 = untouched, 1 = HTP written, 2 = LTP claimed
  const state = new Uint8Array(size)

  for (const layer of sorted) {
    const scale = Math.min(255, layer.master) / 255
    for (const [u, uniMap] of layer.channels) {
      if (u < 0 || u >= info.universeCount) continue
      for (const [ch, raw] of uniMap) {
        if (ch < 0 || ch >= U) continue
        const idx = u * U + ch
        const role = info.role[idx] as ChannelRole
        const value = finiteByte(isIntensityRole(role) ? raw * scale : raw)
        if (info.htp[idx]) {
          if (state[idx] === 0 || value > out[idx]) out[idx] = value
          state[idx] = 1
        } else if (state[idx] !== 2) {
          out[idx] = value
          state[idx] = 2
        }
      }
    }
  }

  if (programmer) {
    for (const [u, uniMap] of programmer.channels) {
      if (u < 0 || u >= info.universeCount) continue
      for (const [ch, raw] of uniMap) {
        if (ch < 0 || ch >= U) continue
        out[u * U + ch] = finiteByte(raw)
      }
    }
  }
}

/**
 * Output stage: apply the master section to the mix. Only intensity channels
 * are affected by GM / blackout / strobe; the blinder forces dimmers full,
 * shutters open and (dimmer-less fixtures) white/RGB full — nothing else.
 * Precedence: blinder < strobe < blackout (blackout always kills light).
 */
export function applyMasters(mix: Uint8Array, info: ChannelInfo, masters: MasterState, out: Uint8Array): void {
  const size = Math.min(mix.length, out.length, info.role.length)
  const gm = finiteByte(masters.grandMaster) / 255
  const kill = masters.blackout || (masters.strobe && !masters.strobeOn)
  const blinder = masters.blinder

  for (let idx = 0; idx < size; idx++) {
    const forced = blinder ? info.blinder[idx] : -1

    if (!isIntensityRole(info.role[idx] as ChannelRole)) {
      out[idx] = forced >= 0 ? forced : mix[idx]
      continue
    }
    if (info.isFine[idx]) continue // written together with its coarse channel

    const fine = info.fineOf[idx]
    if (fine !== -1 && fine < size) {
      // 16-bit intensity: scale the combined value, then split it again
      let v16 = forced >= 0 ? 65535 : Math.round((mix[idx] * 256 + mix[fine]) * gm)
      if (kill) v16 = 0
      out[idx] = v16 >> 8
      out[fine] = v16 & 0xff
    } else {
      let v = forced >= 0 ? forced : Math.round(mix[idx] * gm)
      if (kill) v = 0
      out[idx] = v
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
  master?: number
): void {
  const existing = layers.get(id)
  if (existing) {
    existing.channels = channels
    if (priority !== undefined) existing.priority = clampPriority(priority)
    if (master !== undefined) existing.master = toDmx(master)
  } else {
    layers.set(id, {
      id,
      priority: clampPriority(priority ?? 50),
      master: master === undefined ? 255 : toDmx(master),
      activatedAt: clockNow(),
      channels
    })
  }
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
}

// --------------- Public API: programmer ---------------

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
  if (isRemoteMode()) {
    pendingRemoteProgrammer.get(universe)?.delete(channel)
    sendRemoteCommand('release-programmer-channels', { [universe]: [channel] })
  }
}

/** Release several programmer channels at once ({ universe: [channels] }). */
export function releaseProgrammerChannels(channels: Record<number, number[]>): void {
  for (const [u, list] of Object.entries(channels)) {
    const uniMap = layers.get(PROGRAMMER_LAYER_ID)?.channels.get(Number(u))
    if (!uniMap || !Array.isArray(list)) continue
    for (const ch of list) uniMap.delete(ch)
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

  mixLayers(layers.values(), info, mixBuf)

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
  }, outputBuf)

  sendChangedChannels(info.universeCount)

  // Throttled publish of the pre-master mix for the UI (faders, meters, 3D)
  const strobeChanged = prevStrobe !== strobeOn
  if ((mixVersion !== publishedVersion || strobeChanged) && now - lastPublish >= PUBLISH_INTERVAL_MS) {
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
  for (let u = 0; u < universeCount; u++) {
    values.push(Array.from(mixBuf.subarray(u * U, (u + 1) * U)))
  }
  publishedVersion = mixVersion
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
