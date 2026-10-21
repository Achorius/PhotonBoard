// ============================================================
// PhotonBoard — FixtureDefinition → GDTF 1.2 (DIN SPEC 15800)
//
// Writes a minimal but valid fixture type that grandMA3, Capture,
// Vectorworks, Depence… can read:
//   • AttributeDefinitions with the standard GDTF attributes (Annex B)
//     the channels map to (Dimmer, Pan, Tilt, ColorAdd_R/G/B/W/RY/UV,
//     ColorSub_C/M/Y, CTO, Color1 wheel, Gobo1, Shutter1 /
//     Shutter1Strobe, Zoom, Focus1, Iris, Prism1, Frost1, Control1…),
//     custom attributes for the rest
//   • Wheels (colour slots as CIE xyY, prism facets)
//   • A simple geometry tree (Base › Yoke › Head › Beam for moving
//     heads, Body › Beam otherwise, one Beam per pixel cell) with
//     primitive models sized from the physical dimensions
//   • DMX modes: channels with Offset (coarse + fine = 16/24 bit),
//     default / highlight, one channel function per capability range
//     (wheel ranges as channel sets with WheelSlotIndex)
// The archive holds description.xml only (no 3D models / images).
// Pure apart from node's crypto (stable UUIDs).
// ============================================================

import AdmZip from 'adm-zip'
import type { FixtureCapability, FixtureChannel, FixtureDefinition, FixtureMode, FixtureWheel } from '../../../shared/types'
import type { ImportWarning } from '../../../shared/interchange'
import { FEATURE_GROUP_PRETTY, lookupGdtfAttribute } from './attributes'
import { hexToCieText } from './color'
import { stableUuid } from './uuid'
import { el, num, serializeXml, type XEl } from './xml'

export interface GdtfExportOptions {
  /** Revision date (default: now) */
  now?: Date
  /** Producing application version, written in the revision text */
  appVersion?: string
}

export interface GdtfExportResult {
  xml: string
  bytes: Uint8Array
  /** Recommended archive name: Manufacturer@Fixture@PhotonBoard.gdtf */
  fileName: string
  /** Mode name in the GDTF for each definition mode (names are sanitised / de-duplicated) */
  modeNames: Map<string, string>
  fixtureTypeId: string
  warnings: ImportWarning[]
}

// ---------------------------------------------------------------
// Names
// ---------------------------------------------------------------

/**
 * GDTF "Name" value (Annex C characters). '.' separates node links, so it is
 * only kept for names that are never part of a link (fixture type, DMX mode).
 */
export function gdtfName(s: string, fallback = 'Unnamed', allowDot = false): string {
  const ascii = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u2026/g, allowDot ? '...' : '-').replace(/[\u2013\u2014]/g, '-').replace(/\u2192/g, '->').replace(/\u00b0/g, 'deg')
  const out = ascii.replace(allowDot ? /[^a-zA-Z0-9#%()*+\-/:;<=>@_` "',.]/g : /[^a-zA-Z0-9#%()*+\-/:;<=>@_` "',]/g, '_').replace(/\s+/g, ' ').trim()
  return out || fallback
}

function uniqueIn(name: string, taken: Set<string>): string {
  let n = name
  for (let i = 2; taken.has(n); i++) n = `${name} ${i}`
  taken.add(n)
  return n
}

/** Archive file name: portable characters, `Manufacturer@Model@PhotonBoard.gdtf` */
export function gdtfFileName(def: Pick<FixtureDefinition, 'manufacturer' | 'name'>): string {
  const part = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_\- ]+/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '') || 'Fixture'
  return `${part(def.manufacturer || 'Generic')}@${part(def.name)}@PhotonBoard.gdtf`
}

// ---------------------------------------------------------------
// Channel → attribute
// ---------------------------------------------------------------

const FINE_SUFFIX = /\s*(?:[-_ ]?fine(?:\s*\d+)?|16-?bit|\(fine\)|\blsb)\s*$/i

function words(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Index of a wheel / gobo / prism… family from the channel name ("Gobo Wheel 2" → 2) */
function familyIndex(name: string): number {
  const m = /(\d+)/.exec(name.replace(/\b(fine|16 ?bit)\b/gi, ''))
  const n = m ? parseInt(m[1], 10) : 1
  return n >= 1 && n <= 9 ? n : 1
}

const COLOR_WORDS: [RegExp, string][] = [
  [/\b(warm ?white|ww)\b/, 'ColorAdd_WW'],
  [/\b(cool ?white|cold ?white|cw)\b/, 'ColorAdd_CW'],
  [/\bamber\b/, 'ColorAdd_RY'],
  [/\blime\b/, 'ColorAdd_GY'],
  [/\b(uv|ultra ?violet)\b/, 'ColorAdd_UV'],
  [/\b(indigo|purple|violet|royal blue)\b/, 'ColorAdd_BM'],
  [/\bmint\b/, 'ColorAdd_GC'],
  [/\b(light blue|sky blue)\b/, 'ColorAdd_BC'],
  [/\bpink\b/, 'ColorAdd_RM'],
  [/\bred\b|^r$/, 'ColorAdd_R'],
  [/\bgreen\b|^g$/, 'ColorAdd_G'],
  [/\bblue\b|^b$/, 'ColorAdd_B'],
  [/\bwhite\b|^w$/, 'ColorAdd_W'],
  [/\bcyan\b|^c$/, 'ColorSub_C'],
  [/\bmagenta\b|^m$/, 'ColorSub_M'],
  [/\byellow\b|^y$/, 'ColorSub_Y'],
  [/\bcto\b/, 'CTO'],
  [/\bctb\b/, 'CTB'],
  [/\b(ctc|colou?r temp(erature)?|cct|kelvin)\b/, 'CTC'],
  [/\bhue\b/, 'HSB_Hue'],
  [/\bsaturation\b|\bsat\b/, 'HSB_Saturation'],
  [/\btint\b|minus green|green ?correct/, 'Tint']
]

/** Emitter attribute closest to a hex colour (for ColorIntensity capabilities without a name hint) */
function emitterForHex(hex: string | undefined): string | null {
  if (!hex) return null
  const h = hex.toLowerCase()
  const table: Record<string, string> = {
    '#ff0000': 'ColorAdd_R', '#00ff00': 'ColorAdd_G', '#0000ff': 'ColorAdd_B', '#ffffff': 'ColorAdd_W',
    '#ffbf00': 'ColorAdd_RY', '#bfff00': 'ColorAdd_GY', '#7f00ff': 'ColorAdd_UV', '#4b0082': 'ColorAdd_BM',
    '#00ffff': 'ColorAdd_C', '#ff00ff': 'ColorAdd_M', '#ffff00': 'ColorAdd_Y', '#ffd9a0': 'ColorAdd_WW', '#dceeff': 'ColorAdd_CW'
  }
  return table[h] ?? null
}

/**
 * Main GDTF attribute of a console channel. The channel type decides the
 * family (it is what the console itself acts on); the name and the
 * capabilities pick the attribute inside it.
 */
export function attributeForChannel(name: string, ch: FixtureChannel | undefined, modeHasShutter: boolean): string {
  const w = words(name.replace(FINE_SUFFIX, '')).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim()
  const caps = ch?.capabilities ?? []
  const capTypes = new Set(caps.map((c) => c.type))
  const has = (...t: string[]) => t.some((x) => capTypes.has(x))
  const n = familyIndex(name)

  const position = (isTilt: boolean): string => {
    if (/speed|time/.test(w)) return 'PositionMSpeed'
    if (/rotat|continuous|endless/.test(w) || (has('PanContinuous', 'TiltContinuous') && !has('Pan', 'Tilt'))) return isTilt ? 'TiltRotate' : 'PanRotate'
    return isTilt ? 'Tilt' : 'Pan'
  }
  const strobe = (): string => {
    if (/duration|length/.test(w)) return 'StrobeDuration'
    if (/speed|rate|frequency/.test(w)) return 'StrobeRate'
    return modeHasShutter ? `Shutter${n}Strobe` : `Shutter${n}`
  }
  const speed = (): string => {
    if (/pan|tilt|position|movement|p\/t/.test(w)) return 'PositionMSpeed'
    if (/strobe/.test(w)) return 'StrobeRate'
    if (/effect|program|macro|chase|auto|show/.test(w) || has('EffectSpeed')) return 'Effects1Rate'
    if (/colou?r|cmy/.test(w)) return 'ColorMixMSpeed'
    if (/gobo/.test(w)) return 'GoboWheel1MSpeed'
    if (/dimmer|intensity/.test(w)) return 'IntensityMSpeed'
    if (/zoom/.test(w)) return 'ZoomMSpeed'
    if (/focus/.test(w)) return 'FocusMSpeed'
    if (/prism/.test(w)) return 'Prism1MSpeed'
    if (/iris/.test(w)) return 'IrisMSpeed'
    if (/frost/.test(w)) return 'Frost1MSpeed'
    return 'GlobalMSpeed'
  }
  const color = (): string => {
    if (has('WheelSlot') || /colou?r ?wheel/.test(w)) return /rotat|spin|scroll/.test(w) ? `Color${n}WheelSpin` : `Color${n}`
    if (has('ColorPreset') || /macro|preset/.test(w)) return `ColorMacro${n}`
    for (const [re, a] of COLOR_WORDS) if (re.test(w)) return a
    const byHex = emitterForHex(caps.find((c) => c.type === 'ColorIntensity')?.color)
    if (byHex) return byHex
    if (has('ColorTemperature')) return 'CTC'
    return `ColorMacro${n}`
  }
  const gobo = (): string => {
    const family = /animation/.test(w) ? 'AnimationWheel' : 'Gobo'
    if (/rotat|index|spin/.test(w)) return /wheel/.test(w) ? `${family}${n}WheelSpin` : `${family}${n}Pos`
    if (!has('WheelSlot') && has('WheelSlotRotation')) return `${family}${n}Pos`
    return `${family}${n}`
  }
  const prism = (): string => (/rotat|index|spin/.test(w) || (!has('Prism') && has('PrismRotation')) ? `Prism${n}PosRotate` : `Prism${n}`)
  const maintenance = (): string => {
    if (/reset/.test(w)) return 'FixtureGlobalReset'
    if (/lamp/.test(w)) return 'LampControl'
    if (/\bfan/.test(w)) return 'FanMode'
    if (/curve/.test(w)) return 'DimmerCurve'
    if (/display/.test(w)) return 'DisplayIntensity'
    return `Control${n}`
  }
  const custom = (): string => {
    const id = name.replace(FINE_SUFFIX, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('')
    return id && !lookupGdtfAttribute(id) ? id : `Control${n}`
  }

  if (/^(no function|reserved|not used|unused|dummy|nothing)\b/.test(w) && (caps.length === 0 || caps.every((c) => c.type === 'NoFunction'))) return 'NoFeature'
  switch (ch?.type) {
    case 'intensity': return 'Dimmer'
    case 'pan': return position(false)
    case 'tilt': return position(true)
    case 'shutter': return `Shutter${n}`
    case 'strobe': return strobe()
    case 'speed': return speed()
    case 'color': return color()
    case 'gobo': return gobo()
    case 'prism': return prism()
    case 'fog': return /haze/.test(w) ? 'Haze1' : 'Fog1'
    case 'effect': return /^(pan|tilt|position|movement)/.test(w) ? 'PositionEffect' : `Effects${n}`
    case 'maintenance': return maintenance()
    default: break
  }
  // Generic / unknown type: name, then capabilities
  if (/\bzoom\b/.test(w) || has('Zoom')) return 'Zoom'
  if (/\bfocus\b/.test(w) || has('Focus')) return `Focus${n}`
  if (/\biris\b/.test(w) || has('Iris')) return 'Iris'
  if (/\bfrost\b|diffus/.test(w) || has('Frost')) return `Frost${n}`
  if (/\bblade|framing|shaper/.test(w) || has('BladeInsertion')) return has('BladeRotation') || /rotat/.test(w) ? `Blade${n}Rot` : `Blade${n}A`
  if (/^(pan|tilt)\b/.test(w)) return position(/^tilt/.test(w))
  if (/\b(dimmer|intensity|brightness)\b/.test(w) && !/speed|curve|mode/.test(w)) return 'Dimmer'
  if (has('Intensity') && caps.every((c) => c.type === 'Intensity' || c.type === 'NoFunction')) return 'Dimmer'
  if (has('ColorIntensity')) return color()
  if (has('WheelSlot')) return gobo()
  if (has('ShutterStrobe', 'ShutterOpen')) return `Shutter${n}`
  if (has('Effect')) return `Effects${n}`
  if (has('Maintenance')) return `Control${n}`
  return custom()
}


/** Attribute of one capability range of a channel whose main attribute is `base` */
function attributeForCapability(cap: FixtureCapability, base: string): string {
  const shutterN = /^Shutter(\d+)/.exec(base)?.[1] ?? '1'
  const wheel = /^(Color|Gobo|AnimationWheel)(\d+)/.exec(base)
  const label = (cap.label ?? '').toLowerCase()
  switch (cap.type) {
    case 'NoFunction': return 'NoFeature'
    case 'Intensity': return /^Dimmer/.test(base) ? base : 'Dimmer'
    case 'ShutterOpen':
    case 'ShutterClose': return `Shutter${shutterN}`
    case 'ShutterStrobe': {
      if (base === 'StrobeRate') return base
      if (/random/.test(label)) return `Shutter${shutterN}StrobeRandom`
      if (/pulse|ramp/.test(label)) return /close/.test(label) ? `Shutter${shutterN}StrobePulseClose` : /open/.test(label) ? `Shutter${shutterN}StrobePulseOpen` : `Shutter${shutterN}StrobePulse`
      if (/lightn|effect|burst|thunder|sound|music/.test(label)) return `Shutter${shutterN}StrobeEffect`
      return `Shutter${shutterN}Strobe`
    }
    case 'StrobeSpeed': return /^Shutter\d+$/.test(base) || /^Shutter\d+Strobe/.test(base) ? `Shutter${shutterN}Strobe` : 'StrobeRate'
    case 'StrobeDuration': return 'StrobeDuration'
    case 'Pan': return 'Pan'
    case 'Tilt': return 'Tilt'
    case 'PanContinuous': return 'PanRotate'
    case 'TiltContinuous': return 'TiltRotate'
    case 'PanTiltSpeed': return 'PositionMSpeed'
    case 'ColorIntensity': return /^(ColorAdd_|ColorSub_|ColorRGB_)/.test(base) ? base : emitterForHex(cap.color) ?? base
    case 'ColorPreset': return /^ColorMacro/.test(base) ? base : 'ColorMacro1'
    case 'ColorTemperature': return /^(CTO|CTB|CTC)$/.test(base) ? base : 'CTC'
    case 'WheelSlot': return wheel ? `${wheel[1]}${wheel[2]}` : base
    case 'WheelShake': return wheel && wheel[1] !== 'Color' ? `${wheel[1]}${wheel[2]}SelectShake` : base
    case 'WheelSlotRotation': {
      if (!wheel) return base
      if (/Pos/.test(base)) return /speed|rotat|spin/.test(label) && !/index/.test(label) ? `${wheel[1]}${wheel[2]}PosRotate` : `${wheel[1]}${wheel[2]}Pos`
      return wheel[1] === 'Color' ? `Color${wheel[2]}WheelSpin` : `${wheel[1]}${wheel[2]}SelectSpin`
    }
    case 'WheelRotation': return wheel ? `${wheel[1]}${wheel[2]}WheelSpin` : base
    case 'Prism': return /^Prism\d+$/.test(base) ? base : 'Prism1'
    case 'PrismRotation': return /^Prism(\d+)/.test(base) ? `Prism${/^Prism(\d+)/.exec(base)![1]}PosRotate` : 'Prism1PosRotate'
    case 'Zoom': return 'Zoom'
    case 'Focus': return /^Focus\d+$/.test(base) ? base : 'Focus1'
    case 'Iris': return 'Iris'
    case 'IrisEffect': return /close/.test(label) ? 'IrisPulseClose' : /open/.test(label) ? 'IrisPulseOpen' : 'IrisStrobe'
    case 'Frost': return /^Frost\d+$/.test(base) ? base : 'Frost1'
    case 'FrostEffect': return 'Frost1PulseOpen'
    case 'Effect': return /^Effects\d+$/.test(base) ? base : 'Effects1'
    case 'EffectSpeed': return /^Effects(\d+)$/.test(base) ? `${base}Rate` : 'Effects1Rate'
    case 'EffectDuration': return 'Effects1Fade'
    case 'BladeInsertion': return /^Blade\d+[AB]$/.test(base) ? base : 'Blade1A'
    case 'BladeRotation': return /^Blade\d+Rot$/.test(base) ? base : 'Blade1Rot'
    case 'BladeSystemRotation': return 'ShaperRot'
    case 'Fog':
    case 'FogOutput': return /^(Fog|Haze)\d+$/.test(base) ? base : 'Fog1'
    case 'Maintenance': return base
    default: return base
  }
}

// ---------------------------------------------------------------
// Builder
// ---------------------------------------------------------------

interface AttrInfo { name: string; pretty: string; feature: string; physicalUnit?: string; activationGroup?: string; mainAttribute?: string; color?: string }

function hzRange(label: string | undefined): [number, number] | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:hz)?\s*(?:…|\.\.\.?|-|–|to|→)\s*(\d+(?:[.,]\d+)?)\s*hz/i.exec(label ?? '')
  if (!m) return null
  return [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]
}

export function buildGdtfDescription(def: FixtureDefinition, opts: GdtfExportOptions = {}): Omit<GdtfExportResult, 'bytes'> {
  const warnings: ImportWarning[] = []
  const fixtureName = gdtfName(def.name, 'Fixture', true)
  const fixtureTypeId = stableUuid('photonboard-gdtf', def.id)

  const attributes = new Map<string, AttrInfo>()
  const useAttribute = (name: string): string => {
    if (attributes.has(name)) return name
    const std = lookupGdtfAttribute(name)
    if (std) {
      attributes.set(name, { name, pretty: std.pretty, feature: std.feature, physicalUnit: std.physicalUnit, activationGroup: std.activationGroup, mainAttribute: std.mainAttribute, color: std.color })
      if (std.mainAttribute) useAttribute(std.mainAttribute)
    } else {
      attributes.set(name, { name, pretty: name.slice(0, 24), feature: 'Control.Control' })
    }
    return name
  }

  const isMovingHead = Object.values(def.channels).some((c) => c.type === 'pan' || c.type === 'tilt')
  const headGeometry = isMovingHead ? 'Head' : 'Body'
  const extraBeams: XEl[] = []
  const extraBeamNames = new Set<string>()
  const ensureBeamGeometry = (geoName: string, index: number, count: number) => {
    if (extraBeamNames.has(geoName)) return
    extraBeamNames.add(geoName)
    // Pixels side by side along X
    const len = Math.max(0.1, (def.physical?.dimensions?.[0] ?? 300) / 1000)
    const x = count > 1 ? (index / (count - 1) - 0.5) * len * 0.9 : 0
    extraBeams.push(el('Beam', {
      Name: geoName,
      Model: 'Pixel',
      Position: matrix4(x, 0, -0.01),
      LampType: 'LED',
      PowerConsumption: 10,
      LuminousFlux: 100,
      BeamAngle: num(beamAngleOf(def)),
      FieldAngle: num(beamAngleOf(def)),
      BeamRadius: 0.01,
      BeamType: 'Wash',
      ColorTemperature: 6000
    }))
  }

  // ---- wheels (export the definition's, add ones referenced by capabilities only) ----
  const wheelXml: XEl[] = []
  const wheelNames = new Map<string, string>() // definition wheel name → GDTF name
  const wheelSlotCount = new Map<string, number>()
  const takenWheelNames = new Set<string>()
  const addWheel = (w: FixtureWheel) => {
    const gName = uniqueIn(gdtfName(w.name, 'Wheel'), takenWheelNames)
    wheelNames.set(w.name, gName)
    wheelSlotCount.set(w.name, w.slots.length)
    const slotNames = new Set<string>()
    wheelXml.push(el('Wheel', { Name: gName }, w.slots.map((s) => {
      const color = s.color ? hexToCieText(s.color) : '0.312700,0.329000,100.000000'
      const facets = s.type === 'Prism' && (s.facets ?? 0) > 0
        ? Array.from({ length: s.facets! }, (_, i) => {
          const a = (2 * Math.PI * i) / s.facets!
          return el('Facet', { Color: '0.312700,0.329000,100.000000', Rotation: `{${num(Math.cos(a))},${num(-Math.sin(a))},${num(0.1 * Math.cos(a))}}{${num(Math.sin(a))},${num(Math.cos(a))},${num(0.1 * Math.sin(a))}}{0,0,1}` })
        })
        : []
      return el('Slot', { Name: uniqueIn(s.name || 'Slot', slotNames), Color: color }, facets)
    })))
  }
  for (const w of def.wheels ?? []) if (w.slots.length) addWheel(w)
  // Wheels known only through capabilities (wheel + wheelSlot without a wheels entry)
  const capWheels = new Map<string, Map<number, FixtureCapability>>()
  for (const ch of Object.values(def.channels)) {
    for (const c of ch.capabilities ?? []) {
      if (c.wheel && c.wheelSlot && !wheelNames.has(c.wheel)) {
        const m = capWheels.get(c.wheel) ?? new Map<number, FixtureCapability>()
        if (!m.has(c.wheelSlot)) m.set(c.wheelSlot, c)
        capWheels.set(c.wheel, m)
      }
    }
  }
  for (const [wName, slots] of capWheels) {
    const max = Math.max(...slots.keys())
    addWheel({
      name: wName,
      slots: Array.from({ length: max }, (_, i) => {
        const c = slots.get(i + 1)
        return { type: c?.color ? 'Color' as const : 'Gobo' as const, name: c?.label ?? `Slot ${i + 1}`, color: c?.color }
      })
    })
  }

  // ---- DMX modes ----
  const modeNames = new Map<string, string>()
  const takenModeNames = new Set<string>()
  const modesXml: XEl[] = []
  const maxCells = Math.max(0, ...def.modes.map((m) => m.pixelLayout?.cellCount ?? 0))

  for (const mode of def.modes) {
    const gModeName = uniqueIn(gdtfName(mode.name, 'Mode', true), takenModeNames)
    modeNames.set(mode.name, gModeName)
    modesXml.push(buildMode(mode, gModeName))
  }

  function buildMode(mode: FixtureMode, gModeName: string): XEl {
    const names = mode.channels
    const indexOf = new Map<string, number[]>()
    names.forEach((n, i) => indexOf.set(n, [...(indexOf.get(n) ?? []), i]))
    // Fine channels → offsets of their coarse channel
    const fineOfIndex = new Map<number, number>() // fine index → coarse index
    names.forEach((n, i) => {
      const ch = def.channels[n]
      const coarseName = ch?.fineOf ?? (FINE_SUFFIX.test(n) ? n.replace(FINE_SUFFIX, '').trim() : undefined)
      if (!coarseName || coarseName === n) return
      const coarseIdx = (indexOf.get(coarseName) ?? []).filter((x) => x !== i)
      if (coarseIdx.length) fineOfIndex.set(i, coarseIdx.reduce((best, x) => (Math.abs(x - i) < Math.abs(best - i) ? x : best)))
    })
    // At most 32-bit (3 fine bytes) per channel; extra "fine" channels stay plain channels
    const finesPerCoarse = new Map<number, number>()
    for (const [f, c] of [...fineOfIndex.entries()].sort((a, b) => a[0] - b[0])) {
      const count = (finesPerCoarse.get(c) ?? 0) + 1
      finesPerCoarse.set(c, count)
      if (count > 3) fineOfIndex.delete(f)
    }
    const cellOf = new Map<number, number>()
    for (const cell of mode.pixelLayout?.cells ?? []) {
      cell.channelNames.forEach((_, k) => cellOf.set(cell.channelOffset + k, cell.index))
    }
    const modeHasShutter = names.some((n) => def.channels[n]?.type === 'shutter')
    const usedOnGeometry = new Map<string, Set<string>>()
    const channelsXml: XEl[] = []
    const seenCoarse = new Set<number>()

    names.forEach((chName, i) => {
      if (fineOfIndex.has(i)) return
      if (seenCoarse.has(i)) return
      seenCoarse.add(i)
      const ch = def.channels[chName]
      if (!ch) warnings.push({ level: 'warning', code: 'gdtf.export.unknownChannel', params: { channel: chName, mode: mode.name }, message: `Channel "${chName}" of mode "${mode.name}" has no definition; exported as a plain channel` })
      const fines = [...fineOfIndex.entries()].filter(([, c]) => c === i).map(([f]) => f).sort((a, b) => a - b)
      const offsets = [i + 1, ...fines.map((f) => f + 1)]
      const resolution = offsets.length
      let wanted = attributeForChannel(chName, ch, modeHasShutter)
      // Geometry: pan on the yoke, pixel cells on their own beams, duplicates on extra beams
      let geometry = (wanted === 'Pan' || wanted === 'PanRotate') && isMovingHead ? 'Yoke' : headGeometry
      const cell = cellOf.get(i)
      if (cell !== undefined && maxCells >= 2) {
        geometry = `Pixel ${cell + 1}`
        ensureBeamGeometry(geometry, cell, maxCells)
      } else {
        // Numbered families (Color1/Color2, Gobo1/Gobo2, Shutter1/Shutter2…) take the next free index
        const family = /^(Color|Gobo|AnimationWheel|Shutter|Prism|Frost|Focus|Effects|Control|ColorMacro|Fog|Haze)(\d+)(\w*)$/.exec(wanted)
        if (family) {
          for (let k = parseInt(family[2], 10); usedOnGeometry.get(geometry)?.has(wanted) && k < 9; k++) {
            const candidate = `${family[1]}${k + 1}${family[3]}`
            if (lookupGdtfAttribute(candidate)) wanted = candidate
          }
        }
      }
      const base = useAttribute(wanted)
      for (let k = 2; usedOnGeometry.get(geometry)?.has(base); k++) {
        geometry = `Beam ${k}`
        ensureBeamGeometry(geometry, 0, 1)
      }
      const set = usedOnGeometry.get(geometry) ?? new Set<string>()
      set.add(base)
      usedOnGeometry.set(geometry, set)

      const max = Math.pow(256, resolution) - 1
      const scale = Math.pow(256, resolution - 1)
      const dmx = (v8: number) => `${Math.min(max, v8 * scale)}/${resolution}`
      const defaultValue = ch?.defaultValue !== undefined ? Math.max(0, Math.min(255, ch.defaultValue)) : (ch?.type === 'pan' || ch?.type === 'tilt' ? 128 : 0)
      const functions = buildChannelFunctions(chName, ch, base, defaultValue, dmx)
      const initial = functions.find((f) => f.containsDefault) ?? functions[0]
      const dmxChannelName = `${geometry}_${base}`
      channelsXml.push(el('DMXChannel', {
        DMXBreak: ch?.dmxBreak && ch.dmxBreak > 1 ? ch.dmxBreak : 1,
        Offset: offsets.join(','),
        InitialFunction: `${dmxChannelName}.${base}.${initial.name}`,
        Highlight: ch?.highlightValue !== undefined ? dmx(Math.max(0, Math.min(255, ch.highlightValue))) : 'None',
        Geometry: geometry
      }, [
        el('LogicalChannel', {
          Attribute: base,
          Snap: /^(Color\d+|Gobo\d+|AnimationWheel\d+|Prism\d+|Control\d+|NoFeature)$/.test(base) ? 'Yes' : 'No',
          Master: base === 'Dimmer' ? 'Grand' : 'None',
          MibFade: 0,
          DMXChangeTimeLimit: 0
        }, functions.map((f) => f.xml))
      ]))
    })
    return el('DMXMode', { Name: gModeName, Geometry: isMovingHead ? 'Base' : 'Body', Description: mode.name !== gModeName ? mode.name : undefined }, [
      el('DMXChannels', {}, channelsXml),
      el('Relations'),
      el('FTMacros')
    ])
  }

  function buildChannelFunctions(chName: string, ch: FixtureChannel | undefined, base: string, defaultValue: number, dmx: (v8: number) => string): { name: string; xml: XEl; containsDefault: boolean }[] {
    const caps = [...(ch?.capabilities ?? [])]
      .filter((c) => Array.isArray(c.dmxRange) && Number.isFinite(c.dmxRange[0]) && Number.isFinite(c.dmxRange[1]))
      .map((c) => ({ ...c, dmxRange: [Math.max(0, Math.min(255, Math.min(c.dmxRange[0], c.dmxRange[1]))), Math.max(0, Math.min(255, Math.max(c.dmxRange[0], c.dmxRange[1])))] as [number, number] }))
      .sort((a, b) => a.dmxRange[0] - b.dmxRange[0])
    // Drop overlaps (keep the first range), fill gaps with NoFeature
    const ranges: { from: number; to: number; cap: FixtureCapability | null }[] = []
    let next = 0
    let overlaps = 0
    for (const c of caps) {
      if (c.dmxRange[0] < next) { overlaps++; continue }
      if (c.dmxRange[0] > next) ranges.push({ from: next, to: c.dmxRange[0] - 1, cap: null })
      ranges.push({ from: c.dmxRange[0], to: c.dmxRange[1], cap: c })
      next = c.dmxRange[1] + 1
    }
    if (ranges.length === 0) ranges.push({ from: 0, to: 255, cap: null })
    else if (next <= 255) ranges.push({ from: next, to: 255, cap: null })
    if (overlaps > 0) warnings.push({ level: 'info', code: 'gdtf.export.overlappingRanges', params: { channel: chName, count: overlaps }, message: `Channel "${chName}": ${overlaps} overlapping range(s) left out` })
    const noCaps = caps.length === 0

    // Group consecutive wheel-slot ranges of the same wheel into one function with channel sets
    interface Fn { from: number; to: number; attribute: string; label: string; wheel?: string; sets: { from: number; name: string; slot: number }[]; cap: FixtureCapability | null }
    const fns: Fn[] = []
    for (const r of ranges) {
      const attribute = r.cap ? useAttribute(attributeForCapability(r.cap, base)) : noCaps ? base : useAttribute('NoFeature')
      const label = r.cap?.label?.trim() || (r.cap ? r.cap.type : noCaps ? chName : 'No function')
      const wheel = r.cap?.wheel && r.cap.wheelSlot && wheelNames.has(r.cap.wheel) ? wheelNames.get(r.cap.wheel) : undefined
      const prev = fns[fns.length - 1]
      if (wheel && prev && prev.wheel === wheel && prev.attribute === attribute && prev.to + 1 === r.from) {
        prev.to = r.to
        prev.sets.push({ from: r.from, name: label, slot: r.cap!.wheelSlot! })
        continue
      }
      fns.push({ from: r.from, to: r.to, attribute, label, wheel, sets: wheel ? [{ from: r.from, name: label, slot: r.cap!.wheelSlot! }] : [], cap: r.cap })
    }

    const taken = new Set<string>()
    return fns.map((f) => {
      const groupName = f.wheel ? (f.sets.length > 1 ? f.wheel : f.label) : f.label
      const name = uniqueIn(gdtfName(groupName, f.attribute), taken)
      const containsDefault = defaultValue >= f.from && defaultValue <= f.to
      const physical = physicalRange(f.attribute, f.cap, chName)
      const attrs: Record<string, string | number | undefined> = {
        Name: name,
        Attribute: f.attribute,
        OriginalAttribute: chName,
        DMXFrom: dmx(f.from),
        Default: dmx(containsDefault ? defaultValue : f.from),
        PhysicalFrom: physical ? num(physical[0]) : undefined,
        PhysicalTo: physical ? num(physical[1]) : undefined,
        RealFade: 0,
        RealAcceleration: 0,
        Wheel: f.wheel
      }
      const sets = f.sets.map((s) => el('ChannelSet', { Name: gdtfName(s.name, 'Slot'), DMXFrom: dmx(s.from), WheelSlotIndex: s.slot }))
      return { name, xml: el('ChannelFunction', attrs, sets), containsDefault }
    })
  }

  function physicalRange(attribute: string, cap: FixtureCapability | null, chName: string): [number, number] | null {
    const p = def.physical
    if (attribute === 'Pan' && p?.panRange) return [-p.panRange / 2, p.panRange / 2]
    if (attribute === 'Tilt' && p?.tiltRange) return [-p.tiltRange / 2, p.tiltRange / 2]
    if (attribute === 'Zoom' && p?.lens?.degreesMinMax && p.lens.degreesMinMax[0] !== p.lens.degreesMinMax[1]) return [p.lens.degreesMinMax[0], p.lens.degreesMinMax[1]]
    if (/Strobe|^StrobeRate$/.test(attribute)) {
      const hz = hzRange(cap?.label) ?? hzRange(chName)
      if (hz) return hz
    }
    if (/^Dimmer/.test(attribute) || /^(ColorAdd_|ColorSub_)/.test(attribute)) return [0, 1]
    return null
  }

  // ---- geometry + models ----
  const dims = def.physical?.dimensions
  const W = Math.max(0.05, (dims?.[0] ?? (isMovingHead ? 350 : 250)) / 1000) // X
  const H = Math.max(0.05, (dims?.[1] ?? (isMovingHead ? 550 : 300)) / 1000) // up
  const D = Math.max(0.05, (dims?.[2] ?? (isMovingHead ? 300 : 250)) / 1000) // depth
  const modelsXml: XEl[] = []
  let geometryTree: XEl
  const beamAngle = beamAngleOf(def)
  const beamAttrs = {
    LampType: lampTypeOf(def),
    PowerConsumption: def.physical?.power ?? (isMovingHead ? 400 : 100),
    LuminousFlux: def.physical?.bulb?.lumens ?? 10000,
    ColorTemperature: def.physical?.bulb?.colorTemperature ?? 6000,
    BeamAngle: num(beamAngle),
    FieldAngle: num(beamAngle),
    BeamRadius: num(Math.min(W, D) * 0.4),
    BeamType: isMovingHead && beamAngle < 20 ? 'Spot' : 'Wash'
  }
  if (extraBeams.length) modelsXml.push(el('Model', { Name: 'Pixel', Length: 0.02, Width: 0.02, Height: 0.01, PrimitiveType: 'Cube' }))
  if (isMovingHead) {
    const baseH = H * 0.25
    const headH = H * 0.45
    modelsXml.unshift(
      el('Model', { Name: 'Base', Length: num(W), Width: num(D), Height: num(baseH), PrimitiveType: 'Base' }),
      el('Model', { Name: 'Yoke', Length: num(W), Width: num(D * 0.5), Height: num(H - baseH), PrimitiveType: 'Yoke' }),
      el('Model', { Name: 'Head', Length: num(W * 0.7), Width: num(D * 0.7), Height: num(headH), PrimitiveType: 'Head' })
    )
    geometryTree = el('Geometry', { Name: 'Base', Model: 'Base', Position: matrix4(0, 0, 0) }, [
      el('Axis', { Name: 'Yoke', Model: 'Yoke', Position: matrix4(0, 0, -baseH) }, [
        el('Axis', { Name: 'Head', Model: 'Head', Position: matrix4(0, 0, -(H - baseH) * 0.6) }, [
          el('Beam', { Name: 'Beam', Position: matrix4(0, 0, -headH / 2), ...beamAttrs }),
          ...extraBeams
        ])
      ])
    ])
  } else {
    modelsXml.unshift(el('Model', { Name: 'Body', Length: num(W), Width: num(D), Height: num(H), PrimitiveType: (def.modes.some((m) => (m.pixelLayout?.cellCount ?? 0) > 1) ? 'Cube' : 'Conventional') }))
    geometryTree = el('Geometry', { Name: 'Body', Model: 'Body', Position: matrix4(0, 0, 0) }, [
      el('Beam', { Name: 'Beam', Position: matrix4(0, 0, -H / 2), ...beamAttrs }),
      ...extraBeams
    ])
  }

  // ---- attribute definitions (feature groups / activation groups from the used attributes) ----
  const featureGroups = new Map<string, Set<string>>()
  const activationGroups = new Set<string>()
  for (const a of attributes.values()) {
    const [group, feature] = a.feature.split('.')
    const set = featureGroups.get(group) ?? new Set<string>()
    set.add(feature)
    featureGroups.set(group, set)
    if (a.activationGroup) activationGroups.add(a.activationGroup)
  }
  const attributeDefinitions = el('AttributeDefinitions', {}, [
    el('ActivationGroups', {}, [...activationGroups].map((g) => el('ActivationGroup', { Name: g }))),
    el('FeatureGroups', {}, [...featureGroups].map(([g, features]) => el('FeatureGroup', { Name: g, Pretty: FEATURE_GROUP_PRETTY[g] ?? g }, [...features].map((f) => el('Feature', { Name: f }))))),
    el('Attributes', {}, [...attributes.values()].map((a) => el('Attribute', {
      Name: a.name,
      Pretty: a.pretty,
      ActivationGroup: a.activationGroup,
      Feature: a.feature,
      MainAttribute: a.mainAttribute && attributes.has(a.mainAttribute) ? a.mainAttribute : undefined,
      PhysicalUnit: a.physicalUnit ?? 'None',
      Color: a.color
    })))
  ])

  const properties: XEl[] = []
  if (def.physical?.weight) properties.push(el('Weight', { Value: num(def.physical.weight) }))

  const now = opts.now ?? new Date()
  const date = now.toISOString().replace(/\.\d+Z$/, '').replace(/Z$/, '')
  const fixtureType = el('FixtureType', {
    Name: fixtureName,
    ShortName: def.shortName ?? def.name,
    LongName: def.name,
    Manufacturer: def.manufacturer || 'Generic',
    Description: `Exported from PhotonBoard (${def.id})`,
    FixtureTypeID: fixtureTypeId,
    CanHaveChildren: 'Yes'
  }, [
    attributeDefinitions,
    el('Wheels', {}, wheelXml),
    el('PhysicalDescriptions', {}, properties.length ? [el('Properties', {}, properties)] : []),
    el('Models', {}, modelsXml),
    el('Geometries', {}, [geometryTree]),
    el('DMXModes', {}, modesXml),
    el('Revisions', {}, [el('Revision', { Text: `Exported from PhotonBoard${opts.appVersion ? ` ${opts.appVersion}` : ''}`, Date: date, UserID: 0, ModifiedBy: 'PhotonBoard' })]),
    el('FTPresets'),
    el('Protocols')
  ])
  if (def.modes.length === 0) warnings.push({ level: 'warning', code: 'gdtf.export.noModes', params: { fixture: def.name }, message: `Fixture "${def.name}" has no DMX mode` })
  const xml = serializeXml(el('GDTF', { DataVersion: '1.2' }, [fixtureType]))
  return { xml, fileName: gdtfFileName(def), modeNames, fixtureTypeId, warnings }
}

/** Build the .gdtf archive for a definition */
export function writeGdtf(def: FixtureDefinition, opts: GdtfExportOptions = {}): GdtfExportResult {
  const built = buildGdtfDescription(def, opts)
  const zip = new AdmZip()
  zip.addFile('description.xml', Buffer.from(built.xml, 'utf-8'))
  const bytes = new Uint8Array(zip.toBuffer())
  return { ...built, bytes }
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

function matrix4(x: number, y: number, z: number): string {
  return `{1,0,0,${num(x)}}{0,1,0,${num(y)}}{0,0,1,${num(z)}}{0,0,0,1}`
}

function beamAngleOf(def: FixtureDefinition): number {
  const lens = def.physical?.lens?.degreesMinMax
  const a = lens ? (lens[0] + lens[1]) / 2 : 25
  return Math.max(1, Math.min(120, a || 25))
}

function lampTypeOf(def: FixtureDefinition): 'LED' | 'Discharge' | 'Tungsten' | 'Halogen' {
  const t = (def.physical?.bulb?.type ?? '').toLowerCase()
  if (/discharge|msd|hmi|arc|metal/.test(t)) return 'Discharge'
  if (/tungsten|incandescent/.test(t)) return 'Tungsten'
  if (/halogen/.test(t)) return 'Halogen'
  return 'LED'
}
