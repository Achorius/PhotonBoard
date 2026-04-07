import type { FixtureDefinition, FixtureChannel } from '@shared/types'
import { detectPixelLayout } from '@shared/types'

/**
 * Parse an Open Fixture Library JSON file into our FixtureDefinition format
 */
export function parseOFLFixture(json: any, manufacturer: string): FixtureDefinition | null {
  try {
    const id = `${manufacturer.toLowerCase().replace(/\s+/g, '-')}/${(json.name || 'unknown').toLowerCase().replace(/\s+/g, '-')}`

    const channels: Record<string, FixtureChannel> = {}

    if (json.availableChannels) {
      for (const [name, chData] of Object.entries(json.availableChannels) as [string, any][]) {
        channels[name] = {
          name,
          type: inferChannelType(name, chData),
          defaultValue: chData.defaultValue ?? 0,
          highlightValue: chData.highlightValue,
          fineChannelAliases: chData.fineChannelAliases,
          precedence: chData.precedence || (inferChannelType(name, chData) === 'intensity' ? 'HTP' : 'LTP'),
          capabilities: (chData.capabilities || []).map((cap: any) => ({
            dmxRange: cap.dmxRange || [0, 255],
            type: cap.type || 'Generic',
            label: cap.comment || cap.type || name,
            color: cap.color?.startsWith('#') ? cap.color : undefined
          }))
        }
      }
    }

    const modes = (json.modes || []).map((mode: any) => {
      const modeChannels = mode.channels?.filter((ch: any) => typeof ch === 'string') || []
      const pixelLayout = detectPixelLayout(modeChannels)
      return {
        name: mode.name || mode.shortName || 'Default',
        shortName: mode.shortName,
        channels: modeChannels,
        channelCount: modeChannels.length,
        ...(pixelLayout ? { pixelLayout } : {})
      }
    })

    return {
      id,
      name: json.name || 'Unknown',
      manufacturer,
      categories: json.categories || ['Other'],
      channels,
      modes,
      physical: json.physical ? {
        dimensions: json.physical.dimensions,
        weight: json.physical.weight,
        power: json.physical.power,
        DMXconnector: json.physical.DMXconnector,
        bulb: json.physical.bulb,
        lens: json.physical.lens
      } : undefined
    }
  } catch {
    return null
  }
}

function inferChannelType(name: string, data: any): FixtureChannel['type'] {
  const n = name.toLowerCase()
  const capabilities = data?.capabilities || []
  const types = capabilities.map((c: any) => c.type?.toLowerCase() || '')

  if (n.includes('dimmer') || n === 'intensity' || types.includes('intensity')) return 'intensity'
  if (n.includes('red') || n.includes('green') || n.includes('blue') || n.includes('white') ||
      n.includes('amber') || n.includes('uv') || n.includes('cyan') || n.includes('magenta') ||
      n.includes('yellow') || n.includes('color') || types.some((t: string) => t.includes('color'))) return 'color'
  if (n.includes('pan')) return 'pan'
  if (n.includes('tilt')) return 'tilt'
  if (n.includes('gobo')) return 'gobo'
  if (n.includes('prism')) return 'prism'
  if (n.includes('shutter') || n.includes('strobe') || types.some((t: string) => t.includes('strobe') || t.includes('shutter'))) return 'shutter'
  if (n.includes('speed')) return 'speed'
  if (n.includes('fog') || n.includes('haze')) return 'fog'
  if (n.includes('effect')) return 'effect'
  return 'generic'
}

/**
 * Get a color representation for a channel type (for UI display)
 */
export function getChannelTypeColor(type: FixtureChannel['type'], channelName?: string): string {
  // For color channels, use the actual color of the channel (R=red, G=green, etc.)
  if (type === 'color' && channelName) {
    const n = channelName.toLowerCase()
    if (n === 'red' || n === 'r') return '#ff3333'
    if (n === 'green' || n === 'g') return '#33ff33'
    if (n === 'blue' || n === 'b') return '#3388ff'
    if (n === 'white' || n === 'w') return '#cccccc'
    if (n === 'amber') return '#ffaa00'
    if (n === 'uv') return '#9933ff'
    if (n === 'cyan') return '#00dddd'
    if (n === 'magenta') return '#ff33aa'
    if (n === 'yellow') return '#ffff33'
    return '#ff3388' // color wheel, color macro, etc.
  }
  switch (type) {
    case 'intensity': return '#ffaa00'
    case 'color': return '#ff3388'
    case 'pan': return '#33aaff'
    case 'tilt': return '#33aaff'
    case 'gobo': return '#aa33ff'
    case 'prism': return '#aa33ff'
    case 'shutter': return '#ffff33'
    case 'strobe': return '#ffff33'
    case 'speed': return '#33ff88'
    case 'effect': return '#ff8833'
    case 'fog': return '#888888'
    case 'maintenance': return '#666666'
    default: return '#999999'
  }
}

/**
 * Get the short label for a channel
 */
export function getChannelShortLabel(name: string): string {
  const n = name.toLowerCase()
  if (n === 'intensity' || n === 'dimmer') return 'DIM'
  if (n === 'red') return 'R'
  if (n === 'green') return 'G'
  if (n === 'blue') return 'B'
  if (n === 'white') return 'W'
  if (n === 'amber') return 'A'
  if (n === 'uv') return 'UV'
  if (n === 'cyan') return 'C'
  if (n === 'magenta') return 'M'
  if (n === 'yellow') return 'Y'
  if (n === 'pan') return 'PAN'
  if (n === 'pan fine') return 'PNf'
  if (n === 'tilt') return 'TLT'
  if (n === 'tilt fine') return 'TLf'
  if (n.includes('shutter')) return 'SHT'
  if (n.includes('strobe')) return 'STR'
  if (n.includes('gobo')) return 'GBO'
  if (n.includes('speed')) return 'SPD'
  if (n.includes('prism')) return 'PRM'
  return name.substring(0, 3).toUpperCase()
}
