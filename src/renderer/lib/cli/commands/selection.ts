// ============================================================
// PhotonBoard — Command line: selection lines and values
//
//   Fixture 1 Thru 4            select (replaces the selection)
//   + 5 · - Group 2             add to / remove from the selection
//   Group 2 At 50               select and set the intensity
//   At 0 Thru 100 Fade 2        fan on the selection (MAtricks, align)
//   Full · Zero · Off           selection at 100 % / 0 % (legacy)
//   At Preset 4.2 · Preset 4.2  call a preset on the selection
//   Fixture 1 Thru 20 If Group 3
//   DMX 1.101 At 50             raw DMX tester
//   Sequence 3 · Executor 2.5 · Macro 2 …  (bare object: its default action)
//   Gobo 30                     legacy: channel by name, DMX value
// ============================================================

import type { CliAst, CliObjectRef, CliValueExpr } from '../ast'
import type { CliCommand, CliContext, CliResult } from '../registry'
import {
  lookupChases, lookupCues, lookupDmx, lookupEffects, lookupExecutors, lookupMacros, lookupPages, lookupPresets,
  lookupSequences, lookupSpeedMasters, cueSequence, numberOf, presetText, refText, resolveFixtureExpr
} from '../objects'
import { applyChannelByName, applyLevel, toDmx, toPercent, timeOf } from '../values'
import { executorLabel, executorTargetName, fail, hasOption, m, notFound, ok, seqParams, warn } from './util'
import { describeAst } from '../preview'

/** Apply a value (level, fan or preset) to fixtures */
export function applyValue(ctx: CliContext, ast: CliAst, ids: string[], v: CliValueExpr): CliResult {
  const { api } = ctx
  if (ids.length === 0) return warn(m(ctx, 'msg.noSelection'))
  if (v.value.kind === 'preset') {
    const ref: CliObjectRef = { kind: 'preset', ids: [{ op: '+', range: { from: v.value.id } }] }
    const r = lookupPresets(api, ref)
    const preset = r.found[0]
    if (!preset) return notFound(ctx, r.missing)
    const n = api.applyPreset(preset.id, ids, timeOf(v))
    const params = { id: presetText(preset, api.getPresets()), name: preset.name }
    if (n === 0) return warn(m(ctx, 'msg.presetNoValues', params))
    return ok(m(ctx, 'msg.presetApplied', { ...params, count: ids.length }))
  }
  const res = applyLevel(api, ids, v, hasOption(ast, 'dmx'))
  if (res.count === 0) return warn(m(ctx, 'msg.noIntensity', { count: res.skipped }))
  if (res.dmxTo !== undefined) return ok(m(ctx, 'msg.fixturesFan', { count: res.count, from: toPercent(res.dmxFrom), to: toPercent(res.dmxTo) }))
  return ok(m(ctx, 'msg.fixturesAt', { count: res.count, pct: toPercent(res.dmxFrom) }))
}

/** Bare object of another kind than fixtures / groups: its default action */
function objectDefault(ctx: CliContext, ast: CliAst, ref: CliObjectRef, select: boolean): CliResult {
  const { api } = ctx
  const v = ast.value
  switch (ref.kind) {
    case 'dmx': {
      const r = lookupDmx(ref)
      if (r.missing.length && !r.found.length) return notFound(ctx, r.missing)
      if (!v || v.value.kind !== 'level') return warn(m(ctx, 'msg.needValue'))
      const raw = hasOption(ast, 'dmx')
      const from = toDmx(v.value.from, raw)
      const to = v.value.to === undefined ? from : toDmx(v.value.to, raw)
      const n = r.found.length
      r.found.forEach((a, i) => api.setDmx(a.universe, a.channel, Math.round(n > 1 ? from + ((to - from) * i) / (n - 1) : from)))
      return ok(m(ctx, 'msg.dmxSet', { count: n, value: from }))
    }
    case 'preset': {
      const r = lookupPresets(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      const id = r.found[0].id
      const preset = r.found[0]
      const sel = api.getActiveSelection()
      if (!sel.length) return warn(m(ctx, 'msg.noSelection'))
      const n = api.applyPreset(id, sel)
      const params = { id: presetText(preset, api.getPresets()), name: preset.name }
      if (n === 0) return warn(m(ctx, 'msg.presetNoValues', params))
      return ok(m(ctx, 'msg.presetApplied', { ...params, count: sel.length }))
    }
    case 'sequence': {
      const r = lookupSequences(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      api.selectCuelist(r.found[0].id)
      return ok(m(ctx, 'msg.sequenceSelected', seqParams(api, r.found[0].id)))
    }
    case 'cue': {
      const { cuelist, missing } = cueSequence(api, ref)
      if (!cuelist) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
      const r = lookupCues(cuelist, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      api.goto(cuelist.id, r.found[0].number)
      return ok(m(ctx, 'msg.goto', { cue: r.found[0].number, ...seqParams(api, cuelist.id) }))
    }
    case 'executor': {
      const r = lookupExecutors(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      if (select) {
        api.selectExecutor(r.found[0])
        return ok(m(ctx, 'msg.executorSelected', { ref: executorLabel(r.found[0]), name: executorTargetName(api, r.found[0]) }))
      }
      if (v && v.value.kind === 'level') {
        const level = toDmx(v.value.from, hasOption(ast, 'dmx'))
        const cols = new Set<string>()
        for (const e of r.found) {
          const k = `${e.page}:${e.col}`
          if (cols.has(k)) continue
          cols.add(k)
          api.columnFader(e.page, e.col, level)
        }
        return ok(m(ctx, 'msg.columnFader', { ref: executorLabel(r.found[0]), pct: toPercent(level) }))
      }
      for (const e of r.found) {
        api.executorPress(e, 'down')
        api.executorPress(e, 'up')
      }
      return ok(m(ctx, 'msg.executorPressed', { ref: executorLabel(r.found[0]), name: executorTargetName(api, r.found[0]) }))
    }
    case 'page': {
      const r = lookupPages(ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      api.setExecutorPage(r.found[0])
      return ok(m(ctx, 'msg.page', { n: r.found[0] + 1 }))
    }
    case 'macro': {
      const r = lookupMacros(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      for (const mac of r.found) api.runMacro(mac.id)
      return ok(m(ctx, 'msg.macroRun', { n: numberOf(r.found[0], api.getMacros()), name: r.found[0].name }))
    }
    case 'chase': {
      const r = lookupChases(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      for (const c of r.found) api.toggleChase(c.id)
      return ok(m(ctx, 'msg.chaseToggled', { name: r.found[0].name }))
    }
    case 'effect': {
      const r = lookupEffects(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      for (const e of r.found) api.setEffectRunning(e.id, !e.isRunning)
      return ok(m(ctx, r.found[0].isRunning ? 'msg.effectOff' : 'msg.effectOn', { name: r.found[0].name }))
    }
    case 'speed': {
      const r = lookupSpeedMasters(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      if (v && v.value.kind === 'level') {
        const bpm = Math.max(1, Math.min(999, v.value.from))
        for (const s of r.found) api.setSpeedMasterBpm(s.id, bpm)
        return ok(m(ctx, 'msg.speedBpm', { name: r.found[0].name, bpm }))
      }
      for (const s of r.found) api.tapSpeedMaster(s.id)
      return ok(m(ctx, 'msg.speedTap', { name: r.found[0].name }))
    }
    default:
      return fail(m(ctx, 'msg.unsupported', { action: ast.action ?? '', object: refText(ref) }))
  }
}

/** Selection line (no action), `Select …` and `Call …` */
export function runSelection(ast: CliAst, ctx: CliContext, select = false): CliResult {
  const { api } = ctx
  // Bare value: At 50 · Full · At Preset 4.2 → active selection
  if (!ast.objects) {
    if (!ast.value) return warn(m(ctx, 'msg.needObject', { action: ast.action ?? '' }))
    return applyValue(ctx, ast, api.getActiveSelection(), ast.value)
  }
  const sel = resolveFixtureExpr(api, ast.objects)
  if (sel.others.length) {
    if (sel.others.length !== ast.objects.items.length) return fail(m(ctx, 'msg.mixed'))
    return objectDefault(ctx, ast, sel.others[0], select)
  }
  if (sel.ids.length === 0) return sel.missing.length ? notFound(ctx, sel.missing) : warn(m(ctx, 'msg.noMatchingFixtures'))
  api.setSelection(sel.ids)
  if (ast.value) {
    // The value goes to the ACTIVE fixtures (Next / Prev step, MAtricks)
    const active = api.getActiveSelection()
    return applyValue(ctx, ast, active.length ? active : sel.ids, ast.value)
  }
  const onlyGroup = ast.objects.items.length === 1 && sel.groups.length === 1 && !ast.objects.condition && !ast.objects.relative
  if (onlyGroup) return ok(m(ctx, 'msg.groupSelected', { name: sel.groups[0].name, count: sel.ids.length }))
  return ok(m(ctx, 'msg.selected', { count: sel.ids.length }))
}

export const selectCommand: CliCommand = {
  keyword: 'select',
  helpKey: 'select',
  run: (ast, ctx) => runSelection(ast, ctx, ast.action === 'select'),
  preview: describeAst
}

export const callCommand: CliCommand = {
  keyword: 'call',
  helpKey: 'call',
  run: (ast, ctx) => runSelection(ast, ctx),
  preview: describeAst
}

/** Legacy `Gobo 30`: selection (or every fixture), channel by name, DMX value */
export const attributeCommand: CliCommand = {
  keyword: 'attribute',
  helpKey: 'attribute',
  run(ast, ctx) {
    const { api } = ctx
    const sel = api.getSelection()
    const ids = sel.length ? sel : api.getPatch().map(p => p.id)
    const value = Math.max(0, Math.min(255, Math.round(ast.amount ?? 0)))
    const count = applyChannelByName(api, ids, ast.text ?? '', value)
    if (count === 0) return warn(m(ctx, 'msg.noChannel', { channel: ast.text ?? '' }))
    return ok(m(ctx, 'msg.channelSet', { count, channel: ast.text ?? '', value }))
  },
  preview: describeAst
}

