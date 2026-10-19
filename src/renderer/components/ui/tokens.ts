// ============================================================
// Token values for code that cannot use CSS classes: canvas
// drawing, Three.js materials, inline SVG, computed styles.
// Keep in sync with the `--pb-*` variables in styles/globals.css.
// In JSX prefer Tailwind classes (`bg-accent`, `text-fg-secondary`).
// ============================================================

export const palette = {
  surface0: '#0d0e10',
  surface1: '#141619',
  surface2: '#1a1d21',
  surface3: '#22262b',
  surface4: '#2b3036',
  surface5: '#353b42',
  overlay: '#1c1f24',
  lineSubtle: '#1f2328',
  line: '#2a2f35',
  lineStrong: '#3d434a',
  fgPrimary: '#eceef1',
  fgSecondary: '#aab1ba',
  fgTertiary: '#858c96',
  fgDisabled: '#5a6069',
  accent: '#ff7a1a',
  accentFg: '#ff9548',
  go: '#22b866',
  goFg: '#4ed88a',
  danger: '#d92d33',
  dangerFg: '#ff6b6b',
  warning: '#f5a623',
  warningFg: '#ffc04d',
  info: '#2b6ee0',
  infoFg: '#62adff',
  midi: '#7c4ded',
  midiFg: '#b494ff'
} as const

/** Semantic tones shared by Badge, StatusDot, Button `tone`, ProgressBar… */
export type Tone = 'neutral' | 'accent' | 'go' | 'danger' | 'warning' | 'info' | 'midi'

/** Column / group colours offered by colour pickers (executor columns, groups, clips) */
export const SWATCH_COLORS = [
  '#ff7a1a', '#ef4444', '#f59e0b', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#a855f7', '#ec4899', '#94a3b8'
] as const

/**
 * Mix a hex colour with the app background — for tinted fills derived from a
 * user colour (executor columns, group chips) without washing out text.
 * amount 0 → background, 1 → the colour itself.
 */
export function tint(hex: string, amount: number, base: string = palette.surface1): string {
  const a = parseHex(hex)
  const b = parseHex(base)
  if (!a || !b) return hex
  const t = Math.max(0, Math.min(1, amount))
  const mix = (i: number) => Math.round(b[i] + (a[i] - b[i]) * t)
  return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`
}

/** "#rrggbb" + alpha 0…1 → "rgb(r g b / a)" */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex)
  if (!c) return hex
  return `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.max(0, Math.min(1, alpha))})`
}

/** True when black text reads better than white on this colour */
export function prefersDarkText(hex: string): boolean {
  const c = parseHex(hex)
  if (!c) return false
  const lum = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lum(c[0]) + 0.7152 * lum(c[1]) + 0.0722 * lum(c[2])
  return L > 0.22
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
