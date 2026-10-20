// ============================================================
// PhotonBoard — Attribute families (shared, pure)
//
// One classification of fixture channels for everything "pro":
//   - canonicalAttributeKey('Colour') → 'color wheel' (programmer
//     attributes, universal presets),
//   - featureOfChannel(name, type) → programmer feature
//     (intensity / position / colour / beam / control) — the SAME
//     result as components/fixtures/programmer-model.ts (which will
//     import it; see attribute-families.test.ts),
//   - presetFamilyOf(name, type) → preset pool family
//     (intensity / position / gobo / color / beam / focus / control).
//
// No imports from the renderer: usable by main, the renderer, tests.
// ============================================================

import type { CueFeature, FixtureChannel, PresetType } from './types'

/** Programmer feature of an attribute (same ids as CueFeature) */
export type AttributeFeature = CueFeature

export const ATTRIBUTE_FEATURES: readonly AttributeFeature[] = ['intensity', 'position', 'colour', 'beam', 'control']

// ---------------------------------------------------------------- canonical names

/** Channel name aliases → canonical attribute key (lower case) */
export const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  intensity: 'dimmer', 'master dimmer': 'dimmer', master: 'dimmer', brightness: 'dimmer', dim: 'dimmer',
  r: 'red', g: 'green', b: 'blue', w: 'white', a: 'amber', c: 'cyan', m: 'magenta', y: 'yellow',
  ultraviolet: 'uv', 'ultra violet': 'uv', 'cold white': 'cool white',
  colour: 'color wheel', color: 'color wheel', 'colour wheel': 'color wheel', 'color wheel effect': 'color wheel',
  'colour macro': 'color macro', 'color macros': 'color macro',
  'colour temperature': 'color temperature', cct: 'color temperature',
  'shutter/strobe': 'shutter', 'strobe/shutter': 'shutter',
  'gobo wheel': 'gobo', 'gobo 1': 'gobo', 'gobo selection': 'gobo', 'gobo rot': 'gobo rotation', 'gobo spin': 'gobo rotation',
  'pan/tilt speed': 'speed', 'pt speed': 'speed', 'movement speed': 'speed'
}

/** "Colour Wheel" → "color wheel", "R" → "red", "Dimmer" → "dimmer" */
export function canonicalAttributeKey(name: string): string {
  const n = name.trim().toLowerCase().replace(/\s+/g, ' ')
  return ATTRIBUTE_ALIASES[n] ?? n
}

// ---------------------------------------------------------------- roles (channel-classify baseRole)

/**
 * Channel role as decided by lib/channel-classify.ts (subset needed here;
 * ColorIntensity counts as 'color': same feature).
 */
export type AttributeRole = 'dimmer' | 'position' | 'shutter' | 'color' | 'other'

const DIMMER_NAME = /(^|[\s_-])(dimmer|intensity|master|brightness)([\s_-]|\d|$)/i
const COLOR_NAME = /(red|green|blue|white|amber|\buv\b|ultraviolet|lime|indigo|cyan|magenta|yellow|colou?r|cto|ctb|ctc|hue|saturation)/i
const POSITION_NAME = /^(pan|tilt)\b/i
const SHUTTER_NAME = /(shutter|strobe)/i

/** Role of a channel from its definition (same rules as channel-classify baseRole). */
export function attributeRoleOf(name: string, type?: FixtureChannel['type'], precedence?: FixtureChannel['precedence']): AttributeRole {
  const n = name.trim()
  if (type === 'speed' || type === 'maintenance' || type === 'effect' || type === 'fog') return 'other'
  if (type === 'intensity') return 'dimmer'
  if (type === 'pan' || type === 'tilt') return 'position'
  if (type === 'shutter' || type === 'strobe') return 'shutter'
  if (type === 'color') return 'color'
  if (precedence === 'HTP') return 'dimmer'
  if (POSITION_NAME.test(n) && !/speed/i.test(n)) return 'position'
  if (DIMMER_NAME.test(n) && !COLOR_NAME.test(n)) return 'dimmer'
  if (SHUTTER_NAME.test(n)) return 'shutter'
  if (COLOR_NAME.test(n)) return 'color'
  return 'other'
}

// ---------------------------------------------------------------- features

const COLOUR_KEY = /(^|\s)(red|green|blue|white|amber|uv|ultra ?violet|lime|indigo|cyan|magenta|yellow|cto|ctb|ctc|hue|saturation|colou?r)(\s|$)/i
const BEAM_KEY = /(shutter|strobe|gobo|prism|zoom|focus|iris|frost|framing|blade|animation|beam|diffusion|edge)/i
const CONTROL_KEY = /speed|reset|control|lamp|power|mode|program|sound|auto/

/**
 * Feature of an attribute from its canonical key, role and channel type
 * (programmer-model.ts `featureOf`, verbatim).
 */
export function featureOfAttribute(key: string, role: AttributeRole, type?: FixtureChannel['type']): AttributeFeature {
  if (role === 'dimmer' && !COLOUR_KEY.test(key)) return 'intensity'
  if (role === 'position' || type === 'pan' || type === 'tilt') return /speed/.test(key) ? 'control' : 'position'
  if (type === 'speed' || type === 'maintenance' || type === 'fog' || CONTROL_KEY.test(key)) return 'control'
  if (role === 'color' || type === 'color' || COLOUR_KEY.test(key)) return 'colour'
  if (role === 'shutter' || type === 'gobo' || type === 'prism' || type === 'shutter' || type === 'strobe' || BEAM_KEY.test(key)) {
    return 'beam'
  }
  return 'control'
}

/** Feature of a fixture channel ("Red 2", type 'color' → 'colour'). */
export function featureOfChannel(channelName: string, channelType?: FixtureChannel['type'], precedence?: FixtureChannel['precedence']): AttributeFeature {
  return featureOfAttribute(canonicalAttributeKey(channelName), attributeRoleOf(channelName, channelType, precedence), channelType)
}

// ---------------------------------------------------------------- preset families

const GOBO_KEY = /(gobo|animation)/i
const FOCUS_KEY = /(zoom|focus)/i

/**
 * Preset pool family of a channel. Beam attributes are split like on a
 * grandMA: gobo / animation wheels → 'gobo', zoom / focus → 'focus',
 * the rest (shutter, strobe, iris, prism, frost…) → 'beam'.
 * Never returns 'full' (that family holds any attribute).
 */
export function presetFamilyOf(channelName: string, channelType?: FixtureChannel['type'], precedence?: FixtureChannel['precedence']): Exclude<PresetType, 'full'> {
  const feature = featureOfChannel(channelName, channelType, precedence)
  switch (feature) {
    case 'intensity': return 'intensity'
    case 'position': return 'position'
    case 'colour': return 'color'
    case 'control': return 'control'
    default: {
      const key = canonicalAttributeKey(channelName)
      if (channelType === 'gobo' || GOBO_KEY.test(key)) return 'gobo'
      if (FOCUS_KEY.test(key)) return 'focus'
      return 'beam'
    }
  }
}

/** Cue feature (per-feature timing, store filters) of a preset family. 'full' has none. */
export function featureOfPresetFamily(type: PresetType): CueFeature | null {
  switch (type) {
    case 'intensity': return 'intensity'
    case 'position': return 'position'
    case 'color': return 'colour'
    case 'gobo':
    case 'beam':
    case 'focus': return 'beam'
    case 'control': return 'control'
    default: return null
  }
}

/** True when a channel belongs in a preset of this family ('full' takes everything). */
export function channelFitsPresetFamily(type: PresetType, channelName: string, channelType?: FixtureChannel['type'], precedence?: FixtureChannel['precedence']): boolean {
  return type === 'full' || presetFamilyOf(channelName, channelType, precedence) === type
}
