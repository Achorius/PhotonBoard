import type { FixtureDefinition, OFLSearchResult } from '../shared/types'
import { convertOflFixture } from './fixture-convert-ofl'

interface OFLManufacturer {
  name: string
  website?: string
}

interface OFLFixtureListItem {
  name: string
  categories: string[]
}

type OFLIndexItem = { manufacturer: string; manufacturerKey: string; fixtureKey: string; name: string; categories: string[] }

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>

const OFL_API = 'https://open-fixture-library.org/api/v1'
/** A loaded index is refreshed after this long (OFL gains fixtures over time) */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000
/** After a failed load, wait this long before hitting the network again */
const FAILURE_RETRY_MS = 30 * 1000
const BATCH_SIZE = 20
const BATCH_ATTEMPTS = 3

export function isOflKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 128 && /^[a-z0-9][a-z0-9-]*$/i.test(key)
}

export class OFLService {
  private fixtureIndex: OFLIndexItem[] | null = null
  private indexLoadedAt = 0
  private lastFailureAt: number | null = null
  private lastError: string | null = null
  private indexLoadPromise: Promise<void> | null = null
  private fetchFn: FetchFn
  private now: () => number
  private retryDelayMs: number

  constructor(opts: { fetch?: FetchFn; now?: () => number; retryDelayMs?: number } = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init))
    this.now = opts.now ?? Date.now
    this.retryDelayMs = opts.retryDelayMs ?? 1000
  }

  // Fetch and cache the full fixture index from OFL
  // Step 1: get manufacturer keys, Step 2: fetch each manufacturer's fixture list in parallel.
  // A failed load leaves the index empty (null) so a later search retries, instead of
  // caching an empty list until restart.
  private async ensureIndex(): Promise<void> {
    const now = this.now()
    if (this.fixtureIndex && now - this.indexLoadedAt < INDEX_TTL_MS) return
    if (this.indexLoadPromise) {
      // A stale index keeps serving searches while the refresh runs
      if (!this.fixtureIndex) await this.indexLoadPromise
      return
    }
    if (this.lastFailureAt !== null && now - this.lastFailureAt < FAILURE_RETRY_MS) return

    const load = (async () => {
      try {
        const index = await this.loadIndex()
        this.fixtureIndex = index
        this.indexLoadedAt = this.now()
        this.lastFailureAt = null
        this.lastError = null
      } catch (e) {
        console.error('[OFL] Failed to load index:', (e as Error).message)
        this.lastFailureAt = this.now()
        this.lastError = (e as Error).message || String(e)
        // Keep a previously loaded (stale) index if we have one; otherwise stay
        // null so a later search tries again instead of being disabled until restart.
      } finally {
        this.indexLoadPromise = null
      }
    })()
    this.indexLoadPromise = load
    if (!this.fixtureIndex) await load
  }

  private async loadIndex(): Promise<OFLIndexItem[]> {
    // Step 1: Get all manufacturer keys
    const mfrRes = await this.fetchFn(`${OFL_API}/manufacturers`, { signal: AbortSignal.timeout(15000) })
    if (!mfrRes.ok) throw new Error(`OFL API error: ${mfrRes.status}`)
    const mfrData = await mfrRes.json() as Record<string, { name: string; fixtureCount?: number }>

    const mfrKeys = Object.keys(mfrData).filter(k => !k.startsWith('$'))
    console.log(`[OFL] Found ${mfrKeys.length} manufacturers, loading fixture lists...`)

    // Step 2: Fetch each manufacturer's fixture list in parallel batches; failed
    // manufacturers are retried a few times so a flaky connection doesn't silently
    // drop whole brands from the index.
    const index: OFLIndexItem[] = []
    let pending = mfrKeys
    for (let attempt = 1; attempt <= BATCH_ATTEMPTS && pending.length > 0; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, this.retryDelayMs * (attempt - 1)))
      const failed: string[] = []
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map(async (mfrKey) => {
            const res = await this.fetchFn(`${OFL_API}/manufacturers/${mfrKey}`, { signal: AbortSignal.timeout(10000) })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return { mfrKey, data: await res.json() }
          })
        )
        results.forEach((result, j) => {
          if (result.status !== 'fulfilled') { failed.push(batch[j]); return }
          const { mfrKey, data } = result.value
          const mfrName = data?.name || mfrData[mfrKey]?.name || mfrKey
          const fixtures = Array.isArray(data?.fixtures) ? data.fixtures : []
          for (const fix of fixtures) {
            const fixtureKey = typeof fix === 'string' ? fix : fix?.key
            if (typeof fixtureKey !== 'string' || !fixtureKey) continue
            index.push({
              manufacturer: mfrName,
              manufacturerKey: mfrKey,
              fixtureKey,
              name: (typeof fix === 'object' && fix.name) || fixtureKey.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              categories: (typeof fix === 'object' && Array.isArray(fix.categories)) ? fix.categories : []
            })
          }
        })
      }
      pending = failed
    }
    if (pending.length > 0) {
      console.warn(`[OFL] ${pending.length} manufacturer list(s) could not be loaded: ${pending.slice(0, 10).join(', ')}`)
    }
    if (index.length === 0) throw new Error('OFL index is empty')
    console.log(`[OFL] Index loaded: ${index.length} fixtures from ${mfrKeys.length - pending.length} manufacturers`)
    return index
  }

  /** Rejects when the online index cannot be loaded (offline, OFL down) — never "no results" */
  async search(query: string, maxResults = 50): Promise<OFLSearchResult[]> {
    await this.ensureIndex()
    if (!this.fixtureIndex || this.fixtureIndex.length === 0) {
      throw new Error(`Could not reach the Open Fixture Library${this.lastError ? ` (${this.lastError})` : ''}. Check the internet connection and try again.`)
    }

    const q = query.toLowerCase().trim()
    if (!q) return []

    const terms = q.split(/\s+/)

    const scored: { item: OFLIndexItem; score: number }[] = []

    for (const item of this.fixtureIndex) {
      const searchStr = `${item.manufacturer} ${item.name} ${item.fixtureKey}`.toLowerCase()
      let score = 0
      let allMatch = true
      for (const term of terms) {
        if (searchStr.includes(term)) {
          score += term.length
          // Bonus for exact name match
          if (item.name.toLowerCase().includes(term)) score += 2
          if (item.fixtureKey.includes(term)) score += 1
        } else {
          allMatch = false
          break
        }
      }
      if (allMatch && score > 0) {
        scored.push({ item, score })
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(({ item }) => ({
        name: item.name,
        manufacturer: item.manufacturer,
        manufacturerKey: item.manufacturerKey,
        fixtureKey: item.fixtureKey,
        categories: item.categories
      }))
  }

  async download(manufacturerKey: string, fixtureKey: string): Promise<FixtureDefinition> {
    // Keys end up in a URL and in the saved fixture id — only accept OFL-style slugs
    if (!isOflKey(manufacturerKey) || !isOflKey(fixtureKey)) {
      throw new Error('Invalid fixture key')
    }
    const url = `https://open-fixture-library.org/${manufacturerKey}/${fixtureKey}.json`
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`Failed to download fixture: ${res.status}`)
    const oflData = await res.json()

    // Convert OFL format to native PhotonBoard format (same converter as the offline catalog).
    // The id stays "<maker>/<model>" (shows patched with earlier downloads reference it).
    const manufacturerName = this.fixtureIndex?.find((i) => i.manufacturerKey === manufacturerKey)?.manufacturer
    return convertOflFixture(oflData, { manufacturerKey, fixtureKey, manufacturerName, stampNow: true })
  }
}
