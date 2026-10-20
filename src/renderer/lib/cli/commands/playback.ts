// ============================================================
// PhotonBoard — Command line: playback
//
//   Go [obj] · Go- [obj] · Goto Cue n [Sequence s] · Off [obj] · Pause [obj]
//   Release [obj] · Stop [n] (legacy) · Page n|+|- · Macro n
//   Blackout [On|Off] · Oops (undo) · Redo · Edit Sequence n
//
// Bare numbers are sequences (Go 3 = Sequence 3) except for Goto
// (cue) and Page / Macro. Without an object, GO / Back / Pause act on
// the selected sequence (selected executor, else the Scenes view
// selection), else the first sequence — the old `Go`.
// ============================================================

import type { CliAst, CliObjectKind, CliObjectRef } from '../ast'
import type { CliCommand, CliContext, CliResult } from '../registry'
import type { ExecutorButtonFn } from '@shared/types'
import { MAX_EXECUTOR_PAGES } from '@shared/show-format'
import {
  cueSequence, lookupChases, lookupCues, lookupEffects, lookupExecutors, lookupMacros, lookupPages, lookupSequences,
  numberOf, refText, resolveFixtureExpr
} from '../objects'
import { describeAst } from '../preview'
import { applyValue } from './selection'
import { defaultSequence, executorLabel, executorTargetName, fail, m, notFound, ok, seqParams, warn } from './util'

type Handler = (ref: CliObjectRef) => CliResult

/** Dispatch on the kind of the line's object */
function dispatch(ctx: CliContext, ast: CliAst, handlers: Partial<Record<CliObjectKind, Handler>>, none: () => CliResult): CliResult {
  const items = ast.objects?.items ?? []
  if (!items.length) return none()
  const ref = items[0].object
  const h = handlers[ref.kind]
  if (!h) return fail(m(ctx, 'msg.unsupported', { action: ast.action ?? '', object: refText(ref) }))
  return h(ref)
}

function sequences(ctx: CliContext, ref: CliObjectRef, fn: (id: string) => void, msg: string): CliResult {
  const r = lookupSequences(ctx.api, ref)
  if (!r.found.length) return notFound(ctx, r.missing)
  for (const cl of r.found) fn(cl.id)
  return ok(m(ctx, msg, seqParams(ctx.api, r.found[0].id)))
}

function executors(ctx: CliContext, ref: CliObjectRef, fn: ExecutorButtonFn): CliResult {
  const r = lookupExecutors(ctx.api, ref)
  if (!r.found.length) return notFound(ctx, r.missing)
  for (const e of r.found) {
    ctx.api.executorPress(e, 'down', { fn })
    ctx.api.executorPress(e, 'up', { fn })
  }
  return ok(m(ctx, 'msg.executorPressed', { ref: executorLabel(r.found[0]), name: executorTargetName(ctx.api, r.found[0]) }))
}

function onDefault(ctx: CliContext, fn: (id: string) => void, msg: string): CliResult {
  const id = defaultSequence(ctx.api)
  if (!id) return warn(m(ctx, 'msg.noScenes'))
  fn(id)
  return ok(m(ctx, msg, seqParams(ctx.api, id)))
}

function gotoCue(ctx: CliContext, ref: CliObjectRef): CliResult {
  const { cuelist, missing } = cueSequence(ctx.api, ref)
  const target = cuelist ?? (missing ? null : ctx.api.getCuelists().find(c => c.id === defaultSequence(ctx.api)) ?? null)
  if (!target) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
  const r = lookupCues(target, ref)
  if (!r.found.length) return notFound(ctx, r.missing)
  ctx.api.goto(target.id, r.found[0].number)
  return ok(m(ctx, 'msg.goto', { cue: r.found[0].number, ...seqParams(ctx.api, target.id) }))
}

function macros(ctx: CliContext, ref: CliObjectRef, run: boolean): CliResult {
  const r = lookupMacros(ctx.api, ref)
  if (!r.found.length) return notFound(ctx, r.missing)
  if (run && ctx.macro && r.found.some(x => x.id === ctx.macro)) return warn(m(ctx, 'msg.macroSelf'))
  for (const mac of r.found) (run ? ctx.api.runMacro : ctx.api.stopMacro).call(ctx.api, mac.id)
  return ok(m(ctx, run ? 'msg.macroRun' : 'msg.macroStopped', { n: numberOf(r.found[0], ctx.api.getMacros()), name: r.found[0].name }))
}

function chases(ctx: CliContext, ref: CliObjectRef, on: boolean): CliResult {
  const r = lookupChases(ctx.api, ref)
  if (!r.found.length) return notFound(ctx, r.missing)
  for (const c of r.found) ctx.api.toggleChase(c.id, on)
  return ok(m(ctx, on ? 'msg.chaseOn' : 'msg.chaseOff', { name: r.found[0].name }))
}

function effects(ctx: CliContext, ref: CliObjectRef, on: boolean): CliResult {
  const r = lookupEffects(ctx.api, ref)
  if (!r.found.length) return notFound(ctx, r.missing)
  for (const e of r.found) ctx.api.setEffectRunning(e.id, on)
  return ok(m(ctx, on ? 'msg.effectOn' : 'msg.effectOff', { name: r.found[0].name }))
}

function releaseFixtures(ctx: CliContext, ast: CliAst): CliResult {
  const sel = resolveFixtureExpr(ctx.api, ast.objects!)
  if (!sel.ids.length) return sel.missing.length ? notFound(ctx, sel.missing) : warn(m(ctx, 'msg.noMatchingFixtures'))
  ctx.api.releaseFixtures(sel.ids)
  return ok(m(ctx, 'msg.releasedFixtures', { count: sel.ids.length }))
}

const go: CliCommand = {
  keyword: 'go',
  helpKey: 'go',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      sequence: ref => sequences(ctx, ref, id => api.go(id), 'msg.go'),
      executor: ref => executors(ctx, ref, 'go'),
      cue: ref => gotoCue(ctx, ref),
      macro: ref => macros(ctx, ref, true),
      chase: ref => chases(ctx, ref, true),
      effect: ref => effects(ctx, ref, true)
    }, () => onDefault(ctx, id => api.go(id), 'msg.go'))
  },
  preview: describeAst
}

const goBack: CliCommand = {
  keyword: 'go-',
  helpKey: 'goBack',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      sequence: ref => sequences(ctx, ref, id => api.goBack(id), 'msg.goBack'),
      executor: ref => executors(ctx, ref, 'goBack')
    }, () => onDefault(ctx, id => api.goBack(id), 'msg.goBack'))
  },
  preview: describeAst
}

const goto: CliCommand = {
  keyword: 'goto',
  helpKey: 'goto',
  run(ast, ctx) {
    return dispatch(ctx, ast, { cue: ref => gotoCue(ctx, ref) }, () => warn(m(ctx, 'msg.needObject', { action: 'Goto' })))
  },
  preview: describeAst
}

const off: CliCommand = {
  keyword: 'off',
  helpKey: 'off',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      fixture: () => releaseFixtures(ctx, ast),
      group: () => releaseFixtures(ctx, ast),
      sequence: ref => sequences(ctx, ref, id => api.off(id), 'msg.off'),
      executor: ref => executors(ctx, ref, 'off'),
      macro: ref => macros(ctx, ref, false),
      chase: ref => chases(ctx, ref, false),
      effect: ref => effects(ctx, ref, false)
    }, () => {
      // Legacy: "Off" alone = selected fixtures at zero
      const sel = api.getSelection()
      if (!sel.length) return warn(m(ctx, 'msg.noSelection'))
      return applyValue(ctx, ast, sel, { value: { kind: 'level', from: 0 } })
    })
  },
  preview: describeAst
}

const pause: CliCommand = {
  keyword: 'pause',
  helpKey: 'pause',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      sequence: ref => sequences(ctx, ref, id => api.pause(id), 'msg.pause'),
      executor: ref => executors(ctx, ref, 'pause')
    }, () => onDefault(ctx, id => api.pause(id), 'msg.pause'))
  },
  preview: describeAst
}

const release: CliCommand = {
  keyword: 'release',
  helpKey: 'release',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      fixture: () => releaseFixtures(ctx, ast),
      group: () => releaseFixtures(ctx, ast),
      sequence: ref => sequences(ctx, ref, id => api.off(id), 'msg.off'),
      executor: ref => executors(ctx, ref, 'off'),
      chase: ref => chases(ctx, ref, false),
      effect: ref => effects(ctx, ref, false)
    }, () => {
      api.releaseAll()
      return ok(m(ctx, 'msg.releasedAll'))
    })
  },
  preview: describeAst
}

/** Legacy `Stop [n]`: stop scene n, or every playing scene */
const stop: CliCommand = {
  keyword: 'stop',
  helpKey: 'stop',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      sequence: ref => sequences(ctx, ref, id => api.off(id), 'msg.off'),
      executor: ref => executors(ctx, ref, 'off')
    }, () => {
      for (const cl of api.getCuelists()) if (cl.isPlaying) api.off(cl.id)
      return ok(m(ctx, 'msg.allStopped'))
    })
  },
  preview: describeAst
}

const page: CliCommand = {
  keyword: 'page',
  helpKey: 'page',
  run(ast, ctx) {
    const { api } = ctx
    if (ast.text === '+' || ast.text === '-') {
      const cur = api.getCurrentExecutorPage()
      const max = Math.max(1, Math.min(MAX_EXECUTOR_PAGES, api.getExecutorPages().length)) - 1
      const next = Math.max(0, Math.min(max, cur + (ast.text === '+' ? 1 : -1)))
      api.setExecutorPage(next)
      return ok(m(ctx, 'msg.page', { n: next + 1 }))
    }
    return dispatch(ctx, ast, {
      page: ref => {
        const r = lookupPages(ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        api.setExecutorPage(r.found[0])
        return ok(m(ctx, 'msg.page', { n: r.found[0] + 1 }))
      }
    }, () => ok(m(ctx, 'msg.page', { n: api.getCurrentExecutorPage() + 1 })))
  },
  preview: describeAst
}

const macro: CliCommand = {
  keyword: 'macro',
  helpKey: 'macro',
  run(ast, ctx) {
    return dispatch(ctx, ast, { macro: ref => macros(ctx, ref, true) }, () => warn(m(ctx, 'msg.needObject', { action: 'Macro' })))
  },
  preview: describeAst
}

const blackout: CliCommand = {
  keyword: 'blackout',
  helpKey: 'blackout',
  run(ast, ctx) {
    if (ast.text === 'on' || ast.text === 'off') {
      ctx.api.setBlackout(ast.text === 'on')
      return ok(m(ctx, ast.text === 'on' ? 'msg.blackoutOn' : 'msg.blackoutOff'))
    }
    ctx.api.setBlackout()
    return ok(m(ctx, 'msg.blackoutToggled'))
  }
}

const oops: CliCommand = {
  keyword: 'oops',
  helpKey: 'oops',
  run(_ast, ctx) {
    const label = ctx.api.undo()
    return label === null ? warn(m(ctx, 'msg.nothingToUndo')) : ok(m(ctx, 'msg.undone', { label }))
  }
}

const redo: CliCommand = {
  keyword: 'redo',
  helpKey: 'redo',
  run(_ast, ctx) {
    const label = ctx.api.redo()
    return label === null ? warn(m(ctx, 'msg.nothingToRedo')) : ok(m(ctx, 'msg.redone', { label }))
  }
}

/** Edit: open the object where the UI shows it (selects the sequence / executor) */
const edit: CliCommand = {
  keyword: 'edit',
  helpKey: 'edit',
  run(ast, ctx) {
    const { api } = ctx
    return dispatch(ctx, ast, {
      sequence: ref => sequences(ctx, ref, id => api.selectCuelist(id), 'msg.sequenceSelected'),
      cue: ref => {
        const { cuelist, missing } = cueSequence(api, ref)
        if (!cuelist) return missing ? notFound(ctx, [missing]) : warn(m(ctx, 'msg.noSequence'))
        api.selectCuelist(cuelist.id)
        return ok(m(ctx, 'msg.sequenceSelected', seqParams(api, cuelist.id)))
      },
      executor: ref => {
        const r = lookupExecutors(api, ref)
        if (!r.found.length) return notFound(ctx, r.missing)
        api.selectExecutor(r.found[0])
        return ok(m(ctx, 'msg.executorSelected', { ref: executorLabel(r.found[0]), name: executorTargetName(api, r.found[0]) }))
      }
    }, () => warn(m(ctx, 'msg.needObject', { action: 'Edit' })))
  },
  preview: describeAst
}

export const playbackCommands: CliCommand[] = [go, goBack, goto, off, pause, release, stop, page, macro, blackout, oops, redo, edit]
