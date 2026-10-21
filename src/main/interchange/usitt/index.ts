// ============================================================
// PhotonBoard — USITT ASCII importer / exporter
// ============================================================

import type { Exporter, Importer, InterchangeFormatInfo } from '../../../shared/interchange'
import { registerExporter, registerImporter } from '../registry'
import { usittToFragment } from './import'
import { readUsitt } from './read'
import { writeUsitt } from './write'

const INFO: InterchangeFormatInfo = {
  id: 'usitt-ascii',
  name: 'USITT ASCII (cues & patch)',
  extensions: ['asc', 'txt', 'usitt'],
  imports: ['fixtures', 'patch', 'groups', 'presets', 'cues'],
  exports: ['patch', 'groups', 'cues'],
  apps: ['ETC Eos / Ion / Element', 'ETC Expression / Congo', 'Strand', 'Jands', 'ChamSys MagicQ', 'grandMA2', 'OLC']
}

const KEYWORD_LINE = /^\s*(IDENT|MANUFACTURER|CONSOLE|CLEAR|SET|PATCH|CUE|GROUP|SUB|CHAN|UP|DOWN|TEXT|ENDDATA|\$\$?[A-Z]+)\b/i

/** Text decoding: UTF-8 when valid, Latin-1 otherwise (old consoles) */
export function decodeUsitt(bytes: Uint8Array): string {
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

export function detectUsitt(fileName: string, head: Uint8Array): number {
  if (head.length === 0) return 0
  // binary files are not USITT
  let ctrl = 0
  for (let i = 0; i < Math.min(head.length, 4096); i++) {
    const b = head[i]
    if (b === 0 || (b < 9) || (b > 13 && b < 32 && b !== 26)) ctrl++
  }
  if (ctrl > 4) return 0
  const text = decodeUsitt(head.subarray(0, Math.min(head.length, 16384)))
  if (/^\s*IDENT\s+3/im.test(text)) return 1
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim() && !l.trim().startsWith('!'))
  const hits = lines.slice(0, 200).filter(l => KEYWORD_LINE.test(l)).length
  const ratio = lines.length ? hits / Math.min(lines.length, 200) : 0
  const ext = /\.(asc|usitt)$/i.test(fileName)
  if (ext && hits >= 2 && ratio > 0.5) return 0.9
  if (hits >= 3 && ratio > 0.7 && /^\s*(CUE|PATCH)\b/im.test(text)) return ext ? 0.9 : 0.5
  return 0
}

export const usittImporter: Importer = {
  info: INFO,
  detect: detectUsitt,
  async parse(bytes, fileName) {
    const text = decodeUsitt(bytes)
    if (!/^\s*(IDENT|CUE|PATCH|GROUP|SUB|\$CUE)\b/im.test(text)) throw new Error('Not a USITT ASCII file')
    return usittToFragment(readUsitt(text), fileName)
  }
}

export const usittExporter: Exporter = {
  info: INFO,
  async write(show, fixtures) {
    const { text, warnings } = writeUsitt(show, fixtures)
    return { bytes: new TextEncoder().encode(text), warnings }
  }
}

registerImporter(usittImporter)
registerExporter(usittExporter)
