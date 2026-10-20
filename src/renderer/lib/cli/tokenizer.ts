// ============================================================
// PhotonBoard — Command line: tokenizer & keywords
//
//   words      case-insensitive keywords: exact name, abbreviation
//              (F = Fixture, Seq = Sequence…) or a unique prefix
//              ("Fi" = Fixture; "Cl" = Clear because Clear is a prefix
//              of every other candidate). "@" = At, "Go-" = Go back.
//   numbers    1 · 1.5 · 4.2 · 1.101 (dotted ids keep the typed text)
//   strings    "Wash" · 'Wash' · “Wash” · « Wash »
//   operators  + - = > < ,
//   options    /merge · /filter=position,color
//
// Never throws: unknown characters become 'op' tokens the parser
// rejects with a position.
// ============================================================

import type { CliObjectKind } from './ast'

/** Action keywords (canonical lower case) → display spelling */
export const ACTION_KEYWORDS: Readonly<Record<string, string>> = {
  store: 'Store', update: 'Update', delete: 'Delete', copy: 'Copy', move: 'Move', label: 'Label', assign: 'Assign',
  go: 'Go', 'go-': 'Go-', goto: 'Goto', off: 'Off', pause: 'Pause', release: 'Release', stop: 'Stop',
  clear: 'Clear', clearall: 'ClearAll', clearselection: 'ClearSelection',
  highlight: 'Highlight', park: 'Park', unpark: 'Unpark', blind: 'Blind', oops: 'Oops', redo: 'Redo',
  next: 'Next', prev: 'Prev', all: 'All', set: 'Set', select: 'Select', call: 'Call', align: 'Align',
  fade: 'Fade', delay: 'Delay', page: 'Page', macro: 'Macro', blackout: 'Blackout', edit: 'Edit'
}

/** Object keywords → display spelling */
export const OBJECT_KEYWORDS: Readonly<Record<CliObjectKind, string>> = {
  fixture: 'Fixture', group: 'Group', preset: 'Preset', cue: 'Cue', sequence: 'Sequence', executor: 'Executor',
  page: 'Page', macro: 'Macro', chase: 'Chase', effect: 'Effect', speed: 'Speed', dmx: 'DMX'
}

/** Other keywords → display spelling */
export const OTHER_KEYWORDS: Readonly<Record<string, string>> = {
  at: 'At', thru: 'Thru', full: 'Full', zero: 'Zero', if: 'If', on: 'On'
}

/** Abbreviations and aliases (checked after exact names, before prefixes) */
export const KEYWORD_ALIASES: Readonly<Record<string, string>> = {
  f: 'fixture', fix: 'fixture', g: 'group', grp: 'group', p: 'preset', c: 'cue', s: 'sequence', seq: 'sequence',
  scene: 'sequence', e: 'executor', exec: 'executor', t: 'thru', through: 'thru', m: 'macro', pg: 'page', ch: 'chase',
  fx: 'effect', bo: 'blackout', undo: 'oops', back: 'go-', goback: 'go-', st: 'store', del: 'delete', sel: 'select',
  rel: 'release', record: 'store', hl: 'highlight', previous: 'prev', clr: 'clear'
}

/**
 * Words of the old command line that set a channel by name: `Gobo 30`
 * (DMX value, selection or every fixture). Exact words only.
 */
export const LEGACY_CHANNEL_WORDS: readonly string[] = [
  'gobo', 'color', 'pan', 'tilt', 'zoom', 'focus', 'shutter', 'strobe', 'prism', 'red', 'green', 'blue', 'white', 'amber'
]

/** Every canonical keyword → display spelling */
export const ALL_KEYWORDS: Readonly<Record<string, string>> = { ...ACTION_KEYWORDS, ...OBJECT_KEYWORDS, ...OTHER_KEYWORDS }

const CANONICAL = Object.keys(ALL_KEYWORDS)

/** Display spelling of a canonical keyword ('go-' → 'Go-') */
export function displayKeyword(kw: string): string {
  return ALL_KEYWORDS[kw] ?? kw
}

export type KeywordMatch =
  | { kind: 'exact' | 'alias' | 'prefix'; keyword: string }
  | { kind: 'channel'; channel: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'unknown' }

/** Resolve a typed word (case-insensitive) */
export function resolveKeyword(word: string): KeywordMatch {
  const w = word.toLowerCase()
  if (w === '') return { kind: 'unknown' }
  if (ALL_KEYWORDS[w]) return { kind: 'exact', keyword: w }
  const alias = KEYWORD_ALIASES[w]
  if (alias) return { kind: 'alias', keyword: alias }
  if (LEGACY_CHANNEL_WORDS.includes(w)) return { kind: 'channel', channel: w }
  const candidates = CANONICAL.filter(k => k.startsWith(w) && k !== 'go-')
  if (candidates.length === 1) return { kind: 'prefix', keyword: candidates[0] }
  if (candidates.length > 1) {
    const shortest = candidates.reduce((a, b) => (b.length < a.length ? b : a))
    if (candidates.every(c => c.startsWith(shortest))) return { kind: 'prefix', keyword: shortest }
    return { kind: 'ambiguous', candidates: candidates.sort() }
  }
  return { kind: 'unknown' }
}

// ---------------------------------------------------------------- tokens

export type TokenKind = 'word' | 'number' | 'string' | 'op' | 'option' | 'eof'

export interface Token {
  kind: TokenKind
  /** Text as typed */
  text: string
  /** Offsets in the input */
  at: number
  end: number
  /** word: resolved keyword (canonical) */
  keyword?: string
  /** word: how it matched */
  match?: KeywordMatch['kind']
  /** word: candidates of an ambiguous prefix */
  candidates?: string[]
  /** word: legacy channel word (`Gobo 30`) */
  channel?: string
  /** number: "4." typed without its second part */
  dangling?: boolean
  /** string: closing quote missing */
  unterminated?: boolean
  /** string: content without quotes */
  value?: string
  /** option: `/name=value` */
  option?: { name: string; value?: string }
}

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '«': '»', '‘': '’' }

/** Split a command line into tokens (always ends with an 'eof' token). Never throws. */
export function tokenize(input: string): Token[] {
  const out: Token[] = []
  const s = input
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    const start = i
    // words
    if (/[A-Za-z_À-ÿ]/.test(c)) {
      while (i < s.length && /[A-Za-z0-9_À-ÿ]/.test(s[i])) i++
      let text = s.slice(start, i)
      // "Go-" (go back) is one key
      if (text.toLowerCase() === 'go' && s[i] === '-') { i++; text = s.slice(start, i) }
      const tok: Token = { kind: 'word', text, at: start, end: i }
      // "F1", "Group2": keyword glued to its number
      const glued = /^([A-Za-z]+)(\d+)$/.exec(text)
      if (glued && resolveKeyword(text).kind === 'unknown') {
        const m = resolveKeyword(glued[1])
        if (m.kind === 'exact' || m.kind === 'alias' || m.kind === 'prefix') {
          const cut = start + glued[1].length
          out.push({ kind: 'word', text: glued[1], at: start, end: cut, keyword: m.keyword, match: m.kind })
          i = cut
          continue
        }
      }
      if (text.endsWith('-')) { tok.keyword = 'go-'; tok.match = 'exact' } else {
        const m = resolveKeyword(text)
        tok.match = m.kind
        if (m.kind === 'exact' || m.kind === 'alias' || m.kind === 'prefix') tok.keyword = m.keyword
        else if (m.kind === 'channel') tok.channel = m.channel
        else if (m.kind === 'ambiguous') tok.candidates = m.candidates
      }
      out.push(tok)
      continue
    }
    // numbers: 12 · 4.2 · 1.101 · .5 · "4." (dangling while typing)
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      while (i < s.length && /[0-9]/.test(s[i])) i++
      let dangling = false
      if (s[i] === '.') {
        i++
        if (/[0-9]/.test(s[i] ?? '')) while (i < s.length && /[0-9]/.test(s[i])) i++
        else dangling = true
      }
      const tok: Token = { kind: 'number', text: s.slice(start, i), at: start, end: i }
      if (dangling) tok.dangling = true
      out.push(tok)
      continue
    }
    // strings
    if (QUOTES[c]) {
      const close = QUOTES[c]
      i++
      let j = i
      while (j < s.length && s[j] !== close && !(c === '“' && s[j] === '"')) j++
      const tok: Token = { kind: 'string', text: s.slice(start, Math.min(j + 1, s.length)), value: s.slice(i, j), at: start, end: Math.min(j + 1, s.length) }
      if (j >= s.length) tok.unterminated = true
      out.push(tok)
      i = Math.min(j + 1, s.length)
      continue
    }
    // options: /merge · /filter=position,color
    if (c === '/') {
      i++
      while (i < s.length && /[A-Za-z]/.test(s[i])) i++
      const name = s.slice(start + 1, i).toLowerCase()
      let value: string | undefined
      if (s[i] === '=') {
        i++
        const v0 = i
        while (i < s.length && !/\s/.test(s[i])) i++
        value = s.slice(v0, i)
      }
      const tok: Token = { kind: 'option', text: s.slice(start, i), at: start, end: i, option: value === undefined ? { name } : { name, value } }
      out.push(tok)
      continue
    }
    if (c === '@') {
      i++
      out.push({ kind: 'word', text: '@', at: start, end: i, keyword: 'at', match: 'alias' })
      continue
    }
    // operators (and anything else, rejected by the parser)
    i++
    out.push({ kind: 'op', text: c, at: start, end: i })
  }
  out.push({ kind: 'eof', text: '', at: s.length, end: s.length })
  return out
}
