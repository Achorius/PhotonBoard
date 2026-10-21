// ============================================================
// PhotonBoard — grandMA attribute names → PhotonBoard channels (pure)
//
// grandMA2 attributes are upper case (DIM, PAN, COLORRGB1, GOBO1_POS,
// PRISMA1…), grandMA3 ones PascalCase with underscores (Dimmer,
// ColorAdd_R, ColorRGB_R, Gobo1_Pos, Shutter1Strobe…). Both are
// normalised (upper case, no "_" / spaces) and mapped to the canonical
// attribute keys of shared/attribute-families.ts, which is what the
// channel names of PhotonBoard fixture definitions resolve to.
// ============================================================

import { canonicalAttributeKey } from '../../../shared/attribute-families'
import type { FixtureChannel, FixtureDefinition, FixtureMode } from '../../../shared/types'

export interface MaAttributeInfo {
  /** Canonical attribute key (attribute-families) */
  key: string
  /** Channel name used when PhotonBoard has to build the fixture type */
  name: string
  type: FixtureChannel['type']
  /** Physical unit of grandMA readouts for this attribute */
  physical?: 'degrees'
  /** Sort order of generated channels (lower first) */
  order: number
}

const A = (key: string, name: string, type: FixtureChannel['type'], order: number, physical?: 'degrees'): MaAttributeInfo =>
  ({ key, name, type, order, physical })

/** Normalised grandMA attribute name → info */
const TABLE: Record<string, MaAttributeInfo> = {}
function def(names: string[], info: MaAttributeInfo): void {
  for (const n of names) TABLE[norm(n)] = info
}

def(['DIM', 'DIMMER', 'INTENSITY', 'INTENS'], A('dimmer', 'Dimmer', 'intensity', 0))
def(['PAN'], A('pan', 'Pan', 'pan', 10, 'degrees'))
def(['TILT'], A('tilt', 'Tilt', 'tilt', 11, 'degrees'))
def(['COLORRGB1', 'COLORRGB_R', 'COLORADD_R', 'RED'], A('red', 'Red', 'color', 20))
def(['COLORRGB2', 'COLORRGB_G', 'COLORADD_G', 'GREEN'], A('green', 'Green', 'color', 21))
def(['COLORRGB3', 'COLORRGB_B', 'COLORADD_B', 'BLUE'], A('blue', 'Blue', 'color', 22))
def(['COLORRGB5', 'COLORRGB_W', 'COLORADD_W', 'WHITE'], A('white', 'White', 'color', 23))
// grandMA2 COLORRGB4 is the 4th additive emitter (amber on RGBA fixture types) — best guess, see docs
def(['COLORRGB4', 'COLORADD_RY', 'COLORADD_A', 'AMBER'], A('amber', 'Amber', 'color', 24))
def(['COLORADD_GY', 'LIME'], A('lime', 'Lime', 'color', 25))
def(['COLORADD_UV', 'UV', 'COLORUV'], A('uv', 'UV', 'color', 26))
def(['COLORADD_WW', 'WARMWHITE'], A('warm white', 'Warm White', 'color', 27))
def(['COLORADD_CW', 'COOLWHITE', 'COLDWHITE'], A('cool white', 'Cool White', 'color', 28))
def(['COLORADD_C', 'COLORSUB_C', 'CYAN'], A('cyan', 'Cyan', 'color', 29))
def(['COLORADD_M', 'COLORSUB_M', 'MAGENTA'], A('magenta', 'Magenta', 'color', 30))
def(['COLORADD_Y', 'COLORSUB_Y', 'YELLOW'], A('yellow', 'Yellow', 'color', 31))
def(['CTO', 'COLORTEMPERATURE', 'CTC', 'CTB'], A('color temperature', 'CTO', 'color', 32))
def(['COLOR1', 'COLOR', 'COLORWHEEL'], A('color wheel', 'Color Wheel', 'color', 33))
def(['COLOR2'], A('color wheel 2', 'Color Wheel 2', 'color', 34))
def(['COLORMACRO1', 'COLORMACROS', 'COLORMACRO', 'COLORMIXER'], A('color macro', 'Color Macro', 'color', 35))
def(['HSB_HUE', 'HUE'], A('hue', 'Hue', 'color', 36))
def(['HSB_SATURATION', 'SATURATION'], A('saturation', 'Saturation', 'color', 37))
def(['SHUTTER', 'SHUTTER1'], A('shutter', 'Shutter', 'shutter', 40))
def(['STROBE', 'SHUTTER1STROBE', 'SHUTTER1STROBEPULSE', 'SHUTTER1STROBERANDOM'], A('strobe', 'Strobe', 'strobe', 41))
def(['GOBO1', 'GOBO'], A('gobo', 'Gobo', 'gobo', 50))
def(['GOBO1_POS', 'GOBO1POS', 'GOBO1POSROTATE', 'GOBO1WHEELSPIN', 'GOBOROT', 'GOBOROTATION'], A('gobo rotation', 'Gobo Rotation', 'gobo', 51))
def(['GOBO2'], A('gobo 2', 'Gobo 2', 'gobo', 52))
def(['GOBO2_POS', 'GOBO2POS', 'GOBO2POSROTATE'], A('gobo 2 rotation', 'Gobo 2 Rotation', 'gobo', 53))
def(['ANIMATIONWHEEL', 'ANIMATIONWHEEL1', 'ANIMATION'], A('animation', 'Animation', 'effect', 54))
def(['PRISMA1', 'PRISM1', 'PRISM', 'PRISMA'], A('prism', 'Prism', 'prism', 55))
def(['PRISMA1_POS', 'PRISM1_POS', 'PRISM1POS', 'PRISM1POSROTATE', 'PRISMROT'], A('prism rotation', 'Prism Rotation', 'prism', 56))
def(['ZOOM'], A('zoom', 'Zoom', 'generic', 60))
def(['FOCUS', 'FOCUS1'], A('focus', 'Focus', 'generic', 61))
def(['IRIS'], A('iris', 'Iris', 'generic', 62))
def(['FROST', 'FROST1'], A('frost', 'Frost', 'generic', 63))
def(['EFFECTWHEEL', 'EFFECTS1', 'EFFECT'], A('effect', 'Effect Wheel', 'effect', 64))
def(['PTSPEED', 'P/TSPEED', 'POSITIONMSPEED', 'PANTILTSPEED'], A('speed', 'Pan/Tilt Speed', 'speed', 70))
def(['FIXTUREGLOBALRESET', 'RESET', 'CONTROL1'], A('reset', 'Reset', 'maintenance', 80))
def(['LAMPCONTROL'], A('lamp control', 'Lamp Control', 'maintenance', 81))

export function norm(name: string): string {
  return name.trim().toUpperCase().replace(/[\s_]+/g, '')
}

/** Info for a grandMA attribute; unknown attributes keep their own name */
export function maAttributeInfo(name: string): MaAttributeInfo {
  const known = TABLE[norm(name)]
  if (known) return known
  const pretty = prettify(name)
  return { key: canonicalAttributeKey(pretty), name: pretty, type: guessType(pretty), order: 100 }
}

/** True when the attribute is in the known table */
export function isKnownMaAttribute(name: string): boolean {
  return !!TABLE[norm(name)]
}

function prettify(name: string): string {
  const s = name.trim().replace(/_/g, ' ')
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) return s.charAt(0) + s.slice(1).toLowerCase()
  return s.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function guessType(name: string): FixtureChannel['type'] {
  const n = name.toLowerCase()
  if (/speed/.test(n)) return 'speed'
  if (/fog|haze|smoke/.test(n)) return 'fog'
  if (/reset|lamp|control|mode/.test(n)) return 'maintenance'
  return 'generic'
}

// ---------------------------------------------------------------- channel matching

const FINE = /(\bfine\b|\blsb\b|16 ?bit)/i

/** Channels of a mode that are not fine (LSB) channels */
function coarseChannels(defn: FixtureDefinition, mode: FixtureMode): string[] {
  return mode.channels.filter(n => {
    const ch = defn.channels[n]
    return !(ch?.fineOf) && !FINE.test(n)
  })
}

/**
 * Name of the channel of `mode` that carries a grandMA attribute, or null.
 * `instance` (1-based) picks the n-th matching channel of multi-instance
 * fixture types ("Red 1", "Red 2"…; grandMA sub-fixtures).
 */
export function findChannelForAttribute(defn: FixtureDefinition, mode: FixtureMode, maAttribute: string, instance = 1): string | null {
  const info = maAttributeInfo(maAttribute)
  const names = coarseChannels(defn, mode)
  const raw = maAttribute.trim().toLowerCase()
  const matches: string[] = []
  for (const n of names) {
    const key = canonicalAttributeKey(n)
    const bare = key.replace(/\s+\d+$/, '')
    if (key === info.key || n.toLowerCase() === raw || n.toLowerCase() === info.name.toLowerCase() ||
        (bare === info.key && /\s\d+$/.test(key))) matches.push(n)
  }
  if (matches.length === 0) {
    // By channel type for the unambiguous attributes
    const ch = (n: string) => defn.channels[n]
    let byType: string[] = []
    if (info.key === 'dimmer') byType = names.filter(n => ch(n)?.type === 'intensity' && !/(red|green|blue|white|amber|uv|cyan|magenta|yellow|lime)/i.test(n))
    else if (info.key === 'pan') byType = names.filter(n => ch(n)?.type === 'pan' && !/speed/i.test(n))
    else if (info.key === 'tilt') byType = names.filter(n => ch(n)?.type === 'tilt' && !/speed/i.test(n))
    else if (info.key === 'color wheel') byType = names.filter(n => /colou?r/i.test(n) && /wheel/i.test(n))
    else if (info.key === 'gobo') byType = names.filter(n => /gobo/i.test(n) && !/rot|index|spin|shake/i.test(n))
    else if (info.key === 'shutter' || info.key === 'strobe') byType = names.filter(n => ch(n)?.type === 'shutter' || ch(n)?.type === 'strobe')
    matches.push(...byType)
  }
  if (matches.length === 0) return null
  if (instance > 1 && matches.length >= instance) return matches[instance - 1]
  return matches[0]
}

/** Fine (LSB) channel of a coarse channel in this mode, if any */
export function findFineChannel(defn: FixtureDefinition, mode: FixtureMode, coarse: string): string | null {
  for (const n of mode.channels) {
    if (n === coarse) continue
    const ch = defn.channels[n]
    if (ch?.fineOf === coarse) return n
  }
  const coarseCh = defn.channels[coarse]
  for (const alias of coarseCh?.fineChannelAliases ?? []) if (mode.channels.includes(alias)) return alias
  const lower = coarse.toLowerCase()
  for (const n of mode.channels) {
    const l = n.toLowerCase()
    if (l === `${lower} fine` || l === `${lower}fine` || l === `${lower} lsb`) return n
  }
  return null
}
