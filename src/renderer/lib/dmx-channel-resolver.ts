import type { PatchEntry, FixtureDefinition } from '@shared/types'

export interface ResolvedChannels {
  dimmer: number   // 0-255
  red: number
  green: number
  blue: number
  white: number
  amber: number
  uv: number
  cyan: number
  magenta: number
  yellow: number
  pan: number      // 0-255 coarse
  panFine: number
  tilt: number     // 0-255 coarse
  tiltFine: number
  shutter: number
  zoom: number
  focus: number
  gobo: number
  strobe: number
}

const EMPTY: ResolvedChannels = {
  dimmer: 0, red: 0, green: 0, blue: 0, white: 0,
  amber: 0, uv: 0, cyan: 0, magenta: 0, yellow: 0,
  pan: 128, panFine: 0, tilt: 128, tiltFine: 0,
  shutter: 255, zoom: 128, focus: 128, gobo: 0, strobe: 0
}

// Name aliases for channel lookup (lowercase)
const CHANNEL_ALIASES: Record<keyof ResolvedChannels, string[]> = {
  dimmer:    ['dimmer', 'intensity', 'master dimmer', 'master', 'brightness'],
  red:       ['red', 'r'],
  green:     ['green', 'g'],
  blue:      ['blue', 'b'],
  white:     ['white', 'w', 'warm white', 'cool white'],
  amber:     ['amber', 'a'],
  uv:        ['uv', 'ultraviolet', 'ultra violet'],
  cyan:      ['cyan', 'c'],
  magenta:   ['magenta', 'm'],
  yellow:    ['yellow', 'y'],
  pan:       ['pan'],
  panFine:   ['pan fine', 'pan 16-bit', 'pan (fine)', 'pan fine control'],
  tilt:      ['tilt'],
  tiltFine:  ['tilt fine', 'tilt 16-bit', 'tilt (fine)', 'tilt fine control'],
  shutter:   ['shutter', 'shutter/strobe', 'strobe/shutter'],
  zoom:      ['zoom'],
  focus:     ['focus'],
  gobo:      ['gobo', 'gobo wheel', 'gobo 1', 'gobo selection'],
  strobe:    ['strobe']
}

/**
 * Resolve the meaningful channel values for a fixture from the raw DMX buffer.
 * Uses name-based matching against the fixture's channel definitions.
 */
export function resolveChannels(
  entry: PatchEntry,
  def: FixtureDefinition | undefined,
  dmxValues: number[][]
): ResolvedChannels {
  if (!def) return { ...EMPTY }

  const mode = def.modes.find((m) => m.name === entry.modeName)
  if (!mode) return { ...EMPTY }

  const result: ResolvedChannels = { ...EMPTY }
  const universeBuffer = dmxValues[entry.universe]
  if (!universeBuffer) return result

  // Build name→dmxValue map for this fixture's channels
  const channelValueMap: Record<string, number> = {}
  for (let i = 0; i < mode.channels.length; i++) {
    const chName = mode.channels[i]
    if (!chName) continue
    const absChannel = entry.address - 1 + i // 0-indexed
    if (absChannel >= 0 && absChannel < 512) {
      channelValueMap[chName.toLowerCase()] = universeBuffer[absChannel] ?? 0
    }
  }

  // Match aliases
  for (const [key, aliases] of Object.entries(CHANNEL_ALIASES) as [keyof ResolvedChannels, string[]][]) {
    for (const alias of aliases) {
      if (alias in channelValueMap) {
        result[key] = channelValueMap[alias]
        break
      }
    }
  }

  return result
}

/**
 * Compute the effective RGB color a fixture is currently outputting (0-1 range for Three.js).
 */
export function getEffectiveColor(ch: ResolvedChannels): { r: number; g: number; b: number } {
  const dim = ch.dimmer / 255
  // Mix RGB + White contribution
  const r = Math.min(1, (ch.red / 255 + ch.white / 510 + ch.amber / 510)) * dim
  const g = Math.min(1, (ch.green / 255 + ch.white / 510)) * dim
  const b = Math.min(1, (ch.blue / 255 + ch.uv / 510)) * dim
  // If no RGB channels, treat dimmer as white
  const hasColor = ch.red > 0 || ch.green > 0 || ch.blue > 0 ||
                   ch.white > 0 || ch.amber > 0 || ch.uv > 0
  if (!hasColor && ch.dimmer > 0) {
    return { r: dim, g: dim, b: dim }
  }
  return { r, g, b }
}

/**
 * Convert pan/tilt DMX values (0-255 coarse + fine) to degrees.
 * Typical moving head: Pan 540°, Tilt 270°
 */
export function dmxToPanDeg(coarse: number, fine: number, range = 540): number {
  const raw = (coarse + fine / 255) / 255
  return raw * range - range / 2
}

export function dmxToTiltDeg(coarse: number, fine: number, range = 270): number {
  const raw = (coarse + fine / 255) / 255
  return raw * range - range / 2
}
