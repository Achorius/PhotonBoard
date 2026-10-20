// ============================================================
// PhotonBoard — Command line: programmer & selection tools
//
//   Clear (selection → values → all) · ClearAll · ClearSelection
//   Highlight [On|Off] [fixtures] · Blind [On|Off]
//   Park [fixtures] [At v] · Unpark [fixtures]
//   Fade n · Delay n (programmer time; "Fade Off")
//   Next · Prev · All · Set (keep the active fixtures) · Align < > <> ><
// ============================================================

import type { CueChannelValue } from '@shared/types'
import type { AlignMode } from '@renderer/lib/pro/contracts'
import type { CliAst } from '../ast'
import type { CliCommand, CliContext, CliResult } from '../registry'
import { fixtureName, resolveFixtureExpr } from '../objects'
import { fixtureModel, intensityChannel, toDmx } from '../values'
import { describeAst } from '../preview'
import { hasOption, m, mutate, notFound, ok, warn } from './util'

/** Fixtures named on the line, else the selection (`all` = every patched fixture as last resort) */
function targets(ctx: CliContext, ast: CliAst, fallbackAll = false): { ids: string[]; error?: CliResult } {
  const { api } = ctx
  if (ast.objects) {
    const sel = resolveFixtureExpr(api, ast.objects)
    if (sel.others.length) return { ids: [], error: warn(m(ctx, 'msg.unsupported', { action: ast.action ?? '', object: sel.others[0].kind })) }
    if (!sel.ids.length) return { ids: [], error: sel.missing.length ? notFound(ctx, sel.missing) : warn(m(ctx, 'msg.noMatchingFixtures')) }
    return { ids: sel.ids }
  }
  const sel = api.getSelection()
  if (sel.length || !fallbackAll) return { ids: sel }
  return { ids: api.getPatch().map(p => p.id) }
}

const clear: CliCommand = {
  keyword: 'clear',
  helpKey: 'clear',
  run(_ast, ctx) {
    const stage = ctx.api.clear()
    return ok(m(ctx, `msg.cleared.${stage}`))
  }
}

const clearAll: CliCommand = {
  keyword: 'clearall',
  helpKey: 'clearAll',
  run(_ast, ctx) {
    ctx.api.clear('all')
    return ok(m(ctx, 'msg.cleared.all'))
  }
}

const clearSelection: CliCommand = {
  keyword: 'clearselection',
  helpKey: 'clearSelection',
  run(_ast, ctx) {
    ctx.api.clear('selection')
    return ok(m(ctx, 'msg.cleared.selection'))
  }
}

function onOff(ast: CliAst, current: boolean): boolean {
  if (ast.text === 'on') return true
  if (ast.text === 'off') return false
  return !current
}

const highlight: CliCommand = {
  keyword: 'highlight',
  helpKey: 'highlight',
  run(ast, ctx) {
    const { api } = ctx
    if (ast.objects) {
      const t = targets(ctx, ast)
      if (t.error) return t.error
      api.setSelection(t.ids)
      api.setHighlight(ast.text !== 'off')
    } else api.setHighlight(onOff(ast, api.isHighlight()))
    return ok(m(ctx, api.isHighlight() ? 'msg.highlightOn' : 'msg.highlightOff'))
  },
  preview: describeAst
}

const blind: CliCommand = {
  keyword: 'blind',
  helpKey: 'blind',
  run(ast, ctx) {
    ctx.api.setBlind(onOff(ast, ctx.api.isBlind()))
    return ok(m(ctx, ctx.api.isBlind() ? 'msg.blindOn' : 'msg.blindOff'))
  }
}

const park: CliCommand = {
  keyword: 'park',
  helpKey: 'park',
  run(ast, ctx) {
    const { api } = ctx
    const t = targets(ctx, ast)
    if (t.error) return t.error
    if (!t.ids.length) return warn(m(ctx, 'msg.noSelection'))
    let values: CueChannelValue[]
    if (ast.value && ast.value.value.kind === 'level') {
      const model = fixtureModel(api)
      const v = toDmx(ast.value.value.from, hasOption(ast, 'dmx'))
      values = []
      for (const id of t.ids) {
        const ch = intensityChannel(model, id)
        if (ch) values.push({ fixtureId: id, channelName: ch, value: v })
      }
    } else {
      values = api.getProgrammerValues({ fixtureIds: t.ids }).map(({ fixtureId, channelName, value }) => ({ fixtureId, channelName, value }))
    }
    if (!values.length) return warn(m(ctx, 'msg.nothingToPark'))
    return mutate(ctx, ast, () => {
      api.park(values)
      return ok(m(ctx, 'msg.parked', { count: values.length }))
    })
  },
  preview: describeAst
}

const unpark: CliCommand = {
  keyword: 'unpark',
  helpKey: 'unpark',
  run(ast, ctx) {
    const t = targets(ctx, ast, true)
    if (t.error) return t.error
    return mutate(ctx, ast, () => {
      ctx.api.unpark(t.ids)
      return ok(m(ctx, 'msg.unparked', { count: t.ids.length }))
    })
  },
  preview: describeAst
}

function progTime(which: 'fade' | 'delay'): CliCommand {
  return {
    keyword: which,
    helpKey: which,
    run(ast, ctx) {
      const { api } = ctx
      const cur = api.getProgTime() ?? { fade: 0, delay: 0 }
      const amount = Math.max(0, Math.min(3600, ast.amount ?? 0))
      const next = { ...cur, [which]: amount }
      api.setProgTime(next.fade === 0 && next.delay === 0 ? null : next)
      const t = api.getProgTime()
      return ok(t ? m(ctx, 'msg.progTime', { fade: t.fade, delay: t.delay }) : m(ctx, 'msg.progTimeOff'))
    }
  }
}

function stepMessage(ctx: CliContext): CliResult {
  const { api } = ctx
  const active = api.getActiveSelection()
  if (!active.length) return warn(m(ctx, 'msg.noSelection'))
  if (active.length === 1) {
    const patch = api.getPatch()
    const entry = patch.find(p => p.id === active[0])
    return ok(m(ctx, 'msg.step', { name: entry ? fixtureName(entry, patch) : active[0] }))
  }
  return ok(m(ctx, 'msg.stepAll', { count: active.length }))
}

function step(keyword: 'next' | 'prev' | 'all'): CliCommand {
  return {
    keyword,
    helpKey: keyword,
    run(_ast, ctx) {
      if (!ctx.api.getSelection().length) return warn(m(ctx, 'msg.noSelection'))
      ctx.api.selectStep(keyword)
      return stepMessage(ctx)
    }
  }
}

const set: CliCommand = {
  keyword: 'set',
  helpKey: 'set',
  run(_ast, ctx) {
    const { api } = ctx
    const active = api.getActiveSelection()
    if (!active.length) return warn(m(ctx, 'msg.noSelection'))
    api.setSelection(active)
    api.selectStep('all')
    return ok(m(ctx, 'msg.selected', { count: active.length }))
  }
}

const align: CliCommand = {
  keyword: 'align',
  helpKey: 'align',
  run(ast, ctx) {
    if (ast.text === 'off' || ast.text === '<') {
      ctx.api.setAlign(ast.text === 'off' ? null : '<')
      return ok(m(ctx, ast.text === 'off' ? 'msg.alignOff' : 'msg.align', { mode: '<' }))
    }
    const mode = ast.text as AlignMode
    if (!['>', '<>', '><'].includes(mode)) return warn(m(ctx, 'errors.expectedValue'))
    ctx.api.setAlign(mode)
    return ok(m(ctx, 'msg.align', { mode }))
  }
}

export const programmerCommands: CliCommand[] = [
  clear, clearAll, clearSelection, highlight, blind, park, unpark, progTime('fade'), progTime('delay'),
  step('next'), step('prev'), step('all'), set, align
]
