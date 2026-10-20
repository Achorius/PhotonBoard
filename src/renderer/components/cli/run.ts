// ============================================================
// Command line UI → engine glue: run a typed line (engine or legacy
// fallback, both logged in pro-store.cliLog), live preview while
// typing, and the persistent ↑ / ↓ history.
// ============================================================

import { getCliContext, getCommand, parse, runCommandLine, type CliParseResult, type CliResult } from '@renderer/lib/cli'
import { useProStore } from '@renderer/stores/pro-store'
import { HISTORY_KEY, chooseRunner, parseHistory, pushHistory } from './cli-model'
import { executeLegacyCommand } from './legacy-commands'

/** Parse for live feedback; never throws */
export function safeParse(text: string): CliParseResult {
  try {
    return parse(text)
  } catch (e) {
    console.error('[CLI] parse failed:', e)
    return { expected: [] }
  }
}

/** One-line preview of what the line would do ("12 fixtures, Group 'Wash'"), or '' */
export function previewLine(parsed: CliParseResult): string {
  const ctx = getCliContext()
  if (!ctx || !parsed.ast) return ''
  try {
    const command = getCommand(parsed.ast.action ?? 'select')
    return command?.preview?.(parsed.ast, ctx) ?? ''
  } catch {
    return ''
  }
}

/** Is the command-line engine wired (or are typed lines run by the legacy commands)? */
export function engineReady(): boolean {
  return getCliContext() !== null && safeParse('Clear').error?.code !== 'notImplemented'
}

/**
 * Run a line typed in this console (status-bar input, expanded panel,
 * keypad). The engine when it is wired, else the legacy commands; both are
 * logged with `origin`.
 */
export function runLine(text: string, origin?: string): CliResult {
  const line = text.trim()
  if (!line) return { ok: true, message: '', level: 'info' }
  const runner = chooseRunner(line, { hasContext: getCliContext() !== null, parsed: safeParse(line) })
  if (runner === 'engine') return runCommandLine(line, origin)
  const legacy = executeLegacyCommand(line)
  const result: CliResult = { ok: legacy.ok, message: legacy.message, level: legacy.ok ? 'info' : 'error' }
  useProStore.getState().appendCliLog({ text: line, ok: result.ok, message: result.message, level: result.level ?? 'info', ...(origin ? { origin } : {}) })
  return result
}

// ---------------------------------------------------------------- history (shared by every command-line input)

let history: string[] | null = null

function load(): string[] {
  if (history) return history
  try {
    history = parseHistory(window.localStorage.getItem(HISTORY_KEY))
  } catch {
    history = []
  }
  return history
}

export function getHistory(): readonly string[] {
  return load()
}

export function addToHistory(line: string): void {
  history = pushHistory(load(), line)
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history)) } catch { /* private mode / quota */ }
}
