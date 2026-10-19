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

export type EffectCategory = 'movement' | 'color' | 'intensity' | 'beam' | 'spatial'

export interface EffectTemplate {
  id: string
  label: string
  icon: IconType
  category: EffectCategory
  description: string
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

export const CATEGORIES: { id: EffectCategory; label: string }[] = [
  { id: 'movement', label: 'Movement' },
  { id: 'color', label: 'Colour' },
  { id: 'intensity', label: 'Intensity' },
  { id: 'beam', label: 'Beam' },
  { id: 'spatial', label: 'Spatial 3D' }
]

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
  { id: 'sweep-lr', label: 'Pan sweep', icon: LuMoveHorizontal, category: 'movement', description: 'Pan left to right',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 30, defaultSize: 80, defaultSpread: 0 },
  { id: 'sweep-ud', label: 'Tilt sweep', icon: LuMoveVertical, category: 'movement', description: 'Tilt up and down',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 60, defaultSpread: 0 },
  { id: 'circle', label: 'Circle', icon: LuCircle, category: 'movement', description: 'Pan + tilt circle (1:1)',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 128 }, { channelType: 'Tilt', phaseOffset: 90, depth: 128 }] },
  { id: 'figure-8', label: 'Figure 8', icon: LuInfinity, category: 'movement', description: 'Lissajous 1:2 figure eight',
    waveform: 'sine', defaultSpeed: 12, defaultSize: 60, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 128, frequencyMultiplier: 1 }, { channelType: 'Tilt', phaseOffset: 0, depth: 100, frequencyMultiplier: 2 }] },
  { id: 'ballyhoo', label: 'Ballyhoo', icon: LuWind, category: 'movement', description: 'Wide sweep: sine pan, triangle tilt',
    waveform: 'sine', defaultSpeed: 8, defaultSize: 90, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 200, waveform: 'sine' }, { channelType: 'Tilt', phaseOffset: 45, depth: 120, waveform: 'triangle' }] },
  { id: 'wave', label: 'Tilt wave', icon: LuWaves, category: 'movement', description: 'Tilt wave across fixtures',
    channels: ['Tilt'], waveform: 'sine', defaultSpeed: 20, defaultSize: 50, defaultSpread: 120 },
  { id: 'fan-out', label: 'Fan out', icon: LuFan, category: 'movement', description: 'Beams spread apart and converge',
    channels: ['Pan'], waveform: 'sine', defaultSpeed: 15, defaultSize: 70, defaultSpread: 180 },
  { id: 'nod', label: 'Nod', icon: LuArrowUpDown, category: 'movement', description: 'Quick bouncing nod',
    channels: ['Tilt'], waveform: 'bounce', defaultSpeed: 40, defaultSize: 40, defaultSpread: 0 },
  { id: 'step-position', label: 'Step positions', icon: LuGrid2X2, category: 'movement', description: 'Snap between 4 positions',
    waveform: 'step', defaultSpeed: 30, defaultSize: 60, defaultSpread: 90,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 150, waveform: 'step' }, { channelType: 'Tilt', phaseOffset: 90, depth: 100, waveform: 'step' }] },
  { id: 'random-move', label: 'Random move', icon: LuShuffle, category: 'movement', description: 'Random position changes',
    waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0,
    compound: [{ channelType: 'Pan', phaseOffset: 0, depth: 128 }, { channelType: 'Tilt', phaseOffset: 0, depth: 128 }] },

  // Colour (RGB)
  { id: 'rainbow', label: 'Rainbow', icon: LuRainbow, category: 'color', description: 'Cycle through RGB colours',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 120 },
  { id: 'color-chase', label: 'Colour chase', icon: LuChevronsRight, category: 'color', description: 'Colours ripple across fixtures',
    channels: ['Red', 'Green', 'Blue'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 60 },
  { id: 'color-pulse', label: 'Colour pulse', icon: LuHeart, category: 'color', description: 'Pulsing RGB colour shifts',
    channels: ['Red', 'Green', 'Blue'], waveform: 'triangle', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },
  { id: 'color-step', label: 'Colour step', icon: LuSquareActivity, category: 'color', description: 'Hard steps between saturated colours',
    channels: ['Red', 'Green', 'Blue'], waveform: 'step', defaultSpeed: 20, defaultSize: 100, defaultSpread: 120 },
  { id: 'fire', label: 'Fire', icon: LuFlame, category: 'color', description: 'Random warm red / amber flicker',
    waveform: 'random', defaultSpeed: 80, defaultSize: 80, defaultSpread: 0,
    compound: [{ channelType: 'Red', phaseOffset: 0, depth: 255 }, { channelType: 'Green', phaseOffset: 0, depth: 80 }, { channelType: 'Blue', phaseOffset: 0, depth: 10 }] },

  // Colour (wheel)
  { id: 'wheel-cycle', label: 'Wheel cycle', icon: LuPalette, category: 'color', description: 'Cycle through colour wheel slots',
    channels: ['Color Wheel'], waveform: 'sawtooth', defaultSpeed: 10, defaultSize: 50, defaultSpread: 0 },
  { id: 'wheel-chase', label: 'Wheel chase', icon: LuRefreshCw, category: 'color', description: 'Colour wheel ripple across fixtures',
    channels: ['Color Wheel'], waveform: 'sawtooth', defaultSpeed: 20, defaultSize: 50, defaultSpread: 90 },
  { id: 'wheel-step', label: 'Wheel step', icon: LuDisc3, category: 'color', description: 'Step through wheel colours sharply',
    channels: ['Color Wheel'], waveform: 'square', defaultSpeed: 30, defaultSize: 50, defaultSpread: 0 },
  { id: 'wheel-random', label: 'Wheel random', icon: LuDices, category: 'color', description: 'Random colour wheel jumps',
    channels: ['Color Wheel'], waveform: 'random', defaultSpeed: 40, defaultSize: 50, defaultSpread: 0 },

  // Intensity
  { id: 'pulse', label: 'Pulse', icon: LuActivity, category: 'intensity', description: 'Smooth dimmer pulsing',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0 },
  { id: 'strobe-fx', label: 'Strobe', icon: LuZap, category: 'intensity', description: 'Fast on / off flashing',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 0 },
  { id: 'chase-intensity', label: 'Chase', icon: LuChevronsRight, category: 'intensity', description: 'Intensity chases across fixtures',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 120, defaultSize: 100, defaultSpread: 90 },
  { id: 'random-flash', label: 'Random flash', icon: LuSparkles, category: 'intensity', description: 'Random fixture flashes',
    channels: ['Dimmer'], waveform: 'random', defaultSpeed: 60, defaultSize: 100, defaultSpread: 0 },
  { id: 'breathe', label: 'Breathe', icon: LuSunDim, category: 'intensity', description: 'Slow breathing',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 10, defaultSize: 80, defaultSpread: 0 },
  { id: 'bump', label: 'Bump', icon: LuSparkle, category: 'intensity', description: 'Fast attack, slow decay — once',
    channels: ['Dimmer'], waveform: 'pulse', defaultSpeed: 120, defaultSize: 100, defaultSpread: 0, oneShot: true },
  { id: 'strobe-burst', label: 'Strobe burst', icon: LuZap, category: 'intensity', description: 'One fast flash cycle, then stop',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 600, defaultSize: 100, defaultSpread: 0, oneShot: true },
  { id: 'wave-dim', label: 'Dim wave', icon: LuWaves, category: 'intensity', description: 'Intensity wave across fixtures',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 120 },
  { id: 'bounce-dim', label: 'Bounce', icon: LuArrowDown, category: 'intensity', description: 'Bouncing-ball decay',
    channels: ['Dimmer'], waveform: 'bounce', defaultSpeed: 40, defaultSize: 100, defaultSpread: 0 },

  // Beam
  { id: 'zoom-breathe', label: 'Zoom breathe', icon: LuZoomIn, category: 'beam', description: 'Zoom in and out smoothly',
    channels: ['Zoom'], waveform: 'sine', defaultSpeed: 15, defaultSize: 80, defaultSpread: 0 },
  { id: 'zoom-pulse', label: 'Zoom pulse', icon: LuSun, category: 'beam', description: 'Quick zoom pulse',
    channels: ['Zoom'], waveform: 'pulse', defaultSpeed: 40, defaultSize: 90, defaultSpread: 0 },
  { id: 'iris-pulse', label: 'Iris pulse', icon: LuAperture, category: 'beam', description: 'Iris open / close',
    channels: ['Iris'], waveform: 'sine', defaultSpeed: 20, defaultSize: 80, defaultSpread: 0 },
  { id: 'focus-hunt', label: 'Focus hunt', icon: LuFocus, category: 'beam', description: 'Slow focus shift for texture',
    channels: ['Focus'], waveform: 'triangle', defaultSpeed: 6, defaultSize: 40, defaultSpread: 0 },
  { id: 'gobo-spin', label: 'Gobo cycle', icon: LuDisc3, category: 'beam', description: 'Step through the gobo wheel',
    channels: ['Gobo'], waveform: 'sawtooth', defaultSpeed: 15, defaultSize: 50, defaultSpread: 0 },
  { id: 'prism-rotate', label: 'Prism', icon: LuTriangle, category: 'beam', description: 'Prism in / out cycle',
    channels: ['Prism'], waveform: 'sawtooth', defaultSpeed: 10, defaultSize: 60, defaultSpread: 0 },
  { id: 'frost-fade', label: 'Frost fade', icon: LuSnowflake, category: 'beam', description: 'Fade frost in and out',
    channels: ['Frost'], waveform: 'sine', defaultSpeed: 8, defaultSize: 80, defaultSpread: 0 },

  // Spatial 3D
  { id: 'spatial-color-lr', label: 'Colour sweep X', icon: LuMoveHorizontal, category: 'spatial', description: 'RGB wave left → right across the room',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x', compound: RGB },
  { id: 'spatial-color-fb', label: 'Colour sweep Z', icon: LuMoveVertical, category: 'spatial', description: 'RGB wave front → back',
    waveform: 'sine', defaultSpeed: 15, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'z', compound: RGB },
  { id: 'spatial-color-radial', label: 'Colour radial', icon: LuRadar, category: 'spatial', description: 'RGB colours radiate from the centre',
    waveform: 'sine', defaultSpeed: 12, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'radial', compound: RGB },
  { id: 'spatial-color-height', label: 'Colour height', icon: LuArrowUpDown, category: 'spatial', description: 'RGB colours shift with fixture height',
    waveform: 'sine', defaultSpeed: 10, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'y', compound: RGB },
  { id: 'spatial-dim-lr', label: 'Dim wave X', icon: LuWaves, category: 'spatial', description: 'Intensity wave left → right',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x' },
  { id: 'spatial-dim-fb', label: 'Dim wave Z', icon: LuWaves, category: 'spatial', description: 'Intensity wave front → back',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 30, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'z' },
  { id: 'spatial-dim-radial', label: 'Dim radial', icon: LuCircleDot, category: 'spatial', description: 'Intensity pulse from the centre out',
    channels: ['Dimmer'], waveform: 'sine', defaultSpeed: 20, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'radial' },
  { id: 'spatial-strobe-lr', label: 'Strobe sweep X', icon: LuZap, category: 'spatial', description: 'Strobe sweeping left → right',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 180, spatialMode: 'spatial', spatialAxis: 'x' },
  { id: 'spatial-strobe-radial', label: 'Strobe radial', icon: LuOrbit, category: 'spatial', description: 'Strobe burst from the centre out',
    channels: ['Dimmer'], waveform: 'square', defaultSpeed: 240, defaultSize: 100, defaultSpread: 180, spatialMode: 'spatial', spatialAxis: 'radial' },
  { id: 'spatial-chase-lr', label: 'Chase X', icon: LuChevronsRight, category: 'spatial', description: 'Sharp intensity chase left → right',
    channels: ['Dimmer'], waveform: 'pulse', defaultSpeed: 60, defaultSize: 100, defaultSpread: 360, spatialMode: 'spatial', spatialAxis: 'x' },
  { id: 'spatial-white-wave', label: 'White wave', icon: LuWaves, category: 'spatial', description: 'White wave across the room',
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

export function attributeLabel(type: string): string {
  return type === 'Color Wheel' ? 'Colour wheel' : type
}

export const WAVEFORMS: { id: WaveformType; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'sawtooth', label: 'Saw' },
  { id: 'square', label: 'Square' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'step', label: 'Step' },
  { id: 'random', label: 'Random' },
  { id: 'custom', label: 'Custom' }
]

export function waveformLabel(w: WaveformType): string {
  return WAVEFORMS.find((x) => x.id === w)?.label ?? w
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
    name: t.label,
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
