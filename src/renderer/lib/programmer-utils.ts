// ============================================================
// PhotonBoard — Programmer Utilities
// Record cues from programmer state, reverse-resolve DMX addresses
// back to fixture-level channel values.
// ============================================================

import { getProgrammerChannels } from './dmx-mixer'
import { usePatchStore } from '@renderer/stores/patch-store'
import type { CueChannelValue } from '@shared/types'

/**
 * Capture the current programmer state as an array of CueChannelValues.
 * Reverse-resolves absolute DMX addresses (universe + channel) back to
 * fixture IDs and channel names using the current patch.
 *
 * Returns empty array if programmer has no active values.
 */
export function recordFromProgrammer(): CueChannelValue[] {
  const programmerChannels = getProgrammerChannels()
  if (programmerChannels.size === 0) return []

  const { patch, fixtures } = usePatchStore.getState()
  const values: CueChannelValue[] = []

  // Build a reverse lookup: for each patched fixture, map its absolute channels
  // back to fixture ID + channel name
  for (const entry of patch) {
    const def = fixtures.find(f => f.id === entry.fixtureDefId)
    if (!def) continue
    const mode = def.modes.find(m => m.name === entry.modeName)
    if (!mode) continue

    const uniMap = programmerChannels.get(entry.universe)
    if (!uniMap) continue

    mode.channels.forEach((chName, index) => {
      const absChannel = entry.address - 1 + index
      const value = uniMap.get(absChannel)
      if (value !== undefined) {
        values.push({
          fixtureId: entry.id,
          channelName: chName,
          value
        })
      }
    })
  }

  return values
}

/**
 * Get a human-readable summary of programmer contents.
 * E.g., "3 fixtures, 12 channels"
 */
export function getProgrammerSummary(): string {
  const values = recordFromProgrammer()
  if (values.length === 0) return 'Empty'
  const fixtureCount = new Set(values.map(v => v.fixtureId)).size
  return `${fixtureCount} fixture${fixtureCount > 1 ? 's' : ''}, ${values.length} ch`
}
