// ============================================================
// PhotonBoard — MVR (My Virtual Rig, DIN SPEC 15801) interchange
// The open rig exchange format of grandMA3 (Menu › Export MVR),
// Vectorworks Spotlight, Capture, Depence, WYSIWYG, Eos 3.x,
// Chamsys, Onyx…: fixtures (embedded GDTF), patch, positions.
// ============================================================

import type { Exporter, Importer, InterchangeFormatInfo } from '../../../shared/interchange'
import { registerExporter, registerImporter } from '../registry'
import { headContains } from '../gdtf'
import { isZip } from '../gdtf/gdtf-import'
import { parseMvr } from './mvr-import'
import { writeMvr } from './mvr-export'

export { parseMvr, parseMvrAddress, looksLikePlaceholderGdtf } from './mvr-import'
export { writeMvr } from './mvr-export'

export const MVR_INFO: InterchangeFormatInfo = {
  id: 'mvr',
  name: 'MVR (My Virtual Rig)',
  extensions: ['mvr'],
  imports: ['fixtures', 'patch', 'positions', 'groups'],
  exports: ['fixtures', 'patch', 'positions'],
  apps: ['grandMA3', 'Vectorworks Spotlight', 'Capture', 'Depence', 'WYSIWYG', 'ETC Eos', 'Chamsys MagicQ', 'Obsidian Onyx', 'Unreal Engine', 'BlenderDMX']
}

export const mvrImporter: Importer = {
  info: MVR_INFO,
  detect(fileName, head) {
    if (!isZip(head)) return 0
    if (headContains(head, 'GeneralSceneDescription.xml')) return 1
    // Some exporters write the scene description last (beyond the first 64 KiB)
    return /\.mvr$/i.test(fileName) ? 0.8 : 0
  },
  parse(bytes, fileName, ctx) {
    return parseMvr(bytes, fileName, ctx)
  }
}

export const mvrExporter: Exporter = {
  info: MVR_INFO,
  async write(show, fixtures) {
    const { bytes, warnings } = writeMvr(show, fixtures)
    return { bytes, warnings }
  }
}

registerImporter(mvrImporter)
registerExporter(mvrExporter)
