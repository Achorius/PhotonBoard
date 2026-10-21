// ============================================================
// CSV patch: importer (any table of fixtures) and two exporters
// (comma / Excel-friendly semicolon). Registered on import.
// ============================================================

import type { Exporter, Importer, InterchangeFormatInfo } from '../../../shared/interchange'
import { registerExporter, registerImporter } from '../registry'
import { importCsvPatch } from './import'
import { exportCsvPatch } from './export'
import { decodeText, detectDelimiter, parseRows } from './table'
import { looksLikeHeader } from './columns'

const APPS = ['grandMA2', 'grandMA3', 'ETC Eos', 'ChamSys MagicQ', 'Lightwright', 'Vectorworks', 'Capture', 'Excel', 'LibreOffice']

export const csvPatchInfo: InterchangeFormatInfo = {
  id: 'csv-patch',
  name: 'CSV patch',
  extensions: ['csv', 'tsv', 'txt'],
  imports: ['fixtures', 'patch', 'positions', 'groups'],
  exports: ['patch', 'positions', 'groups'],
  apps: APPS
}

export const csvPatchExcelInfo: InterchangeFormatInfo = {
  id: 'csv-patch-excel',
  name: 'CSV patch (Excel, ;)',
  extensions: ['csv'],
  imports: [],
  exports: ['patch', 'positions', 'groups'],
  apps: ['Excel', 'Numbers', 'LibreOffice']
}

export const csvImporter: Importer = {
  info: csvPatchInfo,
  detect(fileName, head) {
    const lower = fileName.toLowerCase()
    const ext = lower.split('.').pop() ?? ''
    if (!['csv', 'tsv', 'txt'].includes(ext)) return 0
    // Binary content is not a table
    for (let i = 0; i < Math.min(head.length, 2048); i++) if (head[i] === 0) return 0
    if (ext === 'txt') {
      // USITT ASCII and other text formats are .txt too: only a table with known headers
      const text = decodeText(head)
      if (/^\s*(ident\s+3|manufacturer|console|clear|set\s)/im.test(text.slice(0, 2000))) return 0
      const rows = parseRows(text, detectDelimiter(text), 3)
      return rows.length > 0 && rows[0].length >= 3 && looksLikeHeader(rows[0]) ? 0.5 : 0
    }
    return 0.8
  },
  parse(bytes, fileName, ctx) {
    return importCsvPatch(bytes, fileName, ctx)
  }
}

registerImporter(csvImporter)
registerExporter({
  info: csvPatchInfo,
  async write(show, fixtures) {
    return exportCsvPatch(show, fixtures, { delimiter: ',', decimalComma: false, bom: false })
  }
} satisfies Exporter)
registerExporter({
  info: csvPatchExcelInfo,
  async write(show, fixtures) {
    return exportCsvPatch(show, fixtures, { delimiter: ';', decimalComma: true, bom: true })
  }
} satisfies Exporter)
