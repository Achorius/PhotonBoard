// ============================================================
// PhotonBoard — Programmer Utilities
// Record cues from programmer state, reverse-resolve DMX addresses
// back to fixture-level channel values.
// ============================================================

import { useEffect } from 'react'
import { create } from 'zustand'
import { t } from '@renderer/i18n'
import {
  clearProgrammer, getProgrammerChannels, getProgrammerValue, releaseProgrammerChannels, setProgrammerChannel,
  type LayerChannels
} from './dmx-mixer'
import { ChannelRole, classifyModeChannels } from './channel-classify'
import { usePatchStore } from '@renderer/stores/patch-store'
import type { CueChannelValue, FixtureDefinition, PatchEntry } from '@shared/types'

// ============================================================
// Programmer overlay (pro programmer engine): fades in progress and
// preset / timing references live in lib/pro/programmer-engine.ts,
// which registers itself here — recording sees TARGET values (not a
// mid-fade value, and values still waiting for their delay) and,
// with `withMeta`, the preset refs and timing.
// ============================================================

export interface ProgrammerOverlay {
  /** Target of every channel being faded / delayed: universe → channel → value */
  targets(): ReadonlyMap<number, ReadonlyMap<number, number>>
  /** Preset ref / timing of a fixture channel */
  meta(fixtureId: string, channelName: string): { presetId?: string; fade?: number; delay?: number } | undefined
}

let overlay: ProgrammerOverlay | null = null

/** Register the programmer engine's overlay (null = none) */
export function setProgrammerOverlay(o: ProgrammerOverlay | null): void {
  overlay = o
}

/**
 * Capture the current programmer state as an array of CueChannelValues.
 * Reverse-resolves absolute DMX addresses (universe + channel) back to
 * fixture IDs and channel names using the current patch.
 * Channels being faded record their target. `withMeta`: the preset
 * reference and the fade / delay of each value are copied too.
 *
 * Returns empty array if programmer has no active values.
 */
export function recordFromProgrammer(opts: { withMeta?: boolean } = {}): CueChannelValue[] {
  const programmerChannels = getProgrammerChannels()
  const targets = overlay?.targets()
  if (targets) {
    for (const [u, chMap] of targets) {
      let uniMap = programmerChannels.get(u)
      if (!uniMap) { uniMap = new Map(); programmerChannels.set(u, uniMap) }
      for (const [ch, v] of chMap) uniMap.set(ch, v)
    }
  }
  if (programmerChannels.size === 0) return []

  const { patch, fixtures } = usePatchStore.getState()
  const values: CueChannelValue[] = []
  const withMeta = !!opts.withMeta && !!overlay

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
        const v: CueChannelValue = {
          fixtureId: entry.id,
          channelName: chName,
          value
        }
        if (withMeta) {
          const m = overlay!.meta(entry.id, chName)
          if (m?.presetId) v.presetId = m.presetId
          if (m?.fade !== undefined && m.fade > 0) v.fade = m.fade
          if (m?.delay !== undefined && m.delay > 0) v.delay = m.delay
        }
        values.push(v)
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
  if (values.length === 0) return t('fixtures.summary.empty')
  const fixtureCount = new Set(values.map(v => v.fixtureId)).size
  return t('fixtures.summary.contents', {
    fixtures: t('common.fixtureCount', { count: fixtureCount }),
    channels: t('fixtures.summary.channels', { count: values.length })
  })
}

// ============================================================
// Programmer state for the UI ("which channels are in the programmer")
// The programmer lives in the mixer (not a store); the UI learns about
// changes through a version counter bumped by the helpers below and by a
// light poll (4 Hz) while a view is watching — so a Clear from the toolbar,
// the command line or a remote shows up too.
// ============================================================

interface ProgrammerUiState {
  /** Bumped whenever the set of programmer channels changes */
  version: number
}

export const useProgrammerStore = create<ProgrammerUiState>(() => ({ version: 0 }))

let lastSignature = ''

function programmerSignature(): string {
  const channels = getProgrammerChannels()
  let count = 0
  let hash = 0
  for (const [u, chMap] of channels) {
    for (const ch of chMap.keys()) {
      count++
      hash = (hash + Math.imul(u * 512 + ch + 1, 2654435761)) | 0
    }
  }
  return `${count}:${hash}`
}

/** Re-read the programmer and notify watchers if its channel set changed. */
export function refreshProgrammerState(): void {
  const sig = programmerSignature()
  if (sig === lastSignature) return
  lastSignature = sig
  useProgrammerStore.setState((s) => ({ version: s.version + 1 }))
}

let watchers = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

/** Start polling the programmer (ref-counted). Returns the stop function. */
export function watchProgrammer(): () => void {
  watchers++
  if (!pollTimer) pollTimer = setInterval(refreshProgrammerState, 250)
  refreshProgrammerState()
  return () => {
    watchers = Math.max(0, watchers - 1)
    if (watchers === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

/** Keep the programmer state fresh while the calling component is mounted. */
export function useProgrammerWatch(): void {
  useEffect(() => watchProgrammer(), [])
}

/** True when the programmer holds a value for this channel. */
export function isProgrammerChannel(universe: number, channel: number): boolean {
  return getProgrammerValue(universe, channel) !== undefined
}

/**
 * Set a programmer channel from the UI. Same as setProgrammerChannel, plus an
 * immediate "touched" notification when the channel enters the programmer.
 */
export function programChannel(universe: number, channel: number, value: number): void {
  const isNew = getProgrammerValue(universe, channel) === undefined
  setProgrammerChannel(universe, channel, value)
  if (isNew) refreshProgrammerState()
}

/** Release channels ({ universe: [channels] }) and notify the UI. */
export function releaseChannels(channels: Record<number, number[]>): void {
  releaseProgrammerChannels(channels)
  refreshProgrammerState()
}

/** Clear the whole programmer and notify the UI. */
export function clearProgrammerAll(): void {
  clearProgrammer()
  refreshProgrammerState()
}

/**
 * Release the programmer channels at the DMX footprint of these patch
 * entries (address .. address + channel count − 1, as patched). Used when
 * fixtures are deleted or re-addressed / re-moded: programmer values are
 * stored by absolute address, so they would otherwise stay and drive
 * whatever is patched there next. Returns the channel count released.
 */
export function releaseFootprints(entries: readonly PatchEntry[], fixtures: readonly FixtureDefinition[]): number {
  const out: Record<number, number[]> = {}
  let n = 0
  for (const entry of entries) {
    const mode = fixtures.find((f) => f.id === entry.fixtureDefId)?.modes.find((m) => m.name === entry.modeName)
    if (!mode) continue
    for (let i = 0; i < mode.channels.length; i++) {
      const ch = entry.address - 1 + i
      if (ch < 0 || ch >= 512 || getProgrammerValue(entry.universe, ch) === undefined) continue
      ;(out[entry.universe] ??= []).push(ch)
      n++
    }
  }
  if (n > 0) releaseChannels(out)
  return n
}

/** Release every programmer channel of these fixtures. Returns the channel count released. */
export function releaseFixtures(fixtureIds: readonly string[]): number {
  const { patch, fixtures } = usePatchStore.getState()
  const ids = new Set(fixtureIds)
  return releaseFootprints(patch.filter((entry) => ids.has(entry.id)), fixtures)
}

/** Did a patch update move the fixture's DMX footprint (address, universe, fixture or mode)? */
export function footprintChanged(before: PatchEntry, updates: Partial<PatchEntry>): boolean {
  return (updates.universe !== undefined && updates.universe !== before.universe) ||
    (updates.address !== undefined && updates.address !== before.address) ||
    (updates.fixtureDefId !== undefined && updates.fixtureDefId !== before.fixtureDefId) ||
    (updates.modeName !== undefined && updates.modeName !== before.modeName)
}

const LOCATE_FULL_COLOUR = /^(red|green|blue|white|warm white|cool white|cold white|r|g|b|w)(\s*\d+)?$/i
const LOCATE_ZERO = /^(amber|uv|ultra ?violet|lime|indigo|cyan|magenta|yellow|cto|ctb|ctc|a|c|m|y)(\s*\d+)?$|gobo|prism|frost|animation|iris|effect|macro|framing|blade/i
const LOCATE_OPEN_WHEEL = /colou?r ?wheel|^colou?r$/i

/** DMX value of the capability whose label/type means "open" / "white", if any. */
function openCapabilityValue(caps: { dmxRange: [number, number]; type: string; label?: string }[] | undefined): number | undefined {
  const open = caps?.find((c) => /^(open|white|no ?function|off)$/i.test((c.label ?? '').trim()) || /^(Open|ShutterOpen|NoFunction)$/.test(c.type))
  return open ? open.dmxRange[0] : undefined
}

/**
 * The locate look of fixtures: open white beams at full, and (with
 * `centre`) pan / tilt centred. Calls `set(universe, channel, value)` for
 * every channel it decides. Highlight uses it without centring (grandMA:
 * the beam lights up where it is).
 */
export function forEachLocateValue(
  fixtureIds: readonly string[], centre: boolean, set: (universe: number, channel: number, value: number) => void
): void {
  const { patch, fixtures } = usePatchStore.getState()
  const ids = new Set(fixtureIds)
  const put = (u: number, ch: number, v: number) => {
    if (ch < 0 || ch >= 512) return
    set(u, ch, v)
  }
  for (const entry of patch) {
    if (!ids.has(entry.id)) continue
    const def = fixtures.find((f) => f.id === entry.fixtureDefId)
    const mode = def?.modes.find((m) => m.name === entry.modeName)
    if (!def || !mode) continue
    const classified = classifyModeChannels(def, mode)
    classified.forEach((c, i) => {
      if (c.coarseIndex !== -1) return // fine halves are written with their coarse channel
      const name = (c.name ?? '').trim()
      const chDef = def.channels[c.name]
      const ch = entry.address - 1 + i
      const fine = c.fineIndex !== -1 ? entry.address - 1 + c.fineIndex : -1
      const u = entry.universe
      if (c.role === ChannelRole.Dimmer) {
        put(u, ch, chDef?.highlightValue ?? 255)
        if (fine >= 0) put(u, fine, 255)
      } else if (c.role === ChannelRole.Position) {
        if (!centre) return
        put(u, ch, chDef?.defaultValue ?? 128)
        if (fine >= 0) put(u, fine, def.channels[mode.channels[c.fineIndex]]?.defaultValue ?? 0)
      } else if (c.role === ChannelRole.Shutter) {
        if (c.blinderValue >= 0) put(u, ch, c.blinderValue)
      } else if (LOCATE_OPEN_WHEEL.test(name)) {
        put(u, ch, openCapabilityValue(chDef?.capabilities) ?? 0)
      } else if (c.role === ChannelRole.Color || c.role === ChannelRole.ColorIntensity) {
        if (LOCATE_FULL_COLOUR.test(name)) put(u, ch, 255)
        else if (LOCATE_ZERO.test(name)) put(u, ch, 0)
        else return
        if (fine >= 0) put(u, fine, LOCATE_FULL_COLOUR.test(name) ? 255 : 0)
      } else if (LOCATE_ZERO.test(name) && !/rotat|speed|shake/i.test(name)) {
        put(u, ch, openCapabilityValue(chDef?.capabilities) ?? 0)
      }
    })
  }
}

/** Highlight look of fixtures as a mixer layer (full, open white; positions untouched) */
export function highlightChannels(fixtureIds: readonly string[]): LayerChannels {
  const layer: LayerChannels = new Map()
  forEachLocateValue(fixtureIds, false, (u, ch, v) => {
    let uniMap = layer.get(u)
    if (!uniMap) { uniMap = new Map(); layer.set(u, uniMap) }
    uniMap.set(ch, v)
  })
  return layer
}

/**
 * Locate / highlight: open white beams, centred, at full — the classic
 * "where is this fixture" look. Values go into the programmer (Release or
 * Clear brings the fixtures back). Returns the number of channels set.
 */
export function locateFixtures(fixtureIds: readonly string[]): number {
  let n = 0
  forEachLocateValue(fixtureIds, true, (u, ch, v) => {
    setProgrammerChannel(u, ch, v)
    n++
  })
  refreshProgrammerState()
  return n
}
