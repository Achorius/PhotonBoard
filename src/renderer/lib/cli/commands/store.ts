// ============================================================
// PhotonBoard — Command line: Store / Update
//
//   Store                       next cue of the selected sequence
//   Store Cue 5 [Sequence 3]    asks Merge / Overwrite / Cue only / Cancel
//                               when cue 5 exists (macros: merge)
//   Store Sequence 4            new sequence 4 (or its next cue)
//   Store Preset 4.2 /global    preset family.number (scope option)
//   Store Group 5 "Front"       the selection as group 5
//   Store Executor 1.3          its sequence's next cue, or a new sequence there
//   options  /merge /overwrite /remove /cueonly /block /filter=position,color
//   Update                      active cues + presets the values came from
//   Update Cue 5 · Update Preset 4.2
// Every store is ONE undo step ("Oops").
// ============================================================

import type { StoreOptions } from '@renderer/lib/pro/store-ops'
import type { CliAst, CliObjectRef } from '../ast'
import type { CliCommand, CliContext, CliResult } from '../registry'
import {
  cueNumberOf, cueSequence, lookupExecutors, lookupGroups, lookupPresets, lookupSequences, presetText, presetTypeOfFamily, refText
} from '../objects'
import { describeAst } from '../preview'
import { executorCell, executorLabel, fail, firstRef, m, mutate, notFound, ok, scopeOf, seqParams, storeOptionsOf, tx, warn } from './util'

type StoreMode = StoreOptions['mode']

function programmerEmpty(ctx: CliContext): boolean {
  return ctx.api.getProgrammerValues().length === 0
}

function storeOpts(ast: CliAst, mode: StoreMode): StoreOptions {
  const so = storeOptionsOf(ast)
  const out: StoreOptions = { mode }
  if (so.filter) out.filter = so.filter
  return out
}

/** Store into a cue (number null = next) and say what happened */
function doStoreCue(ctx: CliContext, ast: CliAst, cuelistId: string, cueNumber: number | null, mode: StoreMode): CliResult {
  return mutate(ctx, ast, () => {
    const res = ctx.api.storeCue(cuelistId, cueNumber, storeOpts(ast, mode))
    if (!res) return fail(m(ctx, 'store.failed'))
    const cue = ctx.api.getCuelists().find(c => c.id === res.cuelistId)?.cues.find(c => c.id === res.cueId)
    const params = { cue: cue?.number ?? cueNumber ?? '', ...seqParams(ctx.api, res.cuelistId), mode: m(ctx, `store.choices.${mode}`) }
    return ok(m(ctx, res.existed ? 'store.cueUpdated' : 'store.cue', params))
  })
}

/** Store Cue n: ask when it exists and no mode was given (macros merge) */
function storeCueAsking(ctx: CliContext, ast: CliAst, cuelistId: string, cueNumber: number): CliResult {
  const { api } = ctx
  const given = storeOptionsOf(ast).mode
  const cl = api.getCuelists().find(c => c.id === cuelistId)
  const exists = !!cl?.cues.some(c => c.number === cueNumber)
  if (!exists || given) return doStoreCue(ctx, ast, cuelistId, cueNumber, given ?? 'merge')
  if (ctx.macro) return doStoreCue(ctx, ast, cuelistId, cueNumber, 'merge')
  const params = { cue: cueNumber, ...seqParams(api, cuelistId) }
  const choices = (['merge', 'overwrite', 'cueonly', 'cancel'] as const).map(id => ({ id, label: m(ctx, `store.choices.${id}`) }))
  let pending: Promise<CliResult>
  try {
    pending = Promise.resolve(api.ask(m(ctx, 'store.question', params), choices, 'merge')).then(
      choice => {
        if (!choice || choice === 'cancel') return { ok: false, level: 'info', message: m(ctx, 'store.cancelled') } as CliResult
        if (!['merge', 'overwrite', 'cueonly'].includes(choice)) return fail(m(ctx, 'store.cancelled'))
        return doStoreCue(ctx, ast, cuelistId, cueNumber, choice as StoreMode)
      },
      e => fail(m(ctx, 'failed', { error: e instanceof Error ? e.message : String(e) }))
    )
  } catch (e) {
    return fail(m(ctx, 'failed', { error: e instanceof Error ? e.message : String(e) }))
  }
  return { ok: true, level: 'info', message: m(ctx, 'store.asking', params), pending }
}

/** Sequence "Store" / "Store Cue n" targets: the selected one, else a new one (selected) */
function targetSequence(ctx: CliContext, ast: CliAst): string {
  const { api } = ctx
  const sel = api.getSelectedCuelist()
  if (sel && api.getCuelists().some(c => c.id === sel)) return sel
  return tx(ctx, ast.source, () => {
    const id = api.createCuelist()
    api.selectCuelist(id)
    return id
  })
}

function storeCueRef(ctx: CliContext, ast: CliAst, ref: CliObjectRef): CliResult {
  const { api } = ctx
  let { cuelist } = cueSequence(api, ref)
  if (!cuelist && ref.parent) {
    // Store Cue 1 Sequence 9: sequence 9 is created
    const num = ref.parent.ids[0]?.range.from
    if (!num || ref.parent.ids.length !== 1 || ref.parent.ids[0].range.to !== undefined || num.minor !== undefined) return notFound(ctx, [refText(ref.parent)])
    const id = tx(ctx, ast.source, () => api.createCuelist(undefined, num.major))
    cuelist = api.getCuelists().find(c => c.id === id) ?? null
    if (!cuelist) return fail(m(ctx, 'store.failed'))
  }
  const cuelistId = cuelist?.id ?? targetSequence(ctx, ast)
  const ids = ref.ids.filter(x => x.op === '+')
  if (ids.length === 1 && ids[0].range.to === undefined) return storeCueAsking(ctx, ast, cuelistId, cueNumberOf(ids[0].range.from))
  // Store Cue 1 Thru 5: every existing cue in the range (merge unless told otherwise)
  const cl = api.getCuelists().find(c => c.id === cuelistId)!
  const numbers: number[] = []
  for (const { range } of ids) {
    if (range.to === undefined) { numbers.push(cueNumberOf(range.from)); continue }
    const lo = cueNumberOf(range.from)
    const hi = range.to === 'end' ? Infinity : cueNumberOf(range.to)
    for (const c of cl.cues) if (c.number >= Math.min(lo, hi) && c.number <= Math.max(lo, hi)) numbers.push(c.number)
  }
  if (!numbers.length) return notFound(ctx, [refText(ref)])
  const mode = storeOptionsOf(ast).mode ?? 'merge'
  return mutate(ctx, ast, () => {
    for (const n of numbers) api.storeCue(cuelistId, n, storeOpts(ast, mode))
    return ok(m(ctx, 'store.cues', { count: numbers.length, ...seqParams(api, cuelistId) }))
  })
}

function storePresetRef(ctx: CliContext, ast: CliAst, ref: CliObjectRef, update: boolean): CliResult {
  const { api } = ctx
  const id = ref.ids[0]?.range.from
  if (!id) return fail(m(ctx, 'errors.expectedNumber'))
  const family = id.minor === undefined ? 0 : id.major
  const number = id.minor === undefined ? id.major : id.minor
  const type = presetTypeOfFamily(family)
  if (!type || number < 1) return notFound(ctx, [refText(ref)])
  const existing = lookupPresets(api, { kind: 'preset', ids: [{ op: '+', range: { from: { major: family, minor: number } } }] }).found[0]
  if (update && !existing) return notFound(ctx, [refText(ref)])
  const so = storeOptionsOf(ast)
  return mutate(ctx, ast, () => {
    const opts: Parameters<typeof api.storePreset>[2] = {}
    const scope = scopeOf(ast) ?? (update ? existing?.scope : undefined)
    if (scope) opts.scope = scope
    if (so.mode) opts.mode = so.mode
    else if (update) opts.mode = 'merge'
    if (ast.text) opts.name = ast.text
    const preset = api.storePreset(type, number, opts)
    if (!preset) return fail(m(ctx, 'store.failed'))
    return ok(m(ctx, update ? 'store.presetUpdated' : 'store.preset', { id: presetText(preset, api.getPresets()), name: preset.name }))
  })
}

const store: CliCommand = {
  keyword: 'store',
  helpKey: 'store',
  run: (ast, ctx) => mutate(ctx, ast, () => storeLine(ast, ctx)),
  preview: describeAst
}

function storeLine(ast: CliAst, ctx: CliContext): CliResult {
    const { api } = ctx
    const ref = firstRef(ast)
    const needsValues = !ref || ref.kind !== 'group'
    if (needsValues && programmerEmpty(ctx)) return warn(m(ctx, 'store.programmerEmpty'))
    const mode = storeOptionsOf(ast).mode ?? 'merge'
    if (!ref) return doStoreCue(ctx, ast, targetSequence(ctx, ast), null, mode)
    switch (ref.kind) {
      case 'cue':
        return storeCueRef(ctx, ast, ref)
      case 'sequence': {
        const r = lookupSequences(api, ref)
        if (r.found[0]) return doStoreCue(ctx, ast, r.found[0].id, null, mode)
        const num = ref.ids[0].range.from
        if (num.minor !== undefined || ref.ids[0].range.to !== undefined) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          const id = api.createCuelist(ast.text || undefined, num.major)
          api.selectCuelist(id)
          return doStoreCue(ctx, ast, id, null, mode)
        })
      }
      case 'preset':
        return storePresetRef(ctx, ast, ref, false)
      case 'group': {
        const sel = api.getSelection()
        if (!sel.length) return warn(m(ctx, 'msg.noSelection'))
        const num = ref.ids[0].range.from
        if (num.minor !== undefined || ref.ids[0].range.to !== undefined || num.major < 1) return notFound(ctx, [refText(ref)])
        const so = storeOptionsOf(ast)
        const gmode = so.mode === 'overwrite' || so.mode === 'remove' ? so.mode : 'merge'
        return mutate(ctx, ast, () => {
          const opts: { name?: string; mode: 'merge' | 'overwrite' | 'remove' } = { mode: gmode }
          if (ast.text) opts.name = ast.text
          api.storeGroup(num.major, sel, opts)
          const g = lookupGroups(api, { kind: 'group', ids: [{ op: '+', range: { from: { major: num.major } } }] }).found[0]
          return ok(m(ctx, 'store.group', { n: num.major, name: g?.name ?? '', count: g?.fixtureIds.length ?? sel.length }))
        })
      }
      case 'executor': {
        const r = lookupExecutors(api, ref)
        const e = r.found[0]
        if (!e) return notFound(ctx, r.missing)
        const cell = executorCell(api, e)
        if (cell && cell.kind !== 'cuelist') return fail(m(ctx, 'store.cannot', { object: `Executor ${executorLabel(e)}` }))
        if (cell) return doStoreCue(ctx, ast, cell.id, null, mode)
        return mutate(ctx, ast, () => {
          const id = api.createCuelist(ast.text || undefined)
          api.assignExecutor(e, { kind: 'cuelist', id })
          const res = doStoreCue(ctx, ast, id, null, mode)
          return res.ok ? ok(m(ctx, 'store.executor', { ref: executorLabel(e), ...seqParams(api, id) })) : res
        })
      }
      default:
        return fail(m(ctx, 'store.cannot', { object: refText(ref) }))
    }
}

const update: CliCommand = {
  keyword: 'update',
  helpKey: 'update',
  run(ast, ctx) {
    const { api } = ctx
    if (programmerEmpty(ctx)) return warn(m(ctx, 'store.programmerEmpty'))
    const ref = firstRef(ast)
    if (!ref) {
      return mutate(ctx, ast, () => {
        const so = storeOptionsOf(ast)
        const opts: Partial<StoreOptions> = {}
        if (so.mode) opts.mode = so.mode
        if (so.filter) opts.filter = so.filter
        const cues = api.updateCuesFromProgrammer(opts)
        const presets = api.updatePresetsFromProgrammer()
        if (cues === 0 && presets === 0) return warn(m(ctx, 'store.nothingToUpdate'))
        return ok(m(ctx, 'store.updated', { cues, presets }))
      })
    }
    if (ref.kind === 'preset') return storePresetRef(ctx, ast, ref, true)
    if (ref.kind === 'cue') {
      const { cuelist, missing } = cueSequence(api, ref)
      if (!cuelist) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
      const id = ref.ids[0].range.from
      const n = cueNumberOf(id)
      if (!cuelist.cues.some(c => c.number === n)) return notFound(ctx, [refText(ref)])
      return doStoreCue(ctx, ast, cuelist.id, n, storeOptionsOf(ast).mode ?? 'merge')
    }
    return fail(m(ctx, 'msg.unsupported', { action: 'Update', object: refText(ref) }))
  },
  preview: describeAst
}

export const storeCommands: CliCommand[] = [store, update]
