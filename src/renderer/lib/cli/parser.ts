// ============================================================
// PhotonBoard — Command line: parser
//
//   command   := [action] [objectExpr] ["At" valueExpr | "At" object] {option} ["text"]
//              | valueExpr                       (At / Full / Zero on the selection)
//   objectExpr:= ["+"|"-"] object {("+"|"-") object} ["If" object]
//   object    := [keyword] idList [Sequence id | Cue idList]
//   idList    := range {("+"|"-") range}
//   range     := id ["Thru" [id]] | "Thru" id      (">" = Thru, legacy)
//   valueExpr := ("Full" | "Zero" | n ["Thru" n] | "Preset" id) ["Fade" n] ["Delay" n]
//   option    := "/" word ["=" value]             (anywhere on the line)
//
// parse() never throws. `expected` lists what may come at the END of
// the input (autocomplete chips); while a word is being typed (no
// trailing space) it lists the keywords that word can still become.
// ============================================================

import type {
  CliAst, CliExpectation, CliId, CliIdRange, CliObjectExpr, CliObjectKind, CliObjectRef, CliOption, CliParseError,
  CliParseResult, CliValueExpr
} from './ast'
import { ACTION_KEYWORDS, OBJECT_KEYWORDS, displayKeyword, tokenize, type Token } from './tokenizer'

/** Object a bare number means after each action (`Go 3` = Sequence 3, `Store 5` = Cue 5) */
export const DEFAULT_OBJECT: Readonly<Record<string, CliObjectKind>> = {
  store: 'cue', update: 'cue', delete: 'cue', copy: 'cue', move: 'cue', label: 'cue', goto: 'cue',
  assign: 'sequence', go: 'sequence', 'go-': 'sequence', off: 'sequence', pause: 'sequence', stop: 'sequence',
  release: 'sequence', edit: 'sequence', select: 'fixture', call: 'preset', highlight: 'fixture', park: 'fixture',
  unpark: 'fixture', macro: 'macro', page: 'page'
}

/** Actions taking no object */
const BARE_ACTIONS = new Set(['clear', 'clearall', 'clearselection', 'oops', 'redo', 'next', 'prev', 'all', 'set'])
/** Actions taking an optional On / Off */
const TOGGLE_ACTIONS = new Set(['blind', 'blackout', 'highlight'])

/** Every option the command line knows (name → takes a value) */
export const CLI_OPTIONS: Readonly<Record<string, boolean>> = {
  merge: false, overwrite: false, remove: false, cueonly: false, block: false, filter: true,
  global: false, universal: false, selective: false, dmx: false, button: true
}

/** Feature names accepted by /filter= (→ CueFeature) */
export const FILTER_FEATURES: Readonly<Record<string, 'intensity' | 'position' | 'colour' | 'beam' | 'control'>> = {
  intensity: 'intensity', dimmer: 'intensity', position: 'position', colour: 'colour', color: 'colour',
  beam: 'beam', gobo: 'beam', focus: 'beam', control: 'control'
}

/** Button functions accepted by /button= */
export const BUTTON_FUNCTIONS = ['toggle', 'go', 'goBack', 'flash', 'temp', 'off', 'select', 'swap', 'pause', 'learn'] as const

/** Options offered after each action */
const ACTION_OPTIONS: Readonly<Record<string, string[]>> = {
  store: ['/merge', '/overwrite', '/remove', '/cueonly', '/block', '/filter=', '/global', '/universal', '/selective'],
  update: ['/merge', '/overwrite', '/filter='],
  copy: ['/overwrite', '/merge'],
  move: ['/overwrite'],
  assign: ['/button='],
  '': ['/dmx'],
  park: ['/dmx']
}

const ACTIONS_DISPLAY = Object.keys(ACTION_KEYWORDS).map(displayKeyword)
const OBJECTS_DISPLAY = Object.values(OBJECT_KEYWORDS)

class Fail {
  constructor(public code: string, public tok: Token) {}
}

class Parser {
  private i = 0
  offers: CliExpectation[] = []

  constructor(private toks: Token[]) {}

  get cur(): Token { return this.toks[this.i] }
  get nxt(): Token { return this.toks[Math.min(this.i + 1, this.toks.length - 1)] }

  advance(): Token {
    const t = this.cur
    if (t.kind !== 'eof') this.i++
    return t
  }

  /** Record what would be accepted here (only when the input ends here) */
  offer(...e: CliExpectation[]): void {
    if (this.cur.kind === 'eof') this.offers.push(...e)
  }

  kwOf(t: Token): string | undefined {
    return t.kind === 'word' ? t.keyword : undefined
  }

  isKw(...k: string[]): boolean {
    const x = this.kwOf(this.cur)
    return x !== undefined && k.includes(x)
  }

  isOp(...o: string[]): boolean {
    return this.cur.kind === 'op' && o.includes(this.cur.text)
  }

  /** Fail at the current token; unknown / ambiguous words get their own code */
  fail(code: string, tok: Token = this.cur): never {
    if (tok.kind === 'word' && tok.match === 'unknown') throw new Fail('unknownWord', tok)
    if (tok.kind === 'word' && tok.match === 'ambiguous') throw new Fail('ambiguous', tok)
    if (tok.kind === 'word' && tok.match === 'channel') throw new Fail('unexpected', tok)
    if (tok.kind === 'string' && tok.unterminated) throw new Fail('unterminatedString', tok)
    if (tok.kind === 'op' && !'+-=><,'.includes(tok.text)) throw new Fail('unexpectedChar', tok)
    throw new Fail(code, tok)
  }

  // ------------------------------------------------------------ line

  line(source: string): CliAst | null {
    const ast: CliAst = { options: [], source }
    const t = this.cur
    if (t.kind === 'eof') {
      this.offer(
        { kind: 'action', values: ACTIONS_DISPLAY },
        { kind: 'object', values: OBJECTS_DISPLAY },
        { kind: 'value', values: ['At', 'Full', 'Zero', 'If'] },
        { kind: 'number', helpKey: 'fixture' }
      )
      return null
    }
    if (t.kind === 'word' && t.channel) {
      // Legacy: `Gobo 30` (DMX value)
      this.advance()
      ast.action = 'attribute'
      ast.text = t.channel
      this.offer({ kind: 'value', values: ['At'] }, { kind: 'number', helpKey: 'attribute' })
      if (this.isKw('at')) this.advance()
      ast.amount = this.number()
    } else if (t.kind === 'word' && t.keyword && ACTION_KEYWORDS[t.keyword]) {
      this.advance()
      ast.action = t.keyword
      this.afterAction(ast)
    } else {
      this.selectionLine(ast)
    }
    this.end(ast)
    return ast
  }

  private selectionLine(ast: CliAst): void {
    if (this.isKw('if')) {
      this.advance()
      ast.objects = { items: [], condition: this.objectRef('fixture') }
    } else if (this.isKw('at', 'full', 'zero')) {
      this.valueOpt(ast, false)
      return
    } else {
      ast.objects = this.objectExpr('fixture', true)
      this.condition(ast.objects)
    }
    this.valueOpt(ast, !ast.objects.items.some(i => i.object.kind === 'preset'))
  }

  private afterAction(ast: CliAst): void {
    const a = ast.action!
    if (a === 'fade' || a === 'delay') {
      this.offer({ kind: 'number', helpKey: a }, { kind: 'value', values: ['Off'] })
      if (this.isKw('off')) { this.advance(); ast.amount = 0 } else ast.amount = this.number()
      return
    }
    if (a === 'align') {
      this.offer({ kind: 'value', values: ['<', '>', '<>', '><', 'Off'] })
      if (this.isKw('off')) { this.advance(); ast.text = 'off'; return }
      let text = ''
      while (this.isOp('<', '>') && text.length < 2 && (text === '' || this.cur.at === this.toks[this.i - 1].end)) text += this.advance().text
      if (!text) this.fail('expectedValue')
      ast.text = text
      return
    }
    if (a === 'page' && this.isOp('+', '-')) {
      ast.text = this.advance().text
      return
    }
    if (BARE_ACTIONS.has(a)) return
    if (a === 'blind' || a === 'blackout') {
      this.onOff(ast)
      return
    }
    const def = DEFAULT_OBJECT[a] ?? 'fixture'
    this.offer({ kind: 'object', values: OBJECTS_DISPLAY }, { kind: 'number', helpKey: def })
    if (this.objectStart()) {
      ast.objects = this.objectExpr(def, false)
      this.condition(ast.objects)
    }
    if (a === 'copy' || a === 'move' || a === 'assign') {
      this.offer({ kind: 'value', values: ['At'] })
      if (this.isKw('at')) {
        this.advance()
        const first = ast.objects?.items[0]?.object
        ast.target = this.objectRef(a === 'assign' ? 'executor' : first?.kind ?? 'cue')
      } else if (a !== 'assign' && ast.objects) this.fail('expectedTarget')
    }
    if (a === 'park') this.valueOpt(ast, false)
    if (TOGGLE_ACTIONS.has(a)) this.onOff(ast)
    if (a === 'label' || a === 'store') {
      this.offer({ kind: 'text', helpKey: a === 'label' ? 'label' : 'storeName' })
      if (this.cur.kind === 'string') {
        if (this.cur.unterminated) this.fail('unterminatedString')
        ast.text = this.advance().value ?? ''
      } else if (a === 'label') this.fail('expectedText')
    }
  }

  private onOff(ast: CliAst): void {
    this.offer({ kind: 'value', values: ['On', 'Off'] })
    if (this.isKw('on', 'off')) ast.text = this.kwOf(this.advance())
  }

  private objectStart(): boolean {
    const t = this.cur
    if (t.kind === 'number') return true
    const k = this.kwOf(t)
    return k === 'thru' || (k !== undefined && k in OBJECT_KEYWORDS)
  }

  private condition(expr: CliObjectExpr): void {
    this.offer({ kind: 'object', values: ['If'] })
    if (this.isKw('if')) {
      this.advance()
      expr.condition = this.objectRef('fixture')
    }
  }

  /** At value · Full / Zero · (Fixture 1) Preset 4.2 */
  private valueOpt(ast: CliAst, allowPreset: boolean): void {
    this.offer({ kind: 'value', values: allowPreset ? ['At', 'Full', 'Zero', 'Preset'] : ['At', 'Full', 'Zero'] })
    if (this.isKw('at')) {
      this.advance()
      ast.value = this.valueExpr()
    } else if (this.isKw('full', 'zero') || (allowPreset && this.isKw('preset'))) {
      ast.value = this.valueExpr()
    }
  }

  // ------------------------------------------------------------ objects

  private objectExpr(defaultKind: CliObjectKind, allowRelative: boolean): CliObjectExpr {
    const expr: CliObjectExpr = { items: [] }
    let op: '+' | '-' = '+'
    if (allowRelative && this.isOp('+', '-')) {
      expr.relative = true
      op = this.advance().text as '+' | '-'
    }
    let ref = this.objectRef(defaultKind)
    expr.items.push({ op, object: ref })
    while (this.isOp('+', '-')) {
      op = this.advance().text as '+' | '-'
      ref = this.objectRef(ref.kind)
      expr.items.push({ op, object: ref })
    }
    return expr
  }

  objectRef(defaultKind: CliObjectKind): CliObjectRef {
    this.offer({ kind: 'object', values: OBJECTS_DISPLAY }, { kind: 'number', helpKey: defaultKind })
    const t = this.cur
    const k = this.kwOf(t)
    let kind: CliObjectKind
    let implicit = false
    if (k !== undefined && k in OBJECT_KEYWORDS) {
      kind = k as CliObjectKind
      this.advance()
    } else if (t.kind === 'number' || k === 'thru') {
      kind = defaultKind
      implicit = true
    } else {
      this.fail('expectedObject')
    }
    let ref: CliObjectRef = { kind, ids: this.idList(kind) }
    if (implicit) ref.implicit = true
    if (kind === 'cue') {
      this.offer({ kind: 'object', values: ['Sequence'] })
      if (this.isKw('sequence')) {
        this.advance()
        ref.parent = { kind: 'sequence', ids: this.idList('sequence') }
      }
    } else if (kind === 'sequence') {
      this.offer({ kind: 'object', values: ['Cue'] })
      if (this.isKw('cue')) {
        this.advance()
        ref = { kind: 'cue', ids: this.idList('cue'), parent: ref }
      }
    }
    return ref
  }

  private idList(kind: CliObjectKind): CliObjectRef['ids'] {
    const ids: CliObjectRef['ids'] = []
    let op: '+' | '-' = '+'
    for (;;) {
      const range = this.range(kind)
      ids.push({ op, range })
      this.offer({ kind: 'number', values: range.to === undefined ? ['Thru', '+', '-'] : ['+', '-'] })
      const n = this.nxt
      if (this.isOp('+', '-') && (n.kind === 'number' || this.kwOf(n) === 'thru')) {
        op = this.advance().text as '+' | '-'
        continue
      }
      return ids
    }
  }

  private range(kind: CliObjectKind): CliIdRange {
    this.offer({ kind: 'number', helpKey: kind, values: ['Thru'] })
    if (this.isKw('thru')) {
      this.advance()
      this.offer({ kind: 'number', helpKey: kind })
      return { from: { major: 0 }, to: this.id() }
    }
    const from = this.id()
    if (this.isKw('thru') || this.isOp('>')) {
      this.advance()
      this.offer({ kind: 'number', helpKey: kind })
      if (this.cur.kind === 'number') return { from, to: this.id() }
      return { from, to: 'end' }
    }
    return { from }
  }

  private id(): CliId {
    const t = this.cur
    if (t.kind !== 'number') this.fail('expectedNumber')
    if (t.dangling) {
      if (this.nxt.kind === 'eof') this.offers.push({ kind: 'number' })
      this.fail('expectedNumber', t)
    }
    this.advance()
    const [a, b] = t.text.split('.')
    const id: CliId = { major: a === '' ? 0 : parseInt(a, 10), text: t.text }
    if (b !== undefined) id.minor = parseInt(b, 10)
    return id
  }

  private number(): number {
    const t = this.cur
    if (t.kind !== 'number') this.fail('expectedNumber')
    if (t.dangling) {
      if (this.nxt.kind === 'eof') this.offers.push({ kind: 'number' })
      this.fail('expectedNumber', t)
    }
    this.advance()
    return parseFloat(t.text)
  }

  // ------------------------------------------------------------ values

  private valueExpr(): CliValueExpr {
    this.offer({ kind: 'value', values: ['Full', 'Zero', 'Preset'] }, { kind: 'number', helpKey: 'value' })
    let expr: CliValueExpr
    if (this.isKw('full')) { this.advance(); expr = { value: { kind: 'level', from: 100 } } }
    else if (this.isKw('zero', 'off')) { this.advance(); expr = { value: { kind: 'level', from: 0 } } }
    else if (this.isKw('preset')) {
      this.advance()
      this.offer({ kind: 'number', helpKey: 'preset' })
      expr = { value: { kind: 'preset', id: this.id() } }
    } else if (this.cur.kind === 'number') {
      const from = this.number()
      this.offer({ kind: 'number', values: ['Thru'] })
      if (this.isKw('thru')) {
        this.advance()
        this.offer({ kind: 'number', helpKey: 'value' })
        expr = { value: { kind: 'level', from, to: this.number() } }
      } else expr = { value: { kind: 'level', from } }
    } else this.fail('expectedValue')
    for (;;) {
      const more = [expr.fade === undefined ? 'Fade' : '', expr.delay === undefined ? 'Delay' : ''].filter(Boolean)
      if (more.length) this.offer({ kind: 'value', values: more })
      if (expr.fade === undefined && this.isKw('fade')) {
        this.advance()
        this.offer({ kind: 'number', helpKey: 'fade' })
        expr.fade = this.number()
      } else if (expr.delay === undefined && this.isKw('delay')) {
        this.advance()
        this.offer({ kind: 'number', helpKey: 'delay' })
        expr.delay = this.number()
      } else return expr
    }
  }

  private end(ast: CliAst): void {
    const opts = ACTION_OPTIONS[ast.action ?? ''] ?? []
    if (opts.length) this.offer({ kind: 'option', values: opts })
    this.offer({ kind: 'end' })
    if (this.cur.kind !== 'eof') this.fail('unexpected')
  }
}

// ---------------------------------------------------------------- options

function readOptions(tokens: Token[]): { options: CliOption[]; error?: CliParseError } {
  const options: CliOption[] = []
  for (const t of tokens) {
    if (t.kind !== 'option' || !t.option) continue
    const { name, value } = t.option
    if (name === '' || !(name in CLI_OPTIONS)) return { options, error: { code: name === '' ? 'badOption' : 'unknownOption', at: t.at, token: t.text } }
    if (CLI_OPTIONS[name] && !value) return { options, error: { code: 'optionValue', at: t.at, token: t.text } }
    if (name === 'filter') {
      const bad = value!.split(',').map(s => s.trim().toLowerCase()).find(f => f && !(f in FILTER_FEATURES))
      if (bad !== undefined) return { options, error: { code: 'badFilter', at: t.at, token: bad } }
    }
    if (name === 'button' && !BUTTON_FUNCTIONS.some(b => b.toLowerCase() === value!.toLowerCase())) {
      return { options, error: { code: 'badButton', at: t.at, token: value } }
    }
    options.push(value === undefined ? { name } : { name, value })
  }
  return { options }
}

// ---------------------------------------------------------------- expectations

function mergeExpectations(list: CliExpectation[]): CliExpectation[] {
  const out: CliExpectation[] = []
  for (const e of list) {
    const same = out.find(o => o.kind === e.kind && o.helpKey === e.helpKey)
    if (!same) { out.push({ ...e, ...(e.values ? { values: [...e.values] } : {}) }); continue }
    if (e.values) {
      same.values ??= []
      for (const v of e.values) if (!same.values.includes(v)) same.values.push(v)
    }
  }
  return out
}

function run(tokens: Token[], source: string): { ast?: CliAst; error?: CliParseError; expected: CliExpectation[] } {
  const words = tokens.filter(t => t.kind !== 'option')
  const p = new Parser(words)
  try {
    const ast = p.line(source)
    return ast ? { ast, expected: mergeExpectations(p.offers) } : { expected: mergeExpectations(p.offers) }
  } catch (e) {
    if (e instanceof Fail) {
      const error: CliParseError = { code: e.code, at: e.tok.at }
      if (e.tok.kind !== 'eof') error.token = e.tok.text
      return { error, expected: mergeExpectations(p.offers) }
    }
    return { error: { code: 'internal', at: 0 }, expected: [] }
  }
}

/** Parse a command line. Never throws. */
export function parse(input: string): CliParseResult {
  try {
    const source = input.trim()
    const tokens = tokenize(input)
    const res = run(tokens, source)
    const opts = readOptions(tokens)
    if (!res.ast && !res.error) {
      // Options alone ("/merge"): nothing to apply them to
      const first = tokens.find(t => t.kind === 'option')
      if (first) return { error: { code: 'unexpected', at: first.at, token: first.text }, expected: res.expected }
    }
    if (res.ast) {
      if (opts.error) return { error: opts.error, expected: res.expected }
      res.ast.options = opts.options
    }

    // A word being typed (no trailing space): what can it still become?
    const last = tokens[tokens.length - 2]
    if (last && last.kind === 'word' && last.end === input.length && last.text !== '@') {
      const before = tokens.slice(0, tokens.length - 2).filter(t => t.kind !== 'option')
      before.push({ kind: 'eof', text: '', at: last.at, end: last.at })
      const prefix = last.text.toLowerCase()
      const completions: CliExpectation[] = []
      for (const e of run(before, source).expected) {
        const values = e.values?.filter(v => v.toLowerCase().startsWith(prefix))
        if (values && values.length) completions.push({ ...e, values })
      }
      const others = completions.some(e => e.values!.some(v => v.toLowerCase() !== prefix))
      if (others || last.match !== 'exact') {
        const out: CliParseResult = { expected: mergeExpectations([...completions, ...(res.ast ? res.expected : [])]) }
        if (res.ast) out.ast = res.ast
        if (res.error) out.error = res.error
        return out
      }
    }
    const out: CliParseResult = { expected: res.expected }
    if (res.ast) out.ast = res.ast
    if (res.error) out.error = res.error
    return out
  } catch {
    return { error: { code: 'internal', at: 0 }, expected: [] }
  }
}
