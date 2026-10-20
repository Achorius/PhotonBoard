// ============================================================
// PhotonBoard — Command line (public entry point)
//
// Callers only ever import '@renderer/lib/cli'. Syntax: README.md.
//
//   parse(input)               never throws; `expected` drives autocomplete
//   executeLine(line, ctx?)    never throws; ctx defaults to the one set
//                              with setCliContext() (the integrator wires
//                              the real ProApi there)
//   runCommandLine(text, o?)   executeLine + command-line log (pro-store)
//   previewLine(text, ctx?)    "→ 12 fixtures, Group “Wash”" while typing
//   registerCommand(cmd)       keyword (+ aliases) → command
//   runMacro / stopMacro       macros (sequential lines with waits)
//   getCliHistory()            typed lines, 200, localStorage
//
// Modules: tokenizer.ts · parser.ts · ast.ts · objects.ts (numbers →
// objects) · values.ts · commands/* · preview.ts · help.ts ·
// macro-runner.ts · history.ts. Commands talk to the show ONLY through
// the ProApi facade (lib/pro/contracts.ts).
//
// Keywords stay English (console convention); every message goes
// through ctx.t() — namespace pro.cli.*.
// ============================================================

import { t } from '@renderer/i18n'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore, type CliLogEntry } from '@renderer/stores/pro-store'
import { getCliContext, getCommand, key, type CliContext, type CliResult, type TFn } from './registry'
import { parse } from './parser'
import { describeAst } from './preview'
import { registerBuiltinCommands } from './commands'
import { createMacroRunner, type MacroClock } from './macro-runner'
import { createCliHistory, type CliHistory } from './history'

export type {
  CliObjectKind, CliId, CliIdRange, CliObjectRef, CliObjectExpr, CliValue, CliValueExpr, CliOption, CliAst, CliExpectation,
  CliParseError, CliParseResult
} from './ast'
export type { TFn, CliContext, CliResult, CliCommand } from './registry'
export { registerCommand, getCommand, listCommands, setCliContext, getCliContext } from './registry'
export { parse, DEFAULT_OBJECT, CLI_OPTIONS, FILTER_FEATURES, BUTTON_FUNCTIONS } from './parser'
export {
  tokenize, resolveKeyword, displayKeyword, ACTION_KEYWORDS, OBJECT_KEYWORDS, OTHER_KEYWORDS, KEYWORD_ALIASES, LEGACY_CHANNEL_WORDS,
  type Token, type KeywordMatch
} from './tokenizer'
export { CLI_CHEATSHEET, helpKeyOf, type CheatLine, type CheatSection } from './help'
export { createCliHistory, CLI_HISTORY_KEY, CLI_HISTORY_LIMIT, type CliHistory, type HistoryStorage } from './history'
export { createMacroRunner, realClock, MAX_MACRO_DEPTH, type MacroClock, type MacroRunner } from './macro-runner'
export { describeAst } from './preview'

registerBuiltinCommands()

// ---------------------------------------------------------------- execute

/** Message of a parse error (pro.cli.errors.<code>) */
export function parseErrorMessage(tr: TFn, code: string, token?: string): string {
  return tr(key(`pro.cli.errors.${code}`), { token: token ?? '' })
}

/** Run one command line. Never throws. */
export function executeLine(line: string, ctx?: CliContext): CliResult {
  const context = ctx ?? getCliContext()
  const tr: TFn = context?.t ?? t
  const text = line.trim()
  if (text === '') return { ok: true, message: '', level: 'info' }
  if (!context) return { ok: false, message: tr('pro.cli.notAvailable'), level: 'warning' }
  try {
    const parsed = parse(text)
    if (parsed.error || !parsed.ast) {
      const e = parsed.error ?? { code: 'internal', at: 0 }
      return { ok: false, message: parseErrorMessage(tr, e.code, e.token), level: 'error' }
    }
    const action = parsed.ast.action ?? 'select'
    const command = getCommand(action)
    if (!command) return { ok: false, message: tr('pro.cli.unknownCommand', { command: action }), level: 'error' }
    return command.run(parsed.ast, context)
  } catch (e) {
    console.error('[CLI] command failed:', e)
    return { ok: false, message: tr('pro.cli.failed', { error: e instanceof Error ? e.message : String(e) }), level: 'error' }
  }
}

/** One-line preview of what a line would do ('' when nothing to say or invalid). Never throws. */
export function previewLine(line: string, ctx?: CliContext): string {
  const context = ctx ?? getCliContext()
  if (!context || line.trim() === '') return ''
  try {
    const parsed = parse(line)
    if (!parsed.ast || parsed.error) return ''
    const command = getCommand(parsed.ast.action ?? 'select')
    return (command?.preview ?? describeAst)(parsed.ast, context)
  } catch {
    return ''
  }
}

function logResult(text: string, result: CliResult, origin?: string): void {
  const entry: Omit<CliLogEntry, 'id' | 'time'> = { text, ok: result.ok, message: result.message, level: result.level ?? (result.ok ? 'info' : 'error') }
  if (origin) entry.origin = origin
  useProStore.getState().appendCliLog(entry)
}

/**
 * Run a line and add it to the command-line log (console UI, remote
 * 'cli', macros). A command waiting for an answer logs its question,
 * then its final result when answered.
 */
export function runCommandLine(text: string, origin?: string, ctx?: CliContext): CliResult {
  const result = executeLine(text, ctx)
  const line = text.trim()
  if (line !== '') {
    logResult(line, result, origin)
    result.pending?.then(final => logResult(line, final, origin), () => {})
  }
  return result
}

// ---------------------------------------------------------------- macros

const macroRunner = createMacroRunner({
  getMacros: () => {
    const api = getCliContext()?.api
    return typeof api?.getMacros === 'function' ? api.getMacros() : usePoolStore.getState().macros
  },
  runLine: () => undefined
})

/**
 * Run a macro (by id, or by number): its lines one after the other, waiting
 * `wait` seconds after each. Returns false when it does not exist or is
 * already running (a macro never starts itself twice).
 */
export function runMacro(idOrNumber: string | number, opts: { ctx?: CliContext; origin?: string } = {}): boolean {
  const api = opts.ctx?.api
  const macros = typeof api?.getMacros === 'function' ? api.getMacros() : undefined
  return macroRunner.run(idOrNumber, (command, macroId) => {
    const base = opts.ctx ?? getCliContext()
    runCommandLine(command, opts.origin ?? 'macro', base ? { ...base, macro: macroId } : undefined)
  }, macros)
}

/** Stop a running macro ("Off Macro 3") */
export function stopMacro(id: string): void {
  macroRunner.stop(id)
}

export function isMacroRunning(id: string): boolean {
  return macroRunner.isRunning(id)
}

/** Ids of the running macros */
export function runningMacros(): string[] {
  return macroRunner.running()
}

export function stopAllMacros(): void {
  macroRunner.stopAll()
}

/** Clock of macro waits (tests; default setTimeout) */
export function setMacroClock(clock: MacroClock): void {
  macroRunner.setClock(clock)
}

// ---------------------------------------------------------------- history

let history: CliHistory | null = null

/** Typed-line history of this machine (created on first use) */
export function getCliHistory(): CliHistory {
  history ??= createCliHistory()
  return history
}
