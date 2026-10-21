// ============================================================
// PhotonBoard — grandMA XML helpers (pure)
// Every element is parsed as an array (uniform traversal), attributes
// keep their original case and are looked up case-insensitively:
// grandMA2 writes snake_case (`fixture_id`), grandMA3 PascalCase
// (`FixtureType`), and both changed spellings between versions.
// ============================================================

import { XMLParser } from 'fast-xml-parser'

export type XmlNode = Record<string, unknown>

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true, // only the 5 XML entities (&quot; in macro lines); no DOCTYPE entities
  htmlEntities: false,
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  alwaysCreateTextNode: true,
  removeNSPrefix: true,
  isArray: (_name: string, _jpath: unknown, _isLeaf: boolean, isAttribute: boolean) => !isAttribute
} as const

/** Decode bytes (UTF-8 / UTF-16 with BOM) into text */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Refuse DOCTYPE (entity expansion) and parse; returns the document node */
export function parseXml(text: string): XmlNode {
  if (/<!DOCTYPE/i.test(text.slice(0, 4096))) throw new Error('DOCTYPE is not allowed in grandMA XML')
  const parser = new XMLParser(PARSER_OPTIONS)
  return parser.parse(text) as XmlNode
}

/** Child elements with this tag (case-insensitive) */
export function children(node: XmlNode | undefined, tag: string): XmlNode[] {
  if (!node) return []
  const direct = node[tag]
  if (Array.isArray(direct)) return direct.filter(isNode)
  const lower = tag.toLowerCase()
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key.toLowerCase() !== lower) continue
    const v = node[key]
    return Array.isArray(v) ? v.filter(isNode) : []
  }
  return []
}

export function child(node: XmlNode | undefined, tag: string): XmlNode | undefined {
  return children(node, tag)[0]
}

/** All descendants with this tag, in document order per branch (depth first) */
export function descendants(node: XmlNode | undefined, tag: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out
  const lower = tag.toLowerCase()
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue
    const v = node[key]
    if (!Array.isArray(v)) continue
    for (const c of v) {
      if (!isNode(c)) continue
      if (key.toLowerCase() === lower) out.push(c)
      descendants(c, tag, out)
    }
  }
  return out
}

/** Names of the child element tags of a node */
export function childTags(node: XmlNode | undefined): string[] {
  if (!node) return []
  return Object.keys(node).filter(k => !k.startsWith('@_') && k !== '#text' && k !== '?xml' && !k.startsWith('?'))
}

function isNode(v: unknown): v is XmlNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Attribute (case-insensitive, several spellings accepted) */
export function attr(node: XmlNode | undefined, ...names: string[]): string | undefined {
  if (!node) return undefined
  for (const name of names) {
    const v = node['@_' + name]
    if (v !== undefined && v !== null) return String(v)
  }
  const wanted = new Set(names.map(n => n.toLowerCase()))
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') && wanted.has(key.slice(2).toLowerCase())) {
      const v = node[key]
      if (v !== undefined && v !== null) return String(v)
    }
  }
  return undefined
}

/** Text content of an element (or of its first child with that tag) */
export function text(node: XmlNode | undefined, tag?: string): string | undefined {
  const n = tag ? child(node, tag) : node
  if (!n) return undefined
  const t = n['#text']
  if (t === undefined || t === null) return undefined
  return Array.isArray(t) ? t.join('') : String(t)
}

export function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const s = v.trim().replace(',', '.')
  if (s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

export function yes(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined
  const s = v.trim().toLowerCase()
  if (s === 'yes' || s === 'true' || s === '1' || s === 'on' || s === 'enabled') return true
  if (s === 'no' || s === 'false' || s === '0' || s === 'off' || s === 'disabled') return false
  return undefined
}

/**
 * grandMA time value → seconds. Accepts "2", "2.000", "2s", "1m30", "1:30",
 * "0.5 s"; MA3 before 2.3 stored raw times (1 s = 16777216) in some places:
 * integers ≥ 2^20 are converted. "CueTiming", "None", "" → undefined.
 */
export function maTime(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const s = v.trim().toLowerCase()
  if (!s || /^(none|cuetiming|cue timing|default|-)$/.test(s)) return undefined
  let m = /^(\d+):(\d+(?:[.,]\d+)?)$/.exec(s)
  if (m) return Number(m[1]) * 60 + Number(m[2].replace(',', '.'))
  m = /^(?:(\d+(?:[.,]\d+)?)h)?\s*(?:(\d+(?:[.,]\d+)?)m)?\s*(?:(\d+(?:[.,]\d+)?)\s*s?)?$/.exec(s)
  if (m && (m[1] || m[2] || m[3])) {
    const h = m[1] ? Number(m[1].replace(',', '.')) : 0
    const mi = m[2] ? Number(m[2].replace(',', '.')) : 0
    const se = m[3] ? Number(m[3].replace(',', '.')) : 0
    let total = h * 3600 + mi * 60 + se
    if (!m[1] && !m[2] && Number.isInteger(se) && se >= 1 << 20) total = se / 16777216
    return Number.isFinite(total) && total >= 0 ? Math.min(total, 3600) : undefined
  }
  return undefined
}

/** "  1", "1.5", "1.500" → 1.5; MA2 number + sub_number (thousandths) */
export function cueNumber(v: string | undefined, sub?: string): number | undefined {
  const n = num(v)
  if (n === undefined) return undefined
  const s = num(sub)
  if (s !== undefined && s > 0) return Math.round((Math.trunc(n) + s / 1000) * 1000) / 1000
  return Math.round(n * 1000) / 1000
}
