// Reading / writing programmer attributes from components.
// Live values: one primitive selector per display (re-renders only when
// that attribute's value changes). Touched state: the programmer version.

import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { getMatricksResult, useSelectionStore } from '@renderer/stores/selection-store'
import { fanValues } from '@renderer/lib/pro/selection-tools'
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
  if (!fixtureId && setAttrAligned(attr, value)) return
  for (const t of attr.targets) {
    if (fixtureId && t.fixtureId !== fixtureId) continue
    for (const [ch, v] of targetWrites(t, value, attr.fine)) programChannel(t.universe, ch, v)
  }
}

// ---------------------------------------------------------------
// Align (Pro): with an align mode set in the selection tools, moving an
// attribute on a multi-selection FANS it along the selection order
// (MAtricks / Next step applied): the value spreads from where the
// gesture started to where the control is, in the align direction
// ('<' first fixture keeps the start, last follows the control; '>' the
// reverse; '<>' / '><' centre / ends). A gesture = calls less than
// ALIGN_GESTURE_GAP_MS apart.
// ---------------------------------------------------------------

const ALIGN_GESTURE_GAP_MS = 600
let alignGesture: { targets: readonly AttrTarget[]; start: number; at: number } | null = null

function setAttrAligned(attr: Pick<Attribute, 'targets' | 'fine'>, value: number): boolean {
  const align = useSelectionStore.getState().align
  if (!align || !useUiStore.getState().proMode) return false
  const selection = usePatchStore.getState().selectedFixtureIds
  if (selection.length < 2) return false
  const { phase } = getMatricksResult(selection)
  const targets = attr.targets.filter((t) => phase.has(t.fixtureId))
  if (new Set(targets.map((t) => t.fixtureId)).size < 2) return false
  const now = Date.now()
  if (!alignGesture || alignGesture.targets !== attr.targets || now - alignGesture.at > ALIGN_GESTURE_GAP_MS) {
    // The gesture starts from the attribute's current value (first fixture in the selection order)
    const first = targets.find((t) => t.fixtureId === selection.find((id) => phase.has(id))) ?? targets[0]
    alignGesture = { targets: attr.targets, start: readAttrNow({ targets: [first], fine: attr.fine }).first ?? value, at: now }
  }
  alignGesture.at = now
  const fan = fanValues(phase, alignGesture.start, value, align)
  for (const t of targets) {
    const v = Math.round(fan.get(t.fixtureId) ?? value)
    for (const [ch, out] of targetWrites(t, v, attr.fine)) programChannel(t.universe, ch, out)
  }
  return true
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
