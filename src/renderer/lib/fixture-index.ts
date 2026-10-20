// ============================================================
// PhotonBoard — Fixture index
// Resolves the "fixtureId:channelName" keys used by cues, chase
// steps and timeline clips to absolute DMX addresses, and tells the
// engines how a channel behaves (intensity? 16-bit fine half of …?).
// Memoised on the patch / fixture-library identity.
// ============================================================

import type { FixtureDefinition, PatchEntry } from '@shared/types'
import { DMX_CHANNELS_PER_UNIVERSE } from '@shared/types'
import { classifyModeChannels, isIntensityRole } from './channel-classify'
import type { LayerChannels } from './dmx-mixer'

export interface ChannelAddress {
  universe: number
  /** 0-based channel within the universe */
  channel: number
}

/** How the playback engines must treat a cue key. */
export interface KeyMeta {
  /** Intensity channel: fades up with fade-in, down with fade-out, released to 0 */
  intensity: boolean
  /** For a 16-bit fine channel: the key of its coarse channel */
  coarseKey?: string
  /** For a coarse channel: the key of its 16-bit fine partner */
  fineKey?: string
}

export type KeyMetaFn = (key: string) => KeyMeta

export function cueKey(fixtureId: string, channelName: string): string {
  return `${fixtureId}:${channelName}`
}

export function splitCueKey(key: string): [string, string] {
  const i = key.indexOf(':')
  return i === -1 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]
}

interface IndexedChannel {
  name: string
  address: ChannelAddress
  intensity: boolean
  coarseName?: string
  fineName?: string
}

export class FixtureIndex {
  /** fixtureId → lower-case channel name → channel */
  private readonly byFixture = new Map<string, Map<string, IndexedChannel>>()

  constructor(patch: PatchEntry[], fixtures: FixtureDefinition[]) {
    const defs = new Map(fixtures.map(f => [f.id, f]))
    for (const entry of patch) {
      const def = defs.get(entry.fixtureDefId)
      const mode = def?.modes.find(m => m.name === entry.modeName)
      if (!def || !mode) continue
      const classified = classifyModeChannels(def, mode)
      const channels = new Map<string, IndexedChannel>()
      classified.forEach((c, i) => {
        if (!c.name) return
        const channel = entry.address - 1 + i
        if (channel < 0 || channel >= DMX_CHANNELS_PER_UNIVERSE) return
        const lower = c.name.toLowerCase()
        if (channels.has(lower)) return
        channels.set(lower, {
          name: c.name,
          address: { universe: entry.universe, channel },
          intensity: isIntensityRole(c.role),
          coarseName: c.coarseIndex !== -1 ? mode.channels[c.coarseIndex] : undefined,
          fineName: c.fineIndex !== -1 ? mode.channels[c.fineIndex] : undefined
        })
      })
      this.byFixture.set(entry.id, channels)
    }
  }

  private find(key: string): IndexedChannel | undefined {
    const [fixtureId, channelName] = splitCueKey(key)
    return this.byFixture.get(fixtureId)?.get(channelName.toLowerCase())
  }

  resolve(key: string): ChannelAddress | undefined {
    return this.find(key)?.address
  }

  meta(key: string): KeyMeta {
    const ch = this.find(key)
    if (!ch) return { intensity: false }
    const [fixtureId] = splitCueKey(key)
    return {
      intensity: ch.intensity,
      coarseKey: ch.coarseName ? cueKey(fixtureId, ch.coarseName) : undefined,
      fineKey: ch.fineName ? cueKey(fixtureId, ch.fineName) : undefined
    }
  }

  /** Convert key → value maps to a mixer layer. Unknown keys are skipped. */
  toLayer(values: Map<string, number>): LayerChannels {
    const layer: LayerChannels = new Map()
    for (const [key, value] of values) {
      const addr = this.resolve(key)
      if (!addr) continue
      let uniMap = layer.get(addr.universe)
      if (!uniMap) {
        uniMap = new Map()
        layer.set(addr.universe, uniMap)
      }
      uniMap.set(addr.channel, value)
    }
    return layer
  }
}

let cached: FixtureIndex | null = null
let cachedPatch: PatchEntry[] | null = null
let cachedFixtures: FixtureDefinition[] | null = null

/** Index of the given patch (memoised on array identity). */
export function getFixtureIndex(patch: PatchEntry[], fixtures: FixtureDefinition[]): FixtureIndex {
  if (!cached || patch !== cachedPatch || fixtures !== cachedFixtures) {
    cached = new FixtureIndex(patch, fixtures)
    cachedPatch = patch
    cachedFixtures = fixtures
  }
  return cached
}
