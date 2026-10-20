// ============================================================
// PhotonBoard — Command line: command registry & context
//
// WP0 contract types (re-exported from lib/cli/index.ts). WP1 adds the
// optional CliContext.macro (the line runs inside a macro: questions
// get their default answer instead of a dialog).
// ============================================================

import type { TParams, TranslationKey } from '@renderer/i18n'
import type { ProApi } from '@renderer/lib/pro/contracts'
import type { CliAst } from './ast'

/** Translation function given to commands (t, or a fixed-locale one in tests) */
export type TFn = (key: TranslationKey, params?: TParams) => string

export interface CliContext {
  api: ProApi
  t: TFn
  now(): number
  /** Id of the macro running this line (questions are answered with their default) */
  macro?: string
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

/** Dynamic translation key (pro.cli.errors.<code>…): checked by the i18n tests, not by tsc */
export function key(k: string): TranslationKey {
  return k as TranslationKey
}
