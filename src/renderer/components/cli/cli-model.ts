// ============================================================
// Command line UI model (pure): keypad editing of the line,
// autocomplete chips from the parser's `expected`, chip completion,
// history walking (↑ / ↓; storage: lib/cli history) and the choice
// between the command-line engine (lib/cli) and the legacy commands.
// No React, no stores: unit-tested in cli-model.test.ts.
// ============================================================

import type { CliExpectation, CliParseResult } from '@renderer/lib/cli'

// ---------------------------------------------------------------- keypad

/** Keys that run at once on an empty line (grandMA: Oops, Clear, Next / Prev, Highlight are immediate) */
export const IMMEDIATE_ON_EMPTY = new Set(['Clear', 'Oops', 'Next', 'Prev', 'Highlight'])

const isDigit = (c: string) => c >= '0' && c <= '9'

/** Append a keyword as its own word: "Fixture 1" + At → "Fixture 1 At " */
export function insertWord(text: string, word: string): string {
  const base = text.replace(/\s+$/, '')
  return `${base}${base ? ' ' : ''}${word} `
}

/** "+" / "-" between ids: "1" → "1 + " */
export function insertOperator(text: string, op: '+' | '-'): string {
  return insertWord(text, op)
}

/** Digits and "." stick to the number being typed; after a word they start a new one */
export function insertDigit(text: string, digit: string): string {
  if (text === '') return digit === '.' ? '0.' : digit
  const last = text[text.length - 1]
  if (isDigit(last) || last === '.') return text + digit
  if (last === ' ') return text + (digit === '.' ? '0.' : digit)
  // Right after a word ("At") or an operator without space
  return `${text} ${digit === '.' ? '0.' : digit}`
}

/** Insert what a keypad key types (keyword, operator or digit) */
export function insertKey(text: string, key: string): string {
  if (key === '+' || key === '-') return insertOperator(text, key)
  if (key === '.' || (key.length === 1 && isDigit(key))) return insertDigit(text, key)
  return insertWord(text, key)
}

/** Backspace: a whole keyword when the line ends with one ("Fixture 1 At " → "Fixture 1 "), else one character */
export function backspace(text: string): string {
  if (text === '') return ''
  if (/\s$/.test(text)) {
    const trimmed = text.replace(/\s+$/, '')
    const m = /(\S+)$/.exec(trimmed)
    if (m && (/^[A-Za-z][A-Za-z-]*$/.test(m[1]) || m[1] === '+' || m[1] === '-')) {
      const rest = trimmed.slice(0, trimmed.length - m[1].length)
      return rest
    }
    return trimmed
  }
  return text.slice(0, -1)
}

/** Oops on a non-empty line removes the last word (grandMA) */
export function removeLastWord(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  const m = /(\S+)$/.exec(trimmed)
  if (!m) return ''
  return trimmed.slice(0, trimmed.length - m[1].length)
}

// ---------------------------------------------------------------- autocomplete

export interface CliChip {
  /** What gets typed */
  value: string
  kind: CliExpectation['kind']
  /** pro.cli.help.* key (WP1), when the parser gave one */
  helpKey?: string
}

/** The word being typed at the end of the line ("Fix" in "Fix", "/me" in "Store Cue 3 /me"), '' after a space or a number */
export function partialWord(text: string): string {
  if (text === '' || /\s$/.test(text)) return ''
  const m = /(\S+)$/.exec(text)
  if (!m) return ''
  return /^\/[A-Za-z-]*$|^[A-Za-z][A-Za-z-]*$/.test(m[1]) ? m[1] : ''
}

/** Options are typed with a leading "/" whether or not the parser lists them with it */
const typed = (chip: Pick<CliChip, 'value' | 'kind'>) => (chip.kind === 'option' && !chip.value.startsWith('/') ? `/${chip.value}` : chip.value)

/**
 * Chips for the current line: candidate keywords / options from the
 * parser's expectations, narrowed to the word being typed. Kinds without
 * candidates (number, value, text, end) give no chip — see expectationHints.
 */
export function chipsFor(parsed: Pick<CliParseResult, 'expected'> | null | undefined, text: string, max = 24): CliChip[] {
  if (!parsed) return []
  const partial = partialWord(text).toLowerCase()
  const seen = new Set<string>()
  const chips: CliChip[] = []
  for (const e of parsed.expected) {
    for (const raw of e.values ?? []) {
      const v = typed({ value: raw, kind: e.kind })
      const key = v.toLowerCase()
      if (seen.has(key)) continue
      if (partial && (!key.startsWith(partial) || key === partial)) continue
      seen.add(key)
      chips.push({ value: v, kind: e.kind, ...(e.helpKey ? { helpKey: e.helpKey } : {}) })
      if (chips.length >= max) return chips
    }
  }
  return chips
}

/** Expectation kinds without candidates ("number", "value"…), for the hint after the chips */
export function expectationHints(parsed: Pick<CliParseResult, 'expected'> | null | undefined): CliExpectation['kind'][] {
  if (!parsed) return []
  const kinds: CliExpectation['kind'][] = []
  for (const e of parsed.expected) {
    if (e.values && e.values.length > 0) continue
    if (!kinds.includes(e.kind)) kinds.push(e.kind)
  }
  return kinds
}

/** Put a chip on the line: completes the word being typed, else adds it as a new word */
export function applyChip(text: string, value: string): string {
  const partial = partialWord(text)
  if (partial && value.toLowerCase().startsWith(partial.toLowerCase())) {
    return `${text.slice(0, text.length - partial.length)}${value} `
  }
  return insertWord(text, value)
}

// ---------------------------------------------------------------- engine / legacy choice

/**
 * Which implementation runs a line:
 *   'engine' — lib/cli (the full grammar, old commands included: Gobo 30,
 *   Stop 2, BO…), as soon as its context is set (lib/pro/setup),
 *   'legacy' — the previous ad-hoc commands, only while the engine is not
 *   wired (no context / parser not implemented).
 */
export function chooseRunner(_text: string, opts: { hasContext: boolean; parsed: Pick<CliParseResult, 'ast' | 'error'> }): 'engine' | 'legacy' {
  if (!opts.hasContext) return 'legacy'
  if (opts.parsed.error?.code === 'notImplemented') return 'legacy'
  return 'engine'
}

// ---------------------------------------------------------------- history

// Lines are stored by lib/cli (getCliHistory: 200 lines, localStorage
// 'photonboard.cli.history'); this only walks them.

/**
 * ↑ / ↓ through the history. `index` -1 = the draft being typed.
 * Returns the new index and the text to show, or null when it cannot move.
 */
export function stepHistory(history: readonly string[], index: number, dir: 1 | -1, draft: string): { index: number; text: string } | null {
  const next = index + dir
  if (next < -1 || next >= history.length) return null
  return { index: next, text: next === -1 ? draft : history[next] }
}
