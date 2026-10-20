// ============================================================
// PhotonBoard — Command line: one-line preview while typing
//
//   "Group 2 + 7 At 50"  → "→ 12 fixtures, Group “Wash”, at 50 %"
//   "Store Cue 5"         → "→ new cue 5 in “Intro”"
//   "Executor 2.5"        → "→ executor 2.5: “Intro”"
//
// Read-only (ProApi getters); computed on keystroke, not per frame.
// ============================================================

import type { CliAst, CliObjectRef, CliValueExpr } from './ast'
import type { CliContext } from './registry'
import { key } from './registry'
import {
  cueSequence, executorText, lookupChases, lookupCues, lookupDmx, lookupEffects, lookupExecutors, lookupMacros, lookupPages,
  lookupPresets, lookupSequences, lookupSpeedMasters, numberOf, presetText, refText, resolveFixtureExpr, idText
} from './objects'
import { toDmx, toPercent } from './values'
import type { TParams } from '@renderer/i18n'

const MAX_LISTED = 3
/** Actions that work on the selected sequence when no object is given */
const DEFAULT_SEQUENCE_ACTIONS = new Set(['go', 'go-', 'pause', 'store'])

function p(ctx: CliContext, k: string, params?: TParams): string {
  return ctx.t(key(`pro.cli.preview.${k}`), params)
}

function listed<T>(items: T[], fmt: (x: T) => string): string[] {
  const out = items.slice(0, MAX_LISTED).map(fmt)
  if (items.length > MAX_LISTED) out.push(`+${items.length - MAX_LISTED}`)
  return out
}

function describeRef(ctx: CliContext, ref: CliObjectRef, creating: boolean): string[] {
  const { api } = ctx
  const missing = (list: string[]) => list.map(x => p(ctx, creating ? 'new' : 'missing', { object: x }))
  switch (ref.kind) {
    case 'sequence': {
      const r = lookupSequences(api, ref)
      const all = api.getCuelists()
      return [...listed(r.found, c => p(ctx, 'sequence', { n: numberOf(c, all), name: c.name })), ...missing(r.missing)]
    }
    case 'cue': {
      const { cuelist, missing: m } = cueSequence(api, ref)
      if (!cuelist) return [p(ctx, m ? 'missing' : 'noSequence', { object: m ?? '' })]
      const r = lookupCues(cuelist, ref)
      const out = listed(r.found, c => p(ctx, 'cue', { cue: c.number, name: cuelist.name }))
      for (const x of r.missing) out.push(p(ctx, creating ? 'cueNew' : 'missing', { object: x, cue: x.replace(/^Cue /, ''), name: cuelist.name }))
      return out
    }
    case 'preset': {
      const r = lookupPresets(api, ref)
      const all = api.getPresets()
      return [...listed(r.found, x => p(ctx, 'preset', { id: presetText(x, all), name: x.name })), ...missing(r.missing)]
    }
    case 'executor': {
      const r = lookupExecutors(api, ref)
      return [...listed(r.found, e => {
        const cell = api.getExecutorPages()[e.page]?.cells[e.col]?.[e.row]
        if (!cell) return p(ctx, 'executorEmpty', { ref: executorText(e) })
        const lists: Record<string, readonly { id: string; name: string }[]> = {
          cuelist: api.getCuelists(), chase: api.getChases(), effect: api.getEffects(), macro: api.getMacros(), group: api.getGroups(), speed: api.getSpeedMasters()
        }
        return p(ctx, 'executor', { ref: executorText(e), name: lists[cell.kind]?.find(x => x.id === cell.id)?.name ?? '' })
      }), ...missing(r.missing)]
    }
    case 'page': {
      const r = lookupPages(ref)
      return r.found.slice(0, 1).map(n => p(ctx, 'page', { n: n + 1 }))
    }
    case 'macro': {
      const r = lookupMacros(api, ref)
      const all = api.getMacros()
      return [...listed(r.found, x => p(ctx, 'named', { object: `Macro ${numberOf(x, all)}`, name: x.name })), ...missing(r.missing)]
    }
    case 'chase': {
      const r = lookupChases(api, ref)
      const all = api.getChases()
      return [...listed(r.found, x => p(ctx, 'named', { object: `Chase ${numberOf(x, all)}`, name: x.name })), ...missing(r.missing)]
    }
    case 'effect': {
      const r = lookupEffects(api, ref)
      const all = api.getEffects()
      return [...listed(r.found, x => p(ctx, 'named', { object: `Effect ${numberOf(x, all)}`, name: x.name })), ...missing(r.missing)]
    }
    case 'speed': {
      const r = lookupSpeedMasters(api, ref)
      const all = api.getSpeedMasters()
      return [...listed(r.found, x => p(ctx, 'named', { object: `Speed ${numberOf(x, all)}`, name: x.name })), ...missing(r.missing)]
    }
    case 'dmx': {
      const r = lookupDmx(ref)
      return [p(ctx, 'dmx', { count: r.found.length }), ...missing(r.missing)]
    }
    default:
      return [refText(ref)]
  }
}

function describeValue(ctx: CliContext, ast: CliAst, v: CliValueExpr): string[] {
  const out: string[] = []
  const raw = ast.options.some(o => o.name === 'dmx')
  if (v.value.kind === 'preset') {
    const r = lookupPresets(ctx.api, { kind: 'preset', ids: [{ op: '+', range: { from: v.value.id } }] })
    const preset = r.found[0]
    out.push(preset ? p(ctx, 'presetValue', { id: presetText(preset, ctx.api.getPresets()), name: preset.name }) : p(ctx, 'missing', { object: `Preset ${idText(v.value.id)}` }))
  } else if (v.value.to !== undefined) {
    out.push(p(ctx, 'fan', { from: toPercent(toDmx(v.value.from, raw)), to: toPercent(toDmx(v.value.to, raw)) }))
  } else {
    out.push(p(ctx, 'level', { pct: toPercent(toDmx(v.value.from, raw)) }))
  }
  if (v.fade !== undefined) out.push(p(ctx, 'fade', { s: v.fade }))
  if (v.delay !== undefined) out.push(p(ctx, 'delay', { s: v.delay }))
  return out
}

/** "→ 12 fixtures, Group “Wash”" — '' when there is nothing to say */
export function describeAst(ast: CliAst, ctx: CliContext): string {
  const { api } = ctx
  const parts: string[] = []
  const creating = ast.action === 'store'
  if (ast.objects) {
    const sel = resolveFixtureExpr(api, ast.objects)
    const hasFixtures = ast.objects.items.some(i => i.object.kind === 'fixture' || i.object.kind === 'group') || ast.objects.items.length === 0
    if (hasFixtures) {
      parts.push(p(ctx, 'fixtures', { count: sel.ids.length }))
      for (const g of sel.groups.slice(0, MAX_LISTED)) parts.push(p(ctx, 'group', { name: g.name }))
      for (const x of sel.missing) parts.push(p(ctx, 'missing', { object: x }))
    }
    for (const ref of sel.others) parts.push(...describeRef(ctx, ref, creating))
  } else if (ast.value && !ast.action) {
    parts.push(p(ctx, 'fixtures', { count: api.getActiveSelection().length }))
  } else if (ast.action && DEFAULT_SEQUENCE_ACTIONS.has(ast.action)) {
    // Go / Go- / Pause / Store without an object: the sequence they act on
    const lists = api.getCuelists()
    const sel = api.getSelectedCuelist()
    const cl = lists.find(c => c.id === sel) ?? (ast.action === 'store' ? undefined : lists[0])
    if (ast.action === 'store') {
      const next = cl ? Math.floor(Math.max(0, ...cl.cues.map(c => c.number))) + 1 : 1
      parts.push(cl ? p(ctx, 'cueNew', { cue: next, name: cl.name }) : p(ctx, 'new', { object: 'Sequence' }))
    } else if (cl) parts.push(p(ctx, 'sequence', { n: numberOf(cl, lists), name: cl.name }))
  }
  if (ast.target) parts.push(p(ctx, 'target', { object: describeRef(ctx, ast.target, true).join(', ') || refText(ast.target) }))
  if (ast.value) parts.push(...describeValue(ctx, ast, ast.value))
  return parts.length ? `→ ${parts.join(', ')}` : ''
}
