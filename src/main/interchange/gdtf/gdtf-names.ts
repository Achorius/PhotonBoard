// ============================================================
// PhotonBoard — GDTF attribute ↔ console channel vocabulary.
// Friendly channel names, channel types and capability types
// (OFL-style, as the console's channel classifier expects) for
// GDTF attributes. Shared by the importer and the exporter. Pure.
// ============================================================

import type { FixtureChannel } from '../../../shared/types'
import { lookupGdtfAttribute } from './attributes'

const FIXED_NAMES: Record<string, string> = {
  Dimmer: 'Dimmer',
  Pan: 'Pan',
  Tilt: 'Tilt',
  PanRotate: 'Pan Rotation',
  TiltRotate: 'Tilt Rotation',
  PositionEffect: 'Position Effect',
  PositionEffectRate: 'Position Effect Speed',
  PositionEffectFade: 'Position Effect Fade',
  ColorAdd_R: 'Red',
  ColorAdd_G: 'Green',
  ColorAdd_B: 'Blue',
  ColorAdd_W: 'White',
  ColorAdd_WW: 'Warm White',
  ColorAdd_CW: 'Cool White',
  ColorAdd_RY: 'Amber',
  ColorAdd_GY: 'Lime',
  ColorAdd_UV: 'UV',
  ColorAdd_C: 'Cyan',
  ColorAdd_M: 'Magenta',
  ColorAdd_Y: 'Yellow',
  ColorAdd_GC: 'Mint',
  ColorAdd_BC: 'Light Blue',
  ColorAdd_BM: 'Indigo',
  ColorAdd_RM: 'Pink',
  ColorSub_C: 'Cyan',
  ColorSub_M: 'Magenta',
  ColorSub_Y: 'Yellow',
  ColorSub_R: 'Red Filter',
  ColorSub_G: 'Green Filter',
  ColorSub_B: 'Blue Filter',
  CTO: 'CTO',
  CTB: 'CTB',
  CTC: 'CTC',
  Tint: 'Tint',
  HSB_Hue: 'Hue',
  HSB_Saturation: 'Saturation',
  HSB_Brightness: 'Brightness',
  HSB_Quality: 'Color Quality',
  CIE_X: 'CIE x',
  CIE_Y: 'CIE y',
  CIE_Brightness: 'CIE Brightness',
  ColorRGB_Red: 'Red',
  ColorRGB_Green: 'Green',
  ColorRGB_Blue: 'Blue',
  ColorRGB_Cyan: 'Cyan',
  ColorRGB_Magenta: 'Magenta',
  ColorRGB_Yellow: 'Yellow',
  Zoom: 'Zoom',
  Iris: 'Iris',
  StrobeRate: 'Strobe Speed',
  StrobeFrequency: 'Strobe Frequency',
  StrobeDuration: 'Strobe Duration',
  EffectsSync: 'Effects Sync',
  FixtureGlobalReset: 'Reset',
  LampControl: 'Lamp Control',
  PositionMSpeed: 'Pan/Tilt Speed',
  NoFeature: 'No function',
  Dummy: 'No function',
  BeamShaper: 'Beam Shaper',
  BeamShaperPos: 'Beam Shaper Rotation',
  BeamShaperPosRotate: 'Beam Shaper Rotation',
  ShaperRot: 'Shaper Rotation'
}

function suffix(n: number | undefined): string {
  return n !== undefined && n > 1 ? ` ${n}` : ''
}

/** "BlackoutMode" → "Blackout Mode", "Dimmer12" → "Dimmer 12" */
function splitWords(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Console channel name for a GDTF attribute ("Gobo2Pos" → "Gobo 2 Rotation") */
export function gdtfFriendlyName(attribute: string): string {
  if (FIXED_NAMES[attribute]) return FIXED_NAMES[attribute]
  const def = lookupGdtfAttribute(attribute)
  const n = def?.n
  switch (def?.pattern) {
    case 'Color(n)': return `Color Wheel${suffix(n)}`
    case 'Color(n)WheelIndex':
    case 'Color(n)WheelSpin':
    case 'Color(n)WheelRandom':
    case 'Color(n)WheelAudio': return `Color Wheel${suffix(n)} Rotation`
    case 'ColorMacro(n)': return `Color Macro${suffix(n)}`
    case 'ColorMacro(n)Rate': return `Color Macro${suffix(n)} Speed`
    case 'ColorEffects(n)': return `Color Effects${suffix(n)}`
    case 'Gobo(n)': return `Gobo Wheel${suffix(n)}`
    case 'Gobo(n)SelectSpin':
    case 'Gobo(n)SelectShake':
    case 'Gobo(n)SelectEffects': return `Gobo Wheel${suffix(n)} Effects`
    case 'Gobo(n)WheelIndex':
    case 'Gobo(n)WheelSpin':
    case 'Gobo(n)WheelShake':
    case 'Gobo(n)WheelRandom':
    case 'Gobo(n)WheelAudio': return `Gobo Wheel${suffix(n)} Rotation`
    case 'Gobo(n)Pos':
    case 'Gobo(n)PosRotate':
    case 'Gobo(n)PosShake': return `Gobo${suffix(n)} Rotation`
    case 'AnimationWheel(n)': return `Animation Wheel${suffix(n)}`
    case 'AnimationWheel(n)Pos':
    case 'AnimationWheel(n)PosRotate':
    case 'AnimationWheel(n)PosShake': return `Animation Wheel${suffix(n)} Rotation`
    case 'Shutter(n)': return `Shutter${suffix(n)}`
    case 'Shutter(n)Strobe': return `Strobe${suffix(n)}`
    case 'Prism(n)': return `Prism${suffix(n)}`
    case 'Prism(n)Pos':
    case 'Prism(n)PosRotate':
    case 'Prism(n)SelectSpin': return `Prism${suffix(n)} Rotation`
    case 'Prism(n)Macro': return `Prism${suffix(n)} Macro`
    case 'Frost(n)': return `Frost${suffix(n)}`
    case 'Focus(n)': return `Focus${suffix(n)}`
    case 'Effects(n)': return `Effects${suffix(n)}`
    case 'Effects(n)Rate': return `Effects${suffix(n)} Speed`
    case 'Effects(n)Fade': return `Effects${suffix(n)} Fade`
    case 'Effects(n)Pos':
    case 'Effects(n)PosRotate': return `Effects${suffix(n)} Rotation`
    case 'Control(n)': return `Control${suffix(n)}`
    case 'Fog(n)': return `Fog${suffix(n)}`
    case 'Haze(n)': return `Haze${suffix(n)}`
    case 'Fan(n)': return `Fan${suffix(n)}`
    case 'Blower(n)': return `Blower${suffix(n)}`
    case 'Blade(n)A': return `Blade ${n ?? 1}A`
    case 'Blade(n)B': return `Blade ${n ?? 1}B`
    case 'Blade(n)Rot': return `Blade ${n ?? 1} Rotation`
    case 'GoboWheel(n)MSpeed': return `Gobo Wheel${suffix(n)} Speed`
    default: break
  }
  if (/MSpeed$/.test(attribute)) return `${splitWords(attribute.replace(/MSpeed$/, ''))} Speed`
  if (def?.pattern && /\((n|m)\)/.test(def.pattern)) {
    // "Focus(n)Adjust" → "Focus Adjust" / "Focus 2 Adjust"
    const named = def.pattern.replace('(n)', n !== undefined && n > 1 ? String(n) : '').replace('(m)', def.m !== undefined ? String(def.m) : '')
    return splitWords(named) || attribute
  }
  return splitWords(attribute) || attribute
}

const CONTINUOUS = /^(Dimmer\d*|Pan|Tilt|ColorAdd_\w+|ColorSub_\w+|ColorRGB_\w+|CTO|CTB|CTC|Tint|HSB_\w+|CIE_\w+|Zoom|ZoomMode\w+|DigitalZoom|Focus\d+(Adjust|Distance)?|Iris|Frost\d+|Gobo\d+Pos|Prism\d+Pos|AnimationWheel\d+Pos|Blade(Soft)?\d+[AB]|Blade\d+Rot|KeyStone\d+[AB]|ShaperRot|XYZ_\w|Rot_\w|Scale_\w+)$/

/** Attributes whose channel sets are mere markers (min / home / max) of a continuous range */
export function isContinuousAttribute(attribute: string): boolean {
  return CONTINUOUS.test(attribute)
}

/** Console channel type of a GDTF attribute; `feature` ("Color.RGB") helps for custom attributes */
export function gdtfChannelType(attribute: string, feature?: string): FixtureChannel['type'] {
  const a = attribute
  if (/^Dimmer\d*$/.test(a)) return 'intensity'
  if (/^Pan(Rotate)?$/.test(a)) return 'pan'
  if (/^Tilt(Rotate)?$/.test(a)) return 'tilt'
  if (/MSpeed$/.test(a)) return 'speed'
  if (/^(ColorAdd_|ColorSub_|ColorRGB_|CTO$|CTB$|CTC$|Tint$|HSB_|CIE_|Color\d+$|Color\d+Wheel|ColorMacro\d+$|ColorEffects)/.test(a)) return 'color'
  if (/^(Gobo\d|AnimationWheel|AnimationSystem)/.test(a)) return 'gobo'
  if (/^Prism\d/.test(a)) return 'prism'
  if (/^Shutter\d+$/.test(a)) return 'shutter'
  if (/^(Shutter\d+Strobe|StrobeRate|StrobeFrequency|StrobeDuration|StrobeMode(?!Shutter))/.test(a)) return 'strobe'
  if (/^(Fog|Haze)\d*$/.test(a)) return 'fog'
  if (/(MSpeed|Rate)$/.test(a)) return 'speed'
  if (/^(Effects\d|EffectsSync|PositionEffect|Video)/.test(a)) return 'effect'
  if (/^(Control\d|FixtureGlobalReset|LampControl|LampPowerMode|DisplayIntensity|DMXInput|Fans|Fan\d|Blower\d|Function|DimmerCurve|DimmerMode|BlackoutMode|ReflectorAdjust|LEDFrequency)/.test(a) || /(Reset|Mode)$/.test(a)) return 'maintenance'
  if (/^(NoFeature|Dummy)$/.test(a)) return 'generic'
  if (/^(Zoom|Focus|Iris|Frost|Blade|Shaper|KeyStone|BeamShaper|DigitalZoom)/.test(a)) return 'generic'
  // Custom attribute: its feature, then its name
  const group = (feature ?? lookupGdtfAttribute(a)?.feature ?? '').split('.')[0]
  switch (group) {
    case 'Dimmer': return 'intensity'
    case 'Color': return 'color'
    case 'Gobo': return 'gobo'
    case 'Control': return /reset|lamp|mode|control|fan|curve|display|calibrat|function|power/i.test(a) ? 'maintenance' : 'generic'
    case 'Position': return /tilt/i.test(a) ? 'tilt' : /pan/i.test(a) ? 'pan' : 'generic'
    default: break
  }
  if (/dimmer|intensity/i.test(a)) return 'intensity'
  if (/strobe/i.test(a)) return 'strobe'
  if (/shutter/i.test(a)) return 'shutter'
  return 'generic'
}

/** OFL-style capability type of one GDTF channel function (the console classifier reads these) */
export function gdtfCapabilityType(attribute: string, label: string, hasWheelSlot: boolean): string {
  const a = attribute
  if (/^(NoFeature|Dummy)$/.test(a)) return 'NoFunction'
  if (/^Dimmer\d*$/.test(a)) return 'Intensity'
  if (a === 'Pan') return 'Pan'
  if (a === 'Tilt') return 'Tilt'
  if (a === 'PanRotate') return 'PanContinuous'
  if (a === 'TiltRotate') return 'TiltContinuous'
  if (/^(ColorAdd_|ColorSub_|ColorRGB_)/.test(a)) return 'ColorIntensity'
  if (/^(CTO|CTB|CTC)$/.test(a)) return 'ColorTemperature'
  if (/^ColorMacro\d+$/.test(a)) return 'ColorPreset'
  if (/^(Color|Gobo|AnimationWheel)\d+$/.test(a)) return hasWheelSlot ? 'WheelSlot' : 'Generic'
  if (/^(Gobo|AnimationWheel)\d+(SelectShake|PosShake)$/.test(a)) return 'WheelShake'
  if (/^(Gobo|AnimationWheel)\d+(SelectSpin|Pos|PosRotate)$/.test(a)) return 'WheelSlotRotation'
  if (/^(Color|Gobo|AnimationWheel)\d+Wheel(Index|Spin|Random|Audio|Shake)$/.test(a)) return 'WheelRotation'
  if (/^Prism\d+(Pos|PosRotate|SelectSpin)$/.test(a)) return 'PrismRotation'
  if (/^Prism\d+/.test(a)) return 'Prism'
  if (/^Shutter\d+$/.test(a)) return /clos|off|black|shut\b/i.test(label) ? 'ShutterClose' : 'ShutterOpen'
  if (/^Shutter\d+Strobe/.test(a)) return 'ShutterStrobe'
  if (/^(StrobeRate|StrobeFrequency)$/.test(a)) return 'StrobeSpeed'
  if (a === 'StrobeDuration') return 'StrobeDuration'
  if (a === 'Iris') return 'Iris'
  if (/^Iris/.test(a)) return 'IrisEffect'
  if (/^Frost\d+$/.test(a)) return 'Frost'
  if (/^Frost\d+/.test(a)) return 'FrostEffect'
  if (/^(Zoom|DigitalZoom|ZoomMode)/.test(a)) return 'Zoom'
  if (/^Focus\d+/.test(a)) return 'Focus'
  if (/^(Effects\d+|PositionEffect|ColorEffects\d+)$/.test(a)) return 'Effect'
  if (/^(Effects\d+Rate|PositionEffectRate|ColorMacro\d+Rate)$/.test(a)) return 'EffectSpeed'
  if (/^Effects\d+(Pos|PosRotate)$/.test(a)) return 'Rotation'
  if (/^Effects\d+/.test(a)) return 'EffectParameter'
  if (/^Blade\d+[AB]$/.test(a)) return 'BladeInsertion'
  if (/^Blade\d+Rot$/.test(a)) return 'BladeRotation'
  if (a === 'ShaperRot') return 'BladeSystemRotation'
  if (a === 'PositionMSpeed') return 'PanTiltSpeed'
  if (/MSpeed$/.test(a)) return 'Speed'
  if (/^(Fog|Haze)\d*$/.test(a)) return 'Fog'
  if (gdtfChannelType(a) === 'maintenance') return 'Maintenance'
  return 'Generic'
}
