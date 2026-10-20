// ============================================================
// Pro store modes of the Record popover / cue menu: Merge,
// Overwrite, Remove, Cue only, with a feature filter. Goes through
// lib/pro/store-ops (storeIntoCue: pure) and writes the cues it
// changed as ONE undo step. Feature of a channel = shared
// attribute-families classification (same as the programmer).
// ============================================================

import type { CueChannelValue, CueFeature } from '@shared/types'
import { featureOfChannel } from '@shared/attribute-families'
import { filterValues, storeIntoCue, type KeyMetaFn, type StoreMode, type StoreOptions } from '@renderer/lib/pro/store-ops'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { historyStep } from '@renderer/lib/history'

/** Store modes offered in the Record popover (block = command line only) */
export const RECORD_STORE_MODES: readonly Exclude<StoreMode, 'block'>[] = ['merge', 'overwrite', 'remove', 'cueonly']

/**
 * Feature of a fixture's channel, from the patch and fixture definitions
 * as they are now (cached per call site: build one per operation / render).
 */
export function makeFeatureOf(): (fixtureId: string, channelName: string) => CueFeature {
  const { patch, fixtures } = usePatchStore.getState()
  const entries = new Map(patch.map((p) => [p.id, p]))
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  const cache = new Map<string, CueFeature>()
  return (fixtureId, channelName) => {
    const key = `${fixtureId}\u0000${channelName}`
    let f = cache.get(key)
    if (f) return f
    const def = defs.get(entries.get(fixtureId)?.fixtureDefId ?? '')
    const ch = def?.channels[channelName]
    f = featureOfChannel(channelName, ch?.type, ch?.precedence)
    cache.set(key, f)
    return f
  }
}

export function keyMetaFn(): KeyMetaFn {
  const featureOf = makeFeatureOf()
  return (fixtureId, channelName) => ({ feature: featureOf(fixtureId, channelName) })
}

/** Values left after the feature filter (empty filter = all) */
export function applyFeatureFilter(values: CueChannelValue[], filter: CueFeature[] | undefined): CueChannelValue[] {
  return filter && filter.length > 0 ? filterValues(values, filter, keyMetaFn()) : values
}

function sameValues(a: readonly CueChannelValue[], b: readonly CueChannelValue[] | undefined): boolean {
  if (!b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (x.fixtureId !== y.fixtureId || x.channelName !== y.channelName || x.value !== y.value || x.presetId !== y.presetId ||
      x.fade !== y.fade || x.delay !== y.delay || x.part !== y.part) return false
  }
  return true
}

/**
 * Store values into an existing cue with a store mode (one undo step).
 * Returns the number of cues that changed (Cue only may touch the next cue).
 */
export function storeIntoExistingCue(cuelistId: string, cueId: string, values: CueChannelValue[], opts: StoreOptions, label: string): number {
  const pb = usePlaybackStore.getState()
  const cl = pb.cuelists.find((c) => c.id === cuelistId)
  if (!cl) return 0
  const index = cl.cues.findIndex((c) => c.id === cueId)
  if (index < 0) return 0
  const next = storeIntoCue(cl, index, values, opts, keyMetaFn())
  // Only real changes (no empty undo step when e.g. nothing was there to remove)
  const changed = next.cues.filter((cue, i) => cue !== cl.cues[i] && (!sameValues(cue.values, cl.cues[i]?.values) || cue.block !== cl.cues[i]?.block))
  if (changed.length === 0) return 0
  historyStep(label, () => {
    for (const cue of changed) {
      const { id, ...rest } = cue
      // Only the fields store-ops may change
      usePlaybackStore.getState().updateCue(cuelistId, id, { values: rest.values, ...(rest.block !== undefined ? { block: rest.block } : {}) })
    }
  })
  return changed.length
}
