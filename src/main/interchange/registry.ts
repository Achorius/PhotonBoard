// ============================================================
// PhotonBoard — Interchange registry (main process)
// Each format module registers its importer / exporter here; the
// interchange host (index.ts) detects formats and runs them.
// ============================================================

import type { Exporter, Importer, InterchangeFormatId } from '../../shared/interchange'

const importers = new Map<InterchangeFormatId, Importer>()
const exporters = new Map<InterchangeFormatId, Exporter>()

export function registerImporter(importer: Importer): void {
  importers.set(importer.info.id, importer)
}

export function registerExporter(exporter: Exporter): void {
  exporters.set(exporter.info.id, exporter)
}

export function listImporters(): Importer[] {
  return [...importers.values()]
}

export function listExporters(): Exporter[] {
  return [...exporters.values()]
}

export function getImporter(id: InterchangeFormatId): Importer | undefined {
  return importers.get(id)
}

export function getExporter(id: InterchangeFormatId): Exporter | undefined {
  return exporters.get(id)
}

/** Best importer for a file, or null when nothing is confident enough */
export function detectImporter(fileName: string, head: Uint8Array): { importer: Importer; confidence: number } | null {
  let best: { importer: Importer; confidence: number } | null = null
  for (const importer of importers.values()) {
    let confidence = 0
    try { confidence = importer.detect(fileName, head) } catch { confidence = 0 }
    if (confidence > 0 && (!best || confidence > best.confidence)) best = { importer, confidence }
  }
  return best && best.confidence >= 0.3 ? best : null
}
