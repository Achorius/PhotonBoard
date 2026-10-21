// ============================================================
// PhotonBoard — GDTF (DIN SPEC 15800) interchange
//   import: a .gdtf fixture type → fragment with one definition
//   export: one fixture type → .gdtf (Exporter.writeFixture), or the
//           single fixture type of a show (Exporter.write)
// One reader for every .gdtf: this importer (File › Import, drop),
// ImportContext.parseGdtf (GDTFs embedded in MVR / grandMA archives,
// context.ts) and the fixture library import (fixture-parsers
// parseGDTFBuffer) all go through parseGdtfArchive(). This is the only
// importer that claims a .gdtf (host.test.ts).
// ============================================================

import type { Exporter, ImportWarning, Importer, InterchangeFormatInfo } from '../../../shared/interchange'
import { emptyFragment } from '../../../shared/interchange'
import { registerExporter, registerImporter } from '../registry'
import { APP_VERSION } from './app-info'
import { isZip, parseGdtfArchive } from './gdtf-import'
import { writeGdtf } from './gdtf-export'

export { parseGdtfArchive, parseGdtfDescription, readGdtfDescription, isZip, parseDmxValue } from './gdtf-import'
export { writeGdtf, buildGdtfDescription, gdtfFileName, attributeForChannel } from './gdtf-export'

export const GDTF_INFO: InterchangeFormatInfo = {
  id: 'gdtf',
  name: 'GDTF (General Device Type Format)',
  extensions: ['gdtf'],
  imports: ['fixtures'],
  exports: ['fixtures'],
  apps: ['GDTF Share', 'grandMA3', 'Vectorworks Spotlight', 'Capture', 'Depence', 'WYSIWYG', 'ETC Eos', 'Chamsys MagicQ', 'Onyx']
}

/** ASCII search in the first bytes of a file (ZIP local headers carry the entry names in clear) */
export function headContains(head: Uint8Array, needle: string): boolean {
  const n = Buffer.from(needle, 'latin1')
  return Buffer.from(head.buffer, head.byteOffset, head.byteLength).indexOf(n) >= 0
}

export const gdtfImporter: Importer = {
  info: GDTF_INFO,
  detect(fileName, head) {
    if (!isZip(head)) return 0
    // An MVR embeds .gdtf files (whose description.xml may show up in the head): never claim it
    if (headContains(head, 'GeneralSceneDescription.xml')) return 0
    const ext = /\.gdtf$/i.test(fileName)
    const desc = headContains(head, 'description.xml')
    if (ext && desc) return 1
    if (ext) return 0.8
    return desc ? 0.6 : 0
  },
  async parse(bytes, fileName) {
    const { definition, notes } = parseGdtfArchive(bytes, fileName)
    const fragment = emptyFragment('gdtf', definition.name)
    fragment.fixtures.push(definition)
    fragment.sourceApp = 'GDTF'
    for (const note of notes) fragment.warnings.push({ level: 'info', code: 'gdtf.note', params: { fixture: definition.name }, message: note })
    return fragment
  }
}

export const gdtfExporter: Exporter = {
  info: GDTF_INFO,
  async write(show, fixtures) {
    const used = new Set(show.patch.map((p) => p.fixtureDefId))
    const candidates = fixtures.filter((f) => used.has(f.id))
    const list = candidates.length ? candidates : fixtures
    if (list.length === 0) throw new Error('No fixture type to export')
    const warnings: ImportWarning[] = []
    if (list.length > 1) {
      warnings.push({
        level: 'warning',
        code: 'gdtf.export.singleFixture',
        params: { fixture: list[0].name, count: list.length },
        message: `A GDTF file describes one fixture type: only "${list[0].name}" was exported (${list.length} types in the show). Use MVR to export the whole rig.`
      })
    }
    const res = writeGdtf(list[0], { appVersion: APP_VERSION })
    return { bytes: res.bytes, warnings: [...warnings, ...res.warnings] }
  },
  async writeFixture(def) {
    const res = writeGdtf(def, { appVersion: APP_VERSION })
    return { bytes: res.bytes, warnings: res.warnings, fileName: res.fileName }
  }
}

registerImporter(gdtfImporter)
registerExporter(gdtfExporter)
