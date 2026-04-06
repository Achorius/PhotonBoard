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
let running = false

// Cache for channel precedence lookups (rebuilt when patch changes)
let precedenceCache = new Map<string, ChannelPrecedence>() // "universe:channel" → HTP|LTP
let lastPatchVersion = -1

// --------------- Public API ---------------

/**
 * Start the mixer loop. Call once at app init.
 */
export function startMixer(): void {
  if (running) return
  running = true
  ensurePrecedenceCache()
  rafId = requestAnimationFrame(mixerTick)
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

// --------------- Precedence Cache ---------------

function ensurePrecedenceCache(): void {
  const patchStore = usePatchStore.getState()
  // Simple version check — recompute whenever patch length changes
  const version = patchStore.patch.length
  if (version === lastPatchVersion) return
  lastPatchVersion = version

  precedenceCache = new Map()
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

  if (sortedLayers.length === 0) {
    rafId = requestAnimationFrame(mixerTick)
    return
  }

  // For each universe, merge all layers
  for (let u = 0; u < universeCount; u++) {
    const merged: Record<number, number> = {}
    // Track which LTP channels have already been claimed by a higher-priority layer
    const ltpClaimed = new Set<number>()
    let hasChanges = false

    for (const layer of sortedLayers) {
      const uniMap = layer.channels.get(u)
      if (!uniMap) continue

      const masterScale = layer.master / 255

      for (const [ch, rawValue] of uniMap) {
        const scaledValue = Math.round(rawValue * masterScale)
        const prec = getChannelPrecedence(u, ch)

        if (prec === 'HTP') {
          // Highest Takes Precedence — take max across all layers
          const current = merged[ch]
          if (current === undefined || scaledValue > current) {
            merged[ch] = scaledValue
            hasChanges = true
          }
        } else {
          // LTP — first layer to claim it wins (layers are sorted by priority desc)
          if (!ltpClaimed.has(ch)) {
            merged[ch] = scaledValue
            ltpClaimed.add(ch)
            hasChanges = true
          }
        }
      }
    }

    if (hasChanges) {
      // Write merged values to the DMX store
      // We bypass the store's setChannel to do a batch update
      dmxStore.setChannels(u, merged)
    }
  }

  rafId = requestAnimationFrame(mixerTick)
}
