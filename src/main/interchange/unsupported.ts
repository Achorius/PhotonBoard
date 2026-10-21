// ============================================================
// PhotonBoard — Closed / binary formats we recognise but cannot read
// (grandMA2/3 show files, MagicQ .shw, Eos .esf, Onyx, Lightkey…).
// Instead of "unknown file", the wizard explains how to export the
// data from the original console into an open format PhotonBoard
// reads (texts: renderer i18n `interchange.guidance.<key>`).
// Pure module (no Electron): unit-tested.
// ============================================================

import type { InterchangeFormatId, UnsupportedFormatGuidance } from '../../shared/interchange'

export interface UnsupportedFormat {
  key: string
  app: string
  /** Lower-case extensions without dot; multi-part ones first ("show.gz") */
  extensions: string[]
  suggestedFormats: InterchangeFormatId[]
  /** Optional content check on the first bytes (true = it is this format) */
  magic?: (head: Uint8Array) => boolean
}

const isGzip = (h: Uint8Array) => h.length >= 2 && h[0] === 0x1f && h[1] === 0x8b

function asciiHead(h: Uint8Array, max = 4096): string {
  let s = ''
  const n = Math.min(h.length, max)
  for (let i = 0; i < n; i++) s += String.fromCharCode(h[i])
  return s
}

/** Most specific first: the first match wins */
export const UNSUPPORTED_FORMATS: UnsupportedFormat[] = [
  { key: 'grandma2Show', app: 'grandMA2', extensions: ['show.gz'], suggestedFormats: ['ma2-xml', 'csv-patch'] },
  {
    key: 'grandma3Show',
    app: 'grandMA3',
    extensions: ['show'],
    suggestedFormats: ['mvr', 'ma3-xml', 'gdtf', 'csv-patch'],
    // grandMA2 shows renamed without .gz are gzip too
    magic: (h) => !isGzip(h) || h.length < 2
  },
  { key: 'grandma2Show', app: 'grandMA2', extensions: ['show'], suggestedFormats: ['ma2-xml', 'csv-patch'], magic: isGzip },
  { key: 'magicqShow', app: 'ChamSys MagicQ', extensions: ['shw', 'sbk', 'shw.bak'], suggestedFormats: ['csv-patch', 'usitt-ascii', 'mvr'] },
  { key: 'eosShow', app: 'ETC Eos', extensions: ['esf3d', 'esf2', 'esf'], suggestedFormats: ['usitt-ascii', 'csv-patch', 'mvr'] },
  { key: 'cobaltShow', app: 'ETC Cobalt', extensions: ['csf'], suggestedFormats: ['usitt-ascii', 'csv-patch'] },
  { key: 'onyxShow', app: 'Obsidian Onyx', extensions: ['onyxshow'], suggestedFormats: ['csv-patch', 'mvr'] },
  { key: 'lightkeyProject', app: 'Lightkey', extensions: ['lightkeyproj'], suggestedFormats: ['csv-patch'] },
  { key: 'sunliteProfile', app: 'Sunlite / Daslight / ESA', extensions: ['ssl2', 'ssl'], suggestedFormats: ['gdtf', 'ofl-fixture', 'qlcplus-fixture', 'csv-patch'] },
  { key: 'consoleBackup', app: 'Avolites Titan / Hog 4', extensions: ['tar.gz', 'tgz'], suggestedFormats: ['csv-patch', 'mvr', 'usitt-ascii'] },
  { key: 'cadDrawing', app: 'Vectorworks / WYSIWYG / Capture', extensions: ['vwx', 'wyg', 'lw6', 'lw7', 'c2p', 'c2q'], suggestedFormats: ['mvr', 'csv-patch'] },
  { key: 'spreadsheet', app: 'Excel / Numbers / LibreOffice', extensions: ['xlsx', 'xlsm', 'xls', 'ods', 'numbers'], suggestedFormats: ['csv-patch'] }
]

/** "Show.Show.GZ" → true for 'show.gz' */
function hasExtension(fileName: string, ext: string): boolean {
  return fileName.toLowerCase().endsWith(`.${ext}`)
}

/**
 * Guidance for a recognised closed format, null otherwise. Run only when
 * no importer claimed the file.
 */
export function detectUnsupported(fileName: string, head: Uint8Array): UnsupportedFormatGuidance | null {
  for (const f of UNSUPPORTED_FORMATS) {
    const ext = f.extensions.find((e) => hasExtension(fileName, e))
    if (!ext) continue
    if (f.magic && !f.magic(head)) continue
    return { key: f.key, app: f.app, suggestedFormats: [...f.suggestedFormats] }
  }
  // MagicQ text show files saved with another name
  if (/MagicQ/i.test(asciiHead(head, 512)) && !/^\s*[<{]/.test(asciiHead(head, 64))) {
    return { key: 'magicqShow', app: 'ChamSys MagicQ', suggestedFormats: ['csv-patch', 'usitt-ascii', 'mvr'] }
  }
  return null
}

/** Applications whose own files we recognise (Settings › About, docs) */
export function listUnsupported(): { key: string; app: string; extensions: string[] }[] {
  const byKey = new Map<string, { key: string; app: string; extensions: string[] }>()
  for (const f of UNSUPPORTED_FORMATS) {
    const cur = byKey.get(f.key) ?? { key: f.key, app: f.app, extensions: [] }
    for (const e of f.extensions) if (!cur.extensions.includes(e)) cur.extensions.push(e)
    byKey.set(f.key, cur)
  }
  return [...byKey.values()]
}
