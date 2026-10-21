// ============================================================
// PhotonBoard — USITT ASCII reader (pure)
//
// "ASCII Text Representation for Lighting Console Data" (USITT 1991,
// version 3.0): line-oriented records, one primary keyword (IDENT,
// MANUFACTURER, CONSOLE, CLEAR, SET, PATCH, CUE, GROUP, SUB, ENDDATA)
// followed by secondary keywords (TEXT, UP, DOWN, WAIT, FOLLOWON, LINK,
// PART, CHAN). "!" starts a comment. Keywords beginning with "$" are
// manufacturer primaries, "$$" manufacturer secondaries; unknown ones are
// skipped (and counted). Supported extensions:
//   ETC Expression / Insight: $MlAttribute, $MlPers + $$MlPersChan,
//     $MlPatch + $$Pr + $$FixtPatch (moving lights on desk channels),
//     $$CueBlock, $FocusPoint (reported), $$Dwell…
//   ETC Eos / Congo / OLC: $SEQUENCE, $CUE <list> <cue>, $GROUP, $$TEXT
//     (UTF-8 label), $$WAIT, $$PARTTIME…
// Levels: decimal percent (0-100), "FL" / "FULL", hex "Hxx" (DMX 0-255).
// Channel / level separator "/" (standard) or "@" (ETC).
// ============================================================

import type { ImportWarning } from '../../../shared/interchange'

export interface UsittLevel {
  channel: number
  /** DMX 0-255 */
  value: number
}

export interface UsittCue {
  list: number
  number: number
  text?: string
  up?: number
  upDelay?: number
  down?: number
  downDelay?: number
  followOn?: number
  /** $$WAIT (seconds) */
  wait?: number
  link?: number
  block?: boolean
  levels: UsittLevel[]
  parts: { index: number; up?: number; upDelay?: number; down?: number; downDelay?: number; levels: UsittLevel[] }[]
}

export interface UsittGroup {
  number: number
  text?: string
  levels: UsittLevel[]
}

export interface UsittSub extends UsittGroup {
  up?: number
  down?: number
}

export interface UsittMlPersonality {
  name: string
  /** offset (0-based) → attribute number (0 = none), home value, flags */
  channels: { offset: number; attribute: number; home: number; flags: string }[]
}

export interface UsittMlFixture {
  number: number
  personality?: string
  /** First desk channel of the fixture */
  startChannel?: number
  /** 1-based output port (universe) and DMX address */
  port?: number
  address?: number
}

export interface UsittDocument {
  ident?: string
  manufacturer?: string
  console?: string
  softwareVersion?: string
  /** channel → dimmers (absolute DMX addresses, 1-based) with proportional level */
  patch: Map<number, { dimmer: number; level: number }[]>
  hasPatch: boolean
  cues: UsittCue[]
  groups: UsittGroup[]
  subs: UsittSub[]
  /** $MlAttribute number → name */
  mlAttributes: Map<number, string>
  mlPersonalities: Map<string, UsittMlPersonality>
  mlFixtures: UsittMlFixture[]
  /** $SEQUENCE / list names */
  lists: Map<number, string>
  warnings: ImportWarning[]
}

/** Level token → DMX 0-255, or null */
export function parseLevel(tok: string): number | null {
  const t = tok.trim().toUpperCase()
  if (t === 'FL' || t === 'FULL') return 255
  if (/^H[0-9A-F]{1,2}$/.test(t)) return parseInt(t.slice(1), 16)
  if (/^\d+(\.\d+)?$/.test(t)) {
    const p = Number(t)
    return Math.round((Math.min(100, Math.max(0, p)) * 255) / 100)
  }
  return null
}

/** "5", "2.5", "1:30", "1:02:03" → seconds */
export function parseTime(tok: string | undefined): number | undefined {
  if (tok === undefined) return undefined
  const t = tok.trim()
  if (!t) return undefined
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  const parts = t.split(':')
  if (parts.length >= 2 && parts.length <= 3 && parts.every(p => /^\d+(\.\d+)?$/.test(p))) {
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
  }
  return undefined
}

function parseCueNumber(tok: string | undefined): number | undefined {
  if (tok === undefined || !/^\d+(\.\d+)?$/.test(tok)) return undefined
  return Math.round(Number(tok) * 1000) / 1000
}

/** "1/50 2@H80 3/FL" → levels */
function parseChanTokens(tokens: string[], warnings: ImportWarning[]): UsittLevel[] {
  const out: UsittLevel[] = []
  for (const tok of tokens) {
    const m = /^(\d+)[/@](.+)$/.exec(tok)
    if (!m) {
      warnings.push({ level: 'warning', code: 'usitt.badLevel', message: `Unreadable channel level "${tok}"` })
      continue
    }
    const value = parseLevel(m[2])
    if (value === null) {
      warnings.push({ level: 'warning', code: 'usitt.badLevel', message: `Unreadable channel level "${tok}"` })
      continue
    }
    out.push({ channel: Number(m[1]), value })
  }
  return out
}

/** Split a line into tokens (comment removed, "<" and "@" in PATCH kept inside tokens) */
function tokenize(line: string): string[] {
  const bang = line.indexOf('!')
  const body = bang >= 0 ? line.slice(0, bang) : line
  return body.trim().split(/[\s,]+/).filter(Boolean)
}

type UsittRecord =
  | { kind: 'cue'; cue: UsittCue; part?: UsittCue['parts'][number] }
  | { kind: 'group'; group: UsittGroup }
  | { kind: 'sub'; sub: UsittSub }
  | { kind: 'mlpers'; pers: UsittMlPersonality }
  | { kind: 'mlpatch'; fixture: UsittMlFixture }
  | { kind: 'ignore'; keyword: string }
  | null

export function readUsitt(text: string): UsittDocument {
  const doc: UsittDocument = {
    patch: new Map(), hasPatch: false, cues: [], groups: [], subs: [], mlAttributes: new Map(),
    mlPersonalities: new Map(), mlFixtures: [], lists: new Map(), warnings: []
  }
  const ignored = new Map<string, number>()
  const ignore = (kw: string) => ignored.set(kw, (ignored.get(kw) ?? 0) + 1)
  let rec: UsittRecord = null
  let currentList = 1
  const lines = text.split(/\r\n|\r|\n/)
  for (const raw of lines) {
    const tokens = tokenize(raw)
    if (tokens.length === 0) continue
    const kw = tokens[0].toUpperCase()
    const args = tokens.slice(1)
    // Text keywords keep the rest of the line verbatim (comments allowed only on other lines)
    const restText = () => raw.replace(/^\s*\S+\s?/, '').trim()

    switch (kw) {
      case 'ENDDATA':
        rec = null
        break
      case 'IDENT': doc.ident = args.join(' '); rec = null; break
      case 'MANUFACTURER': doc.manufacturer = restText(); rec = null; break
      case 'CONSOLE': doc.console = restText(); rec = null; break
      case '$$SOFTWAREVERSION': doc.softwareVersion = restText(); break
      case 'CLEAR': case 'SET': rec = null; break
      case 'PATCH': {
        rec = null
        doc.hasPatch = true
        // PATCH page channel<dimmer@level …
        for (const tok of args.slice(1)) {
          const m = /^(\d+)<(\d+)(?:@(.+))?$/.exec(tok)
          if (!m) { doc.warnings.push({ level: 'warning', code: 'usitt.badPatch', message: `Unreadable patch entry "${tok}"` }); continue }
          const ch = Number(m[1])
          const dimmer = Number(m[2])
          const level = m[3] ? parseLevel(m[3]) ?? 255 : 255
          if (dimmer < 1) continue
          const list = doc.patch.get(ch) ?? []
          list.push({ dimmer, level })
          doc.patch.set(ch, list)
        }
        break
      }
      case 'CUE': case '$CUE': {
        // CUE number [page] — $CUE list number (Congo / OLC)
        const list = kw === '$CUE' ? Number(args[0]) || currentList : currentList
        const number = parseCueNumber(kw === '$CUE' ? args[1] : args[0])
        if (number === undefined) { rec = { kind: 'ignore', keyword: kw }; break }
        const cue: UsittCue = { list, number, levels: [], parts: [] }
        doc.cues.push(cue)
        rec = { kind: 'cue', cue }
        break
      }
      case '$SEQUENCE': {
        currentList = Number(args[0]) || 1
        if (args.length > 2) doc.lists.set(currentList, args.slice(2).join(' '))
        rec = null
        break
      }
      case 'GROUP': case '$GROUP': {
        const number = parseCueNumber(args[0])
        if (number === undefined) { rec = { kind: 'ignore', keyword: kw }; break }
        const existing = doc.groups.find(g => g.number === number)
        if (existing) { rec = { kind: 'ignore', keyword: kw }; break } // Congo $GROUP repeats GROUP
        const group: UsittGroup = { number, levels: [] }
        doc.groups.push(group)
        rec = { kind: 'group', group }
        break
      }
      case 'SUB': {
        const number = parseCueNumber(args[0])
        if (number === undefined) { rec = { kind: 'ignore', keyword: kw }; break }
        const sub: UsittSub = { number, levels: [] }
        doc.subs.push(sub)
        rec = { kind: 'sub', sub }
        break
      }
      case '$MLATTRIBUTE': {
        rec = null
        const n = Number(args[0])
        if (Number.isFinite(n) && args[1]) doc.mlAttributes.set(n, args.slice(1).join(' '))
        break
      }
      case '$MLPERS': {
        const pers: UsittMlPersonality = { name: restText(), channels: [] }
        doc.mlPersonalities.set(pers.name.toLowerCase(), pers)
        rec = { kind: 'mlpers', pers }
        break
      }
      case '$MLPATCH': {
        const fixture: UsittMlFixture = { number: Number(args[0]) || doc.mlFixtures.length + 1 }
        doc.mlFixtures.push(fixture)
        rec = { kind: 'mlpatch', fixture }
        break
      }

      // ---- secondary keywords
      case 'TEXT': case '$$TEXT': {
        const t = restText()
        if (!rec || !t) break
        // $$TEXT is the UTF-8 version of TEXT: prefer it
        if (rec.kind === 'cue') { if (kw === '$$TEXT' || !rec.cue.text) rec.cue.text = t }
        else if (rec.kind === 'group') { if (kw === '$$TEXT' || !rec.group.text) rec.group.text = t }
        else if (rec.kind === 'sub') { if (kw === '$$TEXT' || !rec.sub.text) rec.sub.text = t }
        break
      }
      case 'UP': case 'DOWN': {
        const time = parseTime(args[0])
        const delay = parseTime(args[1])
        if (rec?.kind === 'cue') {
          const target = rec.part ?? rec.cue
          if (kw === 'UP') { target.up = time; if (delay) target.upDelay = delay } else { target.down = time; if (delay) target.downDelay = delay }
        } else if (rec?.kind === 'sub') {
          if (kw === 'UP') rec.sub.up = time; else rec.sub.down = time
        }
        break
      }
      case 'FOLLOWON': case 'FOLLOW': {
        if (rec?.kind === 'cue') rec.cue.followOn = parseTime(args[0]) ?? 0
        break
      }
      case 'WAIT': case '$$WAIT': {
        const t = parseTime(args[0])
        if (rec?.kind === 'cue' && t !== undefined && t > 0) rec.cue.wait = t
        break
      }
      case 'LINK': case '$$LINK': {
        if (rec?.kind === 'cue') rec.cue.link = parseCueNumber(args[0])
        break
      }
      case 'PART': case '$$PART': {
        if (rec?.kind === 'cue') {
          const index = Number(args[0])
          if (Number.isFinite(index) && index >= 1) {
            const part = { index, levels: [] as UsittLevel[] }
            rec.cue.parts.push(part)
            rec = { kind: 'cue', cue: rec.cue, part }
          }
        }
        break
      }
      case '$$CUEBLOCK': {
        if (rec?.kind === 'cue' && Number(args[0]) === 1) rec.cue.block = true
        break
      }
      case 'CHAN': {
        const levels = parseChanTokens(args, doc.warnings)
        if (rec?.kind === 'cue') (rec.part ?? rec.cue).levels.push(...levels)
        else if (rec?.kind === 'group') rec.group.levels.push(...levels)
        else if (rec?.kind === 'sub') rec.sub.levels.push(...levels)
        else if (rec?.kind !== 'ignore') ignore('CHAN (outside a cue / group / sub)')
        break
      }
      case '$$MLPERSCHAN': case '$$MLPERSCH': {
        if (rec?.kind === 'mlpers') {
          const [offset, attribute, home] = args.map(Number)
          if (Number.isFinite(offset)) rec.pers.channels.push({ offset, attribute: attribute || 0, home: home || 0, flags: args.slice(3).join('').toUpperCase() })
        }
        break
      }
      case '$$PR': {
        if (rec?.kind === 'mlpatch') rec.fixture.personality = restText()
        break
      }
      case '$$FIXTPATCH': {
        if (rec?.kind === 'mlpatch') {
          const [start, port, offset] = args.map(Number)
          if (Number.isFinite(start)) rec.fixture.startChannel = start
          if (Number.isFinite(port)) rec.fixture.port = port
          if (Number.isFinite(offset)) rec.fixture.address = offset
        }
        break
      }
      default: {
        if (kw.startsWith('$$')) {
          ignore(kw)
        } else if (kw.startsWith('$')) {
          ignore(kw)
          rec = { kind: 'ignore', keyword: kw }
        } else {
          ignore(kw)
          rec = { kind: 'ignore', keyword: kw }
        }
      }
    }
  }
  if (ignored.size > 0) {
    const list = [...ignored.entries()].map(([k, n]) => `${k} (${n})`).join(', ')
    doc.warnings.push({ level: 'info', code: 'usitt.ignoredKeywords', message: `Keywords not imported: ${list}`, params: { count: ignored.size } })
  }
  return doc
}
