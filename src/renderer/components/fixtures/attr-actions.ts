// Reading / writing programmer attributes from components.
// Live values: one primitive selector per display (re-renders only when
// that attribute's value changes). Touched state: the programmer version.

import { useDmxStore } from '@renderer/stores/dmx-store'
import { getProgrammerValue } from '@renderer/lib/dmx-mixer'
import { programChannel, refreshProgrammerState, releaseChannels, useProgrammerStore } from '@renderer/lib/programmer-utils'
import {
  parseSummaryKey, summarize, summaryKey, targetChannels, targetWrites,
  type AttrSummary, type AttrTarget, type Attribute
} from './programmer-model'

/** Live min / max / first value of an attribute (optionally of one fixture) */
export function useAttrSummary(attr: Pick<Attribute, 'targets' | 'fine'>, fixtureId?: string): AttrSummary {
  const key = useDmxStore((s) => summaryKey(summarize(s.values, attr, fixtureId)))
  return parseSummaryKey(key)
}

export function isTargetTouched(t: AttrTarget): boolean {
  return getProgrammerValue(t.universe, t.coarse) !== undefined
}

/** 'none' | 'some' | 'all' of the attribute's channels are in the programmer */
export type Touched = 'none' | 'some' | 'all'

export function attrTouched(targets: readonly AttrTarget[]): Touched {
  let n = 0
  for (const t of targets) if (isTargetTouched(t)) n++
  return n === 0 ? 'none' : n === targets.length ? 'all' : 'some'
}

export function useAttrTouched(targets: readonly AttrTarget[]): Touched {
  return useProgrammerStore((s) => (s.version >= 0 ? attrTouched(targets) : 'none'))
}

/** Any of these attributes in the programmer */
export function useAnyTouched(attrs: readonly Attribute[]): boolean {
  return useProgrammerStore((s) => s.version >= 0 && attrs.some((a) => a.targets.some(isTargetTouched)))
}

/** Set an attribute (value in its range: 0-255, or 0-65535 when 16-bit) on every target */
export function setAttr(attr: Pick<Attribute, 'targets' | 'fine'>, value: number, fixtureId?: string): void {
  for (const t of attr.targets) {
    if (fixtureId && t.fixtureId !== fixtureId) continue
    for (const [ch, v] of targetWrites(t, value, attr.fine)) programChannel(t.universe, ch, v)
  }
}

/** Set an 8-bit DMX value (wheel slot, capability) regardless of 16-bit */
export function setAttrDmx(attr: Pick<Attribute, 'targets' | 'fine'>, dmx: number, fixtureId?: string): void {
  setAttr(attr, attr.fine ? dmx * 256 : dmx, fixtureId)
}

export function releaseAttrs(attrs: readonly Pick<Attribute, 'targets'>[]): void {
  const targets = attrs.flatMap((a) => a.targets)
  if (targets.length === 0) return
  releaseChannels(targetChannels(targets))
  refreshProgrammerState()
}

/** Read an attribute summary right now (event handlers) */
export function readAttrNow(attr: Pick<Attribute, 'targets' | 'fine'>, fixtureId?: string): AttrSummary {
  return summarize(useDmxStore.getState().values, attr, fixtureId)
}
