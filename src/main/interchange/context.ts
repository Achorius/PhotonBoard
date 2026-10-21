// ============================================================
// PhotonBoard — ImportContext implementation (main process)
// Fixture type lookup for importers: the offline catalog's exact id
// ("qlc/<maker>/<model>", "ofl/<maker>/<model>") first, then the user
// library, then the offline catalog (OFL + QLC+) by name, with
// manufacturer aliases and fuzzy model matching ("ADJ" = "American DJ",
// "Robe lighting" = "Robe", "MAC Aura XB" ≈ "Mac Aura XB"); a mode with
// the wanted channel count is preferred. Embedded GDTF / QXF definitions go through the same
// parsers as the fixture library import.
// No Electron imports: unit-tested.
// ============================================================

import type { FixtureCatalogEntry, FixtureDefinition } from '../../shared/types'
import type { ImportContext, ImportOptions } from '../../shared/interchange'
import type { FixtureCatalog } from '../fixture-catalog'
import { withinEdits } from '../fixture-catalog'
import { slugify } from '../fixture-convert-common'
import { parseQLCPlus } from '../fixture-parsers'
import { parseGdtfArchive } from './gdtf/gdtf-import'

/** Lower-case letters and digits only, accents removed ("Clay Paky" → "claypaky") */
export function compactKey(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Words that do not identify a manufacturer ("Robe lighting", "Martin Professional", "Chauvet DJ") */
const MAKER_NOISE = new Set([
  'lighting', 'lightings', 'light', 'lights', 'professional', 'pro', 'dj', 'inc', 'ltd', 'llc', 'gmbh', 'ag', 'spa', 'sa', 'srl',
  'sas', 'bv', 'co', 'corp', 'corporation', 'company', 'group', 'international', 'technologies', 'technology', 'the', 'by', 'and'
])

/** Compact aliases → one canonical key */
const MAKER_ALIASES: Record<string, string> = {
  adj: 'american',
  americandj: 'american',
  american: 'american',
  martin: 'martin',
  martinbyharman: 'martin',
  harmanmartin: 'martin',
  robe: 'robe',
  robelighting: 'robe',
  claypaky: 'claypaky',
  clay: 'claypaky',
  highend: 'highend',
  highendsystems: 'highend',
  hes: 'highend',
  varilite: 'varilite',
  vl: 'varilite',
  philipsvarilite: 'varilite',
  glp: 'glp',
  germanlightproducts: 'glp',
  etc: 'etc',
  electronictheatrecontrols: 'etc',
  ma: 'malighting',
  malighting: 'malighting',
  elation: 'elation',
  chauvet: 'chauvet',
  chauvetprofessional: 'chauvet',
  showtec: 'showtec',
  highlite: 'showtec',
  jbsystems: 'jbsystems',
  jb: 'jbsystems',
  sgm: 'sgm',
  ayrton: 'ayrton',
  prolights: 'prolights',
  musicandlights: 'prolights',
  cameo: 'cameo',
  adamhall: 'cameo',
  eurolite: 'eurolite',
  steinigke: 'eurolite',
  stairville: 'stairville',
  thomann: 'stairville',
  colorkinetics: 'colorkinetics',
  philipscolorkinetics: 'colorkinetics',
  philipsselecon: 'selecon',
  selecon: 'selecon',
  strand: 'strand',
  strandlighting: 'strand',
  adb: 'adb',
  adbstagelight: 'adb',
  ledj: 'ledj',
  equinox: 'equinox',
  briteq: 'briteq',
  beamz: 'beamz',
  acme: 'acme',
  generic: 'generic'
}

/** Canonical manufacturer key ("Robe lighting s.r.o." → "robe", "ADJ" → "american") */
export function manufacturerKey(name: string): string {
  const words = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const whole = words.join('')
  if (MAKER_ALIASES[whole]) return MAKER_ALIASES[whole]
  const kept = words.filter((w) => !MAKER_NOISE.has(w))
  const compact = (kept.length > 0 ? kept : words).join('')
  if (MAKER_ALIASES[compact]) return MAKER_ALIASES[compact]
  if (kept.length > 0 && MAKER_ALIASES[kept[0]]) return MAKER_ALIASES[kept[0]]
  return compact
}

/** Model key without the manufacturer when the model repeats it ("Robe Robin 600" → "robin600") */
export function modelKey(model: string, manufacturer = ''): string {
  let m = compactKey(model)
  const mk = compactKey(manufacturer)
  if (mk && m.startsWith(mk) && m.length > mk.length + 1) m = m.slice(mk.length)
  return m
}

interface Candidate {
  manufacturer: string
  names: string[]
  counts: number[]
}

/**
 * Similarity of a candidate (0 = no match). Manufacturer must agree when both
 * are known; the model is compared exactly, by prefix, then within 1-2 edits.
 */
export function scoreCandidate(c: Candidate, manufacturer: string, model: string, channelCount?: number): number {
  const wantMaker = manufacturer ? manufacturerKey(manufacturer) : ''
  const haveMaker = manufacturerKey(c.manufacturer)
  let score = 0
  if (wantMaker) {
    if (wantMaker === haveMaker) score += 10
    else if (haveMaker && (haveMaker.startsWith(wantMaker) || wantMaker.startsWith(haveMaker)) && Math.min(wantMaker.length, haveMaker.length) >= 5) score += 6
    else return 0
  }
  const want = modelKey(model, manufacturer || c.manufacturer)
  if (!want) return 0
  let best = 0
  for (const n of c.names) {
    const have = modelKey(n, c.manufacturer)
    if (!have) continue
    if (have === want) { best = Math.max(best, 20); continue }
    const short = Math.min(have.length, want.length)
    if (short >= 4 && (have.startsWith(want) || want.startsWith(have))) best = Math.max(best, 10 - Math.min(4, Math.abs(have.length - want.length)))
    else if (want.length >= 5 && withinEdits(want, have, want.length >= 9 ? 2 : 1)) best = Math.max(best, 8)
    else if (short >= 5 && (have.includes(want) || want.includes(have))) best = Math.max(best, 5)
  }
  if (best === 0) return 0
  score += best
  if (channelCount && c.counts.includes(channelCount)) score += 4
  return score
}

const MIN_SCORE = 13

export interface FixtureLookupDeps {
  /** The fixture library (built-in + user) */
  getLibrary: () => FixtureDefinition[]
  catalog?: FixtureCatalog
}

/**
 * The catalog definition whose id is exactly "<source>/<maker-slug>/<model-slug>"
 * (QLC+ and OFL ids are built that way: a file naming the fixture like the
 * library did finds it without fuzzy matching). The library's copy wins when
 * that type is installed.
 */
export async function findExactCatalogFixture(deps: FixtureLookupDeps, manufacturer: string, model: string): Promise<FixtureDefinition | null> {
  const catalog = deps.catalog
  const maker = slugify(String(manufacturer ?? ''))
  const name = slugify(String(model ?? ''))
  if (!catalog || !maker || !name) return null
  for (const source of ['qlc', 'ofl']) {
    let id: string | null = null
    try { id = await catalog.resolveId(`${source}/${maker}/${name}`) } catch { id = null }
    if (!id) continue
    const installed = deps.getLibrary().find((d) => d.id === id)
    if (installed) return installed
    try {
      const def = await catalog.get(id)
      if (def) return def
    } catch { /* catalog unavailable */ }
  }
  return null
}

/**
 * Find a fixture type by manufacturer + model: the catalog's exact id first,
 * then the library by name (a tie goes to the library), then the offline
 * catalog by name. Null when nothing is close enough.
 */
export async function findFixture(
  deps: FixtureLookupDeps,
  manufacturer: string,
  model: string,
  channelCount?: number
): Promise<FixtureDefinition | null> {
  if (!model || !String(model).trim()) return null
  const exact = await findExactCatalogFixture(deps, manufacturer, model)
  if (exact) return exact
  let best: { score: number; def?: FixtureDefinition; catalogId?: string } | null = null
  for (const def of deps.getLibrary()) {
    const score = scoreCandidate(
      { manufacturer: def.manufacturer, names: [def.name, ...(def.shortName ? [def.shortName] : [])], counts: def.modes.map((m) => m.channelCount) },
      manufacturer, model, channelCount
    ) + 0.5 // the library wins a tie: shows patched with it keep working
    if (score > MIN_SCORE && (!best || score > best.score)) best = { score, def }
  }
  if (deps.catalog) {
    const entries = new Map<string, FixtureCatalogEntry>()
    const queries = [model, `${manufacturer} ${model}`.trim()]
    const words = String(model).trim().split(/\s+/)
    if (words.length > 1) queries.push(words[0])
    for (const text of queries) {
      try {
        const res = await deps.catalog.search({ text: text.slice(0, 200), limit: 60 })
        for (const e of res.entries) entries.set(e.id, e)
      } catch { /* catalog unavailable */ }
    }
    for (const e of entries.values()) {
      const score = scoreCandidate(
        { manufacturer: e.manufacturer, names: [e.name, ...(e.shortName ? [e.shortName] : [])], counts: e.modes.map((m) => m.channelCount) },
        manufacturer, model, channelCount
      ) + (e.source === 'ofl' ? 0.1 : 0) // OFL definitions carry wheels / capabilities more often
      if (score > MIN_SCORE && (!best || score > best.score)) best = { score, catalogId: e.id }
    }
  }
  if (!best) return null
  if (best.def) return best.def
  try {
    return (await deps.catalog?.get(best.catalogId!)) ?? null
  } catch {
    return null
  }
}

/** The ImportContext importers get (one per import: lookups are cached) */
export function createImportContext(deps: FixtureLookupDeps, options?: ImportOptions): ImportContext {
  const cache = new Map<string, Promise<FixtureDefinition | null>>()
  return {
    options,
    findFixture(manufacturer, model, channelCount) {
      const key = `${manufacturerKey(manufacturer ?? '')}|${compactKey(model ?? '')}|${channelCount ?? ''}`
      let hit = cache.get(key)
      if (!hit) {
        hit = findFixture(deps, manufacturer ?? '', model ?? '', channelCount).catch(() => null)
        cache.set(key, hit)
      }
      // Each importer gets its own copy (it may rename / edit it)
      return hit.then((d) => (d ? structuredClone(d) : null))
    },
    async parseGdtf(bytes, fileName) {
      try {
        // Same reader as the .gdtf importer (gdtf/index.ts). No 10 MB fixture-file cap here: GDTFs
        // embedded in an MVR carry 3D models (the whole file is capped by MAX_IMPORT_SIZE).
        // The file name ("Maker@Model@Revision.gdtf") names the definition when the description does not.
        return parseGdtfArchive(bytes, fileName || undefined).definition
      } catch (e) {
        console.warn('[Interchange] embedded GDTF unreadable:', (e as Error).message)
        return null
      }
    },
    async parseQxf(xml, _fileName) {
      try {
        return parseQLCPlus(xml)
      } catch (e) {
        console.warn('[Interchange] embedded QXF unreadable:', (e as Error).message)
        return null
      }
    }
  }
}
