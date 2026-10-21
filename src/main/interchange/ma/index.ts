// ============================================================
// PhotonBoard — grandMA2 / grandMA3 XML importers
//
// One file (an `Export …` XML) or a .zip of several (a zipped
// gma3_library / importexport folder: patch + sequences + presets +
// groups + macros, optional .gdtf fixture types). The import contract
// takes one path, so several files are brought in as a zip; their
// objects are combined before fixtures are resolved, so cues of one
// file use the patch of another.
// ============================================================

import AdmZip from 'adm-zip'
import type { ImportContext, ImportedShowFragment, Importer } from '../../../shared/interchange'
import { registerImporter } from '../registry'
import { buildFragment } from './build'
import { readMa2Xml } from './ma2'
import { readMa3Xml } from './ma3'
import { addWarning, emptyMaDocument, type MaDocument } from './model'
import { decodeText, parseXml } from './xml'

const MAX_ZIP_ENTRIES = 2000
const MAX_ZIP_TOTAL = 200 * 1024 * 1024
const MAX_XML = 64 * 1024 * 1024

function headText(head: Uint8Array): string {
  return decodeText(head.subarray(0, Math.min(head.length, 8192)))
}

export function isZip(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

/** Entry names found in the local file headers of the first bytes of a zip */
export function zipEntryNames(head: Uint8Array): string[] {
  const names: string[] = []
  let i = 0
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  while (i + 30 <= head.length && dv.getUint32(i, true) === 0x04034b50 && names.length < 200) {
    const flags = dv.getUint16(i + 6, true)
    const csize = dv.getUint32(i + 18, true)
    const nlen = dv.getUint16(i + 26, true)
    const xlen = dv.getUint16(i + 28, true)
    if (i + 30 + nlen > head.length) break
    names.push(new TextDecoder().decode(head.subarray(i + 30, i + 30 + nlen)))
    if (flags & 0x08) break // sizes after the data: cannot skip
    i += 30 + nlen + xlen + csize
  }
  return names
}

/** Zip of grandMA XML exports? (never claims MVR / GDTF archives) */
function zipConfidence(fileName: string, head: Uint8Array): number {
  if (!isZip(head) || !/\.zip$/i.test(fileName)) return 0
  const names = zipEntryNames(head)
  if (names.some(n => /GeneralSceneDescription\.xml$|(^|\/)description\.xml$/i.test(n))) return 0
  const files = names.filter(n => !n.endsWith('/'))
  if (files.length === 0) return 0
  if (names.some(n => /gma3_library|gma2|importexport/i.test(n))) return 0.7
  return files.every(n => /\.(xml|gdtf)$/i.test(n)) ? 0.4 : 0
}

type XmlKind = 'ma3' | 'ma2' | null

function xmlKind(text: string): XmlKind {
  const t = text.slice(0, 8192)
  if (/<GMA3[\s>]/.test(t)) return 'ma3'
  if (/<MA[\s>]/.test(t) && /schemas\.malighting\.de\/grandma2/i.test(t)) return 'ma2'
  return null
}

async function readXmlInto(doc: MaDocument | null, text: string, kind: Exclude<XmlKind, null>, fileName: string): Promise<MaDocument> {
  const target = doc ?? emptyMaDocument(kind === 'ma3' ? 'ma3-xml' : 'ma2-xml')
  let root
  try {
    root = parseXml(text)
  } catch (e) {
    addWarning(target.warnings, { level: 'error', code: 'ma.badXml', message: `${fileName}: invalid XML (${(e as Error).message})`, params: { file: fileName, error: (e as Error).message } })
    return target
  }
  try {
    if (kind === 'ma3') readMa3Xml(root, target)
    else readMa2Xml(root, target)
  } catch (e) {
    addWarning(target.warnings, { level: 'error', code: 'ma.readError', message: `${fileName}: ${(e as Error).message}`, params: { file: fileName, error: (e as Error).message } })
  }
  return target
}

async function parseZip(bytes: Uint8Array, fileName: string, ctx: ImportContext): Promise<ImportedShowFragment> {
  let zip: AdmZip
  try {
    zip = new AdmZip(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  } catch {
    throw new Error('Not a readable zip archive')
  }
  const entries = zip.getEntries().filter(e => !e.isDirectory)
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error(`Too many files in the archive (${entries.length})`)
  let total = 0
  let ma3: MaDocument | null = null
  let ma2: MaDocument | null = null
  const embedded: MaDocument['embeddedDefinitions'] = []
  const skipped: string[] = []
  for (const e of entries.sort((a, b) => a.entryName.localeCompare(b.entryName))) {
    const size = e.header.size
    total += size
    if (total > MAX_ZIP_TOTAL) throw new Error('Archive too large')
    const name = e.entryName
    if (/\.gdtf$/i.test(name)) {
      try {
        const def = await ctx.parseGdtf(new Uint8Array(e.getData()), name.replace(/^.*\//, ''))
        if (def) embedded.push(def)
      } catch { skipped.push(name) }
      continue
    }
    if (!/\.xml$/i.test(name) || size > MAX_XML) { skipped.push(name); continue }
    const text = decodeText(new Uint8Array(e.getData()))
    const kind = xmlKind(text)
    if (kind === 'ma3') ma3 = await readXmlInto(ma3, text, kind, name)
    else if (kind === 'ma2') ma2 = await readXmlInto(ma2, text, kind, name)
    else skipped.push(name)
  }
  if (!ma3 && !ma2) throw new Error('No grandMA XML export in this archive')
  let doc: MaDocument
  if (ma3 && ma2) {
    // Mixed archive: keep the larger set, report the other
    const size = (d: MaDocument) => d.fixtures.length + d.sequences.length + d.presets.length + d.groups.length + d.macros.length
    doc = size(ma3) >= size(ma2) ? ma3 : ma2
    addWarning(doc.warnings, { level: 'warning', code: 'ma.mixedArchive', message: 'The archive mixes grandMA2 and grandMA3 exports; only one of them was imported — import the other separately' })
  } else {
    doc = (ma3 ?? ma2)!
  }
  doc.embeddedDefinitions.push(...embedded)
  if (skipped.length > 0) {
    addWarning(doc.warnings, { level: 'info', code: 'ma.skippedFiles', message: `Files ignored in the archive: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? '…' : ''}`, params: { count: skipped.length, files: `${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? '…' : ''}` } })
  }
  return buildFragment(doc, ctx, fileName)
}

async function parseSingle(bytes: Uint8Array, fileName: string, ctx: ImportContext, expected: Exclude<XmlKind, null>): Promise<ImportedShowFragment> {
  const text = decodeText(bytes)
  const kind = xmlKind(text)
  if (kind !== expected) throw new Error(expected === 'ma3' ? 'Not a grandMA3 XML export' : 'Not a grandMA2 XML export')
  // Recognised but damaged files return what could be read + an error warning
  const doc = await readXmlInto(null, text, kind, fileName.replace(/^.*[\\/]/, ''))
  return buildFragment(doc, ctx, fileName)
}

export const ma3XmlImporter: Importer = {
  info: {
    id: 'ma3-xml',
    name: 'grandMA3 XML export',
    extensions: ['xml', 'zip'],
    imports: ['fixtures', 'patch', 'positions', 'groups', 'presets', 'cues', 'macros'],
    exports: [],
    apps: ['grandMA3', 'grandMA3 onPC']
  },
  detect(fileName, head) {
    if (isZip(head)) return zipConfidence(fileName, head)
    return xmlKind(headText(head)) === 'ma3' ? 1 : 0
  },
  async parse(bytes, fileName, ctx) {
    if (isZip(bytes)) return parseZip(bytes, fileName, ctx)
    return parseSingle(bytes, fileName, ctx, 'ma3')
  }
}

export const ma2XmlImporter: Importer = {
  info: {
    id: 'ma2-xml',
    name: 'grandMA2 XML export',
    extensions: ['xml', 'zip'],
    imports: ['fixtures', 'patch', 'positions', 'groups', 'presets', 'cues', 'effects', 'macros'],
    exports: [],
    apps: ['grandMA2', 'grandMA2 onPC', 'dot2']
  },
  detect(fileName, head) {
    if (isZip(head)) return zipConfidence(fileName, head) > 0 ? 0.35 : 0 // the grandMA3 importer reads both kinds in a zip
    return xmlKind(headText(head)) === 'ma2' ? 1 : 0
  },
  async parse(bytes, fileName, ctx) {
    if (isZip(bytes)) return parseZip(bytes, fileName, ctx)
    return parseSingle(bytes, fileName, ctx, 'ma2')
  }
}

registerImporter(ma3XmlImporter)
registerImporter(ma2XmlImporter)
