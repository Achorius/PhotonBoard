// ============================================================
// PhotonBoard — builds the offline fixture catalog from the
// Open Fixture Library and QLC+ fixture repositories.
//
// Pure (no fs): scripts/build-fixture-library.mjs reads the
// pinned source checkouts, calls buildCatalogBundle() and writes
// the result. Deterministic: same inputs → identical output.
//
// Dedupe policy: a QLC+ fixture whose normalised manufacturer +
// model matches an OFL fixture is dropped in favour of the OFL
// one (structured capabilities with 16-bit resolution, wheels
// with slot colours, matrices, physical data; same ids as the
// online OFL path). Its would-be id is kept as an alias.
// ============================================================

import type { FixtureCatalogProvenance, FixtureDefinition } from '../shared/types'
import { convertOflFixture } from './fixture-convert-ofl'
import { convertQxfFixture, parseQxfXml } from './fixture-convert-qxf'
import { manufacturerGroupKey, manufacturerMatchKey, modelMatchKey, slugify } from './fixture-convert-common'
import {
  CATALOG_FORMAT,
  CATALOG_SOURCE_CODES,
  type CatalogIndexFile,
  type CatalogIndexRow,
  type CatalogManifest,
  type CatalogManifestSource
} from './fixture-catalog-format'

export interface CatalogSourceMeta {
  revision: string
  /** ISO date of the commit */
  date: string
}

export interface CatalogBuildInput {
  ofl: CatalogSourceMeta & {
    /** fixtures/manufacturers.json */
    manufacturers: Record<string, { name?: string }>
    /** fixtures/<manufacturer>/<fixture>.json, path relative to the repo root */
    files: { path: string; content: string }[]
  }
  qlcplus: CatalogSourceMeta & {
    /** resources/fixtures/<Manufacturer>/<file>.qxf, path relative to the repo root */
    files: { path: string; content: string }[]
  }
}

export interface CatalogBundle {
  manifest: CatalogManifest
  index: CatalogIndexFile
  /** shard name → { id → definition } (ids sorted) */
  shards: Map<string, Record<string, FixtureDefinition>>
}

export const OFL_REPOSITORY = 'https://github.com/OpenLightingProject/open-fixture-library'
export const QLCPLUS_REPOSITORY = 'https://github.com/mcallegari/qlcplus'

export const DEDUPE_POLICY =
  'QLC+ fixtures whose normalised manufacturer + model match an Open Fixture Library fixture are dropped in favour of the OFL definition ' +
  '(richer structured data: 16-bit resolutions, wheel slots with colours, matrices, physical data; OFL keys, which also resolve ids of the online OFL download). ' +
  'The dropped QLC+ id is kept as an alias of the OFL id.'

interface Candidate {
  def: FixtureDefinition
  source: 'ofl' | 'qlcplus'
  mfrKey: string
  matchKey: string
  /** Manufacturer spelling in its own source */
  mfrName: string
  /** Shard preference (OFL manufacturer key, or slug of the QLC+ spelling) */
  shardHint: string
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function buildCatalogBundle(input: CatalogBuildInput): CatalogBundle {
  const skipped: CatalogManifest['skipped'] = []
  const aliases: Record<string, string> = {}
  const candidates: Candidate[] = []

  // ---- OFL ----
  const oflFiles = [...input.ofl.files].sort((a, b) => byString(a.path, b.path))
  let oflConverted = 0
  for (const file of oflFiles) {
    const m = file.path.match(/(?:^|\/)fixtures\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/)
    if (!m) continue
    const [, mfrKey, fixtureKey] = m
    let json: any
    try { json = JSON.parse(file.content) } catch (e) { skipped.push({ source: 'ofl', path: file.path, reason: `invalid JSON: ${(e as Error).message}` }); continue }
    if (typeof json?.redirectTo === 'string') {
      aliases[`ofl/${mfrKey}/${fixtureKey}`] = `ofl/${json.redirectTo}`
      skipped.push({ source: 'ofl', path: file.path, reason: `redirect to ${json.redirectTo}` })
      continue
    }
    const mfrName = input.ofl.manufacturers[mfrKey]?.name || mfrKey
    try {
      const def = convertOflFixture(json, {
        manufacturerKey: mfrKey,
        fixtureKey,
        manufacturerName: mfrName,
        id: `ofl/${mfrKey}/${fixtureKey}`,
        source: 'ofl',
        catalog: compactProvenance({ source: 'ofl' as const, path: file.path, revision: input.ofl.revision, license: 'MIT', authors: json.meta?.authors })
      })
      oflConverted++
      candidates.push({ def, source: 'ofl', mfrKey: manufacturerGroupKey(mfrName), matchKey: matchKeyOf(def.name, mfrName), mfrName, shardHint: mfrKey })
    } catch (e) {
      skipped.push({ source: 'ofl', path: file.path, reason: (e as Error).message })
    }
  }

  // ---- QLC+ ----
  const oflByMatch = new Map<string, Candidate>()
  for (const c of candidates) if (!oflByMatch.has(c.matchKey)) oflByMatch.set(c.matchKey, c)
  const qlcFiles = [...input.qlcplus.files].sort((a, b) => byString(a.path, b.path))
  const usedIds = new Set(candidates.map((c) => c.def.id))
  let qlcConverted = 0
  let duplicates = 0
  for (const file of qlcFiles) {
    if (!file.path.endsWith('.qxf')) continue
    let doc: any
    try { doc = parseQxfXml(file.content) } catch (e) { skipped.push({ source: 'qlcplus', path: file.path, reason: `invalid XML: ${(e as Error).message}` }); continue }
    const mfrName = String(doc?.FixtureDefinition?.Manufacturer ?? '').trim()
    const model = String(doc?.FixtureDefinition?.Model ?? '').trim()
    if (!mfrName || !model) { skipped.push({ source: 'qlcplus', path: file.path, reason: 'missing manufacturer or model' }); continue }
    let id = `qlc/${slugify(mfrName) || 'unknown'}/${slugify(model) || 'fixture'}`
    if (usedIds.has(id)) {
      const fileSlug = slugify(file.path.split('/').pop()!.replace(/\.qxf$/, ''))
      id = `qlc/${slugify(mfrName) || 'unknown'}/${fileSlug}`
      for (let i = 2; usedIds.has(id); i++) id = `qlc/${slugify(mfrName) || 'unknown'}/${fileSlug}-${i}`
    }
    const matchKey = matchKeyOf(model, mfrName)
    const ofl = oflByMatch.get(matchKey)
    if (ofl) {
      duplicates++
      aliases[id] = ofl.def.id
      continue
    }
    try {
      const def = convertQxfFixture(doc, {
        id,
        source: 'qlcplus',
        sourceUrl: `${QLCPLUS_REPOSITORY}/blob/${input.qlcplus.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
        catalog: compactProvenance({ source: 'qlcplus' as const, path: file.path, revision: input.qlcplus.revision, license: 'Apache-2.0', authors: qxfAuthors(doc) })
      })
      usedIds.add(id)
      qlcConverted++
      candidates.push({ def, source: 'qlcplus', mfrKey: manufacturerGroupKey(mfrName), matchKey, mfrName, shardHint: slugify(mfrName) || 'unknown' })
    } catch (e) {
      skipped.push({ source: 'qlcplus', path: file.path, reason: (e as Error).message })
    }
  }

  // ---- unified manufacturers ----
  const groups = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const g = groups.get(c.mfrKey)
    if (g) g.push(c)
    else groups.set(c.mfrKey, [c])
  }
  const mfrInfo = new Map<string, { name: string; shard: string }>()
  for (const [key, list] of groups) {
    const ofl = list.filter((c) => c.source === 'ofl')
    let name: string
    let shard: string
    if (ofl.length) {
      name = ofl[0].mfrName
      shard = ofl[0].shardHint
    } else {
      const counts = new Map<string, number>()
      for (const c of list) counts.set(c.mfrName, (counts.get(c.mfrName) ?? 0) + 1)
      name = [...counts.entries()].sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))[0][0]
      shard = slugify(name) || 'unknown'
    }
    mfrInfo.set(key, { name, shard })
  }
  for (const c of candidates) c.def.manufacturer = mfrInfo.get(c.mfrKey)!.name

  // ---- index + shards (sorted, deterministic) ----
  const manufacturers = [...new Map([...mfrInfo.values()].map((m) => [m.name, m])).values()]
    .sort((a, b) => byString(a.name.toLowerCase(), b.name.toLowerCase()) || byString(a.name, b.name))
  const mfrIndex = new Map(manufacturers.map((m, i) => [m.name, i]))
  const sorted = [...candidates].sort((a, b) => byString(a.def.id, b.def.id))
  const fixtures: CatalogIndexRow[] = []
  const shards = new Map<string, Record<string, FixtureDefinition>>()
  for (const c of sorted) {
    const def = c.def
    const m = manufacturers[mfrIndex.get(def.manufacturer)!]
    const row: CatalogIndexRow = [
      def.id,
      def.name,
      mfrIndex.get(def.manufacturer)!,
      def.categories,
      def.modes.map((mode) => [mode.name, mode.channelCount] as [string, number]),
      CATALOG_SOURCE_CODES[c.source]
    ]
    if (def.shortName) row.push(def.shortName)
    fixtures.push(row)
    let shard = shards.get(m.shard)
    if (!shard) { shard = {}; shards.set(m.shard, shard) }
    shard[def.id] = def
  }
  const sortedAliases: Record<string, string> = {}
  for (const k of Object.keys(aliases).sort(byString)) sortedAliases[k] = aliases[k]

  const oflCount = candidates.filter((c) => c.source === 'ofl').length
  const qlcCount = candidates.length - oflCount
  const sources: CatalogManifestSource[] = [
    {
      id: 'ofl', name: 'Open Fixture Library', repository: OFL_REPOSITORY, url: 'https://open-fixture-library.org',
      revision: input.ofl.revision, date: input.ofl.date, license: 'MIT', licenseFile: 'LICENSES/open-fixture-library-LICENSE.txt',
      files: oflFiles.filter((f) => /\/fixtures\/[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(`/${f.path}`)).length, converted: oflConverted, fixtureCount: oflCount
    },
    {
      id: 'qlcplus', name: 'QLC+ fixture definitions', repository: QLCPLUS_REPOSITORY, url: 'https://www.qlcplus.org',
      revision: input.qlcplus.revision, date: input.qlcplus.date, license: 'Apache-2.0', licenseFile: 'LICENSES/qlcplus-COPYING.txt',
      files: qlcFiles.filter((f) => f.path.endsWith('.qxf')).length, converted: qlcConverted, fixtureCount: qlcCount
    }
  ]

  return {
    manifest: {
      format: CATALOG_FORMAT,
      generatedBy: 'scripts/build-fixture-library.mjs',
      fixtureCount: fixtures.length,
      manufacturerCount: manufacturers.length,
      sources,
      dedupePolicy: DEDUPE_POLICY,
      duplicates,
      skipped
    },
    index: { format: CATALOG_FORMAT, manufacturers, fixtures, aliases: sortedAliases },
    shards
  }
}

function matchKeyOf(model: string, manufacturer: string): string {
  return `${manufacturerMatchKey(manufacturer)}|${modelMatchKey(model, manufacturer)}`
}

function qxfAuthors(doc: any): string[] | undefined {
  const a = String(doc?.FixtureDefinition?.Creator?.Author ?? '').trim()
  return a ? a.split(/\s*[,;]\s*/).filter(Boolean) : undefined
}

function compactProvenance(p: FixtureCatalogProvenance): FixtureCatalogProvenance {
  if (!Array.isArray(p.authors) || p.authors.length === 0) delete p.authors
  else p.authors = (p.authors as unknown[]).filter((a): a is string => typeof a === 'string')
  return p
}
