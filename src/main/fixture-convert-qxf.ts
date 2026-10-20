// ============================================================
// PhotonBoard — QLC+ fixture definition (.qxf) → FixtureDefinition
//
// Handles both QXF generations: channel / capability presets
// (QLC+ 4.12+: Preset="IntensityRed", Res1="#ff0000") and the
// older Group/Colour elements with Color/Res attributes. 16-bit
// pairs (…Fine presets, Group Byte="1") are linked and named so
// the console pairs them; mode <Head>s become pixel layouts.
//
// Used by file import and the offline catalog build. Pure.
// ============================================================

import { XMLParser } from 'fast-xml-parser'
import type {
  FixtureCapability,
  FixtureCatalogProvenance,
  FixtureChannel,
  FixtureDefinition,
  FixtureMode,
  FixturePhysical
} from '../shared/types'
import { clampByte, compact, defaultPrecedence, pixelLayoutFromCells, slugify, uniqueName } from './fixture-convert-common'

// Secure XML parser options — no entity expansion (XXE / billion laughs)
const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true
} as const

export interface QxfConvertOptions {
  /** Definition id; default `${slug(manufacturer)}/${slug(model)}` */
  id?: string
  /** Display manufacturer (e.g. the OFL spelling when the catalogs are merged) */
  manufacturerName?: string
  source?: FixtureDefinition['source']
  sourceUrl?: string
  catalog?: FixtureCatalogProvenance
  stampNow?: boolean
}

type Json = Record<string, any>

function list<T = Json>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : v === undefined || v === null || v === '' ? [] : [v as T]
}

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object' && '#text' in (v as Json)) return String((v as Json)['#text'])
  return ''
}

function int(v: unknown, fallback = 0): number {
  const n = parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

function float(v: unknown): number | undefined {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n !== 0 ? n : undefined
}

// ---------------------------------------------------------------
// Presets
// ---------------------------------------------------------------

interface ChannelPresetInfo {
  type: FixtureChannel['type']
  /** OFL-style capability type of the single synthesised capability */
  cap: string
  label: string
  color?: string
  fine?: boolean
  /** Preset of the coarse partner (fine presets) */
  coarse?: string
}

const INTENSITY_COLORS: Record<string, string> = {
  Red: '#ff0000', Green: '#00ff00', Blue: '#0000ff', Cyan: '#00ffff', Magenta: '#ff00ff', Yellow: '#ffff00',
  Amber: '#ffbf00', White: '#ffffff', UV: '#7f00ff', Indigo: '#4b0082', Lime: '#bfff00'
}

function channelPreset(preset: string): ChannelPresetInfo | null {
  if (!preset) return null
  const fine = /Fine$/.test(preset)
  const base = fine ? preset.replace(/Fine$/, '') : preset
  const out = (info: Omit<ChannelPresetInfo, 'fine' | 'coarse'>): ChannelPresetInfo =>
    fine ? { ...info, fine: true, coarse: base, label: `${info.label} fine` } : info
  const m = base.match(/^Intensity(Red|Green|Blue|Cyan|Magenta|Yellow|Amber|White|UV|Indigo|Lime)$/)
  if (m) return out({ type: 'color', cap: 'ColorIntensity', label: m[1], color: INTENSITY_COLORS[m[1]] })
  switch (base) {
    case 'IntensityMasterDimmer':
    case 'IntensityDimmer': return out({ type: 'intensity', cap: 'Intensity', label: 'Dimmer' })
    case 'IntensityHue': return out({ type: 'color', cap: 'Generic', label: 'Hue' })
    case 'IntensitySaturation': return out({ type: 'color', cap: 'Generic', label: 'Saturation' })
    case 'IntensityLightness':
    case 'IntensityValue': return out({ type: 'intensity', cap: 'Intensity', label: 'Intensity' })
    case 'PositionPan': return out({ type: 'pan', cap: 'Pan', label: 'Pan' })
    case 'PositionTilt': return out({ type: 'tilt', cap: 'Tilt', label: 'Tilt' })
    case 'PositionXAxis': return out({ type: 'pan', cap: 'Pan', label: 'X axis' })
    case 'PositionYAxis': return out({ type: 'tilt', cap: 'Tilt', label: 'Y axis' })
    case 'SpeedPanSlowFast': return out({ type: 'speed', cap: 'PanTiltSpeed', label: 'Pan speed slow…fast' })
    case 'SpeedPanFastSlow': return out({ type: 'speed', cap: 'PanTiltSpeed', label: 'Pan speed fast…slow' })
    case 'SpeedTiltSlowFast': return out({ type: 'speed', cap: 'PanTiltSpeed', label: 'Tilt speed slow…fast' })
    case 'SpeedTiltFastSlow': return out({ type: 'speed', cap: 'PanTiltSpeed', label: 'Tilt speed fast…slow' })
    case 'SpeedPanTiltSlowFast': return out({ type: 'speed', cap: 'PanTiltSpeed', label: 'Pan/tilt speed slow…fast' })
    case 'SpeedPanTiltFastSlow': return out({ type: 'speed', cap: 'PanTiltSpeed', label: 'Pan/tilt speed fast…slow' })
    case 'ColorMacro': return out({ type: 'color', cap: 'ColorPreset', label: 'Color macro' })
    case 'ColorWheel': return out({ type: 'color', cap: 'WheelSlot', label: 'Color wheel' })
    case 'ColorRGBMixer': return out({ type: 'color', cap: 'ColorPreset', label: 'RGB mixer' })
    case 'ColorCTOMixer': return out({ type: 'color', cap: 'ColorTemperature', label: 'CTO' })
    case 'ColorCTCMixer': return out({ type: 'color', cap: 'ColorTemperature', label: 'CTC' })
    case 'ColorCTBMixer': return out({ type: 'color', cap: 'ColorTemperature', label: 'CTB' })
    case 'GoboWheel': return out({ type: 'gobo', cap: 'WheelSlot', label: 'Gobo wheel' })
    case 'GoboIndex': return out({ type: 'gobo', cap: 'WheelSlotRotation', label: 'Gobo index' })
    case 'ShutterStrobeSlowFast': return out({ type: 'strobe', cap: 'ShutterStrobe', label: 'Strobe slow…fast' })
    case 'ShutterStrobeFastSlow': return out({ type: 'strobe', cap: 'ShutterStrobe', label: 'Strobe fast…slow' })
    case 'ShutterIrisMinToMax': return out({ type: 'generic', cap: 'Iris', label: 'Iris min…max' })
    case 'ShutterIrisMaxToMin': return out({ type: 'generic', cap: 'Iris', label: 'Iris max…min' })
    case 'ShutterIris': return out({ type: 'generic', cap: 'Iris', label: 'Iris' })
    case 'BeamFocusNearFar': return out({ type: 'generic', cap: 'Focus', label: 'Focus near…far' })
    case 'BeamFocusFarNear': return out({ type: 'generic', cap: 'Focus', label: 'Focus far…near' })
    case 'BeamFocus': return out({ type: 'generic', cap: 'Focus', label: 'Focus' })
    case 'BeamZoomSmallBig': return out({ type: 'generic', cap: 'Zoom', label: 'Zoom small…big' })
    case 'BeamZoomBigSmall': return out({ type: 'generic', cap: 'Zoom', label: 'Zoom big…small' })
    case 'BeamZoom': return out({ type: 'generic', cap: 'Zoom', label: 'Zoom' })
    case 'PrismRotationSlowFast': return out({ type: 'prism', cap: 'PrismRotation', label: 'Prism rotation slow…fast' })
    case 'PrismRotationFastSlow': return out({ type: 'prism', cap: 'PrismRotation', label: 'Prism rotation fast…slow' })
    case 'NoFunction': return out({ type: 'generic', cap: 'NoFunction', label: 'No function' })
    default: return null
  }
}

function groupType(group: string, name: string): FixtureChannel['type'] {
  switch (group.toLowerCase()) {
    case 'intensity': return /red|green|blue|white|amber|uv|cyan|magenta|yellow|lime|indigo/i.test(name) && !/dimmer|master|intensity/i.test(name) ? 'color' : 'intensity'
    case 'colour': case 'color': return 'color'
    case 'gobo': return 'gobo'
    case 'speed': return 'speed'
    case 'pan': return 'pan'
    case 'tilt': return 'tilt'
    case 'shutter': return /strobe/i.test(name) && !/shutter/i.test(name) ? 'strobe' : 'shutter'
    case 'prism': return 'prism'
    case 'beam': return 'generic'
    case 'effect': return /fog|haze|smoke/i.test(name) ? 'fog' : 'effect'
    case 'maintenance': return 'maintenance'
    case 'nothing': return 'generic'
    default: return 'generic'
  }
}

/** Capability type for a QLC+ capability preset (OFL vocabulary where it maps) */
function capPresetType(preset: string, group: string, channelType: FixtureChannel['type']): string {
  if (!preset) {
    switch (group.toLowerCase()) {
      case 'intensity': return channelType === 'color' ? 'ColorIntensity' : channelType === 'fog' ? 'FogOutput' : channelType === 'speed' ? 'Speed' : 'Intensity'
      case 'colour': case 'color': return 'ColorPreset'
      case 'gobo': return 'WheelSlot'
      case 'shutter': return 'ShutterStrobe'
      case 'speed': return 'Speed'
      case 'pan': return 'Pan'
      case 'tilt': return 'Tilt'
      case 'prism': return 'Prism'
      case 'effect': return 'Effect'
      case 'maintenance': return 'Maintenance'
      case 'nothing': return 'NoFunction'
      default: return 'Generic'
    }
  }
  if (preset === 'ShutterOpen') return 'ShutterOpen'
  if (preset === 'ShutterClose') return 'ShutterClose'
  if (/^(Strobe|Pulse|Ramp)/.test(preset)) return 'ShutterStrobe'
  if (preset === 'ColorMacro' || preset === 'ColorDoubleMacro') return channelType === 'gobo' ? 'WheelSlot' : 'ColorPreset'
  if (preset === 'GoboMacro') return channelType === 'color' ? 'ColorPreset' : 'WheelSlot'
  if (preset === 'GoboShakeMacro') return 'WheelShake'
  if (/^Rotation/.test(preset)) return channelType === 'gobo' ? 'WheelSlotRotation' : channelType === 'prism' ? 'PrismRotation' : 'Rotation'
  if (/^(Reset|Lamp)/.test(preset)) return 'Maintenance'
  if (/^Prism/.test(preset)) return 'Prism'
  if (preset === 'NoFunction') return 'NoFunction'
  if (/SlowToFast|FastToSlow/.test(preset)) return 'Speed'
  if (preset === 'Alias') return 'Generic'
  return 'Generic'
}

const FINE_WORDS = /\s*(?:[-_ ]?fine|16-?bit|\(fine\)|\blsb)\s*$/i

function pairsByName(fine: string, coarse: string): boolean {
  return FINE_WORDS.test(fine) && fine.replace(FINE_WORDS, '').trim().toLowerCase() === coarse.trim().toLowerCase()
}

function stemOf(name: string): string {
  return name.toLowerCase().replace(/\b(fine|coarse|lsb|msb|16-?bit|8-?bit)\b/g, '').replace(/[^a-z0-9]+/g, '')
}

// ---------------------------------------------------------------
// Converter
// ---------------------------------------------------------------

const QLC_TYPE_TO_CATEGORIES: Record<string, string[]> = {
  'Color Changer': ['Color Changer'],
  'Moving Head': ['Moving Head'],
  Scanner: ['Scanner'],
  Flower: ['Flower'],
  'LED Bar (Beams)': ['Pixel Bar'],
  'LED Bar (Pixels)': ['Pixel Bar'],
  Strobe: ['Strobe'],
  Laser: ['Laser'],
  Smoke: ['Smoke'],
  Hazer: ['Hazer'],
  Effect: ['Effect'],
  Dimmer: ['Dimmer'],
  Fan: ['Fan'],
  Other: ['Other']
}

export function parseQxfXml(content: string): Json {
  const parser = new XMLParser({ ...XML_OPTIONS, isArray: (name) => ['Channel', 'Capability', 'Mode', 'Head', 'Alias'].includes(name) })
  return parser.parse(content)
}

export function convertQxfFixture(content: string | Json, opts: QxfConvertOptions = {}): FixtureDefinition {
  const doc = typeof content === 'string' ? parseQxfXml(content) : content
  const fd = doc?.FixtureDefinition
  if (!fd || typeof fd !== 'object') throw new Error('Not a QLC+ fixture definition')
  const qlcManufacturer = text(fd.Manufacturer).trim() || 'Unknown'
  const model = text(fd.Model).trim() || 'QLC+ Fixture'
  const manufacturer = opts.manufacturerName || qlcManufacturer
  const qlcType = text(fd.Type).trim()
  const isFogMachine = qlcType === 'Smoke' || qlcType === 'Hazer'

  // ---- channels (definition order) ----
  interface Raw { qlcName: string; name: string; group: string; byte: number; preset: string; ch: FixtureChannel }
  const raws: Raw[] = []
  const byQlcName = new Map<string, Raw>()
  for (const node of list(fd.Channel)) {
    const qlcName = String(node['@_Name'] ?? '').trim()
    if (!qlcName || byQlcName.has(qlcName)) continue
    const preset = String(node['@_Preset'] ?? '')
    const groupNode = node.Group
    const group = text(groupNode).trim()
    const byte = int(groupNode?.['@_Byte'], 0)
    const pinfo = channelPreset(preset)
    const colourEl = text(node.Colour).trim()
    let type: FixtureChannel['type'] = pinfo ? pinfo.type : groupType(group, qlcName)
    if (!pinfo && group.toLowerCase() === 'intensity' && colourEl && colourEl !== 'Generic') type = 'color'
    // Smoke / haze machines put their output and fan on "Intensity": never let masters / blackout drive a fan
    if (isFogMachine && type === 'intensity') type = /fan|blower|speed/i.test(qlcName) ? 'speed' : 'fog'

    const capabilities: FixtureCapability[] = []
    for (const cap of list(node.Capability)) {
      const cPreset = String(cap['@_Preset'] ?? '')
      const min = clampByte(int(cap['@_Min'], 0))
      const max = clampByte(int(cap['@_Max'], 255))
      const label = text(cap).trim() || cPreset || qlcName
      const res1 = String(cap['@_Res1'] ?? cap['@_Res'] ?? '')
      const res2 = String(cap['@_Res2'] ?? '')
      const colors: string[] = []
      for (const c of [cap['@_Color'], cap['@_Color2'], res1, res2]) {
        if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) && !colors.includes(c.toLowerCase())) colors.push(c.toLowerCase())
      }
      const image = res1 && !res1.startsWith('#') && /\.(svg|png|jpe?g|gif)$/i.test(res1) ? res1 : undefined
      let capLabel = label
      if (cPreset === 'StrobeFreqRange' && res1 && res2) capLabel = `${label} (${res1}…${res2} Hz)`
      else if (cPreset === 'StrobeFrequency' && res1) capLabel = `${label} (${res1} Hz)`
      capabilities.push(compact<FixtureCapability>({
        dmxRange: [Math.min(min, max), Math.max(min, max)],
        type: capPresetType(cPreset, pinfo ? groupOfPreset(preset) : group, type),
        label: capLabel,
        color: colors[0],
        colors: colors.length > 1 ? colors : undefined,
        image
      }))
    }
    if (capabilities.length === 0) {
      const c = pinfo
        ? compact<FixtureCapability>({ dmxRange: [0, 255], type: pinfo.cap, label: pinfo.label, color: pinfo.color })
        : compact<FixtureCapability>({ dmxRange: [0, 255], type: capPresetType('', group, type), label: qlcName, color: colourEl ? INTENSITY_COLORS[colourEl] : undefined })
      capabilities.push(c)
    } else if (type === 'color' && colourEl && INTENSITY_COLORS[colourEl] && capabilities.length === 1 && !capabilities[0].color) {
      capabilities[0].color = INTENSITY_COLORS[colourEl]
      capabilities[0].type = 'ColorIntensity'
    }

    const ch: FixtureChannel = { name: qlcName, type, precedence: defaultPrecedence(type) }
    if (node['@_Default'] !== undefined) ch.defaultValue = clampByte(int(node['@_Default'], 0))
    if (type === 'intensity') ch.highlightValue = 255
    ch.capabilities = capabilities
    const raw: Raw = { qlcName, name: qlcName, group: pinfo ? groupOfPreset(preset) : group, byte: pinfo?.fine ? 1 : byte, preset, ch }
    raws.push(raw)
    byQlcName.set(qlcName, raw)
  }

  // ---- 16-bit pairs ----
  const modeLists = list(fd.Mode).map((m) => list(m.Channel)
    .map((ref, i) => ({ n: int(typeof ref === 'object' ? ref['@_Number'] : undefined, i), name: text(ref).trim() }))
    .sort((a, b) => a.n - b.n)
    .map((r) => r.name))
  const FINE_NAME = /fine|lsb|16 ?-?bit|\blow\b/i
  // A "…Fine" preset on a coarse-named channel that has a fine-named twin is a mistake in the source
  for (const r of raws) {
    if (r.byte === 1 && !FINE_NAME.test(r.qlcName) && raws.some((o) => o !== r && FINE_NAME.test(o.qlcName) && stemOf(o.qlcName) === stemOf(r.qlcName))) {
      r.byte = 0
      const cap = r.ch.capabilities?.[0]
      if (cap?.label) cap.label = cap.label.replace(/ fine$/, '')
    }
  }
  const pbNames = new Set(raws.map((r) => r.name))
  raws.forEach((fine, i) => {
    if (fine.byte !== 1) return
    const coarsePreset = channelPreset(fine.preset)?.coarse
    const coarseChannels = raws.filter((r) => r !== fine && r.byte !== 1)
    // "BeamZoomFine" pairs with "BeamZoomSmallBig"; otherwise any channel of the same group
    let candidates = coarsePreset ? coarseChannels.filter((r) => r.preset.startsWith(coarsePreset)) : []
    if (candidates.length === 0) candidates = coarseChannels.filter((r) => r.group.toLowerCase() === fine.group.toLowerCase())
    // Prefer a coarse channel present in every mode that uses the fine one
    const fineModes = modeLists.filter((l) => l.includes(fine.qlcName))
    const together = fineModes.length ? candidates.filter((r) => fineModes.every((l) => l.includes(r.qlcName))) : []
    const byName = (list: Raw[]) => list.find((r) => pairsByName(fine.qlcName, r.qlcName)) ?? list.find((r) => stemOf(r.qlcName) === stemOf(fine.qlcName))
    const nearestInMode = (): Raw | undefined => {
      const l = fineModes[0]
      if (!l) return undefined
      for (let j = l.indexOf(fine.qlcName) - 1; j >= 0; j--) {
        const r = together.find((c) => c.qlcName === l[j])
        if (r) return r
      }
      return undefined
    }
    const coarse = byName(together)
      ?? byName(candidates)
      ?? nearestInMode()
      ?? together[0]
      ?? [...candidates].reverse().find((r) => raws.indexOf(r) < i)
      ?? candidates[0]
    if (!coarse) return
    fine.ch.type = coarse.ch.type
    fine.ch.precedence = coarse.ch.precedence
    delete fine.ch.highlightValue
    fine.ch.capabilities = undefined
    if (!pairsByName(fine.name, coarse.name)) {
      // "Pan coarse" + "Pan fine" → "Pan" + "Pan fine"; otherwise "<coarse> fine"
      const stripped = coarse.name.replace(/\s*[-_(]?\s*(coarse|msb|8-?bit)\)?\s*$/i, '').trim()
      if (stripped && stripped !== coarse.name && pairsByName(fine.name, stripped) && !pbNames.has(stripped)) {
        pbNames.delete(coarse.name)
        for (const r of raws) if (r.ch.fineOf === coarse.name) r.ch.fineOf = stripped
        coarse.name = stripped
        coarse.ch.name = stripped
        pbNames.add(stripped)
      } else {
        pbNames.delete(fine.name)
        fine.name = uniqueName(`${coarse.name} fine`, pbNames)
        pbNames.add(fine.name)
      }
    }
    fine.ch.name = fine.name
    fine.ch.fineOf = coarse.name
    coarse.ch.fineChannelAliases = [...(coarse.ch.fineChannelAliases ?? []), fine.name]
  })
  for (const r of raws) if (!r.ch.capabilities) delete r.ch.capabilities

  // ---- physical (fixture level, else the first mode's) ----
  const physNode: Json | undefined = fd.Physical ?? list(fd.Mode).find((m) => m.Physical)?.Physical
  const physical = convertPhysical(physNode)
  const layoutNode = physNode?.Layout
  const grid = layoutNode ? { columns: int(layoutNode['@_Width'], 1), rows: int(layoutNode['@_Height'], 1) } : undefined

  // ---- modes ----
  const channels: Record<string, FixtureChannel> = {}
  const modes: FixtureMode[] = []
  for (const m of list(fd.Mode)) {
    const refs = list(m.Channel).map((ref, i) => ({ number: int(typeof ref === 'object' ? ref['@_Number'] : undefined, i), name: text(ref).trim() }))
    refs.sort((a, b) => a.number - b.number)
    const modeChannels: string[] = []
    for (const ref of refs) {
      const raw = byQlcName.get(ref.name)
      if (!raw) continue
      channels[raw.name] = raw.ch
      modeChannels.push(raw.name)
    }
    if (modeChannels.length === 0) continue
    const mode: FixtureMode = { name: String(m['@_Name'] ?? 'Default').trim() || 'Default', channels: modeChannels, channelCount: modeChannels.length }
    const heads = list(m.Head).map((h) => list(h?.Channel).map((c) => int(text(c), -1)).filter((n) => n >= 0 && n < modeChannels.length))
    if (heads.length > 1) {
      const layout = pixelLayoutFromCells(mode, heads, grid)
      if (layout) mode.pixelLayout = layout
    }
    modes.push(mode)
  }
  if (modes.length === 0) {
    if (raws.length === 0) throw new Error('No channels')
    for (const r of raws) channels[r.name] = r.ch
    modes.push({ name: 'Default', channels: raws.map((r) => r.name), channelCount: raws.length })
  }
  // Unique mode names (the console selects modes by name)
  const seenModes = new Set<string>()
  for (const mode of modes) {
    mode.name = uniqueName(mode.name, seenModes)
    seenModes.add(mode.name)
  }

  const def: FixtureDefinition = {
    id: opts.id ?? `${slugify(qlcManufacturer)}/${slugify(model)}`,
    name: model,
    manufacturer,
    categories: QLC_TYPE_TO_CATEGORIES[qlcType] ?? (qlcType ? [qlcType] : ['Other']),
    channels,
    modes
  }
  if (physical) def.physical = physical
  def.source = opts.source ?? 'qlcplus'
  if (opts.sourceUrl) def.sourceUrl = opts.sourceUrl
  if (opts.stampNow) def.lastModified = new Date().toISOString()
  if (opts.catalog) def.catalog = opts.catalog
  return def
}

function groupOfPreset(preset: string): string {
  if (/^Intensity/.test(preset)) return 'Intensity'
  if (/^Position(Pan|XAxis)/.test(preset)) return 'Pan'
  if (/^Position(Tilt|YAxis)/.test(preset)) return 'Tilt'
  if (/^Speed/.test(preset)) return 'Speed'
  if (/^Color/.test(preset)) return 'Colour'
  if (/^Gobo/.test(preset)) return 'Gobo'
  if (/^Shutter/.test(preset)) return 'Shutter'
  if (/^Beam/.test(preset)) return 'Beam'
  if (/^Prism/.test(preset)) return 'Prism'
  if (preset === 'NoFunction') return 'Nothing'
  return 'Effect'
}

function convertPhysical(p: Json | undefined): FixturePhysical | undefined {
  if (!p || typeof p !== 'object') return undefined
  const dims = p.Dimensions
  const bulb = p.Bulb
  const lens = p.Lens
  const focus = p.Focus
  const tech = p.Technical
  const w = float(dims?.['@_Width'])
  const h = float(dims?.['@_Height'])
  const d = float(dims?.['@_Depth'])
  const physical = compact<FixturePhysical>({
    dimensions: w || h || d ? [w ?? 0, h ?? 0, d ?? 0] : undefined,
    weight: float(dims?.['@_Weight']),
    power: float(tech?.['@_PowerConsumption']) ?? float(bulb?.['@_PowerConsumption']),
    DMXconnector: typeof tech?.['@_DmxConnector'] === 'string' && tech['@_DmxConnector'] !== 'Other' ? tech['@_DmxConnector'] : undefined,
    bulb: bulb ? compact({
      type: typeof bulb['@_Type'] === 'string' && bulb['@_Type'] && bulb['@_Type'] !== 'Other' ? bulb['@_Type'] : undefined,
      lumens: float(bulb['@_Lumens']),
      colorTemperature: float(bulb['@_ColourTemperature'])
    }) : undefined,
    lens: lens && (float(lens['@_DegreesMin']) || float(lens['@_DegreesMax']))
      ? { degreesMinMax: [float(lens['@_DegreesMin']) ?? 0, float(lens['@_DegreesMax']) ?? 0] as [number, number] }
      : undefined,
    panRange: float(focus?.['@_PanMax']),
    tiltRange: float(focus?.['@_TiltMax'])
  })
  if (physical.bulb && Object.keys(physical.bulb).length === 0) delete physical.bulb
  return Object.keys(physical).length ? physical : undefined
}
