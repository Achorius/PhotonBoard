// Which programmer values come from a preset (Pro view): the "P4.2"
// chips of the attribute panels and the lit tiles of the preset pools.
// The programmer engine keeps a preset ref per fixture channel
// (getProgrammerMeta); a value counts while it still equals what the
// preset gives. Polled at 4 Hz while a Pro view watches (ref-counted),
// state written only when it changed — nothing runs in simple mode.

import { useEffect } from 'react'
import { create } from 'zustand'
import type { FixtureDefinition, PatchEntry, Preset } from '@shared/types'
import { getProgrammerMeta } from '@renderer/lib/pro/programmer-engine'
import { resolvePreset } from '@renderer/lib/pro/preset-resolve'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { presetChip, presetOfTargets, validPresetRefs, type ChipTarget } from '@renderer/components/pools/pool-model'

interface PresetMetaState {
  /** meta key (fixtureId:channel) → preset id, for values still equal to their preset */
  refs: ReadonlyMap<string, string>
  /** Presets the programmer holds values of */
  ids: ReadonlySet<string>
}

export const usePresetMeta = create<PresetMetaState>(() => ({ refs: new Map(), ids: new Set() }))

let signature = ''

function addressOf(entry: PatchEntry, def: FixtureDefinition | undefined, channel: string): number {
  const mode = def?.modes.find((m) => m.name === entry.modeName)
  const i = mode ? mode.channels.indexOf(channel) : -1
  return i < 0 ? -1 : entry.address - 1 + i
}

/** Re-read the programmer meta now (after applying / storing a preset) */
export function refreshPresetMeta(): void {
  const meta = getProgrammerMeta()
  if (meta.size === 0 && signature === '') return
  const { patch, fixtures } = usePatchStore.getState()
  const presets = usePlaybackStore.getState().presets
  const entries = new Map(patch.map((p) => [p.id, p]))
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  const byId = new Map<string, Preset>(presets.map((p) => [p.id, p]))
  const refs = validPresetRefs(meta, (key, presetId) => {
    const sep = key.indexOf(':')
    const entry = entries.get(key.slice(0, sep))
    const channel = key.slice(sep + 1)
    const preset = byId.get(presetId)
    if (!entry || !preset) return { current: undefined, expected: undefined }
    const def = defs.get(entry.fixtureDefId)
    const addr = addressOf(entry, def, channel)
    return {
      current: addr < 0 ? undefined : getProgrammerValue(entry.universe, addr),
      expected: resolvePreset(preset, entry, def, channel)
    }
  })
  const sig = [...refs].map(([k, v]) => `${k}=${v}`).sort().join('|')
  if (sig === signature) return
  signature = sig
  usePresetMeta.setState({ refs, ids: new Set(refs.values()) })
}

let watchers = 0
let timer: ReturnType<typeof setInterval> | null = null

/** Keep the preset refs fresh while the calling component is mounted (pass false to skip) */
export function usePresetMetaWatch(active = true): void {
  useEffect(() => {
    if (!active) return
    watchers++
    if (!timer) timer = setInterval(refreshPresetMeta, 250)
    refreshPresetMeta()
    return () => {
      watchers = Math.max(0, watchers - 1)
      if (watchers === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [active])
}

/** Is this target's coarse channel in the programmer */
function held(t: ChipTarget & { universe?: number; coarse?: number }): boolean {
  return t.universe !== undefined && t.coarse !== undefined && getProgrammerValue(t.universe, t.coarse) !== undefined
}

/**
 * Chip of an attribute's programmer values: "P4.2", "P…" (several presets)
 * or '' (not from a preset).
 */
export function usePresetChip(targets: readonly (ChipTarget & { universe: number; coarse: number })[], several: string): string {
  const id = usePresetMeta((s) => (s.refs.size === 0 ? '' : presetOfTargets(targets, s.refs, held)))
  const preset = usePlaybackStore((s) => (id && id !== '*' ? s.presets.find((p) => p.id === id) : undefined))
  if (!id) return ''
  if (id === '*') return several
  return preset ? presetChip(preset) : ''
}
