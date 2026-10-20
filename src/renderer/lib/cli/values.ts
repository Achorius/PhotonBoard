// ============================================================
// PhotonBoard — Command line: values → programmer
//
//   Levels are percent 0-100 (Full = 100, Zero = 0). A number above
//   100 is a DMX value 0-255 (the old command line's rule), and the
//   /dmx option makes every number a DMX value.
//   "At" sets the intensity channel of each fixture: its "Dimmer" /
//   "Intensity" channel (the old command line's rule), else its first
//   coarse intensity-type channel.
//   Fans (`At 0 Thru 100`) spread over the selection ORDER with the
//   MAtricks phases and the align mode; the values go to the ACTIVE
//   fixtures (Next / Prev step, MAtricks).
// ============================================================

import type { FixtureDefinition, PatchEntry } from '@shared/types'
import { applyMatricks, fanValues } from '@renderer/lib/pro/selection-tools'
import type { AlignMode, ProApi, ProgTime, ProgrammerValueInput } from '@renderer/lib/pro/contracts'
import type { CliValueExpr } from './ast'

/**
 * Optional ProApi extension: the align mode of the selection tools
 * (selection-store `align`). Without it fans run '<' (first → last).
 */
export type AlignAwareApi = ProApi & { getAlign?(): AlignMode | null }

export function alignOf(api: ProApi): AlignMode {
  return (api as AlignAwareApi).getAlign?.() ?? '<'
}

/** Level as typed → DMX 0-255 */
export function toDmx(n: number, raw = false): number {
  if (!Number.isFinite(n)) return 0
  const v = raw || n > 100 ? n : (n / 100) * 255
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** DMX → whole percent */
export function toPercent(dmx: number): number {
  return Math.round((Math.max(0, Math.min(255, dmx)) / 255) * 100)
}

export interface FixtureModel {
  patch: readonly PatchEntry[]
  byId: Map<string, PatchEntry>
  defs: Map<string, FixtureDefinition>
}

/** Patch + definitions, read once per command */
export function fixtureModel(api: ProApi): FixtureModel {
  const patch = api.getPatch()
  return {
    patch,
    byId: new Map(patch.map(p => [p.id, p])),
    defs: new Map(api.getFixtureDefs().map(d => [d.id, d]))
  }
}

/** Channels of a patched fixture (its mode, in order) */
export function channelsOf(m: FixtureModel, fixtureId: string): { name: string; type: string; fine: boolean }[] {
  const entry = m.byId.get(fixtureId)
  const def = entry && m.defs.get(entry.fixtureDefId)
  const mode = def?.modes.find(md => md.name === entry!.modeName)
  if (!def || !mode) return []
  return mode.channels.map(name => {
    const ch = def.channels[name]
    return { name, type: ch?.type ?? 'generic', fine: !!ch?.fineOf || /\bfine\b/i.test(name) }
  })
}

/** Intensity channel of a fixture ("Dimmer" / "Intensity" first, like the old command line) */
export function intensityChannel(m: FixtureModel, fixtureId: string): string | null {
  const chans = channelsOf(m, fixtureId)
  const named = chans.find(c => c.name.toLowerCase() === 'dimmer' || c.name.toLowerCase() === 'intensity')
  if (named) return named.name
  return chans.find(c => c.type === 'intensity' && !c.fine)?.name ?? null
}

/** Explicit time of a value expression (`Fade 2 Delay 1`); undefined = programmer time */
export function timeOf(v: CliValueExpr | undefined): ProgTime | undefined {
  if (!v || (v.fade === undefined && v.delay === undefined)) return undefined
  return { fade: Math.max(0, v.fade ?? 0), delay: Math.max(0, v.delay ?? 0) }
}

/**
 * Phase 0…1 of each fixture for a fan: MAtricks phases of the whole
 * selection (selection order), restricted to `ids`; fixtures outside
 * the selection are spread in their own order.
 */
export function fanPhases(api: ProApi, ids: string[]): Map<string, number> {
  const sel = api.getSelection()
  const inSel = ids.every(id => sel.includes(id))
  const { phase } = applyMatricks(inSel ? sel : ids, inSel ? api.getMatricks() : {}, null)
  const out = new Map<string, number>()
  ids.forEach((id, i) => out.set(id, phase.get(id) ?? (ids.length > 1 ? i / (ids.length - 1) : 0)))
  return out
}

export interface LevelResult {
  /** Fixtures that received a value */
  count: number
  /** Fixtures without an intensity channel */
  skipped: number
  dmxFrom: number
  dmxTo?: number
}

/** Put an intensity level (or a fan) on fixtures through the programmer */
export function applyLevel(api: ProApi, ids: string[], v: CliValueExpr, raw: boolean): LevelResult {
  if (v.value.kind !== 'level') return { count: 0, skipped: 0, dmxFrom: 0 }
  const m = fixtureModel(api)
  const from = toDmx(v.value.from, raw)
  const to = v.value.to === undefined ? undefined : toDmx(v.value.to, raw)
  const levels = to === undefined ? null : fanValues(fanPhases(api, ids), from, to, alignOf(api))
  const values: ProgrammerValueInput[] = []
  let skipped = 0
  for (const id of ids) {
    const ch = intensityChannel(m, id)
    if (!ch) { skipped++; continue }
    values.push({ fixtureId: id, channelName: ch, value: levels ? Math.round(levels.get(id) ?? from) : from })
  }
  if (values.length) api.setAttributeValues(values, timeOf(v))
  const res: LevelResult = { count: values.length, skipped, dmxFrom: from }
  if (to !== undefined) res.dmxTo = to
  return res
}

/** Legacy `Gobo 30`: first channel whose name contains the word, DMX value */
export function applyChannelByName(api: ProApi, ids: string[], word: string, dmx: number): number {
  const m = fixtureModel(api)
  const values: ProgrammerValueInput[] = []
  const target = word.toLowerCase()
  for (const id of ids) {
    const ch = channelsOf(m, id).find(c => c.name.toLowerCase().includes(target))
    if (ch) values.push({ fixtureId: id, channelName: ch.name, value: Math.max(0, Math.min(255, Math.round(dmx))) })
  }
  if (values.length) api.setAttributeValues(values)
  return values.length
}
