/**
 * Map MIDI 7-bit (0-127) to DMX 8-bit (0-255)
 */
export function midiToDmx(midiValue: number): number {
  return Math.round((midiValue / 127) * 255)
}

/**
 * Map DMX 8-bit (0-255) to MIDI 7-bit (0-127)
 */
export function dmxToMidi(dmxValue: number): number {
  return Math.round((dmxValue / 255) * 127)
}

/**
 * Map a 0-255 value to a percentage string
 */
export function dmxToPercent(value: number): string {
  return `${Math.round((value / 255) * 100)}%`
}

/**
 * Map a percentage (0-100) to DMX (0-255)
 */
export function percentToDmx(percent: number): number {
  return Math.round((percent / 100) * 255)
}

/**
 * Convert RGB to a CSS color string
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert hex color to RGB values (0-255)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 }
}

/**
 * HSV to RGB conversion (all values 0-255 for DMX)
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = (h / 255) * 360
  s = s / 255
  v = v / 255

  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

/**
 * Calculate the display color for a fixture based on its RGB(W) values
 */
export function getFixtureDisplayColor(channels: Record<string, number>): string {
  const r = channels['Red'] ?? channels['red'] ?? 0
  const g = channels['Green'] ?? channels['green'] ?? 0
  const b = channels['Blue'] ?? channels['blue'] ?? 0
  const w = channels['White'] ?? channels['white'] ?? 0
  const dim = (channels['Dimmer'] ?? channels['Intensity'] ?? channels['dimmer'] ?? 255) / 255

  const finalR = Math.min(255, Math.round((r + w * 0.5) * dim))
  const finalG = Math.min(255, Math.round((g + w * 0.5) * dim))
  const finalB = Math.min(255, Math.round((b + w * 0.5) * dim))

  return rgbToHex(finalR, finalG, finalB)
}

/**
 * Format DMX address as "U.A" (Universe.Address)
 */
export function formatDmxAddress(universe: number, address: number): string {
  return `${universe + 1}.${address}`
}

/**
 * Check if a DMX address range is available (no conflicts)
 */
export function isAddressRangeAvailable(
  universe: number,
  startAddress: number,
  channelCount: number,
  existingPatch: { universe: number; address: number; channelCount: number; id: string }[],
  excludeId?: string
): boolean {
  if (startAddress < 1 || startAddress + channelCount - 1 > 512) return false

  for (const entry of existingPatch) {
    if (entry.id === excludeId) continue
    if (entry.universe !== universe) continue
    const entryEnd = entry.address + entry.channelCount - 1
    const newEnd = startAddress + channelCount - 1
    if (startAddress <= entryEnd && newEnd >= entry.address) {
      return false // Overlap
    }
  }
  return true
}
