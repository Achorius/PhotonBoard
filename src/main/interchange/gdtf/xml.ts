// ============================================================
// PhotonBoard — small XML helpers for the GDTF / MVR modules.
// Reading: fast-xml-parser with entity expansion disabled (no
// DOCTYPE / XXE / billion-laughs), every element as an array so
// access is uniform; the 5 predefined entities and numeric
// character references are decoded by hand.
// Writing: a tiny escaping element builder (pretty-printed).
// ============================================================

import { XMLParser } from 'fast-xml-parser'

/** A parsed element: attributes under "@_name", children as arrays, text under "#text" */
export type XNode = Record<string, any>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  commentPropName: '#comment',
  isArray: (_name: string, _jpath: unknown, _isLeaf: boolean, isAttribute: boolean) => !isAttribute
})

/** Parse XML text; throws on non-XML input */
export function parseXml(text: string): XNode {
  // Strip a UTF-8 BOM, which some exporters write
  return parser.parse(text.replace(/^﻿/, '')) as XNode
}

const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Decode XML entities left by the parser */
export function decodeXml(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITY[ent.toLowerCase()] ?? whole
  })
}

/** Children of `node` named `name` (always an array) */
export function kids(node: XNode | undefined | null, name: string): XNode[] {
  if (!node || typeof node !== 'object') return []
  const v = node[name]
  if (v === undefined || v === null) return []
  return (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'object' && x !== null ? x : { '#text': String(x) }))
}

/** First child named `name` */
export function kid(node: XNode | undefined | null, name: string): XNode | undefined {
  return kids(node, name)[0]
}

/** Attribute value (decoded), or undefined */
export function attr(node: XNode | undefined | null, name: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const v = node[`@_${name}`]
  if (v === undefined || v === null) return undefined
  return decodeXml(String(v))
}

/** Text content of an element (decoded, trimmed) */
export function text(node: XNode | undefined | null): string {
  if (node === undefined || node === null) return ''
  if (typeof node !== 'object') return decodeXml(String(node)).trim()
  const t = node['#text']
  if (t === undefined || t === null) return ''
  return decodeXml(Array.isArray(t) ? t.join('') : String(t)).trim()
}

/** Text of the first child named `name` */
export function childText(node: XNode | undefined | null, name: string): string {
  return text(kid(node, name))
}

/** Every element child with its tag name, in tag-group order (attributes / text skipped) */
export function elementChildren(node: XNode | undefined | null): { tag: string; node: XNode }[] {
  if (!node || typeof node !== 'object') return []
  const out: { tag: string; node: XNode }[] = []
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text' || key === '#comment') continue
    for (const n of kids(node, key)) out.push({ tag: key, node: n })
  }
  return out
}

// ---------------------------------------------------------------
// Writing
// ---------------------------------------------------------------

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not allowed in XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

export type XAttrs = Record<string, string | number | boolean | undefined | null>

/** An element to serialise: children elements, or text */
export interface XEl {
  tag: string
  attrs?: XAttrs
  children?: (XEl | null | undefined | false)[]
  text?: string
}

export function el(tag: string, attrs?: XAttrs, children?: (XEl | null | undefined | false)[] | string): XEl {
  return typeof children === 'string' ? { tag, attrs, text: children } : { tag, attrs, children }
}

function attrsToString(attrs: XAttrs | undefined): string {
  if (!attrs) return ''
  let s = ''
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue
    s += ` ${k}="${escapeXml(String(v))}"`
  }
  return s
}

function write(e: XEl, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth)
  const open = `${pad}<${e.tag}${attrsToString(e.attrs)}`
  const kidsList = (e.children ?? []).filter((c): c is XEl => !!c)
  if (e.text !== undefined) {
    out.push(`${open}>${escapeXml(e.text)}</${e.tag}>`)
  } else if (kidsList.length === 0) {
    out.push(`${open}/>`)
  } else {
    out.push(`${open}>`)
    for (const c of kidsList) write(c, depth + 1, out)
    out.push(`${pad}</${e.tag}>`)
  }
}

/** Serialise a document with the XML declaration */
export function serializeXml(root: XEl): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="no" ?>']
  write(root, 0, out)
  return out.join('\n') + '\n'
}

/** Number for XML: finite, no exponent, trailing zeros trimmed */
export function num(v: number, decimals = 6): string {
  if (!Number.isFinite(v)) return '0'
  let s = v.toFixed(decimals)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0') s = '0'
  return s
}
