// ============================================================
// PhotonBoard — QLC+ workspace (.qxw) import / export
// Registers the importer and exporter with the interchange registry.
// ============================================================

import type { Exporter, Importer, InterchangeFormatInfo } from '../../../shared/interchange'
import { registerExporter, registerImporter } from '../registry'
import { exportQlcWorkspace } from './export'
import { importQlcWorkspace, QLC_FORMAT_ID } from './import'
import { NotAWorkspaceError } from './model'

export const QLC_WORKSPACE_INFO: InterchangeFormatInfo = {
  id: QLC_FORMAT_ID,
  name: 'QLC+ workspace',
  extensions: ['qxw'],
  imports: ['fixtures', 'patch', 'positions', 'groups', 'presets', 'cues', 'chases', 'effects', 'timeline', 'executors', 'midi', 'macros'],
  exports: ['fixtures', 'patch', 'positions', 'groups', 'presets', 'cues', 'chases', 'effects', 'timeline', 'executors', 'midi'],
  apps: ['QLC+ 4', 'QLC+ 5', 'Q Light Controller 3']
}

/** Confidence that a file is a QLC+ workspace (`head` = first 64 KiB) */
export function detectQlcWorkspace(fileName: string, head: Uint8Array): number {
  const ext = /\.qxw$/i.test(fileName)
  let text = ''
  try { text = new TextDecoder('utf-8').decode(head.subarray(0, 4096)) } catch { text = '' }
  const hasDoctype = /<!DOCTYPE\s+Workspace\s*>/.test(text)
  const hasRoot = /<Workspace[\s>]/.test(text)
  const hasNs = text.includes('http://www.qlcplus.org/Workspace')
  const hasEngine = /<(Engine|Creator)[\s>]/.test(text)
  if (hasRoot && (hasNs || hasDoctype) && hasEngine) return 1
  if (hasRoot && (hasNs || hasDoctype)) return 0.9
  if (ext && hasRoot) return 0.8
  if (ext && text.trim() === '') return 0.3
  return 0
}

export const qlcWorkspaceImporter: Importer = {
  info: QLC_WORKSPACE_INFO,
  detect: detectQlcWorkspace,
  async parse(bytes, fileName, ctx) {
    try {
      return await importQlcWorkspace(bytes, fileName, ctx)
    } catch (e) {
      if (e instanceof NotAWorkspaceError) throw e
      throw new Error(`QLC+ workspace could not be read: ${(e as Error).message}`)
    }
  }
}

export const qlcWorkspaceExporter: Exporter = {
  info: QLC_WORKSPACE_INFO,
  async write(show, fixtures) {
    const { xml, warnings } = exportQlcWorkspace(show, fixtures)
    return { bytes: new TextEncoder().encode(xml), warnings }
  }
}

registerImporter(qlcWorkspaceImporter)
registerExporter(qlcWorkspaceExporter)
