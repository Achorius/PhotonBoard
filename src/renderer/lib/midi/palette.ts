// ============================================================
// PhotonBoard — RGB pad palettes (velocity = colour index)
//
// The APC mini mk2, the APC40 mk2 and the Novation Launchpads light a
// pad with a note-on whose velocity is an index into a 128-colour
// palette. The table below is the one printed in the Akai "APC mini
// mk2 Communication Protocol" (it is the Ableton Live / Launchpad
// palette).  VERIFY: transcribed from memory of the published table —
// if a colour looks wrong on the hardware, fix it here, nothing else
// depends on the exact values (we always pick the NEAREST entry).
//
// nearestPaletteIndex() is cached per hex string: the feedback engine
// asks for the same few column colours over and over.
// ============================================================

/** Ableton / Akai / Novation 128-colour palette (index = velocity). VERIFY against the device. */
export const ABLETON_PALETTE: readonly string[] = [
  '#000000', '#1e1e1e', '#7f7f7f', '#ffffff', '#ff4c4c', '#ff0000', '#590000', '#190000',
  '#ffbd6c', '#ff5400', '#591d00', '#271b00', '#ffff4c', '#ffff00', '#595900', '#191900',
  '#88ff4c', '#54ff00', '#1d5900', '#142b00', '#4cff4c', '#00ff00', '#005900', '#001900',
  '#4cff5e', '#00ff19', '#00590d', '#001902', '#4cff88', '#00ff55', '#00591d', '#001f12',
  '#4cffb7', '#00ff99', '#005935', '#001912', '#4cc3ff', '#00a9ff', '#004152', '#001019',
  '#4c88ff', '#0055ff', '#001d59', '#000819', '#4c4cff', '#0000ff', '#000059', '#000019',
  '#874cff', '#5400ff', '#190064', '#0f0030', '#ff4cff', '#ff00ff', '#590059', '#190019',
  '#ff4c87', '#ff0054', '#59001d', '#220013', '#ff1500', '#993500', '#795100', '#436400',
  '#033900', '#005735', '#00547f', '#0000ff', '#00454f', '#2500cc', '#7f7f7f', '#202020',
  '#ff0000', '#bdff2d', '#afed06', '#64ff09', '#108b00', '#00ff87', '#00a9ff', '#002aff',
  '#3f00ff', '#7a00ff', '#b21a7d', '#402100', '#ff4a00', '#88e106', '#72ff15', '#00ff00',
  '#3bff26', '#59ff71', '#38ffcc', '#5b8aff', '#3151c6', '#877fe9', '#d31dff', '#ff005d',
  '#ff7f00', '#b9b000', '#90ff00', '#835d07', '#392b00', '#144c10', '#0d5038', '#15152a',
  '#16205a', '#693c1c', '#a8000a', '#de513d', '#d86a1c', '#ffe126', '#9ee12f', '#67b50f',
  '#1e1e30', '#dcff6b', '#80ffbd', '#9a99ff', '#8e66ff', '#404040', '#757575', '#e0ffff',
  '#a00000', '#350000', '#1ad000', '#074200', '#b9b000', '#3f3100', '#b35f00', '#4b1502'
]

/** #rgb / #rrggbb → [r, g, b] 0-255 (black when unreadable) */
export function parseHex(hex: string): [number, number, number] {
  let h = (hex || '').trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Colour scaled towards black (factor 0-1) */
export function scaleColor(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r * factor, g * factor, b * factor)
}

export interface Palette {
  readonly colors: readonly string[]
  nearest(hex: string): number
}

/**
 * Nearest-colour lookup for a palette (weighted RGB distance, perceptually
 * good enough for LEDs). Index 0 (black) is only chosen for black: an unlit
 * pad would read as "empty". Results are cached per hex.
 */
export function createPalette(colors: readonly string[]): Palette {
  const rgb = colors.map(parseHex)
  const cache = new Map<string, number>()
  return {
    colors,
    nearest(hex: string): number {
      const key = (hex || '').toLowerCase()
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      const [r, g, b] = parseHex(key)
      let best = 0
      let bestD = Infinity
      const isBlack = r === 0 && g === 0 && b === 0
      for (let i = 0; i < rgb.length; i++) {
        if (i === 0 && !isBlack) continue
        const [pr, pg, pb] = rgb[i]
        const dr = r - pr
        const dg = g - pg
        const db = b - pb
        // "redmean" approximation of perceived distance
        const rm = (r + pr) / 2
        const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
        if (d < bestD) { bestD = d; best = i }
      }
      if (cache.size > 512) cache.clear()
      cache.set(key, best)
      return best
    }
  }
}

export const abletonPalette = createPalette(ABLETON_PALETTE)
