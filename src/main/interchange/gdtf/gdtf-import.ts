// ============================================================
// PhotonBoard — GDTF (DIN SPEC 15800) → FixtureDefinition
//
// Reads description.xml of GDTF 1.0 … 1.2:
//   • DMX channels with multi-byte Offset ("1,2") → coarse + fine
//     channels (fineOf / fineChannelAliases), footprint by offset
//     (gaps become "No function" placeholders)
//   • Geometry references (LED bars / pixel fixtures): channels of
//     a referenced geometry are expanded per reference with its
//     Break DMXOffset → numbered channels + pixel layout
//   • Channel functions / channel sets → capabilities (scaled to
//     the coarse 8-bit channel; wheel slots linked to wheels)
//   • Wheels (colours from CIE xyY, gobo images, prism facets)
//   • Physical data: weight, power, lamp, beam / zoom angle,
//     pan / tilt range, dimensions
// Only DMX break 1 (the first break) makes the footprint: the
// console patches one address per fixture.
// Pure (no fs): the archive is read from memory with adm-zip.
// ============================================================

import AdmZip from 'adm-zip'
import type {
  FixtureCapability,
  FixtureChannel,
  FixtureDefinition,
  FixtureMode,
  FixturePhysical,
  FixtureWheel,
  FixtureWheelSlot
} from '../../../shared/types'
import { detectPixelLayout } from '../../../shared/types'
import { clampByte, compact, defaultPrecedence, pixelLayoutFromCells, slugify, uniqueName } from '../../fixture-convert-common'
import { cieTextToHex } from './color'
import { gdtfCapabilityType, gdtfChannelType, gdtfFriendlyName, isContinuousAttribute } from './gdtf-names'
import { attr, kid, kids, parseXml, type XNode } from './xml'

export interface GdtfParseResult {
  definition: FixtureDefinition
  /** Things that could not be represented (English, for import warnings) */
  notes: string[]
  /** GDTF FixtureTypeID (GUID) when present */
  fixtureTypeId?: string
}

/** Max size of description.xml we accept (zip-bomb guard) */
const MAX_DESCRIPTION_BYTES = 32 * 1024 * 1024

// ---------------------------------------------------------------
// Archive
// ---------------------------------------------------------------

/** True when the bytes look like a ZIP archive */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06)
}

/** Read description.xml out of a .gdtf archive; throws when it is not one */
export function readGdtfDescription(bytes: Uint8Array): string {
  if (!isZip(bytes)) throw new Error('Not a GDTF file (not a ZIP archive)')
  const zip = new AdmZip(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const entry = zip.getEntries().find((e) => e.entryName.replace(/^\.?\//, '').toLowerCase() === 'description.xml')
  if (!entry) throw new Error('Not a GDTF file (no description.xml)')
  if (entry.header.size > MAX_DESCRIPTION_BYTES) throw new Error('GDTF description.xml is too large')
  return entry.getData().toString('utf-8')
}

/** Parse a .gdtf archive (bytes) into a definition */
export function parseGdtfArchive(bytes: Uint8Array, fileName?: string): GdtfParseResult {
  return parseGdtfDescription(readGdtfDescription(bytes), { fileName })
}

// ---------------------------------------------------------------
// DMX values
// ---------------------------------------------------------------

/**
 * GDTF DMXValue "v/n" (byte mirroring) or "v/ns" (byte shifting), converted
 * to a channel of `resolution` bytes. A bare integer is taken as 1 byte.
 */
export function parseDmxValue(raw: string | undefined, resolution: number): number | null {
  if (raw === undefined) return null
  const s = raw.trim()
  if (!s || /^none$/i.test(s)) return null
  const m = /^(\d+)(?:\/(\d+)(s?))?$/.exec(s)
  if (!m) return null
  const v = parseInt(m[1], 10)
  const n = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1
  const shift = m[3] === 's'
  const res = Math.max(1, resolution)
  const max = Math.pow(256, res) - 1
  if (n === res) return Math.min(v, max)
  if (n > res) return Math.min(Math.floor(v / Math.pow(256, n - res)), max)
  if (shift) return Math.min(v * Math.pow(256, res - n), max)
  // Byte mirroring: 255/1 in 16 bit → 65535; 128/1 → 0x8080
  const bytes: number[] = []
  let x = v
  for (let i = 0; i < n; i++) { bytes.unshift(x % 256); x = Math.floor(x / 256) }
  let out = 0
  for (let i = 0; i < res; i++) out = out * 256 + bytes[i % n]
  return Math.min(out, max)
}

/** Coarse (most significant) byte of a value of `resolution` bytes */
function coarse(value: number, resolution: number): number {
  return clampByte(Math.floor(value / Math.pow(256, Math.max(0, resolution - 1))))
}

// ---------------------------------------------------------------
// Geometry tree
// ---------------------------------------------------------------

interface GeoInfo {
  name: string
  tag: string
  node: XNode
  parent: string | null
  top: string
  model?: string
  /** GeometryReference: referenced top-level geometry and its breaks */
  ref?: { geometry: string; breaks: { dmxBreak: number; offset: number }[] }
}

const GEOMETRY_TAGS = ['Geometry', 'Axis', 'FilterBeam', 'FilterColor', 'FilterGobo', 'FilterShaper', 'Beam', 'MediaServerLayer', 'MediaServerCamera', 'MediaServerMaster', 'Display', 'GeometryReference', 'Laser', 'WiringObject', 'Inventory', 'Structure', 'Support', 'Magnet']

function walkGeometries(node: XNode | undefined, parent: string | null, top: string | null, out: Map<string, GeoInfo>, order: string[]): void {
  if (!node) return
  for (const tag of GEOMETRY_TAGS) {
    for (const g of kids(node, tag)) {
      const name = attr(g, 'Name') ?? `${tag} ${out.size + 1}`
      const info: GeoInfo = { name, tag, node: g, parent, top: top ?? name, model: attr(g, 'Model') }
      if (tag === 'GeometryReference') {
        const breaks = kids(g, 'Break').map((b) => ({
          dmxBreak: parseInt(attr(b, 'DMXBreak') ?? '1', 10) || 1,
          offset: parseInt(attr(b, 'DMXOffset') ?? '1', 10) || 1
        }))
        info.ref = { geometry: attr(g, 'Geometry') ?? '', breaks }
      }
      if (!out.has(name)) {
        out.set(name, info)
        order.push(name)
      }
      walkGeometries(g, name, top ?? name, out, order)
    }
  }
}

/** Geometry names of the subtree rooted at `root` (inclusive), in document order */
function subtree(root: string, geos: Map<string, GeoInfo>, order: string[]): string[] {
  const inside = new Set<string>([root])
  const out: string[] = []
  for (const name of order) {
    const g = geos.get(name)!
    if (name === root || (g.parent && inside.has(g.parent))) {
      inside.add(name)
      out.push(name)
    }
  }
  return out
}

// ---------------------------------------------------------------
// Converter
// ---------------------------------------------------------------

interface ChannelInstance {
  dmxBreak: number
  offsets: number[]
  attribute: string
  dmxChannel: XNode
  logical: XNode[]
  geometry: string
  /** GeometryReference name when expanded from a reference */
  reference?: string
}

interface CfRange {
  cf: XNode
  attribute: string
  from: number
  to: number
}

export function parseGdtfDescription(xml: string, opts: { fileName?: string } = {}): GdtfParseResult {
  const doc = parseXml(xml)
  const root = kid(doc, 'GDTF')
  const ft = kid(root, 'FixtureType') ?? kid(doc, 'FixtureType')
  if (!ft) throw new Error('Not a GDTF description (no FixtureType)')
  const notes: string[] = []

  const baseFile = (opts.fileName ?? '').replace(/^.*[\\/]/, '').replace(/\.gdtf$/i, '')
  const [fileMfr, fileName] = baseFile.split('@')
  const name = attr(ft, 'Name') || attr(ft, 'LongName') || attr(ft, 'ShortName') || fileName || 'GDTF Fixture'
  const manufacturer = attr(ft, 'Manufacturer') || fileMfr || 'Unknown'
  const shortName = attr(ft, 'ShortName')

  // ---- attribute definitions (features of custom attributes) ----
  const featureOf = new Map<string, string>()
  const physicalUnitOf = new Map<string, string>()
  for (const a of kids(kid(kid(ft, 'AttributeDefinitions'), 'Attributes'), 'Attribute')) {
    const n = attr(a, 'Name')
    if (!n) continue
    const f = attr(a, 'Feature')
    if (f) featureOf.set(n, f)
    const u = attr(a, 'PhysicalUnit')
    if (u) physicalUnitOf.set(n, u)
  }

  // ---- wheels ----
  interface WheelInfo { name: string; slots: { name: string; color?: string; media?: string; facets: number }[] }
  const wheelInfos: WheelInfo[] = kids(kid(ft, 'Wheels'), 'Wheel').map((w, i) => ({
    name: attr(w, 'Name') || `Wheel ${i + 1}`,
    slots: kids(w, 'Slot').map((s, j) => ({
      name: attr(s, 'Name') || `Slot ${j + 1}`,
      color: attr(s, 'Color') ? cieTextToHex(attr(s, 'Color')) : undefined,
      media: attr(s, 'MediaFileName') || undefined,
      facets: kids(s, 'Facet').length
    }))
  }))
  const wheelByName = new Map(wheelInfos.map((w) => [w.name, w]))
  const wheelUse = new Map<string, string>() // wheel → attribute that selects it

  // ---- geometry / models ----
  const geos = new Map<string, GeoInfo>()
  const geoOrder: string[] = []
  const geometriesNode = kid(ft, 'Geometries')
  walkGeometries(geometriesNode, null, null, geos, geoOrder)
  const models = new Map<string, { length: number; width: number; height: number }>()
  for (const m of kids(kid(ft, 'Models'), 'Model')) {
    const n = attr(m, 'Name')
    if (n) models.set(n, { length: Number(attr(m, 'Length')) || 0, width: Number(attr(m, 'Width')) || 0, height: Number(attr(m, 'Height')) || 0 })
  }

  // ---- DMX modes ----
  const channels: Record<string, FixtureChannel> = {}
  const modes: FixtureMode[] = []
  const physicalRanges: { pan?: number; tilt?: number; zoom?: [number, number] } = {}
  let hasMirror = false

  const modeNodes = kids(kid(ft, 'DMXModes'), 'DMXMode')
  const usedModeNames = new Set<string>()
  for (const [modeIndex, modeNode] of modeNodes.entries()) {
    const modeName = uniqueName(attr(modeNode, 'Name') || `Mode ${modeIndex + 1}`, usedModeNames)
    usedModeNames.add(modeName)
    const modeRoot = attr(modeNode, 'Geometry') ?? geoOrder.find((g) => geos.get(g)?.parent === null) ?? ''
    const inMode = new Set(subtree(modeRoot, geos, geoOrder))
    // References inside this mode's tree, grouped by the geometry they reference
    const refsByTarget = new Map<string, GeoInfo[]>()
    for (const g of geoOrder) {
      const info = geos.get(g)!
      if (info.ref && inMode.has(g)) {
        const list = refsByTarget.get(info.ref.geometry) ?? []
        list.push(info)
        refsByTarget.set(info.ref.geometry, list)
      }
    }

    // Expand every DMX channel into instances (one per geometry reference)
    const instances: ChannelInstance[] = []
    let virtualCount = 0
    for (const dc of kids(kid(modeNode, 'DMXChannels'), 'DMXChannel')) {
      const logical = kids(dc, 'LogicalChannel')
      const offsetText = (attr(dc, 'Offset') ?? '').trim()
      const offsets = /^none$/i.test(offsetText) || !offsetText ? [] : offsetText.split(',').map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x) && x > 0)
      const attribute = attr(logical[0], 'Attribute') ?? attr(kid(logical[0], 'ChannelFunction'), 'Attribute') ?? 'NoFeature'
      if (offsets.length === 0) { virtualCount++; continue }
      const geometry = attr(dc, 'Geometry') ?? modeRoot
      const breakText = attr(dc, 'DMXBreak') ?? '1'
      const overwrite = /^overwrite$/i.test(breakText)
      const dmxBreak = parseInt(breakText, 10) || 1
      if (geos.get(geometry)?.tag === 'Beam' && /mirror/i.test(geometry)) hasMirror = true
      const refs = refsByTarget.get(geometry) ?? []
      if (refs.length > 0) {
        for (const ref of refs) {
          const breaks = ref.ref!.breaks
          const b = overwrite ? breaks[breaks.length - 1] : breaks.find((x) => x.dmxBreak === dmxBreak) ?? breaks[0]
          const shift = (b?.offset ?? 1) - 1
          instances.push({ dmxBreak: overwrite ? b?.dmxBreak ?? 1 : dmxBreak, offsets: offsets.map((o) => o + shift), attribute, dmxChannel: dc, logical, geometry, reference: ref.name })
        }
      } else {
        instances.push({ dmxBreak, offsets, attribute, dmxChannel: dc, logical, geometry })
      }
    }
    if (virtualCount > 0) notes.push(`Mode "${modeName}": ${virtualCount} virtual channel(s) without DMX address ignored`)

    const breaks = [...new Set(instances.map((i) => i.dmxBreak))].sort((a, b) => a - b)
    const mainBreak = breaks[0] ?? 1
    if (breaks.length > 1) notes.push(`Mode "${modeName}" uses ${breaks.length} DMX breaks; only break ${mainBreak} is patched (the console has one address per fixture)`)
    const used = instances.filter((i) => i.dmxBreak === mainBreak).sort((a, b) => a.offsets[0] - b.offsets[0])

    // Names: numbered when an attribute appears on several geometries / references
    const baseCount = new Map<string, number>()
    for (const inst of used) {
      const base = gdtfFriendlyName(inst.attribute)
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
    }
    const baseSeen = new Map<string, number>()
    const footprint = used.reduce((max, i) => Math.max(max, ...i.offsets), 0)
    const slots: (string | null)[] = new Array(footprint).fill(null)
    const modeTaken = new Set<string>()
    const cellsByRef = new Map<string, number[]>()
    let overlaps = 0

    for (const inst of used) {
      const base = gdtfFriendlyName(inst.attribute)
      let chName = base
      if ((baseCount.get(base) ?? 0) > 1) {
        const k = (baseSeen.get(base) ?? 0) + 1
        baseSeen.set(base, k)
        chName = `${base} ${k}`
      }
      chName = uniqueName(chName, modeTaken)
      if (inst.offsets.some((o) => slots[o - 1] !== null)) { overlaps++; continue }
      modeTaken.add(chName)
      const resolution = inst.offsets.length
      const def = channels[chName] ?? buildChannel(chName, inst, resolution)
      channels[chName] ??= def
      slots[inst.offsets[0] - 1] = chName
      const fineNames: string[] = []
      inst.offsets.slice(1).forEach((o, i) => {
        const fineName = uniqueName(i === 0 ? `${chName} fine` : `${chName} fine ${i + 1}`, modeTaken)
        modeTaken.add(fineName)
        fineNames.push(fineName)
        slots[o - 1] = fineName
        if (!channels[fineName]) {
          channels[fineName] = compact<FixtureChannel>({
            name: fineName,
            type: def.type,
            precedence: def.precedence,
            fineOf: chName,
            defaultValue: fineDefault(inst, resolution, i + 1)
          })
        }
      })
      if (fineNames.length && !def.fineChannelAliases?.length) def.fineChannelAliases = fineNames
      if (inst.reference) {
        const cell = cellsByRef.get(inst.reference) ?? []
        cell.push(...inst.offsets.map((o) => o - 1))
        cellsByRef.set(inst.reference, cell)
      }
    }
    if (overlaps > 0) notes.push(`Mode "${modeName}": ${overlaps} channel(s) sharing a DMX offset were skipped`)

    // Gaps → placeholders
    const modeChannels = slots.map((s) => {
      if (s) return s
      const placeholder = uniqueName('No function', modeTaken)
      modeTaken.add(placeholder)
      channels[placeholder] ??= { name: placeholder, type: 'generic', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'NoFunction', label: 'No function' }] }
      return placeholder
    })
    const mode: FixtureMode = { name: modeName, channels: modeChannels, channelCount: modeChannels.length }
    const cells = [...cellsByRef.values()]
    const layout = cells.length >= 2 ? pixelLayoutFromCells(mode, cells) : detectPixelLayout(modeChannels)
    if (layout) mode.pixelLayout = layout
    modes.push(mode)
  }

  if (modes.length === 0) notes.push('The GDTF file has no DMX mode')

  // ---- wheels with slot types from their use ----
  const wheels: FixtureWheel[] = wheelInfos.map((w) => {
    const use = wheelUse.get(w.name) ?? ''
    const kind: FixtureWheelSlot['type'] = /^Color/.test(use) ? 'Color'
      : /^Prism/.test(use) ? 'Prism'
        : /^Animation/.test(use) ? 'Animation'
          : /^Frost/.test(use) ? 'Frost'
            : /^Iris/.test(use) ? 'Iris'
              : /^Gobo/.test(use) ? 'Gobo'
                : w.slots.some((s) => s.color && s.color !== '#ffffff') ? 'Color' : 'Gobo'
    return {
      name: w.name,
      slots: w.slots.map((s) => {
        let type: FixtureWheelSlot['type'] = kind
        if (/^open$/i.test(s.name) || (/\bopen\b/i.test(s.name) && !s.media)) type = 'Open'
        else if (/^closed?$/i.test(s.name)) type = 'Closed'
        return compact<FixtureWheelSlot>({
          type,
          name: s.name,
          color: kind === 'Color' ? s.color : undefined,
          imageFile: s.media,
          facets: kind === 'Prism' && s.facets > 0 ? s.facets : undefined
        })
      })
    }
  })

  // ---- physical ----
  const physical: FixturePhysical = {}
  const props = kid(kid(ft, 'PhysicalDescriptions'), 'Properties')
  const weight = Number(attr(kid(props, 'Weight'), 'Value'))
  if (weight > 0) physical.weight = weight
  const power = Number(attr(kid(props, 'PowerConsumption'), 'Value'))
  if (power > 0) physical.power = power
  const topGeo = geoOrder.map((g) => geos.get(g)!).find((g) => g.parent === null)
  const topModel = topGeo?.model ? models.get(topGeo.model) : undefined
  if (topModel && (topModel.length > 0 || topModel.height > 0)) {
    // GDTF: Length = X, Width = Y (depth), Height = Z (up), metres → [w, h, d] mm
    physical.dimensions = [Math.round(topModel.length * 1000), Math.round(topModel.height * 1000), Math.round(topModel.width * 1000)]
  }
  const beam = geoOrder.map((g) => geos.get(g)!).find((g) => g.tag === 'Beam')
  if (beam) {
    const lampType = attr(beam.node, 'LampType')
    const flux = Number(attr(beam.node, 'LuminousFlux'))
    const ct = Number(attr(beam.node, 'ColorTemperature'))
    const bulb = compact({ type: lampType || undefined, lumens: flux > 0 ? flux : undefined, colorTemperature: ct > 0 ? ct : undefined })
    if (Object.keys(bulb).length) physical.bulb = bulb
    const beamPower = Number(attr(beam.node, 'PowerConsumption'))
    if (!physical.power && beamPower > 0) physical.power = beamPower
    const beamAngle = Number(attr(beam.node, 'BeamAngle'))
    if (!physicalRanges.zoom && beamAngle > 0) physical.lens = { degreesMinMax: [beamAngle, beamAngle] }
  }
  if (physicalRanges.zoom) physical.lens = { degreesMinMax: physicalRanges.zoom }
  if (physicalRanges.pan) physical.panRange = physicalRanges.pan
  if (physicalRanges.tilt) physical.tiltRange = physicalRanges.tilt

  const revisions = kids(kid(ft, 'Revisions'), 'Revision')
  const lastDate = revisions.map((r) => attr(r, 'Date')).filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).pop()

  const definition: FixtureDefinition = {
    id: `${slugify(manufacturer) || 'unknown'}/${slugify(name) || 'gdtf-fixture'}`,
    name,
    manufacturer,
    categories: inferCategories(channels, modes, hasMirror),
    channels,
    modes,
    source: 'gdtf',
    lastModified: lastDate ? new Date(lastDate + (/[zZ]|[+-]\d\d:?\d\d$/.test(lastDate) ? '' : 'Z')).toISOString() : new Date().toISOString()
  }
  if (shortName && shortName !== name) definition.shortName = shortName
  if (Object.keys(physical).length) definition.physical = physical
  if (wheels.length) definition.wheels = wheels
  return { definition, notes, fixtureTypeId: attr(ft, 'FixtureTypeID') || undefined }

  // ---- helpers (closures over wheels / attribute features) ----

  function initialDefault(inst: ChannelInstance, resolution: number): number | null {
    const raw = attr(inst.dmxChannel, 'Default')
    const v = parseDmxValue(raw, resolution)
    if (v !== null) return v
    // GDTF 1.2: the initial channel function's default
    const initial = attr(inst.dmxChannel, 'InitialFunction')
    const cfs = inst.logical.flatMap((lc) => kids(lc, 'ChannelFunction'))
    const cfName = initial?.split('.').pop()
    const cf = (cfName && cfs.find((c) => attr(c, 'Name') === cfName)) || cfs[0]
    return parseDmxValue(attr(cf, 'Default'), resolution)
  }

  function fineDefault(inst: ChannelInstance, resolution: number, byteIndex: number): number | undefined {
    const v = initialDefault(inst, resolution)
    if (v === null) return undefined
    return clampByte(Math.floor(v / Math.pow(256, resolution - 1 - byteIndex)) % 256)
  }

  function buildChannel(chName: string, inst: ChannelInstance, resolution: number): FixtureChannel {
    const type = gdtfChannelType(inst.attribute, featureOf.get(inst.attribute))
    const ch: FixtureChannel = { name: chName, type, precedence: defaultPrecedence(type) }
    const def = initialDefault(inst, resolution)
    if (def !== null) ch.defaultValue = coarse(def, resolution)
    else if (type === 'pan' || type === 'tilt') ch.defaultValue = 128
    const hl = parseDmxValue(attr(inst.dmxChannel, 'Highlight'), resolution)
    if (hl !== null) ch.highlightValue = coarse(hl, resolution)
    else if (type === 'intensity') ch.highlightValue = 255
    if (inst.dmxBreak > 1) ch.dmxBreak = inst.dmxBreak
    const caps = capabilitiesOf(inst, resolution)
    if (caps.length) ch.capabilities = caps
    return ch
  }

  function capabilitiesOf(inst: ChannelInstance, resolution: number): FixtureCapability[] {
    const max = Math.pow(256, resolution) - 1
    // Channel functions of the first logical channel make the ranges; other
    // logical channels (mutually exclusive alternatives) only when they do not overlap
    const ranges: CfRange[] = []
    let modeDependent = 0
    for (const lc of inst.logical) {
      const lcAttr = attr(lc, 'Attribute') ?? inst.attribute
      const cfs = kids(lc, 'ChannelFunction')
      let lastFrom = -1
      const local: CfRange[] = []
      for (const cf of cfs) {
        const from = parseDmxValue(attr(cf, 'DMXFrom') ?? '0/1', resolution) ?? 0
        // Mode-dependent alternatives (ModeMaster) restart the range: keep the first block
        if (from <= lastFrom) { modeDependent++; continue }
        lastFrom = from
        local.push({ cf, attribute: attr(cf, 'Attribute') || lcAttr, from, to: max })
      }
      for (let i = 0; i < local.length; i++) local[i].to = i + 1 < local.length ? Math.max(local[i].from, local[i + 1].from - 1) : max
      for (const r of local) {
        if (ranges.some((x) => r.from <= x.to && r.to >= x.from)) { modeDependent++; continue }
        ranges.push(r)
      }
    }
    if (modeDependent > 0) notes.push(`Channel "${gdtfFriendlyName(inst.attribute)}": ${modeDependent} mode-dependent function(s) not represented`)
    ranges.sort((a, b) => a.from - b.from)

    const caps: FixtureCapability[] = []
    for (const r of ranges) {
      const cfName = attr(r.cf, 'Name') ?? ''
      const original = attr(r.cf, 'OriginalAttribute') ?? ''
      const wheelName = attr(r.cf, 'Wheel')
      const wheel = wheelName ? wheelByName.get(wheelName) : undefined
      if (wheel && !wheelUse.has(wheel.name)) wheelUse.set(wheel.name, r.attribute)
      const unit = physicalUnitOf.get(r.attribute)
      const pFrom = Number(attr(r.cf, 'PhysicalFrom'))
      const pTo = Number(attr(r.cf, 'PhysicalTo'))
      recordPhysical(r.attribute, pFrom, pTo)
      const cfLabel = labelOf(cfName, r.attribute, original, unit, pFrom, pTo)

      const sets = kids(r.cf, 'ChannelSet').map((s) => ({
        name: attr(s, 'Name') ?? '',
        from: parseDmxValue(attr(s, 'DMXFrom') ?? '', resolution),
        slot: parseInt(attr(s, 'WheelSlotIndex') ?? '0', 10) || 0
      })).filter((s): s is { name: string; from: number; slot: number } => s.from !== null && s.from >= r.from && s.from <= r.to)
      const wheelSets = wheel ? sets.filter((s) => s.slot > 0) : []
      sets.sort((a, b) => a.from - b.from)
      // Sets that are mere markers ("slow" / "fast" / "home": one coarse DMX value) do not split the range
      const coarseWidth = (i: number) => {
        const to = i + 1 < sets.length ? sets[i + 1].from - 1 : r.to
        return coarse(Math.max(sets[i].from, to), resolution) - coarse(sets[i].from, resolution) + 1
      }
      const markersOnly = sets.filter((s) => s.name).every((s) => coarseWidth(sets.indexOf(s)) <= 1)
      const useSets = wheelSets.length > 0 || (!isContinuousAttribute(r.attribute) && sets.some((s) => s.name) && !markersOnly)
      if (!useSets) {
        caps.push(makeCap(r.from, r.to, r.attribute, cfLabel, wheel, 0))
        continue
      }
      if (sets[0].from > r.from) caps.push(makeCap(r.from, sets[0].from - 1, r.attribute, cfLabel, wheel, 0))
      sets.forEach((s, i) => {
        const to = i + 1 < sets.length ? Math.max(s.from, sets[i + 1].from - 1) : r.to
        const slotName = wheel && s.slot > 0 ? wheel.slots[s.slot - 1]?.name : undefined
        caps.push(makeCap(s.from, to, r.attribute, s.name || slotName || cfLabel, wheel, s.slot))
      })
    }
    // Scale to the coarse byte; merge ranges that collapse onto the same 8-bit values
    const out: FixtureCapability[] = []
    for (const c of caps) {
      const lo = coarse(c.dmxRange[0], resolution)
      const hi = Math.max(lo, coarse(c.dmxRange[1], resolution))
      const prev = out[out.length - 1]
      if (prev && lo <= prev.dmxRange[1]) {
        // Collapsed into the previous 8-bit range (fine-resolution markers): extend it
        if (hi > prev.dmxRange[1]) prev.dmxRange[1] = hi
        continue
      }
      out.push({ ...c, dmxRange: [lo, hi] })
    }
    return out
  }

  function makeCap(from: number, to: number, attribute: string, label: string, wheel: WheelInfo | undefined, slot: number): FixtureCapability {
    const slotInfo = wheel && slot > 0 ? wheel.slots[slot - 1] : undefined
    const type = gdtfCapabilityType(attribute, label, !!slotInfo)
    let color: string | undefined
    if (type === 'ColorIntensity') color = EMITTER_HEX[attribute]
    else if (slotInfo?.color && /^Color/.test(attribute)) color = slotInfo.color
    return compact<FixtureCapability>({
      dmxRange: [from, to],
      type,
      label,
      color,
      wheel: slotInfo ? wheel!.name : undefined,
      wheelSlot: slotInfo ? slot : undefined,
      image: slotInfo?.media
    })
  }

  function recordPhysical(attribute: string, from: number, to: number): void {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return
    const span = Math.abs(to - from)
    if (attribute === 'Pan' && !physicalRanges.pan && span >= 10) physicalRanges.pan = Math.round(span * 10) / 10
    else if (attribute === 'Tilt' && !physicalRanges.tilt && span >= 10) physicalRanges.tilt = Math.round(span * 10) / 10
    else if (attribute === 'Zoom' && !physicalRanges.zoom && Math.min(from, to) > 0 && Math.max(from, to) < 180) {
      physicalRanges.zoom = [Math.min(from, to), Math.max(from, to)]
    }
  }
}

/** Additive emitter colours of the ColorAdd_* attributes */
const EMITTER_HEX: Record<string, string> = {
  ColorAdd_R: '#ff0000',
  ColorAdd_G: '#00ff00',
  ColorAdd_B: '#0000ff',
  ColorAdd_W: '#ffffff',
  ColorAdd_WW: '#ffd9a0',
  ColorAdd_CW: '#dceeff',
  ColorAdd_RY: '#ffbf00',
  ColorAdd_GY: '#bfff00',
  ColorAdd_UV: '#7f00ff',
  ColorAdd_C: '#00ffff',
  ColorAdd_M: '#ff00ff',
  ColorAdd_Y: '#ffff00',
  ColorAdd_GC: '#00ff9f',
  ColorAdd_BC: '#5fbfff',
  ColorAdd_BM: '#4b0082',
  ColorAdd_RM: '#ff5fa0',
  ColorSub_C: '#00ffff',
  ColorSub_M: '#ff00ff',
  ColorSub_Y: '#ffff00'
}

function labelOf(cfName: string, attribute: string, original: string, unit: string | undefined, pFrom: number, pTo: number): string {
  // GDTF's default channel function name is "<Attribute> <n>"; prefer a friendly label then
  const isDefault = !cfName || cfName === attribute || new RegExp(`^${attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\d*$`).test(cfName)
  let label = isDefault ? (original && original !== attribute ? original : gdtfFriendlyName(attribute)) : cfName
  // Pulse / random / effect strobes say so (the console only uses plain strobe ranges)
  const strobeKind = /^Shutter\d+Strobe(\w+)$/.exec(attribute)?.[1]
  if (strobeKind && !/pulse|random|effect|ramp/i.test(label)) label = `${label} (${strobeKind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()})`
  const isStrobe = /Strobe|Pulse|^StrobeRate$|^StrobeFrequency$/.test(attribute)
  if (isStrobe && Number.isFinite(pFrom) && Number.isFinite(pTo) && pFrom !== pTo && pFrom >= 0 && pTo >= 0 && (unit === undefined || unit === 'Frequency') && !/hz/i.test(label)) {
    const f = (v: number) => String(Math.round(v * 100) / 100)
    label = `${label} ${f(pFrom)}…${f(pTo)}Hz`
  }
  return label
}

function inferCategories(channels: Record<string, FixtureChannel>, modes: FixtureMode[], mirror: boolean): string[] {
  const types = new Set(Object.values(channels).map((c) => c.type))
  const names = Object.keys(channels).join(' ').toLowerCase()
  if (types.has('pan') && types.has('tilt')) return [mirror ? 'Scanner' : 'Moving Head']
  if (modes.some((m) => (m.pixelLayout?.cellCount ?? 0) >= 4)) return ['Pixel Bar']
  if (types.has('fog')) return [/haze/.test(names) ? 'Hazer' : 'Smoke']
  if (types.has('color')) return ['Color Changer']
  const meaningful = Object.values(channels).filter((c) => c.type !== 'generic' || !/^no function/i.test(c.name))
  if (meaningful.length > 0 && meaningful.every((c) => c.type === 'strobe' || c.type === 'shutter' || c.type === 'intensity') && (types.has('strobe') || types.has('shutter'))) return ['Strobe']
  if (meaningful.length > 0 && meaningful.every((c) => c.type === 'intensity')) return ['Dimmer']
  return ['Other']
}
