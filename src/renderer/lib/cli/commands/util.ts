// ============================================================
// PhotonBoard — Command line: helpers shared by the commands
// ============================================================

import type { TParams } from '@renderer/i18n'
import type { CueFeature, ExecutorCell } from '@shared/types'
import type { ExecutorRef, ProApi } from '@renderer/lib/pro/contracts'
import type { StoreOptions } from '@renderer/lib/pro/store-ops'
import type { CliAst, CliObjectRef } from '../ast'
import { key, type CliContext, type CliResult } from '../registry'
import { FILTER_FEATURES } from '../parser'
import { executorText, numberOf } from '../objects'

/** Translate pro.cli.<k> */
export function m(ctx: CliContext, k: string, params?: TParams): string {
  const text = ctx.t(key(`pro.cli.${k}`), params)
  // Unnamed objects (presets, macros… without a label): no empty quotes ("Stored preset 1.1")
  return params && params.name === '' ? stripEmptyQuotes(text) : text
}

/** Remove empty “” / « » (and the space before them) from a message */
export function stripEmptyQuotes(text: string): string {
  return text.replace(/[ \u00a0\u202f]*(?:“[ \u00a0\u202f]*”|«[ \u00a0\u202f]*»)/g, '')
}

export function ok(message: string, extra: Partial<CliResult> = {}): CliResult {
  return { ok: true, message, level: 'info', ...extra }
}

export function warn(message: string): CliResult {
  return { ok: false, message, level: 'warning' }
}

export function fail(message: string): CliResult {
  return { ok: false, message, level: 'error' }
}

/** "Group 7 not found" (first missing id) */
export function notFound(ctx: CliContext, missing: string[]): CliResult {
  return fail(m(ctx, 'msg.notFound', { object: missing[0] ?? '?' }))
}

let txDepth = 0

/**
 * Run `fn` as ONE undo step (ProApi.transaction). Nested calls join the
 * outer step: a command line is one step however many changes it makes.
 */
export function tx<T>(ctx: CliContext, label: string, fn: () => T): T {
  if (txDepth > 0) return fn()
  txDepth++
  try {
    return ctx.api.transaction(label, fn)
  } finally {
    txDepth--
  }
}

/** A content change named after the command line ("Oops" undoes the whole line) */
export function mutate(ctx: CliContext, ast: CliAst, fn: () => CliResult): CliResult {
  const label = ast.source || ast.action || 'command'
  const res = tx(ctx, label, fn)
  return res.ok && !res.undoLabel && !res.pending ? { ...res, undoLabel: label } : res
}

export function hasOption(ast: CliAst, name: string): boolean {
  return ast.options.some(o => o.name === name)
}

export function optionValue(ast: CliAst, name: string): string | undefined {
  return ast.options.find(o => o.name === name)?.value
}

/** The single object of a command (`Delete Cue 3`): its first item */
export function firstRef(ast: CliAst): CliObjectRef | undefined {
  return ast.objects?.items[0]?.object
}

/** Store options from /merge /overwrite /remove /cueonly /block /filter= */
export function storeOptionsOf(ast: CliAst): { mode?: StoreOptions['mode']; filter?: CueFeature[] } {
  const out: { mode?: StoreOptions['mode']; filter?: CueFeature[] } = {}
  for (const mode of ['merge', 'overwrite', 'remove', 'cueonly', 'block'] as const) if (hasOption(ast, mode)) out.mode = mode
  const f = optionValue(ast, 'filter')
  if (f) {
    const filter: CueFeature[] = []
    for (const part of f.split(',')) {
      const feat = FILTER_FEATURES[part.trim().toLowerCase()]
      if (feat && !filter.includes(feat)) filter.push(feat)
    }
    if (filter.length) out.filter = filter
  }
  return out
}

/** Preset scope from /global /universal /selective */
export function scopeOf(ast: CliAst): 'selective' | 'global' | 'universal' | undefined {
  if (hasOption(ast, 'universal')) return 'universal'
  if (hasOption(ast, 'global')) return 'global'
  if (hasOption(ast, 'selective')) return 'selective'
  return undefined
}

/** Cell of an executor (null when empty or out of range) */
export function executorCell(api: ProApi, ref: ExecutorRef): ExecutorCell | null {
  return api.getExecutorPages()[ref.page]?.cells[ref.col]?.[ref.row] ?? null
}

/** Name of what an executor cell plays ("Intro"), '' when empty */
export function executorTargetName(api: ProApi, ref: ExecutorRef): string {
  const cell = executorCell(api, ref)
  if (!cell) return ''
  const lists: Record<ExecutorCell['kind'], readonly { id: string; name: string }[]> = {
    cuelist: api.getCuelists(), chase: api.getChases(), effect: api.getEffects(), macro: api.getMacros(),
    group: api.getGroups(), speed: api.getSpeedMasters()
  }
  return lists[cell.kind].find(x => x.id === cell.id)?.name ?? ''
}

export function executorLabel(ref: ExecutorRef): string {
  return executorText(ref)
}

/** { n, name } of a sequence for messages */
export function seqParams(api: ProApi, id: string): { n: number; name: string } {
  const list = api.getCuelists()
  const cl = list.find(c => c.id === id)
  return { n: cl ? numberOf(cl, list) : 0, name: cl?.name ?? '' }
}

/** Sequence GO / Back / Pause act on when none is named: the selected one, else the first */
export function defaultSequence(api: ProApi): string | null {
  const sel = api.getSelectedCuelist()
  if (sel && api.getCuelists().some(c => c.id === sel)) return sel
  return api.getCuelists()[0]?.id ?? null
}
