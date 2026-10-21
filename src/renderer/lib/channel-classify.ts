// ============================================================
// PhotonBoard — Channel classification
// Decides, per channel of a fixture mode, what the console may do
// with it: merge rule (HTP/LTP), whether it carries intensity (and
// therefore obeys Grand Master / blackout / strobe / fader scaling),
// its neutral default, its "blinder" value and its 16-bit partner.
//
// Pure: used by the mixer, the cue/chase engines and tests.
// ============================================================

import type { FixtureCapability, FixtureChannel, FixtureDefinition, FixtureMode } from '@shared/types'

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
  /**
   * Value forced by the Blinder (and the "full white" Strobe), or -1 when it
   * leaves the channel alone: the fixture at full OPEN WHITE (see
   * blinderFor()). Computed once here: no per-frame cost.
   */
  blinderValue: number
  /**
   * Hardware strobe of a shutter / strobe channel: the DMX range of its plain
   * strobe capability (slow → fast or fast → slow) and the flash rates at
   * both ends. null = no usable strobe range (the masters chop intensity).
   */
  strobe: StrobeRange | null
  /** Intensity channel of a fixture that strobes in hardware (not chopped) */
  hwStrobe: boolean
  /** For a 16-bit fine channel: index (within the mode) of its coarse channel, else -1 */
  coarseIndex: number
  /** For a coarse channel with a 16-bit partner: index of the fine channel, else -1 */
  fineIndex: number
}

/** True when the role carries light output (masters, faders and strobe apply). */
export function isIntensityRole(role: ChannelRole): boolean {
  return role === ChannelRole.Dimmer || role === ChannelRole.ColorIntensity
}

/** DMX range of a hardware strobe and the flash rate (Hz) at each end */
export interface StrobeRange {
  lo: number
  hi: number
  /** Rate at `lo` / at `hi` (Hz). Unknown rates assume 1 → 20 Hz in the label's direction. */
  hzLo: number
  hzHi: number
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

function midRange(c: FixtureCapability): number {
  return clampByte((c.dmxRange[0] + c.dmxRange[1]) / 2)
}

/** Strobe capabilities that are NOT a plain regular strobe */
const SPECIAL_STROBE = /random|pulse|ramp|lightn|lightin|sequence|duration|sound|music|audio|program|macro|single|burst|thunder|\beffect\s*\d/i
const HZ_RANGE = /(\d+(?:[.,]\d+)?)\s*(?:hz)?\s*(?:…|\.\.\.?|-|–|to|→)\s*(\d+(?:[.,]\d+)?)\s*hz/i
const FAST_TO_SLOW = /fast\s*(?:…|\.\.\.?|-|–|to|→|>)\s*slow/i

/**
 * The plain strobe range of a shutter / strobe channel, from its
 * capabilities ("Strobe slow…fast", "Strobe 1…25Hz"…). Random / pulse /
 * ramp / sound strobes are never used.
 */
export function strobeRangeOf(chDef: FixtureChannel | undefined): StrobeRange | null {
  const caps = chDef?.capabilities ?? []
  const hasOpen = caps.some((c) => /shutteropen/i.test(c.type))
  const cap = caps.find((c) => (/^shutterstrobe$/i.test(c.type) || (hasOpen && /^strobespeed$/i.test(c.type)))
    && !SPECIAL_STROBE.test(`${c.label ?? ''} ${c.comment ?? ''}`)
    && c.dmxRange[1] >= c.dmxRange[0])
  if (!cap) return null
  const lo = clampByte(cap.dmxRange[0])
  const hi = clampByte(cap.dmxRange[1])
  const text = `${cap.label ?? ''} ${cap.comment ?? ''}`
  const hz = HZ_RANGE.exec(text)
  if (hz) {
    const a = Number(hz[1].replace(',', '.'))
    const b = Number(hz[2].replace(',', '.'))
    if (a > 0 && b > 0 && a !== b) return { lo, hi, hzLo: a, hzHi: b }
  }
  return FAST_TO_SLOW.test(text) ? { lo, hi, hzLo: 20, hzHi: 1 } : { lo, hi, hzLo: 1, hzHi: 20 }
}

/** DMX value of a hardware strobe range for a flash rate (Hz), clamped to the range */
export function strobeDmxValue(r: StrobeRange, rateHz: number): number {
  const span = r.hzHi - r.hzLo
  const f = span === 0 ? 1 : Math.max(0, Math.min(1, (rateHz - r.hzLo) / span))
  return clampByte(r.lo + f * (r.hi - r.lo))
}

/** Words of a colour channel name (pixel / cell numbers removed) */
function colourWords(name: string): string {
  return name.toLowerCase().replace(/\b(pixel|cell|segment|led|seg|zone|smd|group|c)\s*\d+\b/g, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Additive emitters that make white light (UV, indigo… are left alone) */
const WHITE_EMITTER = /\b(red|green|blue|white|warm white|cool white|cold white|ww|cw|amber|lime|mint|r|g|b|w|a)\b/
const NON_WHITE_EMITTER = /\b(uv|ultra ?violet|indigo|violet|royal blue|deep blue|ir|infra ?red)\b/
const SUBTRACTIVE = /\b(cyan|magenta|yellow|c|m|y)\b/
const COLOUR_CORRECTION = /\b(cto|ctb|ctc|ct|colou?r temp(erature)?|temperature|kelvin|minus green|green ?correct|saturation|sat)\b/
/** Capability labels of an open / white / no-function position */
const OPEN_LABEL = /^\s*(open|white|no colou?r|no gobo|empty( position)?|no function|off|none|neutral|clear)\b/i

/** Value of the open / white / no-function slot of a wheel or macro channel (-1 = unknown) */
function openSlotValue(chDef: FixtureChannel | undefined): number {
  const caps = chDef?.capabilities ?? []
  const open = caps.find((c) => OPEN_LABEL.test(c.label ?? '') && !/rotat|shake|scroll|speed/i.test(c.type))
    ?? caps.find((c) => /^nofunction$/i.test(c.type) && c.dmxRange[0] === 0)
  if (open) return midRange(open)
  if (typeof chDef?.defaultValue === 'number') return clampByte(chDef.defaultValue)
  return -1
}

/** Top of the plain dimming range of an intensity channel that also strobes ("Dimmer/Strobe") */
function intensityFullValue(chDef: FixtureChannel | undefined): number {
  const caps = chDef?.capabilities ?? []
  if (!caps.some((c) => /strobe|shutter/i.test(c.type))) return 255
  const dim = caps.filter((c) => /^intensity$/i.test(c.type))
  if (dim.length === 0) return 255
  return clampByte(Math.max(...dim.map((c) => Math.max(c.dmxRange[0], c.dmxRange[1]))))
}

/**
 * Blinder value of a channel: the fixture at full OPEN WHITE.
 *   intensity       full (a "Dimmer/Strobe" channel: top of its dimming range)
 *   shutter         open
 *   R/G/B/W/A/L     full (with or without a dimmer); UV / indigo untouched
 *   C/M/Y, CTO/CTB, saturation   0
 *   colour wheel / colour macro  the open / white / no-function slot (0 when unknown)
 *   gobo wheel      the open slot (0 when unknown) — gobo rotation untouched
 * Position, focus, zoom, iris, prism, frost, effects, speed and maintenance
 * channels are never touched (a blinder never moves a head or fires a reset).
 */
function blinderFor(name: string, role: ChannelRole, chDef: FixtureChannel | undefined, isFine: boolean, coarseName: string): number {
  if (role === ChannelRole.Dimmer) return isFine ? 255 : intensityFullValue(chDef)
  if (role === ChannelRole.Shutter) return isFine ? -1 : clampByte(shutterOpenValue(name, chDef))
  const words = colourWords(coarseName)
  if (role === ChannelRole.Color || role === ChannelRole.ColorIntensity) {
    // "White Strobe", "Flash 1 Red", "Sound / Strobe"…: full would trigger an effect
    if (/\b(strobe|shutter|flash|chase|auto|sound|speed)\b/.test(words)) return -1
    if (NON_WHITE_EMITTER.test(words)) return -1
    if (COLOUR_CORRECTION.test(words)) return 0
    if (/\bhue\b/.test(words)) return -1
    // Emitter names first ("Red", "Pixel 3 Warm White"), unless it is a wheel / macro / mix channel
    const wheelish = /\b(wheel|macro|macros|preset|presets|program|mode|effect|mix|scroll)\b/.test(words)
    if (!wheelish && WHITE_EMITTER.test(words) && !/\bcolou?r\b/.test(words)) return 255
    if (!wheelish && SUBTRACTIVE.test(words)) return 0
    if (role === ChannelRole.ColorIntensity) return -1
    if (isFine) return -1
    const open = openSlotValue(chDef)
    return open >= 0 ? open : 0
  }
  if (chDef?.type === 'gobo' && !isFine && !/rotat|shake|index|speed|spin|fine/i.test(name)) {
    const open = openSlotValue(chDef)
    return open >= 0 ? open : 0
  }
  return -1
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

  const out: ClassifiedChannel[] = names.map((name, i) => {
    const chDef = def.channels[name]
    const role = roles[i]
    const isFine = coarseIndex[i] !== -1
    const htp = chDef?.precedence ? chDef.precedence === 'HTP' : role === ChannelRole.Dimmer

    let defaultValue = 0
    if (!isIntensityRole(role)) {
      if (typeof chDef?.defaultValue === 'number') defaultValue = clampByte(chDef.defaultValue)
      else if (role === ChannelRole.Position && !isFine) defaultValue = 128
    }

    const coarseName = isFine ? names[coarseIndex[i]] ?? name : name
    const blinderValue = blinderFor(name ?? '', role, chDef, isFine, coarseName ?? '')
    const strobe = role === ChannelRole.Shutter && !isFine ? strobeRangeOf(chDef) : null

    return { name, role, htp, defaultValue, blinderValue, strobe, hwStrobe: false, coarseIndex: coarseIndex[i], fineIndex: fineIndex[i] }
  })
  // A fixture that strobes in hardware: its intensity is not chopped
  if (out.some((c) => c.strobe)) for (const c of out) if (isIntensityRole(c.role)) c.hwStrobe = true
  return out
}
