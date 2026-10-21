// ============================================================
// PhotonBoard — QLC+ interchange: XML helpers
// Reading: fast-xml-parser without entity expansion (no XXE /
// billion laughs); the five XML entities and character references
// are decoded here. Writing: a tiny streaming writer that produces
// the same layout as Qt's QXmlStreamWriter (1-space indent).
// Pure module.
// ============================================================

import { XMLParser } from 'fast-xml-parser'

export type XNode = Record<string, unknown>

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true
} as const

/** Parse XML text into plain objects (attributes as `@_Name`, text as `#text`). Throws on malformed XML. */
export function parseXml(text: string): XNode {
  const parser = new XMLParser(PARSER_OPTIONS)
  return parser.parse(text) as XNode
}

/** Decode the predefined XML entities and character references */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase()
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'amp') return '&'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    try { return Number.isFinite(code) ? String.fromCodePoint(code) : m } catch { return m }
  })
}

export function isNode(v: unknown): v is XNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Child element(s) as a list (absent → [], single → [x]) */
export function list(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/** Child elements of a node with this tag, as nodes (text-only elements become { '#text': … }) */
export function children(node: unknown, tag: string): XNode[] {
  if (!isNode(node)) return []
  return list(node[tag]).map((c) => (isNode(c) ? c : { '#text': c === undefined || c === null ? '' : String(c) }))
}

export function child(node: unknown, tag: string): XNode | undefined {
  return children(node, tag)[0]
}

/** Text content of a node or of a primitive */
export function text(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return decodeEntities(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return text(v[0])
  if (isNode(v) && '#text' in v) return text(v['#text'])
  return ''
}

/** Text of the first child element with this tag */
export function childText(node: unknown, tag: string): string {
  if (!isNode(node)) return ''
  return text(list(node[tag])[0]).trim()
}

export function attr(node: unknown, name: string): string | undefined {
  if (!isNode(node)) return undefined
  const v = node[`@_${name}`]
  if (v === undefined || v === null) return undefined
  return decodeEntities(String(v))
}

/** Unsigned / signed integer parse like Qt's toUInt / toInt (invalid → fallback) */
export function toInt(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback
  const s = v.trim()
  if (!/^[-+]?\d+$/.test(s)) return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

export function toFloat(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

export function isTrue(v: string | undefined): boolean {
  if (v === undefined) return false
  const s = v.trim().toLowerCase()
  return s === 'true' || s === '1'
}

// ---------------------------------------------------------------- writer

export function escapeXml(s: string, attribute = false): string {
  // Strip characters XML 1.0 cannot carry
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (attribute) out = out.replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;')
  return out
}

export type Attrs = Record<string, string | number | undefined>

/** Minimal indenting XML writer (Qt-like output: 1-space indent, self-closing empty elements) */
export class XmlWriter {
  private lines: string[] = []
  private stack: { tag: string; open: string; hasChildren: boolean; text?: string }[] = []

  constructor(private indentUnit = ' ') {}

  raw(line: string): this {
    this.lines.push(line)
    return this
  }

  private attrs(a?: Attrs): string {
    if (!a) return ''
    let s = ''
    for (const [k, v] of Object.entries(a)) {
      if (v === undefined) continue
      s += ` ${k}="${escapeXml(String(v), true)}"`
    }
    return s
  }

  private flushParent(): void {
    const parent = this.stack[this.stack.length - 1]
    if (parent && !parent.hasChildren) {
      this.lines.push(`${this.indentUnit.repeat(this.stack.length - 1)}${parent.open}>`)
      parent.hasChildren = true
    }
  }

  start(tag: string, a?: Attrs): this {
    this.flushParent()
    this.stack.push({ tag, open: `<${tag}${this.attrs(a)}`, hasChildren: false })
    return this
  }

  end(): this {
    const el = this.stack.pop()
    if (!el) return this
    const pad = this.indentUnit.repeat(this.stack.length)
    if (el.hasChildren) this.lines.push(`${pad}</${el.tag}>`)
    else if (el.text !== undefined && el.text !== '') this.lines.push(`${pad}${el.open}>${escapeXml(el.text)}</${el.tag}>`)
    else this.lines.push(`${pad}${el.open}/>`)
    return this
  }

  /** Text content of the current (childless) element */
  text(t: string | number): this {
    const el = this.stack[this.stack.length - 1]
    if (el) el.text = (el.text ?? '') + String(t)
    return this
  }

  /** <tag attrs>text</tag> */
  el(tag: string, content?: string | number, a?: Attrs): this {
    this.start(tag, a)
    if (content !== undefined) this.text(content)
    return this.end()
  }

  toString(): string {
    while (this.stack.length) this.end()
    return this.lines.join('\n') + '\n'
  }
}
