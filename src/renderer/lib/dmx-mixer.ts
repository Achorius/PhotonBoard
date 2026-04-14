// ============================================================
// PhotonBoard — DMX Mixer
// Central mixing engine: collects all sources (programmer, cuelists,
// chases, effects) and merges them using HTP/LTP rules.
//
// Design principle: NO source writes directly to dmx-store anymore.
// Instead each source registers its output layer here and the mixer
// produces the final merged DMX frame at ~60 Hz (rAF).
// ============================================================

import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import { getDeviceProfile } from './device-detect'

// --------------- Types ---------------

export type LayerPriority = number // 0-100, higher wins for LTP

/** A single source layer contributing DMX values. */
export interface MixerLayer {
  id: string
  /** 0-100. Higher priority wins for LTP channels. */
  priority: LayerPriority
  /** Master fader 0-255 for this layer. Scales all output. */
  master: number
  /** Activation timestamp (ms). Used to break LTP ties at same priority. */
  activatedAt: number
  /**
   * Per-universe, per-channel values.
   * Sparse: only channels this layer contributes are present.
   * Key: universe number. Value: Map<channelIndex, rawValue 0-255>
   */
  channels: Map<number, Map<number, number>>
}

// Channel type classification for HTP/LTP decision
type ChannelPrecedence = 'HTP' | 'LTP'

// --------------- State ---------------

/** All registered layers keyed by layer id */
const layers = new Map<string, MixerLayer>()

/** Reserved layer id for the programmer (manual faders). Always highest precedence. */
export const PROGRAMMER_LAYER_ID = '__programmer__'
const PROGRAMMER_PRIORITY = 100

let rafId: number | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let running = false

// Track channels written in the previous frame — used to zero out
// channels that were active but are no longer in any layer (e.g. effect stopped)
let prevWrittenChannels = new Map<number, Set<number>>() // universe → set of channel indices

// Cache for channel precedence lookups (rebuilt when patch changes)
let precedenceCache = new Map<string, ChannelPrecedence>() // "universe:channel" → HTP|LTP
// Default/neutral values per channel (0 for most, 128 for pan/tilt)
let defaultValueCache = new Map<string, number>() // "universe:channel" → default value
let lastPatchVersion = -1

// --------------- Public API ---------------

/**
 * Start the mixer loop. Call once at app init.
 */
export function startMixer(): void {
  if (running) return
  running = true
  ensurePrecedenceCache()
  const { mixerIntervalMs } = getDeviceProfile()
  if (mixerIntervalMs > 0) {
    // Low-end devices: use setInterval at reduced frequency (e.g. 30Hz)
    intervalId = setInterval(mixerTick, mixerIntervalMs)
  } else {
    // Desktop: full-speed rAF (~60Hz)
    rafId = requestAnimationFrame(mixerTick)
  }
}

/**
 * Stop the mixer loop.
 */
export function stopMixer(): void {
  running = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/**
 * Set or update a layer. Creates it if it doesn't exist.
 */
export function setLayer(
  id: string,
  channels: Map<number, Map<number, number>>,
  priority: LayerPriority = 50,
  master: number = 255
): void {
  const existing = layers.get(id)
  if (existing) {
    existing.channels = channels
    existing.priority = priority
    existing.master = master
  } else {
    layers.set(id, {
      id,
      priority,
      master,
      activatedAt: performance.now(),
      channels
    })
  }
}

/**
 * Update only the master fader of a layer.
 */
export function setLayerMaster(id: string, master: number): void {
  const layer = layers.get(id)
  if (layer) layer.master = Math.max(0, Math.min(255, master))
}

/**
 * Update only the priority of a layer.
 */
export function setLayerPriority(id: string, priority: number): void {
  const layer = layers.get(id)
  if (layer) layer.priority = Math.max(0, Math.min(100, priority))
}

/**
 * Remove a layer entirely (release).
 */
export function removeLayer(id: string): void {
  layers.delete(id)
}

/**
 * Check if a layer exists.
 */
export function hasLayer(id: string): boolean {
  return layers.has(id)
}

/**
 * Get all active layer IDs.
 */
export function getLayerIds(): string[] {
  return Array.from(layers.keys())
}

/**
 * Convenience: set programmer (manual fader) values.
 * Programmer always has max priority.
 */
export function setProgrammerChannel(universe: number, channel: number, value: number): void {
  let layer = layers.get(PROGRAMMER_LAYER_ID)
  if (!layer) {
    layer = {
      id: PROGRAMMER_LAYER_ID,
      priority: PROGRAMMER_PRIORITY,
      master: 255,
      activatedAt: 0, // always oldest so it wins by priority, not timestamp
      channels: new Map()
    }
    layers.set(PROGRAMMER_LAYER_ID, layer)
  }
  let uniMap = layer.channels.get(universe)
  if (!uniMap) {
    uniMap = new Map()
    layer.channels.set(universe, uniMap)
  }
  uniMap.set(channel, value)
}

/**
 * Clear a specific programmer channel (when user releases control).
 */
export function clearProgrammerChannel(universe: number, channel: number): void {
  const layer = layers.get(PROGRAMMER_LAYER_ID)
  if (!layer) return
  const uniMap = layer.channels.get(universe)
  if (uniMap) uniMap.delete(channel)
}

/**
 * Clear all programmer values.
 */
export function clearProgrammer(): void {
  const layer = layers.get(PROGRAMMER_LAYER_ID)
  if (layer) layer.channels.clear()
}

/**
 * Get a snapshot of all programmer channels.
 * Returns Map<universe, Map<channel, value>> (empty if no programmer values).
 */
export function getProgrammerChannels(): Map<number, Map<number, number>> {
  const layer = layers.get(PROGRAMMER_LAYER_ID)
  if (!layer) return new Map()
  // Return a deep copy so callers can't mutate internal state
  const copy = new Map<number, Map<number, number>>()
  for (const [u, chMap] of layer.channels) {
    copy.set(u, new Map(chMap))
  }
  return copy
}

/**
 * Check if the programmer has any active values.
 */
export function isProgrammerActive(): boolean {
  const layer = layers.get(PROGRAMMER_LAYER_ID)
  if (!layer) return false
  for (const [, chMap] of layer.channels) {
    if (chMap.size > 0) return true
  }
  return false
}

// --------------- Precedence Cache ---------------

function ensurePrecedenceCache(): void {
  const patchStore = usePatchStore.getState()
  // Simple version check — recompute whenever patch length changes
  const version = patchStore.patch.length
  if (version === lastPatchVersion) return
  lastPatchVersion = version

  precedenceCache = new Map()
  defaultValueCache = new Map()
  const { patch, fixtures } = patchStore

  for (const entry of patch) {
    const def = fixtures.find(f => f.id === entry.fixtureDefId)
    if (!def) continue
    const mode = def.modes.find(m => m.name === entry.modeName)
    if (!mode) continue

    mode.channels.forEach((chName, index) => {
      const absChannel = entry.address - 1 + index
      const key = `${entry.universe}:${absChannel}`

      // Look up channel definition
      const chDef = def.channels[chName]
      if (chDef?.precedence) {
        precedenceCache.set(key, chDef.precedence)
      } else {
        // Infer from channel type
        const prec = inferPrecedence(chDef?.type, chName)
        precedenceCache.set(key, prec)
      }

      // Default/neutral value: 128 for pan/tilt (center), 0 for everything else
      const defaultVal = inferDefaultValue(chDef?.type, chName, chDef?.defaultValue)
      if (defaultVal !== 0) {
        defaultValueCache.set(key, defaultVal)
      }
    })
  }
}

function inferPrecedence(type: string | undefined, name: string): ChannelPrecedence {
  const t = type || name.toLowerCase()
  // Intensity/dimmer channels are HTP
  if (t === 'intensity' || t.includes('dimmer') || t.includes('master')) return 'HTP'
  // Everything else is LTP (position, color, gobo, effects, etc.)
  return 'LTP'
}

function inferDefaultValue(type: string | undefined, name: string, explicitDefault?: number): number {
  if (explicitDefault !== undefined) return explicitDefault
  const t = (type || name).toLowerCase()
  // Pan/tilt center at 128
  if (t.includes('pan') || t.includes('tilt')) return 128
  return 0
}

function getChannelDefault(universe: number, channel: number): number {
  return defaultValueCache.get(`${universe}:${channel}`) ?? 0
}

function getChannelPrecedence(universe: number, channel: number): ChannelPrecedence {
  return precedenceCache.get(`${universe}:${channel}`) ?? 'LTP'
}

// --------------- Mixer Core ---------------

function mixerTick(): void {
  if (!running) return

  ensurePrecedenceCache()

  const dmxStore = useDmxStore.getState()
  const universeCount = dmxStore.universeCount

  // Collect all active layers sorted by priority then activation time
  const sortedLayers = Array.from(layers.values())
    .filter(l => l.channels.size > 0)
    .sort((a, b) => {
      // Higher priority first; if equal, more recent first (for LTP)
      if (a.priority !== b.priority) return b.priority - a.priority
      return b.activatedAt - a.activatedAt
    })

  const currentWritten = new Map<number, Set<number>>()

  // For each universe, merge all layers
  for (let u = 0; u < universeCount; u++) {
    const merged: Record<number, number> = {}
    // Track which LTP channels have already been claimed by a higher-priority layer
    const ltpClaimed = new Set<number>()
    const writtenSet = new Set<number>()
    let hasChanges = false

    for (const layer of sortedLayers) {
      const uniMap = layer.channels.get(u)
      if (!uniMap) continue

      const masterScale = layer.master / 255
      const isProgrammer = layer.id === PROGRAMMER_LAYER_ID

      for (const [ch, rawValue] of uniMap) {
        const scaledValue = Math.round(rawValue * masterScale)
        const prec = getChannelPrecedence(u, ch)

        if (isProgrammer) {
          // Programmer ALWAYS wins (LTP override) — like a real console
          merged[ch] = scaledValue
          ltpClaimed.add(ch)
          hasChanges = true
        } else if (prec === 'HTP') {
          // Highest Takes Precedence — take max across non-programmer layers
          if (!ltpClaimed.has(ch)) {
            const current = merged[ch]
            if (current === undefined || scaledValue > current) {
              merged[ch] = scaledValue
              hasChanges = true
            }
          }
        } else {
          // LTP — first layer to claim it wins (layers are sorted by priority desc)
          if (!ltpClaimed.has(ch)) {
            merged[ch] = scaledValue
            ltpClaimed.add(ch)
            hasChanges = true
          }
        }
        writtenSet.add(ch)
      }
    }

    // Reset released channels to their default value (0 for most, 128 for pan/tilt)
    // when no layer provides them anymore (e.g. an effect or cuelist was stopped).
    const prevSet = prevWrittenChannels.get(u)
    if (prevSet) {
      for (const ch of prevSet) {
        if (!writtenSet.has(ch)) {
          merged[ch] = getChannelDefault(u, ch)
          hasChanges = true
        }
      }
    }

    currentWritten.set(u, writtenSet)

    if (hasChanges) {
      dmxStore.setChannels(u, merged)
    }
  }

  prevWrittenChannels = currentWritten
  // setInterval mode (low-end) handles its own scheduling
  if (intervalId === null) {
    rafId = requestAnimationFrame(mixerTick)
  }
}
