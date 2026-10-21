// ============================================================
// CSV patch export: one row per patched fixture, readable by the CSV
// import of PhotonBoard, grandMA (patch import tools), Eos, Lightwright,
// Vectorworks and any spreadsheet. The "Excel" variant uses ';' and a
// decimal comma with a UTF-8 BOM (French Excel opens it as is).
// ============================================================

import type { FixtureDefinition, ShowFile } from '../../../shared/types'
import type { ImportWarning } from '../../../shared/interchange'
import { csvCell, type Delimiter } from './table'

export interface CsvExportOptions {
  delimiter: Delimiter
  decimalComma: boolean
  bom: boolean
}

/** Header row (stable: the importer recognises every one of them) */
export const CSV_EXPORT_HEADERS = [
  'Fixture ID', 'Name', 'Manufacturer', 'Model', 'Mode', 'Channels', 'Universe', 'Address', 'DMX', 'Absolute Address',
  'X (m)', 'Y (m)', 'Z (m)', 'Rot X', 'Rot Y', 'Rot Z', 'Groups'
]

function num(n: number | undefined, decimalComma: boolean): string {
  if (n === undefined || !Number.isFinite(n)) return ''
  const s = String(Math.round(n * 1000) / 1000)
  return decimalComma ? s.replace('.', ',') : s
}

const RAD = 180 / Math.PI

export function exportCsvPatch(show: ShowFile, fixtures: FixtureDefinition[], opts: CsvExportOptions): { bytes: Uint8Array; warnings: ImportWarning[] } {
  const d = opts.delimiter
  const defs = new Map(fixtures.map((f) => [f.id, f]))
  const groupNames = new Map(show.groups.map((g) => [g.id, g.name]))
  const warnings: ImportWarning[] = []
  const lines: string[] = [CSV_EXPORT_HEADERS.map((h) => csvCell(h, d)).join(d)]
  const patch = [...show.patch].sort((a, b) => (a.fid ?? 1e9) - (b.fid ?? 1e9) || a.universe - b.universe || a.address - b.address)
  let missing = 0
  const groupSep = d === ',' ? '; ' : ', '
  for (const p of patch) {
    const def = defs.get(p.fixtureDefId)
    if (!def) missing++
    const mode = def?.modes.find((m) => m.name === p.modeName)
    const pos = p.position3D
    const rot = p.rotation3D
    const cells = [
      p.fid ?? '',
      p.name,
      def?.manufacturer ?? '',
      def?.name ?? p.fixtureDefId,
      p.modeName,
      mode?.channelCount ?? '',
      p.universe + 1,
      p.address,
      `${p.universe + 1}.${String(p.address).padStart(3, '0')}`,
      p.universe * 512 + p.address,
      // PhotonBoard (y = height, z = depth) → CAD axes (Y = depth, Z = height)
      num(pos?.x, opts.decimalComma),
      num(pos?.z, opts.decimalComma),
      num(pos?.y, opts.decimalComma),
      num(rot ? rot.rx * RAD : undefined, opts.decimalComma),
      num(rot ? rot.rz * RAD : undefined, opts.decimalComma),
      num(rot ? rot.ry * RAD : undefined, opts.decimalComma),
      show.groups.filter((g) => g.fixtureIds.includes(p.id)).map((g) => groupNames.get(g.id) ?? '').filter(Boolean).join(groupSep)
    ]
    lines.push(cells.map((c) => csvCell(c as string | number, d)).join(d))
  }
  if (missing > 0) warnings.push({ level: 'warning', code: 'exportMissingFixtureTypes', params: { count: missing } })
  const skipped: string[] = []
  if (show.cuelists.length) skipped.push('cues')
  if (show.presets.length) skipped.push('presets')
  if (show.chases.length) skipped.push('chases')
  if (show.effects.length) skipped.push('effects')
  if (skipped.length) warnings.push({ level: 'info', code: 'exportPatchOnly', params: { what: skipped.join(', ') } })
  const text = lines.join('\r\n') + '\r\n'
  const body = new TextEncoder().encode(text)
  if (!opts.bom) return { bytes: body, warnings }
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf], 0)
  out.set(body, 3)
  return { bytes: out, warnings }
}
