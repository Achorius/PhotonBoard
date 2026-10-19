import type { FixtureDefinition, OFLSearchResult } from '../shared/types'

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
      } catch (e) {
        console.error('[OFL] Failed to load index:', (e as Error).message)
        this.lastFailureAt = this.now()
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

  async search(query: string, maxResults = 50): Promise<OFLSearchResult[]> {
    await this.ensureIndex()
    if (!this.fixtureIndex || this.fixtureIndex.length === 0) return []

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

    // Convert OFL format to native PhotonBoard format
    return this.convertOFLToNative(oflData, manufacturerKey, fixtureKey)
  }

  private convertOFLToNative(ofl: any, manufacturerKey: string, fixtureKey: string): FixtureDefinition {
    const manufacturer = ofl.manufacturer?.name || manufacturerKey.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    const name = ofl.name || fixtureKey.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    const id = `${manufacturerKey}/${fixtureKey}`

    const channels: Record<string, any> = {}

    // Parse OFL availableChannels
    if (ofl.availableChannels) {
      for (const [chName, chDef] of Object.entries(ofl.availableChannels) as [string, any][]) {
        const type = this.inferChannelType(chName, chDef)
        const capabilities = (chDef?.capability ? [chDef.capability] : chDef?.capabilities || []).map((cap: any) => ({
          dmxRange: cap.dmxRange || [0, 255],
          type: cap.type || 'Generic',
          label: cap.comment || cap.type || chName,
          color: cap.color?.startsWith('#') ? cap.color : cap.colors?.allColors?.[0],
        }))

        channels[chName] = {
          name: chName,
          type,
          defaultValue: chDef?.defaultValue != null ? (typeof chDef.defaultValue === 'string' ? parseInt(chDef.defaultValue) || 0 : chDef.defaultValue) : (type === 'pan' || type === 'tilt' ? 128 : 0),
          highlightValue: type === 'intensity' ? 255 : undefined,
          precedence: type === 'intensity' ? 'HTP' : 'LTP',
          fineChannelAliases: chDef?.fineChannelAliases,
          capabilities: capabilities.length > 0 ? capabilities : undefined
        }
      }
    }

    // Parse modes
    const modes = (ofl.modes || []).map((mode: any) => {
      // OFL modes reference channel names, but may also have null entries for unused channels
      const modeChannels = (mode.channels || []).filter((ch: any) => ch !== null && typeof ch === 'string')
      return {
        name: mode.name || 'Default',
        shortName: mode.shortName,
        channels: modeChannels,
        channelCount: modeChannels.length
      }
    })

    if (modes.length === 0) {
      modes.push({
        name: 'Default',
        channels: Object.keys(channels),
        channelCount: Object.keys(channels).length
      })
    }

    // Parse physical
    let physical: any = undefined
    if (ofl.physical) {
      physical = {
        dimensions: ofl.physical.dimensions,
        weight: ofl.physical.weight,
        power: ofl.physical.power,
        DMXconnector: ofl.physical.DMXconnector,
        bulb: ofl.physical.bulb ? {
          type: ofl.physical.bulb.type,
          lumens: ofl.physical.bulb.lumens,
          colorTemperature: ofl.physical.bulb.colorTemperature
        } : undefined,
        lens: ofl.physical.lens ? {
          degreesMinMax: ofl.physical.lens.degreesMinMax
        } : undefined,
        panRange: undefined, // GDTF-ready
        tiltRange: undefined
      }
    }

    // Parse wheels (GDTF-ready)
    let wheels: any[] | undefined
    if (ofl.wheels) {
      wheels = Object.entries(ofl.wheels).map(([wheelName, wheelSlots]: [string, any]) => ({
        name: wheelName,
        slots: (wheelSlots.slots || wheelSlots || []).map((slot: any) => ({
          type: slot.type === 'Color' ? 'Color' : slot.type === 'Gobo' ? 'Gobo' : slot.type === 'Open' ? 'Open' : 'Gobo',
          name: slot.name || 'Unknown',
          color: slot.colors?.[0],
        }))
      }))
    }

    const categories: string[] = ofl.categories || ['Other']

    return {
      id,
      name,
      manufacturer,
      categories,
      channels,
      modes,
      physical: physical || undefined,
      wheels: wheels?.length ? wheels : undefined,
      source: 'ofl',
      sourceUrl: `https://open-fixture-library.org/${manufacturerKey}/${fixtureKey}`,
      lastModified: new Date().toISOString()
    }
  }

  private inferChannelType(name: string, chDef: any): string {
    const n = name.toLowerCase()
    // Check capabilities first for more precise detection
    if (chDef?.capability?.type || chDef?.capabilities?.[0]?.type) {
      const capType = (chDef.capability?.type || chDef.capabilities?.[0]?.type || '').toLowerCase()
      if (capType.includes('intensity') || capType === 'brightness') return 'intensity'
      if (capType.includes('colorintensity')) return 'color'
      if (capType.includes('pan')) return 'pan'
      if (capType.includes('tilt')) return 'tilt'
      if (capType.includes('wheelslot') && n.includes('gobo')) return 'gobo'
      if (capType.includes('wheelslot') && n.includes('color')) return 'color'
      if (capType.includes('prism')) return 'prism'
      if (capType.includes('shutter') || capType.includes('strobe')) return 'shutter'
      if (capType.includes('fog') || capType.includes('haze')) return 'fog'
      if (capType.includes('speed') || capType.includes('panspeed') || capType.includes('tiltspeed')) return 'speed'
      if (capType.includes('effect')) return 'effect'
      if (capType.includes('maintenance') || capType.includes('reset')) return 'maintenance'
    }
    // Fallback to name matching
    if (n.includes('dimmer') || n.includes('intensity') || n.includes('brightness') || n === 'dim') return 'intensity'
    if (n.includes('red') || n.includes('green') || n.includes('blue') || n.includes('white') ||
        n.includes('amber') || n.includes('uv') || n.includes('cyan') || n.includes('magenta') ||
        n.includes('yellow') || n.includes('cto') || n.includes('ctb') || n.includes('color') || n.includes('colour')) return 'color'
    if (n === 'pan' || n.includes('pan fine') || n === 'pan/tilt speed') return n.includes('speed') ? 'speed' : 'pan'
    if (n === 'tilt' || n.includes('tilt fine')) return 'tilt'
    if (n.includes('gobo')) return 'gobo'
    if (n.includes('shutter') || n.includes('strobe')) return 'shutter'
    if (n.includes('prism')) return 'prism'
    if (n.includes('speed')) return 'speed'
    if (n.includes('fog') || n.includes('haze')) return 'fog'
    if (n.includes('effect') || n.includes('macro')) return 'effect'
    if (n.includes('reset') || n.includes('control') || n.includes('lamp')) return 'maintenance'
    return 'generic'
  }
}
