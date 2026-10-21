// ============================================================
// PhotonBoard — CIE 1931 xyY ↔ sRGB hex (GDTF wheel slots,
// attribute colours, MVR fixture colours). Pure.
// Chromaticity only: the luminance Y is normalised so the
// brightest sRGB component is full (a slot / emitter colour).
// ============================================================

const D65 = { x: 0.3127, y: 0.329 }

function gammaEncode(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(1, v))
}

function gammaDecode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Parse "x,y,Y" (GDTF ColorCIE / MVR CIE Color); null when malformed */
export function parseCie(text: string | undefined | null): { x: number; y: number; Y: number } | null {
  if (!text) return null
  const parts = String(text).replace(/[{}\s]/g, '').split(',').map(Number)
  if (parts.length < 2 || parts.slice(0, 2).some((n) => !Number.isFinite(n))) return null
  const [x, y] = parts
  const Y = Number.isFinite(parts[2]) ? parts[2] : 100
  if (x < 0 || y <= 0 || x > 1 || y > 1 || x + y > 1.0001) return null
  return { x, y, Y }
}

/** CIE xy chromaticity → "#rrggbb" (full brightness) */
export function cieToHex(x: number, y: number): string {
  if (!(y > 0)) return '#ffffff'
  const X = x / y
  const Z = (1 - x - y) / y
  let r = 3.2404542 * X - 1.5371385 * 1 - 0.4985314 * Z
  let g = -0.969266 * X + 1.8760108 * 1 + 0.041556 * Z
  let b = 0.0556434 * X - 0.2040259 * 1 + 1.0572252 * Z
  // Out-of-gamut: desaturate towards white, then normalise to the brightest component
  const min = Math.min(r, g, b)
  if (min < 0) { r -= min; g -= min; b -= min }
  const max = Math.max(r, g, b)
  if (max <= 0) return '#000000'
  r /= max; g /= max; b /= max
  const to = (c: number) => Math.round(gammaEncode(c) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** "x,y,Y" text → hex, or undefined when malformed */
export function cieTextToHex(text: string | undefined | null): string | undefined {
  const c = parseCie(text)
  return c ? cieToHex(c.x, c.y) : undefined
}

/** "#rrggbb" → CIE xyY (Y in 0-100, relative luminance) */
export function hexToCie(hex: string | undefined | null): { x: number; y: number; Y: number } | null {
  if (!hex) return null
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = gammaDecode(((n >> 16) & 255) / 255)
  const g = gammaDecode(((n >> 8) & 255) / 255)
  const b = gammaDecode((n & 255) / 255)
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const sum = X + Y + Z
  if (sum <= 0) return { x: D65.x, y: D65.y, Y: 0 }
  return { x: X / sum, y: Y / sum, Y: Y * 100 }
}

/** "#rrggbb" → "x,y,Y" with 6 decimals (GDTF / MVR text); white when malformed */
export function hexToCieText(hex: string | undefined | null): string {
  const c = hexToCie(hex) ?? { x: D65.x, y: D65.y, Y: 100 }
  return `${c.x.toFixed(6)},${c.y.toFixed(6)},${c.Y.toFixed(6)}`
}
