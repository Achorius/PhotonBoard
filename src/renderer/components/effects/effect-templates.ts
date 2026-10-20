// ============================================================
// Effect library: templates, categories, channel types, waveform
// names and the helpers that turn a template into an Effect.
// ============================================================

import type { IconType } from 'react-icons'
import {
  LuActivity, LuAperture, LuArrowDown, LuArrowUpDown, LuChevronsRight, LuCircle, LuCircleDot, LuDices, LuDisc3,
  LuFan, LuFlame, LuFocus, LuGrid2X2, LuHeart, LuInfinity, LuMoveHorizontal, LuMoveVertical, LuOrbit, LuPalette,
  LuRadar, LuRainbow, LuRefreshCw, LuShuffle, LuSnowflake, LuSparkle, LuSparkles, LuSquareActivity, LuSun,
  LuSunDim, LuTriangle, LuWaves, LuWind, LuZap, LuZoomIn
} from 'react-icons/lu'
import type { Effect, EffectChannel, FixtureDefinition, PatchEntry, SpatialAxis, SpatialMode, WaveformType } from '@shared/types'
import { SWATCH_COLORS } from '@renderer/components/ui/tokens'
import { t as translate, type TranslationKey } from '@renderer/i18n'
import type { effects as effectsEn } from '@renderer/i18n/en/effects'

export type EffectCategory = 'movement' | 'color' | 'intensity' | 'beam' | 'spatial'

/** Stable template ids (display name / description: effects.templates.<id> in i18n) */
export type TemplateId = keyof typeof effectsEn.templates

export interface EffectTemplate {
  id: TemplateId
  icon: IconType
  category: EffectCategory
  waveform: WaveformType
  /** BPM */
  defaultSpeed: number
  /** 0-100 % */
  defaultSize: number
  /** 0-360° */
  defaultSpread: number
  oneShot?: boolean
  /** Simple attributes: phases spread evenly between them (RGB → 0/120/240°) */
  channels?: string[]
  /** Compound attributes with their own phase / depth / frequency */
  compound?: EffectChannel[]
  spatialMode?: SpatialMode
  spatialAxis?: SpatialAxis
}

export const CATEGORIES: EffectCategory[] = ['movement', 'color', 'intensity', 'beam', 'spatial']

export function categoryLabel(c: EffectCategory): string {
  return translate(`effects.categories.${c}`)
}

/** Template name in the current language (also the name of an effect created from it) */
export function templateLabel(tpl: Pick<EffectTemplate, 'id'>): string {
  return translate(`effects.templates.${tpl.id}.label`)
}

export function templateDescription(tpl: Pick<EffectTemplate, 'id'>): string {
  return translate(`effects.templates.${tpl.id}.description`)
}

/** Category accent (from the shared swatch set) */
export const CATEGORY_COLOR: Record<EffectCategory, string> = {
  movement: SWATCH_COLORS[8],
  color: SWATCH_COLORS[10],
  intensity: SWATCH_COLORS[2],
  beam: SWATCH_COLORS[6],
  spatial: SWATCH_COLORS[9]
}

const RGB: EffectChannel[] = [
  { channelType: 'Red', phaseOffset: 0, depth: 255 },
  { channelType: 'Green', phaseOffset: 120, depth: 255 },
  { channelType: 'Blue', phaseOffset: 240, depth: 255 }
]

export const EFFECT_TEMPLATES: EffectTemplate[] = [
  // Movement
  { id: 'sweep-lr', icon: LuMoveHorizontal, category: 'movement',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 30, defaultSize: 80, defaultSpread: 0 },
  { id: 'sweep-ud', icon: LuMoveVertical, category: 'movement',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 60, defaultSpread: 0 },
  { id: 'circle', icon: LuCircle, category: 'movement',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 128 }, { channelType: 'Tilt', phaseOffset: 90, depth: 128 }] },
  { id: 'figure-8', icon: LuInfinity, category: 'movement',
    waveform: 'sine', defaultSpeed: 12, defaultSize: 60, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 128, frequencyMultiplier: 1 }, { channelType: 'Tilt', phaseOffset: 0, depth: 100, frequencyMultiplier: 2 }] },
  { id: 'ballyhoo', icon: LuWind, category: 'movement',
    waveform: 'sine', defaultSpeed: 8, defaultSize: 90, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 200, waveform: 'sine' }, { channelType: 'Tilt', phaseOffset: 45, depth: 120, waveform: 'triangle' }] },
  { id: 'wave', icon: LuWaves, category: 'movement',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 50, defaultSpread: 120 },
  { id: 'fan-out', icon: LuFan, category: 'movement',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 15, defaultSize: 70, defaultSpread: 180 },
  { id: 'nod', icon: LuArrowUpDown, category: 'movement',
    channels: ['Tilt'], waveform: 'bounce', defaultSpeed: 40, defaultSize: 40, defaultSpread: 0 },
  { id: 'step-position', icon: LuGrid2X2, category: 'movement',
    waveform: 'step', defaultSpeed: 30, defaultSize: 60, defaultSpread: 90,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 150, waveform: 'step' }, { channelType: 'Tilt', phaseOffset: 90, depth: 100, waveform: 'step' }] },
  { id: 'random-move', icon: LuShuffle, category: 'movement',
    waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 128 }, { channelType: 'Tilt', phaseOffset: 0, depth: 128 }] },

  // Colour (RGB)
  { id: 'rainbow', icon: LuRainbow, category: 'color',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 120 },
  { id: 'color-chase', icon: LuChevronsRight, category: 'color',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 60 },
  { id: 'color-pulse', icon: LuHeart, category: 'color',
    channels: ['Red', 'Green', 'Blue'], waveform: 'triangle', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },
  { id: 'color-step', icon: LuSquareActivity, category: 'color',
    channels: ['Red', 'Green', 'Blue'], waveform: 'step', defaultSpeed: 20, defaultSize: 100, defaultSpread: 120 },
  { id: 'fire', icon: LuFlame, category: 'color',
    waveform: 'random', defaultSpeed: 80, defaultSize: 80, defaultSpread: 0,
    compound: [{ channelType: 'Red', phaseOffset: 0, depth: 255 }, { channelType: 'Green', phaseOffset: 0, depth: 80 }, { channelType: 'Blue', phaseOffset: 0, depth: 10 }] },

  // Colour (wheel)
  { id: 'wheel-cycle', icon: LuPalette, category: 'color',
    channels: ['Color Wheel'], waveform: 'sawtooth', defaultSpeed: 10, defaultSize: 50, defaultSpread: 0 },
  { id: 'wheel-chase', icon: LuRefreshCw, category: 'color',
    channels: ['Color Wheel'], waveform: 'sawtooth', defaultSpeed: 20, defaultSize: 50, defaultSpread: 90 },
  { id: 'wheel-step', icon: LuDisc3, category: 'color',
    channels: ['Color Wheel'], waveform: 'square', defaultSpeed: 30, defaultSize: 50, defaultSpread: 0 },
  { id: 'wheel-random', icon: LuDices, category: 'color',
    channels: ['Color Wheel'], waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0 },

  // Intensity
  { id: 'pulse', icon: LuActivity, category: 'intensity',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0 },
  { id: 'strobe-fx', icon: LuZap, category: 'intensity',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 0 },
  { id: 'chase-intensity', icon: LuChevronsRight, category: 'intensity',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 120, defaultSize: 100, defaultSpread: 90 },
  { id: 'random-flash', icon: LuSparkles, category: 'intensity',
    channels: ['Dimmer'], waveform: 'random', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0 },
  { id: 'breathe', icon: LuSunDim, category: 'intensity',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 10, defaultSize: 80, defaultSpread: 0 },
  { id: 'bump', icon: LuSparkle, category: 'intensity',
    channels: ['Dimmer'], waveform: 'pulse', defaultSpeed: 120, defaultSize: 100, defaultSpread: 0, oneShot: true },
  { id: 'strobe-burst', icon: LuZap, category: 'intensity',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 600, defaultSize: 100, defaultSpread: 0, oneShot: true },
  { id: 'wave-dim', icon: LuWaves, category: 'intensity',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 120 },
  { id: 'bounce-dim', icon: LuArrowDown, category: 'intensity',
    channels: ['Dimmer'], waveform: 'bounce', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },

  // Beam
  { id: 'zoom-breathe', icon: LuZoomIn, category: 'beam',
    channels: ['Zoom'], waveform: 'sine', defaultSpeed: 15, defaultSize: 80, defaultSpread: 0 },
  { id: 'zoom-pulse', icon: LuSun, category: 'beam',
    channels: ['Zoom'], waveform: 'pulse', defaultSpeed: 40, defaultSize: 90, defaultSpread: 0 },
  { id: 'iris-pulse', icon: LuAperture, category: 'beam',
    channels: ['Iris'], waveform: 'sine', defaultSpeed: 20, defaultSize: 80, defaultSpread: 0 },
  { id: 'focus-hunt', icon: LuFocus, category: 'beam',
    channels: ['Focus'], waveform: 'triangle', defaultSpeed: 6, defaultSize: 40, defaultSpread: 0 },
  { id: 'gobo-spin', icon: LuDisc3, category: 'beam',
    channels: ['Gobo'], waveform: 'sawtooth', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0 },
  { id: 'prism-rotate', icon: LuTriangle, category: 'beam',
    channels: ['Prism'], waveform: 'sawtooth', defaultSpeed: 10, defaultSize: 60, defaultSpread: 0 },
  { id: 'frost-fade', icon: LuSnowflake, category: 'beam',
    channels: ['Frost'], waveform: 'sine', defaultSpeed: 8, defaultSize: 80, defaultSpread: 0 },

  // Spatial 3D
  { id: 'spatial-color-lr', icon: LuMoveHorizontal, category: 'spatial',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x', compound: RGB },
  { id: 'spatial-color-fb', icon: LuMoveVertical, category: 'spatial',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'z', compound: RGB },
  { id: 'spatial-color-radial', icon: LuRadar, category: 'spatial',
    waveform: 'sine', defaultSpeed: 12, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'radial', compound: RGB },
  { id: 'spatial-color-height', icon: LuArrowUpDown, category: 'spatial',
    waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'y', compound: RGB },
  { id: 'spatial-dim-lr', icon: LuWaves, category: 'spatial',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x' },
  { id: 'spatial-dim-fb', icon: LuWaves, category: 'spatial',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'z' },
  { id: 'spatial-dim-radial', icon: LuCircleDot, category: 'spatial',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 20, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'radial' },
  { id: 'spatial-strobe-lr', icon: LuZap, category: 'spatial',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 180, spatialMode: 'spatial', spatialAxis: 'x' },
  { id: 'spatial-strobe-radial', icon: LuOrbit, category: 'spatial',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 180, spatialMode: 'spatial', spatialAxis: 'radial' },
  { id: 'spatial-chase-lr', icon: LuChevronsRight, category: 'spatial',
    channels: ['Dimmer'], waveform: 'pulse', defaultSpeed: 60, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x' },
  { id: 'spatial-white-wave', icon: LuWaves, category: 'spatial',
    channels: ['White'], waveform: 'sine', defaultSpeed: 20, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x' }
]

// ------------------------------------------------------------
// Attributes & waveforms
// ------------------------------------------------------------

/** Attributes an effect can drive (names understood by the engine) */
export const ATTRIBUTES = [
  'Dimmer', 'Red', 'Green', 'Blue', 'White', 'Cyan', 'Magenta', 'Yellow', 'Color Wheel',
  'Pan', 'Tilt', 'Zoom', 'Focus', 'Iris', 'Gobo', 'Prism', 'Frost', 'Shutter'
] as const

const ATTRIBUTE_SET = new Set<string>(ATTRIBUTES)

/** Display name of an attribute (unknown types from older shows are shown as stored) */
export function attributeLabel(type: string): string {
  return ATTRIBUTE_SET.has(type) ? translate(`effects.attributes.${type}` as TranslationKey) : type
}

/** Waveforms offered in the picker (display names: effects.waveforms.<id>) */
export const WAVEFORMS: WaveformType[] = ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'bounce', 'step', 'random', 'custom']

const WAVEFORM_SET = new Set<string>([...WAVEFORMS, 'constant'])

export function waveformLabel(w: WaveformType): string {
  return WAVEFORM_SET.has(w) ? translate(`effects.waveforms.${w}` as TranslationKey) : w
}

export const DEFAULT_KEYFRAMES = [
  { x: 0, y: -1 }, { x: 0.25, y: 1 }, { x: 0.5, y: -1 }, { x: 0.75, y: 1 }, { x: 1, y: -1 }
]

/** The attribute list of an effect (single-channel effects are one implicit attribute) */
export function effectChannels(effect: Pick<Effect, 'channels' | 'channelType' | 'depth'>): EffectChannel[] {
  return effect.channels && effect.channels.length > 0
    ? effect.channels
    : [{ channelType: effect.channelType, phaseOffset: 0, depth: effect.depth, frequencyMultiplier: 1 }]
}

/** Category an effect most likely belongs to (colour accent, icon) */
export function effectCategoryOf(effect: Pick<Effect, 'channels' | 'channelType' | 'spatialMode' | 'depth'>): EffectCategory {
  if (effect.spatialMode === 'spatial') return 'spatial'
  const types = effectChannels(effect).map((c) => c.channelType)
  if (types.some((t) => t === 'Pan' || t === 'Tilt')) return 'movement'
  if (types.some((t) => ['Red', 'Green', 'Blue', 'White', 'Cyan', 'Magenta', 'Yellow', 'Color Wheel'].includes(t))) return 'color'
  if (types.some((t) => ['Zoom', 'Focus', 'Iris', 'Gobo', 'Prism', 'Frost'].includes(t))) return 'beam'
  return 'intensity'
}

// ------------------------------------------------------------
// Fixture capabilities
// ------------------------------------------------------------

/** Attribute names (lowercase) a patched fixture supports */
export function fixtureAttributes(entry: PatchEntry, defs: Map<string, FixtureDefinition>): Set<string> {
  const def = defs.get(entry.fixtureDefId)
  const mode = def?.modes.find((m) => m.name === entry.modeName)
  const result = new Set<string>()
  if (!mode) return result
  const names = mode.pixelLayout ? [...mode.channels, ...mode.pixelLayout.cells.flatMap((c) => c.channelNames)] : mode.channels
  for (const ch of names) {
    const n = ch.toLowerCase()
    if (/\bfine\b/.test(n)) continue
    if (n.includes('pan')) result.add('pan')
    else if (n.includes('tilt')) result.add('tilt')
    else if (n.includes('red')) result.add('red')
    else if (n.includes('green')) result.add('green')
    else if (n.includes('blue')) result.add('blue')
    else if (n.includes('white')) result.add('white')
    else if (n.includes('cyan')) result.add('cyan')
    else if (n.includes('magenta')) result.add('magenta')
    else if (n.includes('yellow')) result.add('yellow')
    else if (n.includes('dimmer') || n.includes('intensity')) result.add('dimmer')
    else if (n.includes('zoom')) result.add('zoom')
    else if (n.includes('iris')) result.add('iris')
    else if (n.includes('focus')) result.add('focus')
    else if (n.includes('gobo')) result.add('gobo')
    else if (n.includes('prism')) result.add('prism')
    else if (n.includes('frost')) result.add('frost')
    else if (n === 'color' || (n.includes('colo') && n.includes('wheel'))) result.add('color wheel')
    else if (n.includes('shutter') || n.includes('strobe')) result.add('shutter')
  }
  return result
}

export type Compat = 'full' | 'partial' | 'none'

export function templateAttributes(t: EffectTemplate): string[] {
  return (t.compound ? t.compound.map((c) => c.channelType) : t.channels ?? []).map((c) => c.toLowerCase())
}

/** RGB effects also run on colour-wheel-only fixtures (nearest slot) */
function supports(attrs: Set<string>, required: string[]): boolean {
  return required.every((r) => attrs.has(r) || (['red', 'green', 'blue'].includes(r) && attrs.has('color wheel')))
}

/** How many targets can run a template: all, some or none */
export function templateCompat(t: EffectTemplate, targets: Set<string>[]): Compat {
  if (targets.length === 0) return 'none'
  const required = templateAttributes(t)
  if (required.length === 0) return 'full'
  let ok = 0
  for (const attrs of targets) if (supports(attrs, required)) ok++
  return ok === targets.length ? 'full' : ok > 0 ? 'partial' : 'none'
}

// ------------------------------------------------------------
// Template → effect
// ------------------------------------------------------------

/** A new effect definition from a template (one effect, several attributes when needed) */
export function effectFromTemplate(t: EffectTemplate, fixtureIds: string[]): Partial<Effect> & { fixtureIds: string[] } {
  const size = t.defaultSize / 100
  let channels: EffectChannel[] | undefined
  if (t.compound) {
    channels = t.compound.map((c) => ({ ...c, depth: Math.round(c.depth * size) }))
  } else if ((t.channels?.length ?? 0) > 1) {
    const list = t.channels!
    channels = list.map((c, i) => ({ channelType: c, phaseOffset: Math.round((i * 360) / list.length), depth: Math.round(255 * size) }))
  }
  const effect: Partial<Effect> & { fixtureIds: string[] } = {
    name: templateLabel(t),
    waveform: t.waveform,
    speed: t.defaultSpeed / 60,
    depth: Math.round(255 * size),
    offset: 0,
    channelType: channels?.[0]?.channelType ?? t.channels?.[0] ?? 'Dimmer',
    fixtureIds,
    fan: t.defaultSpread,
    isRunning: true
  }
  if (channels) effect.channels = channels
  if (t.oneShot) effect.oneShot = true
  if (t.spatialMode) effect.spatialMode = t.spatialMode
  if (t.spatialAxis) effect.spatialAxis = t.spatialAxis
  return effect
}

/**
 * Colour effects need light. The dimmer is NEVER written to the programmer
 * (it would override the effect / every scene until Clear): when all the
 * targets are dark, the effect gets its own constant "open dimmer"
 * attribute, which lives on the effect's layer and goes away with it.
 * When only some are dark, a hint is shown and nothing is changed.
 */
export function withOpenDimmer(
  effect: Partial<Effect> & { fixtureIds: string[] },
  state: { dark: number; lit: number }
): { effect: Partial<Effect> & { fixtureIds: string[] }; hint: boolean } {
  if (state.dark === 0) return { effect, hint: false }
  if (state.lit > 0) return { effect, hint: true }
  const channels: EffectChannel[] = effect.channels && effect.channels.length > 0
    ? effect.channels
    : [{ channelType: effect.channelType ?? 'Dimmer', phaseOffset: 0, depth: effect.depth ?? 255, frequencyMultiplier: 1 }]
  if (channels.some((c) => c.channelType === 'Dimmer')) return { effect, hint: false }
  return {
    effect: { ...effect, channels: [...channels, { channelType: 'Dimmer', phaseOffset: 0, depth: 255, frequencyMultiplier: 1, waveform: 'constant' }] },
    hint: false
  }
}

// ------------------------------------------------------------
// Size scaling with remembered proportions
// ------------------------------------------------------------

/** Last known per-attribute proportions (so dragging size to 0 and back keeps the mix) */
const proportions = new Map<string, number[]>()

/** Updates to set an effect's overall size; scales every attribute proportionally */
export function sizeUpdates(effect: Effect, depth: number): Partial<Effect> {
  const d = Math.max(0, Math.min(255, Math.round(depth)))
  if (!effect.channels || effect.channels.length === 0) return { depth: d }
  let ratios: number[]
  if (effect.depth > 0) {
    ratios = effect.channels.map((c) => c.depth / effect.depth)
    proportions.set(effect.id, ratios)
  } else {
    ratios = proportions.get(effect.id) ?? effect.channels.map(() => 1)
  }
  return {
    depth: d,
    channels: effect.channels.map((c, i) => ({ ...c, depth: Math.max(0, Math.min(255, Math.round(d * (ratios[i] ?? 1)))) }))
  }
}
