// ============================================================
// PhotonBoard — Programmer engine (pro)
//
// WP0 contract with a BASIC implementation (WP2 replaces the bodies):
//   - values are written to the programmer at once (no fade / delay
//     yet: `time` and the programmer time are recorded but ignored),
//   - meta (preset ref, fade, delay) is kept per fixture channel and
//     forgotten when the programmer no longer holds the channel,
//   - highlight and park only update their stores (the mixer applies
//     them in WP2).
// ============================================================

import type { CueChannelValue } from '@shared/types'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { programChannel } from '@renderer/lib/programmer-utils'
import { resolvePresetForFixture } from './preset-resolve'
import type { ProgTime } from './contracts'

export interface ProgrammerMeta {
  presetId?: string
  fade?: number
  delay?: number
}

export interface AttributeValue {
  fixtureId: string
  channelName: string
  value: number
  meta?: ProgrammerMeta
}

/** fixtureId:channelName → meta */
const meta = new Map<string, ProgrammerMeta>()
/** fixtureId:channelName → [universe, channel] of the last write (to drop stale meta) */
const addresses = new Map<string, [number, number]>()

const metaKey = (fixtureId: string, channelName: string) => `${fixtureId}:${channelName}`

/** Absolute address (universe, 0-based channel) of a fixture channel, or null */
function addressOf(fixtureId: string, channelName: string): [number, number] | null {
  const { patch, getFixtureChannels } = usePatchStore.getState()
  const entry = patch.find(p => p.id === fixtureId)
  if (!entry) return null
  const ch = getFixtureChannels(entry).find(c => c.name === channelName)
  if (!ch || ch.absoluteChannel < 0 || ch.absoluteChannel >= 512) return null
  return [entry.universe, ch.absoluteChannel]
}

/** Put values in the programmer (fixture channel → DMX address), with their meta. */
export function setAttributeValues(values: AttributeValue[], time?: ProgTime): void {
  const progTime = time ?? useProStore.getState().progTime ?? undefined
  for (const v of values) {
    const addr = addressOf(v.fixtureId, v.channelName)
    if (!addr) continue
    programChannel(addr[0], addr[1], v.value)
    const key = metaKey(v.fixtureId, v.channelName)
    addresses.set(key, addr)
    const m: ProgrammerMeta = { ...v.meta }
    if (progTime && m.fade === undefined && progTime.fade > 0) m.fade = progTime.fade
    if (progTime && m.delay === undefined && progTime.delay > 0) m.delay = progTime.delay
    if (m.presetId !== undefined || m.fade !== undefined || m.delay !== undefined) meta.set(key, m)
    else meta.delete(key)
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

/** Meta of the channels the programmer still holds (fixtureId:channelName → meta). */
export function getProgrammerMeta(): ReadonlyMap<string, ProgrammerMeta> {
  for (const [key] of meta) {
    const addr = addresses.get(key)
    if (!addr || getProgrammerValue(addr[0], addr[1]) === undefined) {
      meta.delete(key)
      addresses.delete(key)
    }
  }
  return meta
}

/** Forget all meta (clear programmer). */
export function clearProgrammerMeta(): void {
  meta.clear()
  addresses.clear()
}

/** Programmer fade / delay applied to new values (null = none) */
export function setProgrammerTime(t: ProgTime | null): void {
  useProStore.getState().setProgTime(t)
}

/** Highlight these fixtures (null = off). Basic: store flag only. */
export function setHighlight(fixtureIds: string[] | null): void {
  useProStore.getState().setHighlight(!!fixtureIds && fixtureIds.length > 0)
}

/** Park channels at these values (saved with the show; applied by the mixer in WP2) */
export function park(values: CueChannelValue[]): void {
  usePoolStore.getState().park(values)
}

/** Unpark every channel of these fixtures */
export function unpark(fixtureIds: string[]): void {
  usePoolStore.getState().unpark(fixtureIds)
}
