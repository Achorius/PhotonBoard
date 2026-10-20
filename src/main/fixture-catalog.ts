// ============================================================
// PhotonBoard — offline fixture catalog (main process)
//
// Thousands of fixture definitions converted from the Open Fixture
// Library and QLC+ (resources/fixture-library, see
// scripts/build-fixture-library.mjs), available without network.
//
// - The index (~100 KB gz) is loaded once, lazily and async.
// - Definitions live in per-manufacturer gzip shards, loaded on
//   demand and kept in a small LRU cache.
// - Patching a catalog fixture INSTALLS it: its definition is copied
//   into the user library (userData/fixtures) like an OFL download,
//   so shows keep working even if a later catalog changes it.
// - Opening a show whose fixtures are missing from the library
//   installs them from the catalog (show made on another machine).
// ============================================================

import { promises as fsp, existsSync } from 'fs'
import { join } from 'path'
import { gunzip } from 'zlib'
import { promisify } from 'util'
import type {
  FixtureCatalogEntry,
  FixtureCatalogInfo,
  FixtureCatalogQuery,
  FixtureCatalogSearchResult,
  FixtureDefinition,
  ShowFile
} from '../shared/types'
import { CATALOG_FORMAT, CATALOG_SOURCE_BY_CODE, type CatalogIndexFile, type CatalogManifest } from './fixture-catalog-format'
import { compactKey, searchTokens } from './fixture-convert-common'

const gunzipAsync = promisify(gunzip)

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500
const MAX_CACHED_SHARDS = 12
const MAX_ALIAS_HOPS = 5

export const CATALOG_ID_PATTERN = /^(ofl|qlc)\/[a-z0-9-]+\/[a-z0-9-]+$/

interface SearchRecord {
  entry: FixtureCatalogEntry
  shard: string
  modelTokens: string[]
  mfrTokens: string[]
  modelCompact: string
  allCompact: string
  mfrCompact: string
  categories: Set<string>
  counts: Set<number>
}

interface LoadedCatalog {
  dir: string
  manifest: CatalogManifest
  records: SearchRecord[]
  byId: Map<string, SearchRecord>
  aliases: Record<string, string>
  info: FixtureCatalogInfo
}

/** Where the bundle can be: packaged (process.resourcesPath) first, then the source tree */
export function defaultCatalogDirs(opts: { resourcesPath?: string; appPath?: string; mainDir?: string }): string[] {
  const dirs: string[] = []
  if (opts.resourcesPath) dirs.push(join(opts.resourcesPath, 'fixture-library'))
  if (opts.appPath) dirs.push(join(opts.appPath, 'resources', 'fixture-library'))
  if (opts.mainDir) dirs.push(join(opts.mainDir, '..', '..', 'resources', 'fixture-library'))
  return dirs
}

export class FixtureCatalog {
  private dirs: string[]
  private loaded: LoadedCatalog | null = null
  private loadPromise: Promise<LoadedCatalog | null> | null = null
  private error: string | null = null
  private shardCache = new Map<string, Promise<Record<string, FixtureDefinition>>>()

  constructor(dirs: string[]) {
    this.dirs = dirs
  }

  /** Load the index (once). Never rejects: a missing / broken bundle makes the catalog empty. */
  load(): Promise<LoadedCatalog | null> {
    if (this.loaded) return Promise.resolve(this.loaded)
    if (!this.loadPromise) {
      this.loadPromise = this.doLoad().then(
        (c) => { this.loaded = c; return c },
        (e) => {
          this.error = (e as Error).message || String(e)
          console.error('[Catalog] Fixture catalog unavailable:', this.error)
          return null
        }
      )
    }
    return this.loadPromise
  }

  private async doLoad(): Promise<LoadedCatalog> {
    const t0 = Date.now()
    const dir = this.dirs.find((d) => existsSync(join(d, 'index.json.gz')))
    if (!dir) throw new Error(`fixture library not found (looked in ${this.dirs.join(', ')})`)
    const [manifestRaw, indexGz] = await Promise.all([
      fsp.readFile(join(dir, 'manifest.json'), 'utf8'),
      fsp.readFile(join(dir, 'index.json.gz'))
    ])
    const manifest = JSON.parse(manifestRaw) as CatalogManifest
    const index = JSON.parse((await gunzipAsync(indexGz)).toString('utf8')) as CatalogIndexFile
    if (index.format !== CATALOG_FORMAT) throw new Error(`unsupported fixture library format ${index.format}`)

    const records: SearchRecord[] = []
    const byId = new Map<string, SearchRecord>()
    const mfrCounts = new Map<string, number>()
    const catCounts = new Map<string, number>()
    for (const row of index.fixtures) {
      const [id, name, mfrIdx, categories, modes, sourceCode, shortName] = row
      const mfr = index.manufacturers[mfrIdx]
      if (!mfr || typeof id !== 'string') continue
      const entry: FixtureCatalogEntry = {
        id,
        name,
        manufacturer: mfr.name,
        categories,
        modes: modes.map(([n, c]) => ({ name: n, channelCount: c })),
        source: CATALOG_SOURCE_BY_CODE[sourceCode] ?? 'ofl'
      }
      if (shortName) entry.shortName = shortName
      const rec: SearchRecord = {
        entry,
        shard: mfr.shard,
        modelTokens: [...new Set([...searchTokens(name), ...(shortName ? searchTokens(shortName) : [])])],
        mfrTokens: manufacturerTokens(mfr.name),
        modelCompact: compactKey(name) + (shortName ? ` ${compactKey(shortName)}` : ''),
        allCompact: `${compactKey(mfr.name)} ${compactKey(name)}${shortName ? ` ${compactKey(shortName)}` : ''}`,
        mfrCompact: compactKey(mfr.name),
        categories: new Set(categories.map((c) => c.toLowerCase())),
        counts: new Set(modes.map(([, c]) => c))
      }
      records.push(rec)
      byId.set(id, rec)
      mfrCounts.set(mfr.name, (mfrCounts.get(mfr.name) ?? 0) + 1)
      for (const c of categories) catCounts.set(c, (catCounts.get(c) ?? 0) + 1)
    }
    const byName = (a: [string, number], b: [string, number]) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })
    const info: FixtureCatalogInfo = {
      available: true,
      fixtureCount: records.length,
      sources: manifest.sources.map((s) => ({ id: s.id, name: s.name, url: s.url, revision: s.revision, date: s.date, license: s.license, fixtureCount: s.fixtureCount })),
      manufacturers: [...mfrCounts.entries()].sort(byName).map(([name, count]) => ({ name, count })),
      categories: [...catCounts.entries()].sort(byName).map(([name, count]) => ({ name, count }))
    }
    console.log(`[Catalog] ${records.length} fixtures from ${dir} (${Date.now() - t0} ms)`)
    return { dir, manifest, records, byId, aliases: index.aliases ?? {}, info }
  }

  async info(): Promise<FixtureCatalogInfo> {
    const c = await this.load()
    if (!c) return { available: false, error: this.error ?? 'unavailable', fixtureCount: 0, sources: [], manufacturers: [], categories: [] }
    return c.info
  }

  async search(query: FixtureCatalogQuery = {}): Promise<FixtureCatalogSearchResult> {
    const c = await this.load()
    if (!c) return { total: 0, entries: [] }
    const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(query.limit) || DEFAULT_LIMIT)))
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0))
    const mfr = query.manufacturer ? compactKey(query.manufacturer) : ''
    const cat = query.category ? query.category.toLowerCase() : ''
    const count = Number.isInteger(query.channelCount) && (query.channelCount as number) > 0 ? query.channelCount as number : 0
    const terms = query.text ? searchTokens(query.text).slice(0, 12) : []
    const whole = query.text ? compactKey(query.text) : ''

    const hits: { rec: SearchRecord; score: number }[] = []
    for (const rec of c.records) {
      if (mfr && rec.mfrCompact !== mfr) continue
      if (cat && !rec.categories.has(cat)) continue
      if (count && !rec.counts.has(count)) continue
      if (query.source && rec.entry.source !== query.source) continue
      const score = terms.length ? scoreRecord(rec, terms, whole) : 1
      if (score > 0) hits.push({ rec, score })
    }
    hits.sort((a, b) => b.score - a.score || compareEntries(a.rec.entry, b.rec.entry))
    return { total: hits.length, entries: hits.slice(offset, offset + limit).map((h) => h.rec.entry) }
  }

  /** Current catalog id for an id (follows aliases: OFL redirects, superseded QLC+ ids) */
  async resolveId(id: string): Promise<string | null> {
    const c = await this.load()
    if (!c || typeof id !== 'string') return null
    let cur = id
    for (let i = 0; i <= MAX_ALIAS_HOPS; i++) {
      if (c.byId.has(cur)) return cur
      const next = c.aliases[cur]
      if (!next) return null
      cur = next
    }
    return null
  }

  /** A copy of a catalog definition (null when unknown). Loads its shard on demand. */
  async get(id: string): Promise<FixtureDefinition | null> {
    const c = await this.load()
    if (!c) return null
    const resolved = await this.resolveId(id)
    if (!resolved) return null
    const rec = c.byId.get(resolved)!
    const shard = await this.loadShard(c, rec.shard)
    const def = shard[resolved]
    return def ? structuredClone(def) : null
  }

  private loadShard(c: LoadedCatalog, name: string): Promise<Record<string, FixtureDefinition>> {
    const cached = this.shardCache.get(name)
    if (cached) {
      // refresh LRU position
      this.shardCache.delete(name)
      this.shardCache.set(name, cached)
      return cached
    }
    if (!/^[a-z0-9-]+$/.test(name)) return Promise.reject(new Error('Invalid catalog shard'))
    const p = fsp.readFile(join(c.dir, 'fixtures', `${name}.json.gz`))
      .then((buf) => gunzipAsync(buf))
      .then((raw) => JSON.parse(raw.toString('utf8')) as Record<string, FixtureDefinition>)
    p.catch(() => this.shardCache.delete(name))
    this.shardCache.set(name, p)
    while (this.shardCache.size > MAX_CACHED_SHARDS) {
      const oldest = this.shardCache.keys().next().value as string
      this.shardCache.delete(oldest)
    }
    return p
  }
}

// ---------------------------------------------------------------
// Search scoring: every query word must match (prefix, substring
// of the compact name, or a typo within 1-2 edits)
// ---------------------------------------------------------------

function scoreRecord(rec: SearchRecord, terms: string[], whole: string): number {
  let score = 0
  for (const t of terms) {
    let best = 0
    for (const tok of rec.modelTokens) {
      if (tok === t) { best = Math.max(best, 10); break }
      if (tok.startsWith(t)) best = Math.max(best, 7)
    }
    if (best < 6) {
      for (const tok of rec.mfrTokens) {
        if (tok === t) { best = Math.max(best, 6); break }
        if (tok.startsWith(t)) best = Math.max(best, 4)
      }
    }
    if (best === 0 && t.length >= 2) {
      if (rec.modelCompact.includes(t)) best = 3
      else if (rec.allCompact.includes(t)) best = 2
    }
    if (best === 0 && t.length >= 4) {
      const maxEdits = t.length >= 8 ? 2 : 1
      for (const tok of [...rec.modelTokens, ...rec.mfrTokens]) {
        if (tok.length < 3) continue
        if (withinEdits(t, tok, maxEdits) || (tok.length > t.length && withinEdits(t, tok.slice(0, t.length), maxEdits))) { best = 1.5; break }
      }
    }
    if (best === 0) return 0
    score += best
  }
  if (whole) {
    const model = rec.modelCompact.split(' ')[0]
    if (model === whole) score += 20
    else if (model.startsWith(whole)) score += 8
    else if (rec.allCompact.replace(/ /g, '').startsWith(whole)) score += 5
  }
  return score
}

/** Words of a manufacturer name plus its initials ("American DJ" → american, dj, adj) */
function manufacturerTokens(name: string): string[] {
  const words = searchTokens(name)
  const tokens = [...words]
  if (words.length >= 2) {
    // initials, keeping a short last word whole: "American DJ" → "adj", "High End Systems" → "hes"
    const last = words[words.length - 1]
    const initials = words.slice(0, -1).map((w) => w[0]).join('') + (last.length <= 2 ? last : last[0])
    if (initials.length >= 2 && !tokens.includes(initials)) tokens.push(initials)
  }
  return tokens
}

/** Optimal-string-alignment distance ≤ max (early exit) */
export function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  const prev2 = new Array(b.length + 1).fill(0)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur.push(v)
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return false
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]
    prev = cur
  }
  return prev[b.length] <= max
}

function compareEntries(a: FixtureCatalogEntry, b: FixtureCatalogEntry): number {
  return a.manufacturer.localeCompare(b.manufacturer, 'en', { sensitivity: 'base' })
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// ---------------------------------------------------------------
// Library integration
// ---------------------------------------------------------------

/** What the catalog needs from the fixture library (ShowFileManager) */
export interface FixtureLibraryLike {
  getAllFixtures(): FixtureDefinition[]
  saveUserFixture(fixture: FixtureDefinition): { success: boolean; error?: string }
}

/**
 * Copy a catalog fixture into the user library (idempotent: an already
 * installed definition is returned as is, never overwritten — patched shows
 * depend on its mode names).
 */
export async function installCatalogFixture(catalog: FixtureCatalog, library: FixtureLibraryLike, id: string): Promise<FixtureDefinition> {
  const existing = library.getAllFixtures().find((f) => f.id === id)
  if (existing) return existing
  const def = await catalog.get(id)
  if (!def) throw new Error(`Fixture "${id}" is not in the offline library`)
  const installed = library.getAllFixtures().find((f) => f.id === def.id) // id was an alias
  if (installed) return installed
  const saved = library.saveUserFixture(def)
  if (!saved.success) throw new Error(saved.error || 'Could not save the fixture')
  return def
}

/**
 * Install, from the catalog, the fixture types a show patches but the library
 * lacks (show created on another machine). The catalog definition is installed
 * under the id the show uses, and only when it has every mode the show uses.
 * Returns the ids installed.
 */
export async function installMissingShowFixtures(catalog: FixtureCatalog, library: FixtureLibraryLike, show: Pick<ShowFile, 'patch'>): Promise<string[]> {
  if (!Array.isArray(show?.patch) || show.patch.length === 0) return []
  const have = new Set(library.getAllFixtures().map((f) => f.id))
  const wanted = new Map<string, Set<string>>()
  for (const p of show.patch) {
    if (!p || typeof p.fixtureDefId !== 'string' || have.has(p.fixtureDefId)) continue
    const modes = wanted.get(p.fixtureDefId) ?? new Set<string>()
    if (typeof p.modeName === 'string') modes.add(p.modeName)
    wanted.set(p.fixtureDefId, modes)
  }
  if (wanted.size === 0) return []
  const installed: string[] = []
  for (const [id, modes] of wanted) {
    if (id.length > 256) continue
    // Catalog ids, aliases, and ids of the online OFL download ("<maker>/<model>")
    const candidates = [id, `ofl/${id}`]
    for (const candidate of candidates) {
      const def = await catalog.get(candidate)
      if (!def) continue
      if (![...modes].every((m) => def.modes.some((dm) => dm.name === m))) continue
      def.id = id
      const saved = library.saveUserFixture(def)
      if (saved.success) installed.push(id)
      break
    }
  }
  if (installed.length) console.log(`[Catalog] Installed ${installed.length} fixture type(s) used by the show: ${installed.join(', ')}`)
  return installed
}

// ---------------------------------------------------------------
// Argument validation (IPC / remote web UI)
// ---------------------------------------------------------------

export function isCatalogId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 256 && CATALOG_ID_PATTERN.test(id)
}

/** Validated copy of a search query from IPC; throws on malformed input */
export function sanitizeCatalogQuery(raw: unknown): FixtureCatalogQuery {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid catalog query')
  const q = raw as Record<string, unknown>
  const out: FixtureCatalogQuery = {}
  const str = (k: 'text' | 'manufacturer' | 'category', max: number) => {
    const v = q[k]
    if (v === undefined || v === null || v === '') return
    if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid catalog query: ${k}`)
    out[k] = v
  }
  str('text', 200)
  str('manufacturer', 200)
  str('category', 100)
  const int = (k: 'channelCount' | 'limit' | 'offset', min: number, max: number) => {
    const v = q[k]
    if (v === undefined || v === null) return
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`Invalid catalog query: ${k}`)
    out[k] = v
  }
  int('channelCount', 1, 512)
  int('limit', 1, MAX_LIMIT)
  int('offset', 0, 1_000_000)
  if (q.source !== undefined && q.source !== null) {
    if (q.source !== 'ofl' && q.source !== 'qlcplus') throw new Error('Invalid catalog query: source')
    out.source = q.source
  }
  return out
}
