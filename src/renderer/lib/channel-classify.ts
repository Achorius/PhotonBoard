// ============================================================
// PhotonBoard — Channel classification
// Decides, per channel of a fixture mode, what the console may do
// with it: merge rule (HTP/LTP), whether it carries intensity (and
// therefore obeys Grand Master / blackout / strobe / fader scaling),
// its neutral default, its "blinder" value and its 16-bit partner.
//
// Pure: used by the mixer, the cue/chase engines and tests.
// ============================================================

import type { FixtureChannel, FixtureDefinition, FixtureMode } from '@shared/types'

export const ChannelRole = {
  Other: 0,
  /** Dimmer / intensity channel (HTP) */
  Dimmer: 1,
  /** Additive colour emitter (R/G/B/W/A/UV/Lime) of a fixture WITHOUT a dimmer: acts as its intensity */
  ColorIntensity: 2,
  /** Shutter / strobe channel */
  Shutter: 3,
  /** Colour channel of a fixture that has a dimmer (never scaled by masters) */
  Color: 4,
  /** Pan / tilt */
  Position: 5
} as const
export type ChannelRole = (typeof ChannelRole)[keyof typeof ChannelRole]

export interface ClassifiedChannel {
  name: string
  role: ChannelRole
  htp: boolean
  /** Neutral output when no source drives the channel */
  defaultValue: number
  /** Value forced by the Blinder, or -1 when the blinder leaves it alone */
  blinderValue: number
  /** For a 16-bit fine channel: index (within the mode) of its coarse channel, else -1 */
  coarseIndex: number
  /** For a coarse channel with a 16-bit partner: index of the fine channel, else -1 */
  fineIndex: number
}

/** True when the role carries light output (masters, faders and strobe apply). */
export function isIntensityRole(role: ChannelRole): boolean {
  return role === ChannelRole.Dimmer || role === ChannelRole.ColorIntensity
}

const FINE_SUFFIX = /\s*(?:[-_ ]?fine|16-?bit|\(fine\)|\blsb)\s*$/i
const DIMMER_NAME = /(^|[\s_-])(dimmer|intensity|master|brightness)([\s_-]|\d|$)/i
/** Additive emitters — scaling them changes brightness, not hue. */
const ADDITIVE_COLOR_NAME = /^(red|green|blue|white|warm white|cool white|cold white|amber|uv|ultra ?violet|lime|indigo|r|g|b|w|a)(\s*\d+)?$/i
const COLOR_NAME = /(red|green|blue|white|amber|\buv\b|ultraviolet|lime|indigo|cyan|magenta|yellow|colou?r|cto|ctb|ctc|hue|saturation)/i
const POSITION_NAME = /^(pan|tilt)\b/i
const SHUTTER_NAME = /(shutter|strobe)/i

export function isFineChannelName(name: string): boolean {
  return FINE_SUFFIX.test(name) && name.replace(FINE_SUFFIX, '').trim().length > 0
}

export function coarseNameOf(name: string): string {
  return name.replace(FINE_SUFFIX, '').trim()
}

function baseRole(name: string, chDef: FixtureChannel | undefined): ChannelRole {
  const type = chDef?.type
  const n = name.trim()
  if (type === 'speed' || type === 'maintenance' || type === 'effect' || type === 'fog') return ChannelRole.Other
  if (type === 'intensity') return ChannelRole.Dimmer
  if (type === 'pan' || type === 'tilt') return ChannelRole.Position
  if (type === 'shutter' || type === 'strobe') return ChannelRole.Shutter
  if (type === 'color') return ChannelRole.Color
  if (chDef?.precedence === 'HTP') return ChannelRole.Dimmer
  // No (useful) type: infer from the name
  if (POSITION_NAME.test(n) && !/speed/i.test(n)) return ChannelRole.Position
  if (DIMMER_NAME.test(n) && !COLOR_NAME.test(n)) return ChannelRole.Dimmer
  if (SHUTTER_NAME.test(n)) return ChannelRole.Shutter
  if (COLOR_NAME.test(n)) return ChannelRole.Color
  return ChannelRole.Other
}

/** DMX value that opens the shutter (for the Blinder). */
function shutterOpenValue(name: string, chDef: FixtureChannel | undefined): number {
  const caps = chDef?.capabilities ?? []
  const open = caps.find(c => /shutteropen/i.test(c.type) || /^open$/i.test(c.label ?? ''))
  if (open) return Math.round((open.dmxRange[0] + open.dmxRange[1]) / 2)
  if (typeof chDef?.defaultValue === 'number') return chDef.defaultValue
  // A bare "strobe" channel is usually 0 = no strobe; a "shutter" 255 = open
  const isStrobe = chDef?.type === 'strobe' || (/strobe/i.test(name) && !/shutter/i.test(name))
  return isStrobe ? 0 : 255
}

function clampByte(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0
}

/**
 * Classify every channel of a fixture mode. The result is indexed like
 * `mode.channels` (offset from the fixture's start address).
 */
export function classifyModeChannels(def: FixtureDefinition, mode: FixtureMode): ClassifiedChannel[] {
  const names = mode.channels
  const lower = names.map(n => (n ?? '').toLowerCase().trim())

  // 1. coarse/fine pairing
  const coarseIndex = names.map(() => -1)
  const fineIndex = names.map(() => -1)
  names.forEach((name, i) => {
    if (!name || !isFineChannelName(name)) return
    const coarse = coarseNameOf(name).toLowerCase()
    const ci = lower.findIndex((l, j) => j !== i && l === coarse)
    if (ci !== -1 && fineIndex[ci] === -1) {
      coarseIndex[i] = ci
      fineIndex[ci] = i
    }
  })

  // 2. base roles (a fine channel inherits the role of its coarse channel)
  const roles: ChannelRole[] = names.map((name) => baseRole(name ?? '', def.channels[name]))
  names.forEach((_, i) => {
    if (coarseIndex[i] !== -1) roles[i] = roles[coarseIndex[i]]
  })

  // 3. fixtures without a dimmer: additive colour channels carry the intensity
  const hasDimmer = roles.some((r, i) => r === ChannelRole.Dimmer && coarseIndex[i] === -1)
  if (!hasDimmer) {
    names.forEach((name, i) => {
      const base = coarseIndex[i] !== -1 ? names[coarseIndex[i]] : name
      if (roles[i] === ChannelRole.Color && ADDITIVE_COLOR_NAME.test((base ?? '').trim())) {
        roles[i] = ChannelRole.ColorIntensity
      }
    })
  }

  return names.map((name, i) => {
    const chDef = def.channels[name]
    const role = roles[i]
    const isFine = coarseIndex[i] !== -1
    const htp = chDef?.precedence ? chDef.precedence === 'HTP' : role === ChannelRole.Dimmer

    let defaultValue = 0
    if (!isIntensityRole(role)) {
      if (typeof chDef?.defaultValue === 'number') defaultValue = clampByte(chDef.defaultValue)
      else if (role === ChannelRole.Position && !isFine) defaultValue = 128
    }

    let blinderValue = -1
    if (role === ChannelRole.Dimmer) blinderValue = 255
    else if (role === ChannelRole.Shutter && !isFine) blinderValue = clampByte(shutterOpenValue(name, chDef))
    else if (role === ChannelRole.ColorIntensity) {
      const base = (isFine ? names[coarseIndex[i]] : name).toLowerCase()
      if (/^(red|green|blue|white|warm white|cool white|cold white|r|g|b|w)(\s*\d+)?$/.test(base)) blinderValue = 255
    }

    return { name, role, htp, defaultValue, blinderValue, coarseIndex: coarseIndex[i], fineIndex: fineIndex[i] }
  })
}
