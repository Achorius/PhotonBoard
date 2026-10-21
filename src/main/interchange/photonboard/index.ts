// ============================================================
// PhotonBoard's own open format (.pbshow, JSON — documented in
// docs/format/README.md, JSON Schema docs/format/photonboard-show.schema.json).
// Importing a .pbshow through the wizard = "merge parts of another
// show" (patch, groups, presets, sequences… à la carte); exporting =
// a plain copy of the show, readable by any program.
// ============================================================

import { normalizeShow, SHOW_FORMAT_VERSION } from '../../../shared/show-format'
import { emptyFragment, type Exporter, type Importer, type InterchangeFormatInfo } from '../../../shared/interchange'
import { registerExporter, registerImporter } from '../registry'

export const photonboardInfo: InterchangeFormatInfo = {
  id: 'photonboard',
  name: 'PhotonBoard show (.pbshow)',
  extensions: ['pbshow', 'json'],
  imports: ['patch', 'positions', 'groups', 'presets', 'cues', 'chases', 'effects', 'timeline', 'executors', 'midi', 'macros'],
  exports: ['patch', 'positions', 'groups', 'presets', 'cues', 'chases', 'effects', 'timeline', 'executors', 'midi', 'macros'],
  apps: ['PhotonBoard']
}

function asciiHead(head: Uint8Array, max = 4096): string {
  let s = ''
  for (let i = 0; i < Math.min(head.length, max); i++) s += String.fromCharCode(head[i])
  return s
}

export const photonboardImporter: Importer = {
  info: photonboardInfo,
  detect(fileName, head) {
    const lower = fileName.toLowerCase()
    const text = asciiHead(head)
    const json = /^\s*(﻿|\xEF\xBB\xBF)?\s*\{/.test(text)
    if (lower.endsWith('.pbshow')) return json ? 1 : 0.6
    if (lower.endsWith('.json') && json && /"patch"\s*:/.test(text) && /"(version|cuelists)"\s*:/.test(text)) return 0.7
    return 0
  },
  async parse(bytes, fileName) {
    let text = new TextDecoder('utf-8').decode(bytes)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    const { show, warnings } = normalizeShow(text) // throws "Not a PhotonBoard show…" for anything else
    const fragment = emptyFragment('photonboard', show.name || fileName.replace(/\.(pbshow|json)$/i, ''))
    fragment.sourceApp = `PhotonBoard (format v${show.version})`
    fragment.patch = show.patch
    fragment.groups = show.groups
    fragment.presets = show.presets
    fragment.cuelists = show.cuelists
    fragment.chases = show.chases
    fragment.effects = show.effects
    fragment.macros = show.macros ?? []
    fragment.midiMappings = show.midiMappings
    fragment.timeline = show.timeline
    fragment.executor = show.executor
    fragment.roomConfig = show.roomConfig
    fragment.speedMasters = show.speedMasters ?? []
    fragment.stagePages = show.stagePages ?? []
    for (const message of warnings.slice(0, 50)) fragment.warnings.push({ level: 'info', code: 'showNormalized', message })
    if (Number(show.version) > SHOW_FORMAT_VERSION) fragment.warnings.push({ level: 'warning', code: 'newerShowFormat' })
    return fragment
  }
}

registerImporter(photonboardImporter)
registerExporter({
  info: { ...photonboardInfo, extensions: ['pbshow'] },
  async write(show) {
    const { show: clean } = normalizeShow(show)
    return { bytes: new TextEncoder().encode(JSON.stringify({ ...clean, modifiedAt: new Date().toISOString() }, null, 2)), warnings: [] }
  }
} satisfies Exporter)
