// ============================================================
// PhotonBoard — Command line: object editing
//
//   Delete Cue 3 [Sequence 2] · Delete Sequence 4 · Delete Preset 4.2
//   Delete Group 3 · Delete Macro 2 · Delete Executor 1.5 (empties the cell)
//   Copy Cue 2 At 5 · Copy Preset 4.1 At 4.5 · Copy Group 1 At 6 · Copy Macro 1 At 4
//   Copy Sequence 1 At 9 · Copy Executor 1.1 At 1.5
//   Move Cue 2 At 2.5 · Move Preset 4.1 At 4.8 · Move Macro 1 At 7 · Move Executor 1.1 At 2.1
//   Label Group 3 "Wash" (several objects: "Wash 1", "Wash 2"…)
//   Assign Sequence 3 At Executor 2.5 [/button=flash]
//   Assign Executor 1.5 /button=go
// Every change is ONE undo step ("Oops"); Delete never asks (Oops is the safety net).
// ============================================================

import type { ExecutorButtonFn, PresetType } from '@shared/types'
import { PRESET_FAMILY_NUMBER } from '@shared/types'
import type { ExecutorTarget } from '@renderer/lib/pro/contracts'
import type { CliAst, CliObjectRef } from '../ast'
import type { CliCommand, CliContext, CliResult } from '../registry'
import { BUTTON_FUNCTIONS } from '../parser'
import {
  cueNumberOf, cueSequence, lookupChases, lookupCues, lookupEffects, lookupExecutors, lookupGroups, lookupMacros, lookupPresets,
  lookupSequences, lookupSpeedMasters, numberOf, refText
} from '../objects'
import { describeAst } from '../preview'
import { executorCell, executorLabel, fail, hasOption, m, mutate, notFound, ok, optionValue, warn } from './util'

function unsupported(ctx: CliContext, ast: CliAst, ref: CliObjectRef): CliResult {
  return fail(m(ctx, 'msg.unsupported', { action: ast.action ?? '', object: refText(ref) }))
}

function needObject(ctx: CliContext, ast: CliAst): CliResult {
  return warn(m(ctx, 'msg.needObject', { action: ast.action ?? '' }))
}

/** Target number of Copy / Move: `At 5` / `At Cue 5` (dotted ids: their second part for presets) */
function targetNumbers(ref: CliObjectRef, count: number, kind: CliObjectRef['kind']): number[] | null {
  const first = ref.ids[0]?.range.from
  if (!first) return null
  const start = kind === 'cue' ? cueNumberOf(first) : kind === 'preset' && first.minor !== undefined ? first.minor : first.major
  return Array.from({ length: count }, (_, i) => start + i)
}

// ---------------------------------------------------------------- Delete

const del: CliCommand = {
  keyword: 'delete',
  helpKey: 'delete',
  run(ast, ctx) {
    const { api } = ctx
    const ref = ast.objects?.items[0]?.object
    if (!ref) return needObject(ctx, ast)
    switch (ref.kind) {
      case 'cue': {
        const { cuelist, missing } = cueSequence(api, ref)
        if (!cuelist) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
        const r = lookupCues(cuelist, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          for (const c of r.found) api.deleteCue(cuelist.id, c.id)
          return ok(m(ctx, 'msg.deleted', { count: r.found.length, object: refText(ref) }))
        })
      }
      case 'sequence': {
        const r = lookupSequences(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          for (const c of r.found) api.deleteCuelist(c.id)
          return ok(m(ctx, 'msg.deleted', { count: r.found.length, object: refText(ref) }))
        })
      }
      case 'preset': {
        const r = lookupPresets(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          for (const p of r.found) api.deletePreset(p.id)
          return ok(m(ctx, 'msg.deleted', { count: r.found.length, object: refText(ref) }))
        })
      }
      case 'group': {
        const r = lookupGroups(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          for (const g of r.found) api.deleteGroup(g.id)
          return ok(m(ctx, 'msg.deleted', { count: r.found.length, object: refText(ref) }))
        })
      }
      case 'macro': {
        const r = lookupMacros(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          for (const x of r.found) { api.stopMacro(x.id); api.deleteMacro(x.id) }
          return ok(m(ctx, 'msg.deleted', { count: r.found.length, object: refText(ref) }))
        })
      }
      case 'executor': {
        const r = lookupExecutors(api, ref)
        const filled = r.found.filter(e => executorCell(api, e))
        if (!filled.length) return r.found.length ? warn(m(ctx, 'msg.executorEmpty', { ref: executorLabel(r.found[0]) })) : notFound(ctx, r.missing)
        return mutate(ctx, ast, () => {
          for (const e of filled) api.assignExecutor(e, null)
          return ok(m(ctx, 'msg.deleted', { count: filled.length, object: refText(ref) }))
        })
      }
      default:
        return unsupported(ctx, ast, ref)
    }
  },
  preview: describeAst
}

// ---------------------------------------------------------------- Copy / Move

function copyOrMove(ast: CliAst, ctx: CliContext, move: boolean): CliResult {
  const { api } = ctx
  const ref = ast.objects?.items[0]?.object
  const target = ast.target
  if (!ref) return needObject(ctx, ast)
  if (!target) return warn(m(ctx, 'errors.expectedTarget'))
  if (target.kind !== ref.kind && !target.implicit && !(ref.kind === 'cue' && target.kind === 'cue')) return unsupported(ctx, ast, target)
  const overwrite = hasOption(ast, 'overwrite') || hasOption(ast, 'merge')
  const done = (count: number) => ok(m(ctx, move ? 'msg.moved' : 'msg.copied', { count, object: refText(ref), target: refText(target) }))

  switch (ref.kind) {
    case 'cue': {
      const { cuelist, missing } = cueSequence(api, ref)
      if (!cuelist) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
      const r = lookupCues(cuelist, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      let toList = cuelist
      if (target.parent) {
        const t = lookupSequences(api, target.parent).found[0]
        if (!t) return notFound(ctx, [refText(target.parent)])
        toList = t
      }
      if (move && toList.id !== cuelist.id) return unsupported(ctx, ast, target)
      const nums = targetNumbers(target, r.found.length, 'cue')!
      const clash = nums.find(n => toList.cues.some(c => c.number === n && !r.found.includes(c)))
      if (clash !== undefined && !overwrite) return warn(m(ctx, 'msg.targetExists', { object: `Cue ${clash}` }))
      return mutate(ctx, ast, () => {
        r.found.forEach((c, i) => {
          if (move) api.moveCue(cuelist.id, c.id, nums[i])
          else api.copyCue(cuelist.id, c.id, nums[i], toList.id === cuelist.id ? undefined : toList.id)
        })
        return done(r.found.length)
      })
    }
    case 'preset': {
      const r = lookupPresets(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      const tFirst = target.ids[0]?.range.from
      const families = new Set<PresetType>(r.found.map(p => p.type))
      if (tFirst?.minor !== undefined && [...families].some(t => PRESET_FAMILY_NUMBER[t] !== tFirst.major)) return warn(m(ctx, 'msg.familyMismatch'))
      const nums = targetNumbers(target, r.found.length, 'preset')!
      const all = api.getPresets()
      const clash = r.found.findIndex((p, i) => all.some(x => x !== p && x.type === p.type && (x.number ?? -1) === nums[i]))
      if (clash >= 0 && !overwrite) return warn(m(ctx, 'msg.targetExists', { object: `Preset ${PRESET_FAMILY_NUMBER[r.found[clash].type]}.${nums[clash]}` }))
      return mutate(ctx, ast, () => {
        r.found.forEach((p, i) => (move ? api.movePreset(p.id, nums[i]) : api.copyPreset(p.id, nums[i])))
        return done(r.found.length)
      })
    }
    case 'group': {
      if (move) return unsupported(ctx, ast, ref)
      const r = lookupGroups(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      const nums = targetNumbers(target, r.found.length, 'group')!
      const groups = api.getGroups()
      const clash = nums.find(n => groups.some(g => numberOf(g, groups) === n))
      if (clash !== undefined && !overwrite) return warn(m(ctx, 'msg.targetExists', { object: `Group ${clash}` }))
      return mutate(ctx, ast, () => {
        r.found.forEach((g, i) => api.storeGroup(nums[i], [...g.fixtureIds], { name: g.name, mode: 'overwrite' }))
        return done(r.found.length)
      })
    }
    case 'macro': {
      const r = lookupMacros(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      const nums = targetNumbers(target, r.found.length, 'macro')!
      const macros = api.getMacros()
      const clash = nums.find(n => macros.some(x => x.number === n && !r.found.includes(x)))
      if (clash !== undefined && !(overwrite && !move)) return warn(m(ctx, 'msg.targetExists', { object: `Macro ${clash}` }))
      return mutate(ctx, ast, () => {
        r.found.forEach((x, i) => {
          if (move) api.updateMacro(x.id, { number: nums[i] })
          else api.storeMacro(nums[i], x.lines.map(l => ({ ...l })), x.name)
        })
        return done(r.found.length)
      })
    }
    case 'sequence': {
      if (move) return unsupported(ctx, ast, ref)
      const r = lookupSequences(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      const nums = targetNumbers(target, r.found.length, 'sequence')!
      const lists = api.getCuelists()
      const clash = nums.find(n => lists.some(c => numberOf(c, lists) === n))
      if (clash !== undefined) return warn(m(ctx, 'msg.targetExists', { object: `Sequence ${clash}` }))
      return mutate(ctx, ast, () => {
        r.found.forEach((cl, i) => {
          const id = api.createCuelist(cl.name, nums[i])
          for (const c of cl.cues) api.copyCue(cl.id, c.id, c.number, id)
        })
        return done(r.found.length)
      })
    }
    case 'executor': {
      const r = lookupExecutors(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      const t = lookupExecutors(api, target)
      if (!t.found.length) return notFound(ctx, t.missing)
      const dest = t.found[0]
      const cells = r.found.map(e => executorCell(api, e))
      if (cells.every(c => !c)) return warn(m(ctx, 'msg.executorEmpty', { ref: executorLabel(r.found[0]) }))
      return mutate(ctx, ast, () => {
        // Consecutive slots from the target, column-major
        const startSlot = dest.col * 4 + dest.row
        r.found.forEach((e, i) => {
          const cell = cells[i]
          const slot = startSlot + i
          if (slot >= 32) return
          const to = { page: dest.page, col: Math.floor(slot / 4), row: slot % 4 }
          if (move) api.assignExecutor(e, null)
          if (cell) {
            const opts: { button?: ExecutorButtonFn } = {}
            if (cell.button) opts.button = cell.button
            api.assignExecutor(to, { kind: cell.kind, id: cell.id }, opts)
          }
        })
        return done(r.found.length)
      })
    }
    default:
      return unsupported(ctx, ast, ref)
  }
}

const copy: CliCommand = { keyword: 'copy', helpKey: 'copy', run: (ast, ctx) => copyOrMove(ast, ctx, false), preview: describeAst }
const move: CliCommand = { keyword: 'move', helpKey: 'move', run: (ast, ctx) => copyOrMove(ast, ctx, true), preview: describeAst }

// ---------------------------------------------------------------- Label

const label: CliCommand = {
  keyword: 'label',
  helpKey: 'label',
  run(ast, ctx) {
    const { api } = ctx
    const ref = ast.objects?.items[0]?.object
    if (!ref) return needObject(ctx, ast)
    const text = (ast.text ?? '').trim()
    if (!text) return warn(m(ctx, 'errors.expectedText'))
    const nameOf = (i: number, count: number) => (count > 1 ? `${text} ${i + 1}` : text)
    const done = (count: number) => ok(m(ctx, 'msg.labelled', { count, object: refText(ref), name: text }))
    switch (ref.kind) {
      case 'group': {
        const r = lookupGroups(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => { r.found.forEach((g, i) => api.renameGroup(g.id, nameOf(i, r.found.length))); return done(r.found.length) })
      }
      case 'sequence': {
        const r = lookupSequences(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => { r.found.forEach((c, i) => api.renameCuelist(c.id, nameOf(i, r.found.length))); return done(r.found.length) })
      }
      case 'cue': {
        const { cuelist, missing } = cueSequence(api, ref)
        if (!cuelist) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
        const r = lookupCues(cuelist, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => { r.found.forEach((c, i) => api.updateCue(cuelist.id, c.id, { name: nameOf(i, r.found.length) })); return done(r.found.length) })
      }
      case 'preset': {
        const r = lookupPresets(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => { r.found.forEach((p, i) => api.updatePreset(p.id, { name: nameOf(i, r.found.length) })); return done(r.found.length) })
      }
      case 'macro': {
        const r = lookupMacros(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        return mutate(ctx, ast, () => { r.found.forEach((x, i) => api.updateMacro(x.id, { name: nameOf(i, r.found.length) })); return done(r.found.length) })
      }
      default:
        return unsupported(ctx, ast, ref)
    }
  },
  preview: describeAst
}

// ---------------------------------------------------------------- Assign

function buttonOf(ast: CliAst): ExecutorButtonFn | undefined {
  const v = optionValue(ast, 'button')?.toLowerCase()
  return v ? BUTTON_FUNCTIONS.find(b => b.toLowerCase() === v) : undefined
}

const assign: CliCommand = {
  keyword: 'assign',
  helpKey: 'assign',
  run(ast, ctx) {
    const { api } = ctx
    const ref = ast.objects?.items[0]?.object
    if (!ref) return needObject(ctx, ast)
    const button = buttonOf(ast)
    // Assign Executor 1.5 /button=go: change the button of a filled cell
    if (ref.kind === 'executor' && !ast.target) {
      const r = lookupExecutors(api, ref)
      if (!r.found.length) return notFound(ctx, r.missing)
      if (!button) return warn(m(ctx, 'errors.expectedTarget'))
      const filled = r.found.filter(e => executorCell(api, e))
      if (!filled.length) return warn(m(ctx, 'msg.executorEmpty', { ref: executorLabel(r.found[0]) }))
      return mutate(ctx, ast, () => {
        for (const e of filled) {
          const cell = executorCell(api, e)!
          api.assignExecutor(e, { kind: cell.kind, id: cell.id }, { button })
        }
        return ok(m(ctx, 'msg.buttonSet', { ref: executorLabel(filled[0]), fn: button }))
      })
    }
    if (!ast.target) return warn(m(ctx, 'errors.expectedTarget'))
    if (ast.target.kind !== 'executor') return unsupported(ctx, ast, ast.target)
    let source: ExecutorTarget | null = null
    let name = ''
    const one = <T extends { id: string; name: string }>(r: { found: T[]; missing: string[] }, kind: ExecutorTarget['kind']) => {
      if (r.found[0]) { source = { kind, id: r.found[0].id }; name = r.found[0].name }
      return r
    }
    let r: { found: unknown[]; missing: string[] }
    switch (ref.kind) {
      case 'sequence': r = one(lookupSequences(api, ref), 'cuelist'); break
      case 'chase': r = one(lookupChases(api, ref), 'chase'); break
      case 'effect': r = one(lookupEffects(api, ref), 'effect'); break
      case 'macro': r = one(lookupMacros(api, ref), 'macro'); break
      case 'group': r = one(lookupGroups(api, ref), 'group'); break
      case 'speed': r = one(lookupSpeedMasters(api, ref), 'speed'); break
      default: return unsupported(ctx, ast, ref)
    }
    if (!source) return notFound(ctx, r.missing)
    const t = lookupExecutors(api, ast.target)
    if (!t.found.length) return notFound(ctx, t.missing)
    const src: ExecutorTarget = source
    return mutate(ctx, ast, () => {
      for (const e of t.found) api.assignExecutor(e, src, button ? { button } : undefined)
      return ok(m(ctx, 'msg.assigned', { object: refText(ref), name, ref: executorLabel(t.found[0]) }))
    })
  },
  preview: describeAst
}

export const editCommands: CliCommand[] = [del, copy, move, label, assign]

