// ============================================================
// PhotonBoard — Interchange host (main process)
// Lists the registered formats, detects the format of a file, runs
// its importer with an ImportContext (library + offline catalog +
// embedded GDTF / QXF parsers), recognises closed console formats
// (guidance instead of "unknown file") and runs exporters.
//
// Never throws to its callers: every failure is a result with a
// readable message and an `errorCode` the renderer translates
// (`interchange.errors.<code>`). No Electron imports: the dialogs live
// in src/main/index.ts, the web remote goes through remote-invoke.ts.
// ============================================================

import { promises as fsp } from 'fs'
import { basename } from 'path'
import type {
  ImportOptions, ImportResult, ImportWarning, ImportedShowFragment, InterchangeFormatId
} from '../../shared/interchange'
import type { FixtureDefinition, ShowFile } from '../../shared/types'
import type { InterchangeFormatList } from '../../shared/photonboard-api'
import { normalizeShow } from '../../shared/show-format'
import type { FixtureCatalog } from '../fixture-catalog'
import './formats'
import { detectImporter, getExporter, getImporter, listExporters, listImporters } from './registry'
import { createImportContext } from './context'
import { detectUnsupported, listUnsupported } from './unsupported'

/** Largest file an import reads (MVR with many GDTFs and 3D models can be big) */
export const MAX_IMPORT_SIZE = 256 * 1024 * 1024
/** Bytes passed to detect() */
const HEAD_SIZE = 64 * 1024
const MAX_WARNINGS = 500
const IMPORT_TIMEOUT_MS = 120_000

export interface ImportRunOptions {
  format?: InterchangeFormatId
  options?: ImportOptions
}

export type HostImportResult = ImportResult & { fileName?: string; path?: string }

export type HostExportResult =
  | { success: true; bytes: Uint8Array; fileName: string; extension: string; warnings: ImportWarning[] }
  | { success: false; error: string; errorCode?: string }

export interface InterchangeHostDeps {
  /** Fixture library (built-in + user) */
  getLibrary: () => FixtureDefinition[]
  catalog?: FixtureCatalog
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'Unknown error'
}

function sizeMb(n: number): string {
  return (n / 1024 / 1024).toFixed(1)
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** A fragment with every list present (importers are third-party code to the host) */
export function sanitizeFragment(raw: ImportedShowFragment, format: InterchangeFormatId, fileName: string): ImportedShowFragment {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Partial<ImportedShowFragment>
  const out: ImportedShowFragment = {
    ...f,
    format: f.format || format,
    name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : fileName.replace(/\.[^.]+$/, ''),
    fixtures: arr<FixtureDefinition>(f.fixtures).filter((d) => d && typeof d.id === 'string' && d.channels && Array.isArray(d.modes)),
    patch: arr(f.patch),
    groups: arr(f.groups),
    presets: arr(f.presets),
    cuelists: arr(f.cuelists),
    chases: arr(f.chases),
    effects: arr(f.effects),
    macros: arr(f.macros),
    midiMappings: arr(f.midiMappings),
    warnings: arr<ImportWarning>(f.warnings).filter((w) => w && typeof w.code === 'string').slice(0, MAX_WARNINGS)
  }
  if (arr(f.warnings).length > MAX_WARNINGS) {
    out.warnings.push({ level: 'info', code: 'moreWarnings', params: { count: arr(f.warnings).length - MAX_WARNINGS } })
  }
  return out
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The import took longer than ${ms / 1000} s and was stopped`)), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

export function createInterchangeHost(deps: InterchangeHostDeps) {
  function listFormats(): InterchangeFormatList {
    return {
      importers: listImporters().map((i) => i.info),
      exporters: listExporters().map((e) => e.info),
      fixtureExporters: listExporters().filter((e) => typeof e.writeFixture === 'function').map((e) => e.info),
      recognised: listUnsupported()
    }
  }

  /** Extensions for the open dialog: every importer's + the recognised closed formats (to explain them) */
  function importExtensions(): string[] {
    const set = new Set<string>()
    for (const i of listImporters()) for (const e of i.info.extensions) set.add(e.toLowerCase())
    for (const u of listUnsupported()) for (const e of u.extensions) set.add(e.split('.').pop()!.toLowerCase())
    return [...set].sort()
  }

  async function importBytes(bytes: Uint8Array, fileName: string, run: ImportRunOptions = {}): Promise<HostImportResult> {
    const name = basename(String(fileName || 'file'))
    if (!(bytes instanceof Uint8Array)) return { success: false, errorCode: 'unreadable', error: 'Invalid file data', fileName: name }
    if (bytes.byteLength === 0) return { success: false, errorCode: 'emptyFile', error: 'The file is empty', fileName: name }
    if (bytes.byteLength > MAX_IMPORT_SIZE) {
      return { success: false, errorCode: 'tooLarge', error: `The file is too large (${sizeMb(bytes.byteLength)} MB, max ${sizeMb(MAX_IMPORT_SIZE)} MB)`, fileName: name }
    }
    const head = bytes.subarray(0, HEAD_SIZE)
    let importer = run.format ? getImporter(run.format) : undefined
    if (run.format && !importer) return { success: false, errorCode: 'unknownFormat', error: `Unknown format "${run.format}"`, fileName: name }
    if (!importer) {
      const detected = detectImporter(name, head)
      if (!detected) {
        const guidance = detectUnsupported(name, head)
        if (guidance) {
          return { success: false, errorCode: 'unsupported', detectedFormat: guidance.app, guidance, error: `${guidance.app} files cannot be read directly`, fileName: name }
        }
        return { success: false, errorCode: 'unknownFormat', error: 'PhotonBoard cannot read this file format', fileName: name }
      }
      importer = detected.importer
    }
    const ctx = createImportContext(deps, run.options)
    try {
      const raw = await withTimeout(importer.parse(bytes, name, ctx), IMPORT_TIMEOUT_MS)
      const fragment = sanitizeFragment(raw, importer.info.id, name)
      // The fragment crosses IPC / WebSocket as JSON: make sure it can
      JSON.stringify(fragment)
      return { success: true, fragment, fileName: name }
    } catch (e) {
      // No text ending with the word "import" right before a quote anywhere in main: electron-vite's
      // ESM shim plugin takes it for an import statement and inserts its CommonJS shims there
      console.warn('[Interchange] reading failed:', importer.info.id, name, e)
      return { success: false, errorCode: 'parseFailed', detectedFormat: importer.info.name, error: errorText(e), fileName: name }
    }
  }

  async function importPath(path: string, run: ImportRunOptions = {}): Promise<HostImportResult> {
    const fileName = basename(String(path))
    try {
      const st = await fsp.stat(path)
      if (!st.isFile()) return { success: false, errorCode: 'unreadable', error: 'Not a file', fileName, path }
      if (st.size > MAX_IMPORT_SIZE) {
        return { success: false, errorCode: 'tooLarge', error: `The file is too large (${sizeMb(st.size)} MB, max ${sizeMb(MAX_IMPORT_SIZE)} MB)`, fileName, path }
      }
      const buf = await fsp.readFile(path)
      const result = await importBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), fileName, run)
      return { ...result, path }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      const code = err.code === 'ENOENT' ? 'notFound' : err.code === 'EACCES' || err.code === 'EPERM' ? 'noPermission' : 'unreadable'
      return { success: false, errorCode: code, error: errorText(e), fileName, path }
    }
  }

  async function exportShow(format: InterchangeFormatId, showRaw: unknown, fixturesRaw: unknown): Promise<HostExportResult> {
    const exporter = getExporter(format)
    if (!exporter) return { success: false, errorCode: 'unknownFormat', error: `Unknown export format "${String(format).slice(0, 64)}"` }
    let show: ShowFile
    try {
      show = normalizeShow(showRaw).show
    } catch (e) {
      return { success: false, errorCode: 'invalidShow', error: errorText(e) }
    }
    const fixtures = arr<FixtureDefinition>(fixturesRaw).filter((d) => d && typeof d.id === 'string' && Array.isArray(d.modes))
    try {
      const { bytes, warnings } = await exporter.write(show, fixtures)
      const extension = exporter.info.extensions[0] ?? 'dat'
      const base = (show.name || 'Show').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 120) || 'Show'
      return { success: true, bytes, fileName: `${base}.${extension}`, extension, warnings: arr(warnings) }
    } catch (e) {
      console.warn(`[Interchange] ${format} export failed:`, e)
      return { success: false, errorCode: 'exportFailed', error: errorText(e) }
    }
  }

  /** One fixture type to a fixture format (GDTF…): exporters implementing writeFixture */
  async function exportFixture(format: InterchangeFormatId, defRaw: unknown): Promise<HostExportResult> {
    const exporter = getExporter(format)
    if (!exporter?.writeFixture) return { success: false, errorCode: 'unknownFormat', error: `Unknown fixture export format "${String(format).slice(0, 64)}"` }
    const def = defRaw as FixtureDefinition | null
    if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !Array.isArray(def.modes) || !def.channels || typeof def.channels !== 'object') {
      return { success: false, errorCode: 'invalidFixture', error: 'Invalid fixture definition' }
    }
    try {
      const { bytes, warnings, fileName } = await exporter.writeFixture(def)
      const extension = exporter.info.extensions[0] ?? 'dat'
      const base = `${def.manufacturer ? `${def.manufacturer} ` : ''}${def.name || 'Fixture'}`
      const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 160)
      const name = safe(fileName ?? '') || `${safe(base) || 'Fixture'}.${extension}`
      return { success: true, bytes, fileName: name, extension, warnings: arr(warnings) }
    } catch (e) {
      console.warn(`[Interchange] ${format} fixture export failed:`, e)
      return { success: false, errorCode: 'exportFailed', error: errorText(e) }
    }
  }

  return { listFormats, importExtensions, importBytes, importPath, exportShow, exportFixture }
}

export type InterchangeHost = ReturnType<typeof createInterchangeHost>
