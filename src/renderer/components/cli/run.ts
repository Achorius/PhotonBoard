// ============================================================
// Command line UI → engine glue: run a typed line, live preview while
// typing, and the ↑ / ↓ history (lib/cli: one history per machine,
// localStorage 'photonboard.cli.history').
//
//   console        lib/cli runCommandLine (full grammar, undo, log)
//   remote browser the line is sent to the console ('cli' command): it
//                  runs there, its result comes back in the console's
//                  command-line log (state snapshot)
//   no context     the legacy commands (only before the pro layer is
//                  installed: tests, an app without lib/pro/setup)
// ============================================================

import {
  getCliContext, getCliHistory, parse, previewLine as enginePreview, runCommandLine, type CliParseResult, type CliResult
} from '@renderer/lib/cli'
import { isRemoteMode, sendRemoteCommand } from '@renderer/lib/runtime'
import { useProStore } from '@renderer/stores/pro-store'
import { t } from '@renderer/i18n'
import { chooseRunner } from './cli-model'
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

/** One-line preview of what the line would do ("→ 12 fixtures, Group 'Wash'"), or '' */
export function previewLine(text: string): string {
  return enginePreview(text)
}

/** Is the command-line engine wired (or are typed lines run by the legacy commands)? */
export function engineReady(): boolean {
  return getCliContext() !== null
}

/** Remote page id + line counter for 'cli' commands (the console logs the origin) */
let remoteSeq = 0
const remoteOrigin = `remote-${Math.random().toString(36).slice(2, 8)}`

/**
 * Run a line typed in this console (status-bar input, expanded panel,
 * keypad). Logged with `origin`.
 */
export function runLine(text: string, origin?: string): CliResult {
  const line = text.trim()
  if (!line) return { ok: true, message: '', level: 'info' }
  if (isRemoteMode()) {
    sendRemoteCommand('cli', { text: line, origin: origin ?? remoteOrigin, seq: ++remoteSeq })
    return { ok: true, message: t('pro.cliUi.sentToConsole'), level: 'info' }
  }
  const runner = chooseRunner(line, { hasContext: getCliContext() !== null, parsed: safeParse(line) })
  if (runner === 'engine') return runCommandLine(line, origin)
  const legacy = executeLegacyCommand(line)
  const result: CliResult = { ok: legacy.ok, message: legacy.message, level: legacy.ok ? 'info' : 'error' }
  useProStore.getState().appendCliLog({ text: line, ok: result.ok, message: result.message, level: result.level ?? 'info', ...(origin ? { origin } : {}) })
  return result
}

// ---------------------------------------------------------------- history (lib/cli: shared by every command-line input)

export function getHistory(): readonly string[] {
  return getCliHistory().lines()
}

export function addToHistory(line: string): void {
  getCliHistory().push(line)
}
