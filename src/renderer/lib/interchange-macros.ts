// ============================================================
// PhotonBoard — Object numbers inside macro text (import merge)
//
// Macro lines are command lines ("Go Sequence 3", "Goto Cue 2
// Sequence 5", "Group 4 At Preset 4.2", "Executor 2.5"…). When the
// merge gives imported objects new numbers (taken numbers, appended
// executor pages), the numbers in the text must follow, else the
// macro drives the show's own objects. The line is read with the
// command line tokenizer (same keywords, abbreviations, glued "F1"),
// and only the number tokens are rewritten: spacing, case and
// abbreviations of the operator's text are kept.
//
//   - bare numbers take the action's default object (Go 3 = Sequence 3,
//     a line starting with a number = Fixture), like the parser,
//   - ranges (1 Thru 8, 1 Thru) are rewritten when every object of the
//     file inside them moved by the same amount; otherwise the line is
//     kept and reported,
//   - Cue numbers belong to their sequence (never renumbered); DMX
//     addresses and values after At / Fade / Delay are not objects,
//   - a reference to an object of the file that was not imported, or to
//     a number the file does not have, is kept and reported (Store and
//     Copy / Move targets may name free numbers: not reported).
// Pure: no store access.
// ============================================================

import type { CliObjectKind } from './cli/ast'
import { DEFAULT_OBJECT } from './cli/parser'
import { OBJECT_KEYWORDS, displayKeyword, tokenize, type Token } from './cli/tokenizer'

/** old number → new number; null = the object is in the file but was not imported */
export type NumberMap = Map<number, number | null>

export interface MacroNumberMaps {
  fixture?: NumberMap
  group?: NumberMap
  sequence?: NumberMap
  chase?: NumberMap
  effect?: NumberMap
  macro?: NumberMap
  speed?: NumberMap
  /** Executor pages (1-based); executor slots keep their place on the page */
  page?: NumberMap
  /** Presets per family number (0 All, 1 Dimmer, 2 Position…) */
  preset?: Map<number, NumberMap>
}

export interface MacroLineRenumber {
  text: string
  changed: boolean
  /** References kept as they were ("Sequence 3") */
  unresolved: string[]
}

type SimpleKind = 'fixture' | 'group' | 'sequence' | 'chase' | 'effect' | 'macro' | 'speed' | 'page'
const SIMPLE_KINDS = new Set<CliObjectKind>(['fixture', 'group', 'sequence', 'chase', 'effect', 'macro', 'speed', 'page'])

/** Numbers after these keywords are values / times, not objects */
const VALUE_KEYWORDS = new Set(['fade', 'delay', 'full', 'zero', 'on', 'off'])

interface Num {
  major: number
  minor?: number
}

function readNum(t: Token): Num | null {
  if (t.kind !== 'number' || t.dangling) return null
  const [a, b] = t.text.split('.')
  const major = a === '' ? 0 : parseInt(a, 10)
  if (!Number.isFinite(major)) return null
  return b === undefined ? { major } : { major, minor: parseInt(b, 10) }
}

/**
 * New numbers for a range of a simple map: every object of the file inside
 * [from, to] must have moved by the same amount. `to` undefined = single
 * number, 'end' = open range ("1 Thru").
 */
function shiftRange(map: NumberMap, from: number, to: number | 'end' | undefined): { from: number; to?: number } | 'missing' | 'unresolved' {
  if (to === undefined) {
    if (!map.has(from)) return 'missing'
    const n = map.get(from)
    return n === null || n === undefined ? 'unresolved' : { from: n }
  }
  const lo = to === 'end' ? from : Math.min(from, to)
  const hi = to === 'end' ? Infinity : Math.max(from, to)
  let delta: number | null = null
  let members = 0
  for (const [k, v] of map) {
    if (k < lo || k > hi) continue
    members++
    if (v === null) return 'unresolved'
    if (delta === null) delta = v - k
    else if (v - k !== delta) return 'unresolved'
  }
  if (members === 0 || delta === null) return 'missing'
  return { from: from + delta, ...(to === 'end' ? {} : { to: to + delta }) }
}

/** Rewrite the object numbers of one command line */
export function renumberMacroLine(text: string, maps: MacroNumberMaps): MacroLineRenumber {
  const toks = tokenize(text)
  const edits: { at: number; end: number; text: string }[] = []
  const unresolved: string[] = []
  const first = toks[0]
  const action = first?.kind === 'word' && first.keyword && !(first.keyword in OBJECT_KEYWORDS) ? first.keyword : undefined
  // "Macro 3" / "Page 2" start with a word that is both an action and an object: the object rules
  let kind: CliObjectKind | null = action ? DEFAULT_OBJECT[action] ?? 'fixture' : 'fixture'
  let target = false
  const creating = () => action === 'store' || target

  const report = (k: CliObjectKind, label: string) => { unresolved.push(`${displayKeyword(k)} ${label}`) }
  const edit = (t: Token, n: string) => { if (n !== t.text) edits.push({ at: t.at, end: t.end, text: n }) }

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.kind === 'word') {
      const k = t.keyword
      if (t.channel) { kind = null; continue }
      if (!k) continue
      if (k in OBJECT_KEYWORDS) { kind = k as CliObjectKind; continue }
      if (k === 'at') {
        if (action === 'copy' || action === 'move' || action === 'assign') {
          target = true
          if (action === 'assign') kind = 'executor'
        } else kind = null
        continue
      }
      if (k === 'if') { kind = 'fixture'; continue }
      if (VALUE_KEYWORDS.has(k)) { kind = null; continue }
      if (k !== 'thru') continue
      // A leading "Thru 5" (from the first object)
      const next = toks[i + 1]
      const prev = toks[i - 1]
      if (!kind || !next || next.kind !== 'number' || prev?.kind === 'number') continue
      const n = readNum(next)
      if (!n || n.minor !== undefined || !SIMPLE_KINDS.has(kind)) { i++; continue }
      const map = maps[kind as SimpleKind]
      if (map) {
        const r = shiftRange(map, 0, n.major)
        if (typeof r === 'object') edit(next, String(r.to))
        else if (!(r === 'missing' && creating())) report(kind, `Thru ${next.text}`)
      }
      i++
      continue
    }
    if (t.kind !== 'number' || !kind) continue
    const from = readNum(t)
    if (!from) continue
    // "1 Thru 8", "1 Thru" (to the end), "1 > 8" (old syntax)
    let toTok: Token | undefined
    let open = false
    const sep = toks[i + 1]
    if (sep && ((sep.kind === 'word' && sep.keyword === 'thru') || (sep.kind === 'op' && sep.text === '>'))) {
      if (toks[i + 2]?.kind === 'number') toTok = toks[i + 2]
      else open = true
    }
    const to = toTok ? readNum(toTok) : null
    const skip = toTok ? 2 : open ? 1 : 0
    const label = `${t.text}${toTok ? ` Thru ${toTok.text}` : open ? ' Thru' : ''}`

    if (SIMPLE_KINDS.has(kind)) {
      const map = maps[kind as SimpleKind]
      if (map && from.minor === undefined && (!to || to.minor === undefined)) {
        const r = shiftRange(map, from.major, to ? to.major : open ? 'end' : undefined)
        if (typeof r === 'object') {
          edit(t, String(r.from))
          if (toTok && r.to !== undefined) edit(toTok, String(r.to))
        } else if (!(r === 'missing' && creating())) report(kind, label)
      }
    } else if (kind === 'preset' && maps.preset) {
      // "Preset 4.2" = family 4, number 2; "Preset 2" = Preset 0.2, else the only preset numbered 2
      const one = (tok: Token, n: Num): { text: string } | 'missing' | 'unresolved' => {
        const number = n.minor === undefined ? n.major : n.minor
        let family = n.minor === undefined ? undefined : n.major
        if (family === undefined) {
          if (maps.preset!.get(0)?.has(number)) family = 0
          else {
            const families = [...maps.preset!].filter(([, m]) => m.has(number)).map(([f]) => f)
            if (families.length !== 1) return 'missing'
            family = families[0]
          }
        }
        const m = maps.preset!.get(family)
        if (!m?.has(number)) return 'missing'
        const v = m.get(number)
        if (v === null || v === undefined) return 'unresolved'
        if (v === number) return { text: tok.text }
        // A bare number of another family is written in full: it may not be unique in the merged show
        return { text: n.minor === undefined && family === 0 ? String(v) : `${family}.${v}` }
      }
      const a = one(t, from)
      const b = toTok && to ? one(toTok, to) : null
      if (typeof a === 'object' && (b === null || typeof b === 'object')) {
        edit(t, a.text)
        if (toTok && b) edit(toTok, b.text)
      } else if (!((a === 'missing' || b === 'missing') && creating())) report('preset', label)
    } else if (kind === 'executor' && maps.page) {
      // "Executor 2.5" = page 2, slot 5; "Executor 5" = the current page (kept)
      const one = (n: Num): string | null | undefined => {
        if (n.minor === undefined) return String(n.major)
        if (!maps.page!.has(n.major)) return undefined
        const p = maps.page!.get(n.major)
        return p === null || p === undefined ? null : `${p}.${n.minor}`
      }
      const a = one(from)
      const b = to ? one(to) : 'none'
      if (typeof a === 'string' && typeof b === 'string') {
        edit(t, a)
        if (toTok && to) edit(toTok, b)
      } else if (!((a === undefined || b === undefined) && creating())) report('executor', label)
    }
    i += skip
  }

  if (edits.length === 0) return { text, changed: false, unresolved }
  let out = text
  for (const e of edits.sort((x, y) => y.at - x.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end)
  return { text: out, changed: out !== text, unresolved }
}
