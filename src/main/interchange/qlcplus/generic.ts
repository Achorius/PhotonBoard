// ============================================================
// PhotonBoard — QLC+ built-in generic fixtures
// QLC+ has no definition file for two fixture kinds; it builds them
// from the workspace (engine/src/fixture.cpp):
//   - Generic / Generic: an N-channel dimmer pack, channels
//     "Dimmer #1…N", each channel one head;
//   - Generic / RGBPanel: N heads of R G B (or RGBW, BGR, BRG, GBR,
//     GRB, RBG), optionally 16-bit ("RGB 16bit": coarse + fine).
// Matching PhotonBoard definitions (builtin ids when one exists),
// plus the reverse test used by the exporter. Also a generic
// fallback for fixtures whose definition cannot be found.
// Pure module.
// ============================================================

import type { FixtureChannel, FixtureDefinition, FixtureMode, PixelLayout } from '../../../shared/types'

const COLOR_HEX: Record<string, string> = { Red: '#ff0000', Green: '#00ff00', Blue: '#0000ff', White: '#ffffff' }

function intensity(name: string): FixtureChannel {
  return { name, type: 'intensity', precedence: 'HTP', highlightValue: 255, capabilities: [{ dmxRange: [0, 255], type: 'Intensity', label: 'Intensity' }] }
}

function color(name: string, base: string): FixtureChannel {
  return { name, type: 'color', precedence: 'HTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: base, color: COLOR_HEX[base] }] }
}

function cellLayout(cells: number, per: number, names: (cell: number) => string[]): PixelLayout | undefined {
  if (cells < 2) return undefined
  return {
    cellCount: cells,
    orientation: 'horizontal',
    cells: Array.from({ length: cells }, (_, i) => ({ index: i, channelOffset: i * per, channelNames: names(i) }))
  }
}

/** Generic dimmer pack (QLC+ "Generic / Generic", N channels) */
export function genericDimmerDefinition(channels: number): { def: FixtureDefinition | null; id: string; mode: string } {
  const n = Math.max(1, Math.min(512, Math.round(channels)))
  if (n === 1) return { def: null, id: 'generic/dimmer', mode: '1ch' }
  const names = Array.from({ length: n }, (_, i) => `Dimmer ${i + 1}`)
  const mode: FixtureMode = { name: `${n} Channel`, channels: names, channelCount: n }
  const layout = cellLayout(n, 1, (i) => [names[i]])
  if (layout) mode.pixelLayout = layout
  const def: FixtureDefinition = {
    id: `qlcplus-generic/dimmer-${n}ch`,
    name: `Generic Dimmer ${n}ch`,
    manufacturer: 'Generic',
    categories: ['Dimmer'],
    channels: Object.fromEntries(names.map((nm) => [nm, intensity(nm)])),
    modes: [mode],
    source: 'qlcplus'
  }
  return { def, id: def.id, mode: mode.name }
}

const COMPONENTS: Record<string, string[]> = {
  RGB: ['Red', 'Green', 'Blue'],
  BGR: ['Blue', 'Green', 'Red'],
  BRG: ['Blue', 'Red', 'Green'],
  GBR: ['Green', 'Blue', 'Red'],
  GRB: ['Green', 'Red', 'Blue'],
  RBG: ['Red', 'Blue', 'Green'],
  RGBW: ['Red', 'Green', 'Blue', 'White']
}

/** Generic RGB panel (QLC+ "Generic / RGBPanel"); `modeName` = "RGB", "RGBW 16bit"… */
export function rgbPanelDefinition(modeName: string, channels: number): { def: FixtureDefinition | null; id: string; mode: string } {
  const [compToken, bits] = modeName.trim().split(/\s+/)
  const comp = COMPONENTS[compToken] ? compToken : 'RGB'
  const is16 = bits === '16bit'
  const bases = COMPONENTS[comp]
  const per = bases.length * (is16 ? 2 : 1)
  const heads = Math.max(1, Math.floor(Math.max(per, channels) / per))
  if (!is16 && heads === 1 && comp === 'RGB') return { def: null, id: 'generic/rgb', mode: '3ch' }
  if (!is16 && heads === 1 && comp === 'RGBW') return { def: null, id: 'generic/rgbw', mode: '4ch' }
  const chans: Record<string, FixtureChannel> = {}
  const order: string[] = []
  for (let h = 1; h <= heads; h++) {
    for (const b of bases) {
      const coarse = `${b} ${h}`
      chans[coarse] = color(coarse, b)
      order.push(coarse)
      if (is16) {
        // "Red Fine 1" in QLC+; PhotonBoard pairs "<coarse> fine"
        const fine = `${b} ${h} fine`
        chans[fine] = { name: fine, type: 'color', precedence: 'HTP', fineOf: coarse }
        chans[coarse].fineChannelAliases = [fine]
        order.push(fine)
      }
    }
  }
  const mode: FixtureMode = { name: modeName.trim() || comp, channels: order, channelCount: order.length }
  const layout = cellLayout(heads, per, (i) => order.slice(i * per, (i + 1) * per))
  if (layout) mode.pixelLayout = layout
  const id = `qlcplus-generic/rgbpanel-${comp.toLowerCase()}${is16 ? '-16bit' : ''}-${heads}`
  const def: FixtureDefinition = {
    id,
    name: `Generic RGB Panel ${comp}${is16 ? ' 16bit' : ''} ×${heads}`,
    manufacturer: 'Generic',
    categories: heads > 1 ? ['Pixel Bar'] : ['Color Changer'],
    channels: chans,
    modes: [mode],
    source: 'qlcplus'
  }
  return { def, id, mode: mode.name }
}

/** Definition used when the workspace's fixture type is unknown: N generic channels, keeps the patch */
export function unknownFixtureDefinition(manufacturer: string, model: string, modeName: string, channels: number): FixtureDefinition {
  const n = Math.max(1, Math.min(512, Math.round(channels) || 1))
  const names = Array.from({ length: n }, (_, i) => `Channel ${i + 1}`)
  const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
  return {
    id: `qlcplus-unknown/${slug(manufacturer)}-${slug(model)}-${n}ch`,
    name: model || 'Unknown fixture',
    manufacturer: manufacturer || 'Unknown',
    categories: ['Other'],
    channels: Object.fromEntries(names.map((nm) => [nm, { name: nm, type: 'generic' as const, precedence: 'LTP' as const }])),
    modes: [{ name: modeName || `${n} Channel`, channels: names, channelCount: n }],
    source: 'qlcplus'
  }
}

// ---------------------------------------------------------------- export side

export type GenericExport =
  | { kind: 'dimmer'; channels: number }
  | { kind: 'rgbpanel'; mode: string; channels: number; heads: number }

const SHORT: Record<string, string> = { red: 'R', green: 'G', blue: 'B', white: 'W' }

/**
 * Can this mode be written as a QLC+ built-in generic fixture (so QLC+ opens it
 * with the exact channel layout, without a definition file)?
 */
export function asQlcGeneric(def: FixtureDefinition, mode: FixtureMode): GenericExport | null {
  if (mode.channels.length === 0) return null
  // Only PhotonBoard's own generic types: a real fixture keeps its maker / model
  // (QLC+ falls back to a dimmer pack of the same size when it does not know it)
  if (!def.id.startsWith('generic/') && !def.id.startsWith('qlcplus-generic/')) return null
  const chans = mode.channels.map((n) => ({ name: n, ch: def.channels[n] }))
  // Dimmer pack: every channel is a coarse intensity
  if (chans.every((c) => c.ch?.type === 'intensity' && !c.ch.fineOf)) {
    return { kind: 'dimmer', channels: mode.channels.length }
  }
  // RGB panel: repeated R G B (or other orders / RGBW) groups of pure colour channels
  const comps = chans.map((c) => {
    if (!c.ch || c.ch.type !== 'color' || c.ch.fineOf) return null
    const base = c.name.toLowerCase().replace(/[\s_-]*\d+$/, '').trim()
    return SHORT[base] ?? null
  })
  if (comps.some((c) => c === null)) return null
  const seq = comps.join('')
  for (const [name, bases] of Object.entries(COMPONENTS)) {
    const unit = bases.map((b) => b[0]).join('')
    if (seq.length % unit.length !== 0) continue
    if (seq === unit.repeat(seq.length / unit.length)) {
      return { kind: 'rgbpanel', mode: name, channels: seq.length, heads: seq.length / unit.length }
    }
  }
  return null
}
