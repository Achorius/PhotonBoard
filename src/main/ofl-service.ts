import type { FixtureDefinition, OFLSearchResult } from '../shared/types'

interface OFLManufacturer {
  name: string
  website?: string
}

interface OFLFixtureListItem {
  name: string
  categories: string[]
}

export class OFLService {
  private fixtureIndex: { manufacturer: string; manufacturerKey: string; fixtureKey: string; name: string; categories: string[] }[] | null = null
  private indexLoadPromise: Promise<void> | null = null

  // Fetch and cache the full fixture index from OFL
  // Step 1: get manufacturer keys, Step 2: fetch each manufacturer's fixture list in parallel
  private async ensureIndex(): Promise<void> {
    if (this.fixtureIndex) return
    if (this.indexLoadPromise) { await this.indexLoadPromise; return }

    this.indexLoadPromise = (async () => {
      try {
        // Step 1: Get all manufacturer keys
        const mfrRes = await fetch('https://open-fixture-library.org/api/v1/manufacturers', { signal: AbortSignal.timeout(15000) })
        if (!mfrRes.ok) throw new Error(`OFL API error: ${mfrRes.status}`)
        const mfrData = await mfrRes.json() as Record<string, { name: string; fixtureCount?: number }>

        const mfrKeys = Object.keys(mfrData).filter(k => !k.startsWith('$'))
        console.log(`[OFL] Found ${mfrKeys.length} manufacturers, loading fixture lists...`)

        // Step 2: Fetch each manufacturer's fixture list in parallel (batches of 20)
        this.fixtureIndex = []
        const BATCH_SIZE = 20
        for (let i = 0; i < mfrKeys.length; i += BATCH_SIZE) {
          const batch = mfrKeys.slice(i, i + BATCH_SIZE)
          const results = await Promise.allSettled(
            batch.map(async (mfrKey) => {
              const res = await fetch(`https://open-fixture-library.org/api/v1/manufacturers/${mfrKey}`, { signal: AbortSignal.timeout(10000) })
              if (!res.ok) return null
              return { mfrKey, data: await res.json() }
            })
          )
          for (const result of results) {
            if (result.status !== 'fulfilled' || !result.value) continue
            const { mfrKey, data } = result.value
            const mfrName = data.name || mfrData[mfrKey]?.name || mfrKey
            const fixtures = data.fixtures || []
            for (const fix of fixtures) {
              this.fixtureIndex.push({
                manufacturer: mfrName,
                manufacturerKey: mfrKey,
                fixtureKey: fix.key || fix,
                name: fix.name || (typeof fix === 'string' ? fix : fix.key || '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                categories: fix.categories || []
              })
            }
          }
        }
        console.log(`[OFL] Index loaded: ${this.fixtureIndex.length} fixtures from ${mfrKeys.length} manufacturers`)
      } catch (e) {
        console.error('[OFL] Failed to load index:', (e as Error).message)
        this.fixtureIndex = []
      }
    })()
    await this.indexLoadPromise
  }

  async search(query: string, maxResults = 50): Promise<OFLSearchResult[]> {
    await this.ensureIndex()
    if (!this.fixtureIndex || this.fixtureIndex.length === 0) return []

    const q = query.toLowerCase().trim()
    if (!q) return []

    const terms = q.split(/\s+/)

    type IndexItem = { manufacturer: string; manufacturerKey: string; fixtureKey: string; name: string; categories: string[] }
    const scored: { item: IndexItem; score: number }[] = []

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
    const url = `https://open-fixture-library.org/${manufacturerKey}/${fixtureKey}.json`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
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
