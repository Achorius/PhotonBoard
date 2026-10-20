// ============================================================
// PhotonBoard — Command line (public entry point)
//
// WP0 contract: FINAL exported types and signatures, stub bodies.
// WP1 implements the engine (tokenizer.ts, parser.ts, registry.ts,
// objects.ts, commands/*, macro-runner.ts) and re-exports it from
// here; callers only ever import '@renderer/lib/cli'.
//
//   parse(input)               never throws; `expected` drives autocomplete
//   executeLine(line, ctx?)    never throws; ctx defaults to the one set
//                              with setCliContext() (the integrator wires
//                              the real ProApi there)
//   runCommandLine(text, o?)   executeLine + command-line log (pro-store)
//   registerCommand(cmd)       keyword (+ aliases) → command
//   runMacro / stopMacro       macros (sequential lines with waits)
//
// Keywords stay English (console convention); every message goes
// through ctx.t() — namespace pro.cli.*.
// ============================================================

import { t, type TParams, type TranslationKey } from '@renderer/i18n'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore, type CliLogEntry } from '@renderer/stores/pro-store'
import type { ProApi } from '@renderer/lib/pro/contracts'

/** Translation function given to commands (t, or a fixed-locale one in tests) */
export type TFn = (key: TranslationKey, params?: TParams) => string

// ---------------------------------------------------------------- AST

/** Object keywords (Fixture, Group, Preset, Cue, Sequence, Executor, Page, Macro, Chase, Effect, Speed, DMX) */
export type CliObjectKind =
  | 'fixture' | 'group' | 'preset' | 'cue' | 'sequence' | 'executor' | 'page' | 'macro' | 'chase' | 'effect' | 'speed' | 'dmx'

/** `4` → { major: 4 } · `4.2` → { major: 4, minor: 2 } (preset family.slot, page.slot, universe.address) */
export interface CliId {
  major: number
  minor?: number
}

/** `1`, `1 Thru 8`, `1 Thru` (to the end) */
export interface CliIdRange {
  from: CliId
  /** undefined = single id; 'end' = open "Thru" */
  to?: CliId | 'end'
}

/** `Fixture 1 Thru 4 + 7 - 3` */
export interface CliObjectRef {
  kind: CliObjectKind
  /** Bare numbers default to 'fixture' */
  implicit?: boolean
  ids: { op: '+' | '-'; range: CliIdRange }[]
}

/** `Group 2 + Fixture 5 If Group 1` */
export interface CliObjectExpr {
  items: { op: '+' | '-'; object: CliObjectRef }[]
  condition?: CliObjectRef
}

export type CliValue =
  /** Percent 0-100 (Full = 100, Zero = 0); `to` = fan "At 0 Thru 100" */
  | { kind: 'level'; from: number; to?: number }
  /** `At Preset 4.2` */
  | { kind: 'preset'; id: CliId }

export interface CliValueExpr {
  value: CliValue
  fade?: number
  delay?: number
}

/** `/merge`, `/filter=position,color` */
export interface CliOption {
  name: string
  value?: string
}

export interface CliAst {
  /** Lower-case action keyword ('store', 'go-', 'clearall'…); undefined = selection / bare value */
  action?: string
  objects?: CliObjectExpr
  value?: CliValueExpr
  /** `Label Group 3 "Wash"` */
  text?: string
  options: CliOption[]
  /** The line as typed */
  source: string
}

/** What may come next (autocomplete chips, keypad hints) */
export interface CliExpectation {
  kind: 'action' | 'object' | 'number' | 'value' | 'option' | 'text' | 'end'
  /** Candidate keywords / options for this position */
  values?: string[]
  /** Help key of the candidate (pro.cli.help.*) */
  helpKey?: string
}

export interface CliParseError {
  /** Message key suffix under pro.cli.errors (WP1 adds the messages) */
  code: string
  /** Character offset in the input */
  at: number
  token?: string
}

export interface CliParseResult {
  ast?: CliAst
  error?: CliParseError
  expected: CliExpectation[]
}

// ---------------------------------------------------------------- registry

export interface CliContext {
  api: ProApi
  t: TFn
  now(): number
}

export interface CliResult {
  ok: boolean
  /** Already translated */
  message: string
  level?: 'info' | 'warning' | 'error'
  /** Undo step the command created (for "Oops") */
  undoLabel?: string
  /** The command needs an answer first (Store on an existing cue…): final result */
  pending?: Promise<CliResult>
}

export interface CliCommand {
  /** Lower-case action keyword */
  keyword: string
  aliases?: string[]
  /** pro.cli.help.<helpKey> */
  helpKey: string
  run(ast: CliAst, ctx: CliContext): CliResult
  /** One-line preview while typing ("→ 12 fixtures, Group 'Wash'") */
  preview?(ast: CliAst, ctx: CliContext): string
}

const commands = new Map<string, CliCommand>()

/** Register (or replace) a command by keyword and aliases (case-insensitive). */
export function registerCommand(c: CliCommand): void {
  for (const k of [c.keyword, ...(c.aliases ?? [])]) commands.set(k.toLowerCase(), c)
}

/** Command for an action keyword (case-insensitive) */
export function getCommand(keyword: string): CliCommand | undefined {
  return commands.get(keyword.toLowerCase())
}

/** Every registered command (one entry per command) */
export function listCommands(): CliCommand[] {
  return Array.from(new Set(commands.values()))
}

let defaultContext: CliContext | null = null

/** Context used when executeLine() gets none (the integrator sets the real ProApi). */
export function setCliContext(ctx: CliContext | null): void {
  defaultContext = ctx
}

export function getCliContext(): CliContext | null {
  return defaultContext
}

// ---------------------------------------------------------------- parse / execute (stubs)

/** Parse a command line. Never throws. WP0 stub: no grammar yet. */
export function parse(input: string): CliParseResult {
  if (input.trim() === '') return { expected: [{ kind: 'action' }, { kind: 'object' }] }
  return { error: { code: 'notImplemented', at: 0 }, expected: [] }
}

/** Run one command line. Never throws. */
export function executeLine(line: string, ctx?: CliContext): CliResult {
  const context = ctx ?? defaultContext
  const tr: TFn = context?.t ?? t
  const text = line.trim()
  if (text === '') return { ok: true, message: '', level: 'info' }
  if (!context) return { ok: false, message: tr('pro.cli.notAvailable'), level: 'warning' }
  try {
    const parsed = parse(text)
    if (!parsed.ast) return { ok: false, message: tr('pro.cli.notAvailable'), level: 'warning' }
    const command = parsed.ast.action ? getCommand(parsed.ast.action) : getCommand('select')
    if (!command) return { ok: false, message: tr('pro.cli.unknownCommand', { command: parsed.ast.action ?? text }), level: 'error' }
    return command.run(parsed.ast, context)
  } catch (e) {
    console.error('[CLI] command failed:', e)
    return { ok: false, message: tr('pro.cli.failed', { error: e instanceof Error ? e.message : String(e) }), level: 'error' }
  }
}

/** Run a line and add it to the command-line log (console UI, remote 'cli', macros). */
export function runCommandLine(text: string, origin?: string, ctx?: CliContext): CliResult {
  const result = executeLine(text, ctx)
  if (text.trim() !== '') {
    const entry: Omit<CliLogEntry, 'id' | 'time'> = { text: text.trim(), ok: result.ok, message: result.message, level: result.level ?? (result.ok ? 'info' : 'error') }
    if (origin) entry.origin = origin
    useProStore.getState().appendCliLog(entry)
  }
  return result
}

// ---------------------------------------------------------------- macros (basic runner)

const running = new Map<string, { cancel: () => void }>()

/**
 * Run a macro (by id, or by number): its lines one after the other, waiting
 * `wait` seconds after each. Returns false when it does not exist or is
 * already running (a macro never starts itself twice).
 */
export function runMacro(idOrNumber: string | number, opts: { ctx?: CliContext; origin?: string } = {}): boolean {
  const { macros } = usePoolStore.getState()
  const macro = typeof idOrNumber === 'number' ? macros.find(m => m.number === idOrNumber) : macros.find(m => m.id === idOrNumber)
  if (!macro || running.has(macro.id)) return false
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  running.set(macro.id, { cancel: () => { cancelled = true; if (timer) clearTimeout(timer) } })
  const lines = macro.lines.map(l => ({ ...l }))
  const step = (i: number) => {
    timer = null
    if (cancelled || i >= lines.length) { running.delete(macro.id); return }
    const res = runCommandLine(lines[i].command, opts.origin ?? 'macro', opts.ctx)
    if (!res.ok && res.level === 'error') { running.delete(macro.id); return }
    const wait = Math.max(0, lines[i].wait ?? 0) * 1000
    if (wait > 0) timer = setTimeout(() => step(i + 1), wait)
    else step(i + 1)
  }
  step(0)
  return true
}

/** Stop a running macro ("Off Macro 3") */
export function stopMacro(id: string): void {
  running.get(id)?.cancel()
  running.delete(id)
}

export function isMacroRunning(id: string): boolean {
  return running.has(id)
}
