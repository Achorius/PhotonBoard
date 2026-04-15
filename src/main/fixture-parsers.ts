/**
 * Universal Fixture File Parsers
 *
 * Supports: OFL JSON, GDTF (.gdtf), QLC+ (.qxf), Avolites (.d4),
 *           GrandMA2/3 (.xml), CSV, PhotonBoard native JSON
 */

import { readFileSync, statSync } from 'fs'
import { XMLParser } from 'fast-xml-parser'
import AdmZip from 'adm-zip'
import type { FixtureDefinition, FixtureChannel, FixtureMode, FixtureCapability, FixturePhysical } from '../shared/types'

// Security: max file sizes to prevent denial-of-service
const MAX_FIXTURE_FILE_SIZE = 10 * 1024 * 1024  // 10 MB max fixture file
const MAX_GDTF_EXTRACTED_SIZE = 20 * 1024 * 1024 // 20 MB max extracted GDTF content

// Secure XML parser options — disable entity processing to prevent XXE attacks
const SAFE_XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,     // Disable entity processing (prevents XXE)
  htmlEntities: false,         // Disable HTML entity decoding
  allowBooleanAttributes: true,
} as const

// ── Helpers ──────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function inferType(name: string): FixtureChannel['type'] {
  const n = name.toLowerCase()
  if (n.includes('dimmer') || n.includes('intensity') || n.includes('brightness') || n === 'dim' || n === 'master') return 'intensity'
  if (n.includes('red') || n.includes('green') || n.includes('blue') || n.includes('white') ||
      n.includes('amber') || n.includes('uv') || n.includes('cyan') || n.includes('magenta') ||
      n.includes('yellow') || n.includes('cto') || n.includes('ctb') || n.includes('color') || n.includes('colour')) return 'color'
  if (n === 'pan' || n === 'pan fine' || n === 'panfine') return 'pan'
  if (n === 'tilt' || n === 'tilt fine' || n === 'tiltfine') return 'tilt'
  if (n.includes('gobo')) return 'gobo'
  if (n.includes('shutter') || n.includes('strobe')) return 'shutter'
  if (n.includes('prism')) return 'prism'
  if (n.includes('speed')) return 'speed'
  if (n.includes('fog') || n.includes('haze') || n.includes('smoke')) return 'fog'
  if (n.includes('effect') || n.includes('macro')) return 'effect'
  if (n.includes('reset') || n.includes('control') || n.includes('lamp') || n.includes('maintenance')) return 'maintenance'
  return 'generic'
}

function makePrecedence(type: FixtureChannel['type']): 'HTP' | 'LTP' {
  return type === 'intensity' ? 'HTP' : 'LTP'
}

function makeChannel(name: string, type?: FixtureChannel['type'], caps?: FixtureCapability[]): FixtureChannel {
  const t = type || inferType(name)
  return {
    name,
    type: t,
    defaultValue: (t === 'pan' || t === 'tilt') ? 128 : 0,
    highlightValue: t === 'intensity' ? 255 : undefined,
    precedence: makePrecedence(t),
    capabilities: caps?.length ? caps : undefined
  }
}

// ── Format Detection ─────────────────────────────────────────────────

export type FixtureFormat = 'ofl' | 'gdtf' | 'qlcplus' | 'avolites' | 'grandma' | 'csv' | 'native' | 'unknown'

export function detectFormat(filePath: string, rawContent?: string): FixtureFormat {
  const ext = filePath.toLowerCase().split('.').pop() || ''

  if (ext === 'gdtf') return 'gdtf'
  if (ext === 'qxf') return 'qlcplus'
  if (ext === 'd4' || ext === 'r20') return 'avolites'
  if (ext === 'csv' || ext === 'tsv') return 'csv'

  if (ext === 'xml') {
    // Detect by content
    const content = rawContent || readFileSync(filePath, 'utf-8')
    if (content.includes('<FixtureDefinition') && content.includes('xmlns="http://www.qlcplus.org')) return 'qlcplus'
    if (content.includes('<Personality') || content.includes('<PersonalityFile')) return 'avolites'
    if (content.includes('<MA ') || content.includes('<FixtureType') || content.includes('<Fixture ')) return 'grandma'
    if (content.includes('<GDTF') || content.includes('<FixtureType')) return 'gdtf'
    // Generic XML with channel-like structure
    if (content.includes('<Channel') || content.includes('<channel')) return 'grandma'
    return 'unknown'
  }

  if (ext === 'json') {
    const content = rawContent || readFileSync(filePath, 'utf-8')
    try {
      const data = JSON.parse(content)
      if (data.availableChannels || data.$schema?.includes('open-fixture-library')) return 'ofl'
      if (data.name && data.channels) return 'native'
    } catch { /* not valid JSON */ }
    return 'unknown'
  }

  return 'unknown'
}

// ── Parser: OFL JSON ─────────────────────────────────────────────────

export function parseOFL(data: any, manufacturer?: string): FixtureDefinition {
  const mfr = manufacturer || data.manufacturer?.name || 'Unknown'
  const name = data.name || 'Unknown Fixture'
  const id = `${slugify(mfr)}/${slugify(name)}`

  const channels: Record<string, FixtureChannel> = {}

  if (data.availableChannels) {
    for (const [chName, chDef] of Object.entries(data.availableChannels) as [string, any][]) {
      const type = inferType(chName)
      const rawCaps = chDef?.capability ? [chDef.capability] : chDef?.capabilities || []
      const capabilities: FixtureCapability[] = rawCaps.map((cap: any) => ({
        dmxRange: cap.dmxRange || [0, 255] as [number, number],
        type: cap.type || 'Generic',
        label: cap.comment || cap.type || chName,
        color: cap.color?.startsWith('#') ? cap.color : cap.colors?.allColors?.[0]
      }))

      channels[chName] = makeChannel(chName, type, capabilities)
      if (chDef?.defaultValue != null) {
        channels[chName].defaultValue = typeof chDef.defaultValue === 'string'
          ? parseInt(chDef.defaultValue) || 0
          : chDef.defaultValue
      }
      if (chDef?.fineChannelAliases) {
        channels[chName].fineChannelAliases = chDef.fineChannelAliases
      }
    }
  }

  const modes: FixtureMode[] = (data.modes || []).map((mode: any) => {
    const modeChannels = (mode.channels || []).filter((ch: any) => ch !== null && typeof ch === 'string')
    return { name: mode.name || 'Default', shortName: mode.shortName, channels: modeChannels, channelCount: modeChannels.length }
  })
  if (modes.length === 0) {
    modes.push({ name: 'Default', channels: Object.keys(channels), channelCount: Object.keys(channels).length })
  }

  let physical: FixturePhysical | undefined
  if (data.physical) {
    physical = {
      dimensions: data.physical.dimensions,
      weight: data.physical.weight,
      power: data.physical.power,
      DMXconnector: data.physical.DMXconnector,
      bulb: data.physical.bulb,
      lens: data.physical.lens?.degreesMinMax ? { degreesMinMax: data.physical.lens.degreesMinMax } : undefined,
      panRange: data.physical.focus?.panMax,
      tiltRange: data.physical.focus?.tiltMax
    }
  }

  let wheels: any[] | undefined
  if (data.wheels) {
    wheels = Object.entries(data.wheels).map(([wName, wData]: [string, any]) => ({
      name: wName,
      slots: (Array.isArray(wData) ? wData : wData.slots || []).map((s: any) => ({
        type: s.type === 'Color' ? 'Color' : s.type === 'Open' ? 'Open' : 'Gobo',
        name: s.name || 'Unknown',
        color: s.colors?.[0]
      }))
    }))
  }

  return {
    id, name, manufacturer: mfr,
    categories: data.categories || ['Other'],
    channels, modes,
    physical, wheels: wheels?.length ? wheels : undefined,
    source: 'ofl', lastModified: new Date().toISOString()
  }
}

// ── Parser: GDTF (.gdtf = ZIP containing description.xml) ───────────

export function parseGDTF(filePath: string): FixtureDefinition {
  // Security: check file size before processing
  const fileStats = statSync(filePath)
  if (fileStats.size > MAX_FIXTURE_FILE_SIZE) {
    throw new Error(`GDTF file too large: ${(fileStats.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_FIXTURE_FILE_SIZE / 1024 / 1024} MB)`)
  }

  const zip = new AdmZip(filePath)
  const descEntry = zip.getEntry('description.xml')
  if (!descEntry) throw new Error('Invalid GDTF file: missing description.xml')

  // Security: check extracted size (ZIP bomb protection)
  if (descEntry.header.size > MAX_GDTF_EXTRACTED_SIZE) {
    throw new Error(`GDTF description.xml too large when extracted: ${(descEntry.header.size / 1024 / 1024).toFixed(1)} MB`)
  }

  const xml = descEntry.getData().toString('utf-8')
  const parser = new XMLParser(SAFE_XML_OPTIONS)
  const doc = parser.parse(xml)

  const ftNode = doc.GDTF?.FixtureType || doc.FixtureType || {}
  const name = ftNode['@_Name'] || ftNode['@_LongName'] || 'GDTF Fixture'
  const mfr = ftNode['@_Manufacturer'] || 'Unknown'
  const id = `${slugify(mfr)}/${slugify(name)}`

  const channels: Record<string, FixtureChannel> = {}
  const modes: FixtureMode[] = []

  // Parse DMX Modes
  const dmxModes = ftNode.DMXModes?.DMXMode
  const modeList = Array.isArray(dmxModes) ? dmxModes : dmxModes ? [dmxModes] : []

  for (const mode of modeList) {
    const modeName = mode['@_Name'] || 'Default'
    const modeChannelNames: string[] = []

    const dmxChannels = mode.DMXChannels?.DMXChannel
    const chList = Array.isArray(dmxChannels) ? dmxChannels : dmxChannels ? [dmxChannels] : []

    for (const dmxCh of chList) {
      // GDTF channels reference geometry + attribute
      const logicalCh = dmxCh.LogicalChannel
      const logList = Array.isArray(logicalCh) ? logicalCh : logicalCh ? [logicalCh] : []

      for (const lch of logList) {
        const attr = lch['@_Attribute'] || dmxCh['@_Attribute'] || ''
        const chName = gdtfAttributeToName(attr) || attr || `Ch ${modeChannelNames.length + 1}`

        if (!channels[chName]) {
          const type = gdtfAttributeToType(attr)
          const caps: FixtureCapability[] = []

          // Parse channel functions as capabilities
          const chFuncs = lch.ChannelFunction
          const funcList = Array.isArray(chFuncs) ? chFuncs : chFuncs ? [chFuncs] : []
          for (const func of funcList) {
            const dmxFrom = parseDmxValue(func['@_DMXFrom'] || '0')
            const dmxTo = parseDmxValue(func['@_DMXTo'] || func['@_PhysicalTo'] || '255')
            caps.push({
              dmxRange: [dmxFrom, dmxTo],
              type: func['@_Attribute'] || type,
              label: func['@_Name'] || func['@_Attribute'] || chName
            })
          }

          channels[chName] = makeChannel(chName, type, caps)
          const defVal = dmxCh['@_Default']
          if (defVal) channels[chName].defaultValue = parseDmxValue(defVal)
        }
        modeChannelNames.push(chName)
      }
    }

    modes.push({ name: modeName, channels: modeChannelNames, channelCount: modeChannelNames.length })
  }

  if (modes.length === 0 && Object.keys(channels).length > 0) {
    modes.push({ name: 'Default', channels: Object.keys(channels), channelCount: Object.keys(channels).length })
  }

  // Parse physical
  let physical: FixturePhysical | undefined
  const phys = ftNode.PhysicalDescriptions
  if (phys) {
    const props = phys.Properties
    physical = {
      weight: parseFloat(props?.Weight?.['@_Value']) || undefined,
      power: parseFloat(props?.PowerConsumption?.['@_Value']) || undefined,
      panRange: parseFloat(ftNode.Geometries?.Geometry?.['@_PanMax']) || undefined,
      tiltRange: parseFloat(ftNode.Geometries?.Geometry?.['@_TiltMax']) || undefined
    }
  }

  // Parse wheels
  let wheels: any[] | undefined
  const wheelNodes = ftNode.Wheels?.Wheel
  if (wheelNodes) {
    const wList = Array.isArray(wheelNodes) ? wheelNodes : [wheelNodes]
    wheels = wList.map((w: any) => {
      const slots = w.Slot
      const slotList = Array.isArray(slots) ? slots : slots ? [slots] : []
      return {
        name: w['@_Name'] || 'Wheel',
        slots: slotList.map((s: any) => ({
          type: s['@_Color'] ? 'Color' as const : 'Gobo' as const,
          name: s['@_Name'] || 'Slot',
          color: s['@_Color']
        }))
      }
    })
  }

  return {
    id, name, manufacturer: mfr,
    categories: guessCategories(name, channels),
    channels, modes,
    physical, wheels: wheels?.length ? wheels : undefined,
    source: 'gdtf', lastModified: new Date().toISOString()
  }
}

function parseDmxValue(val: string): number {
  // GDTF uses "128/1" format (value/byte) or just numbers
  const parts = val.split('/')
  return Math.min(255, Math.max(0, parseInt(parts[0]) || 0))
}

function gdtfAttributeToType(attr: string): FixtureChannel['type'] {
  const a = attr.toLowerCase()
  if (a.includes('dimmer') || a.includes('intensity')) return 'intensity'
  if (a.includes('pan')) return 'pan'
  if (a.includes('tilt')) return 'tilt'
  if (a.includes('gobo')) return 'gobo'
  if (a.includes('color') || a.includes('red') || a.includes('green') || a.includes('blue') ||
      a.includes('white') || a.includes('amber') || a.includes('cyan') || a.includes('magenta')) return 'color'
  if (a.includes('shutter') || a.includes('strobe')) return 'shutter'
  if (a.includes('prism')) return 'prism'
  if (a.includes('speed') || a.includes('ptspeed')) return 'speed'
  if (a.includes('fog') || a.includes('haze')) return 'fog'
  if (a.includes('zoom') || a.includes('focus') || a.includes('iris') || a.includes('frost')) return 'generic'
  if (a.includes('effect') || a.includes('macro')) return 'effect'
  if (a.includes('control') || a.includes('reset') || a.includes('lamp')) return 'maintenance'
  return 'generic'
}

function gdtfAttributeToName(attr: string): string {
  const map: Record<string, string> = {
    'Dimmer': 'Dimmer', 'Pan': 'Pan', 'Tilt': 'Tilt',
    'Pan1': 'Pan', 'Tilt1': 'Tilt',
    'ColorAdd_R': 'Red', 'ColorAdd_G': 'Green', 'ColorAdd_B': 'Blue', 'ColorAdd_W': 'White',
    'ColorAdd_A': 'Amber', 'ColorAdd_UV': 'UV', 'ColorAdd_C': 'Cyan', 'ColorAdd_M': 'Magenta',
    'ColorAdd_Y': 'Yellow', 'ColorSub_C': 'Cyan', 'ColorSub_M': 'Magenta', 'ColorSub_Y': 'Yellow',
    'Color1': 'Color Wheel', 'Color2': 'Color Wheel 2',
    'Gobo1': 'Gobo', 'Gobo2': 'Gobo 2', 'Gobo1Pos': 'Gobo Rotation', 'Gobo2Pos': 'Gobo 2 Rotation',
    'Shutter1': 'Shutter', 'Shutter1Strobe': 'Strobe',
    'Prism1': 'Prism', 'Prism1Pos': 'Prism Rotation',
    'Focus1': 'Focus', 'Zoom': 'Zoom', 'Iris': 'Iris', 'Frost1': 'Frost',
    'PanTiltSpeed': 'P/T Speed', 'EffectSpeed': 'Effect Speed',
    'CTO': 'CTO', 'CTB': 'CTB',
    'Effects1': 'Effect', 'Control1': 'Control', 'LampControl': 'Lamp Control',
  }
  return map[attr] || ''
}

// ── Parser: QLC+ (.qxf) ─────────────────────────────────────────────

export function parseQLCPlus(content: string): FixtureDefinition {
  const parser = new XMLParser(SAFE_XML_OPTIONS)
  const doc = parser.parse(content)
  const fd = doc.FixtureDefinition || {}

  const mfr = fd.Manufacturer || 'Unknown'
  const name = fd.Model || 'QLC+ Fixture'
  const id = `${slugify(mfr)}/${slugify(name)}`

  const channels: Record<string, FixtureChannel> = {}

  // Parse channels
  const chNodes = fd.Channel
  const chList = Array.isArray(chNodes) ? chNodes : chNodes ? [chNodes] : []

  for (const ch of chList) {
    const chName = ch['@_Name'] || `Channel ${Object.keys(channels).length + 1}`
    const group = (ch.Group || '').toString().toLowerCase()
    const type = qlcGroupToType(group, chName)

    const caps: FixtureCapability[] = []
    const capNodes = ch.Capability
    const capList = Array.isArray(capNodes) ? capNodes : capNodes ? [capNodes] : []
    for (const cap of capList) {
      caps.push({
        dmxRange: [parseInt(cap['@_Min']) || 0, parseInt(cap['@_Max']) || 255],
        type: cap['@_Preset'] || type,
        label: (typeof cap === 'object' && cap['#text']) || cap['@_Preset'] || chName,
        color: cap['@_Color']
      })
    }

    channels[chName] = makeChannel(chName, type, caps)
  }

  // Parse modes
  const modeNodes = fd.Mode
  const modeList = Array.isArray(modeNodes) ? modeNodes : modeNodes ? [modeNodes] : []
  const modes: FixtureMode[] = []

  for (const mode of modeList) {
    const modeName = mode['@_Name'] || 'Default'
    const modeChannels: string[] = []

    const chRefs = mode.Channel
    const refList = Array.isArray(chRefs) ? chRefs : chRefs ? [chRefs] : []
    for (const ref of refList) {
      const chName = typeof ref === 'string' ? ref : ref['#text'] || ref['@_Name'] || ''
      if (chName && channels[chName]) modeChannels.push(chName)
    }

    if (modeChannels.length > 0) {
      modes.push({ name: modeName, channels: modeChannels, channelCount: modeChannels.length })
    }
  }

  if (modes.length === 0 && Object.keys(channels).length > 0) {
    modes.push({ name: 'Default', channels: Object.keys(channels), channelCount: Object.keys(channels).length })
  }

  // Physical
  let physical: FixturePhysical | undefined
  const phys = fd.Physical
  if (phys) {
    const dims = phys.Dimensions
    const lens = phys.Lens
    const bulb = phys.Bulb
    physical = {
      dimensions: dims ? [parseInt(dims['@_Width']) || 0, parseInt(dims['@_Height']) || 0, parseInt(dims['@_Depth']) || 0] : undefined,
      weight: parseFloat(dims?.['@_Weight']) || undefined,
      power: parseFloat(bulb?.['@_PowerConsumption']) || undefined,
      bulb: bulb ? { type: bulb['@_Type'], lumens: parseInt(bulb['@_Lumens']) || undefined, colorTemperature: parseInt(bulb['@_ColourTemperature']) || undefined } : undefined,
      lens: lens ? { degreesMinMax: [parseFloat(lens['@_DegreesMin']) || 0, parseFloat(lens['@_DegreesMax']) || 0] } : undefined,
      DMXconnector: phys.Technical?.['@_DMXconnector']
    }
  }

  const cat = fd.Type || ''
  return {
    id, name, manufacturer: mfr,
    categories: cat ? [cat] : guessCategories(name, channels),
    channels, modes, physical,
    source: 'user', lastModified: new Date().toISOString()
  }
}

function qlcGroupToType(group: string, name: string): FixtureChannel['type'] {
  if (group.includes('intensity') || group.includes('dimmer')) return 'intensity'
  if (group.includes('colour') || group.includes('color')) return 'color'
  if (group.includes('pan')) return 'pan'
  if (group.includes('tilt')) return 'tilt'
  if (group.includes('gobo')) return 'gobo'
  if (group.includes('shutter')) return 'shutter'
  if (group.includes('prism')) return 'prism'
  if (group.includes('speed')) return 'speed'
  if (group.includes('effect')) return 'effect'
  if (group.includes('maintenance') || group.includes('nothing')) return 'maintenance'
  return inferType(name)
}

// ── Parser: Avolites Personality (.d4) ───────────────────────────────

export function parseAvolites(content: string): FixtureDefinition {
  const parser = new XMLParser(SAFE_XML_OPTIONS)
  const doc = parser.parse(content)

  // Avolites .d4 files have various structures
  const pers = doc.Personality || doc.PersonalityFile?.Personality || doc.avolites || doc
  const name = pers['@_Name'] || pers.Name || 'Avolites Fixture'
  const mfr = pers['@_Manufacturer'] || pers.Manufacturer || 'Unknown'
  const id = `${slugify(mfr)}/${slugify(name)}`

  const channels: Record<string, FixtureChannel> = {}
  const modes: FixtureMode[] = []

  // Try to find channels/attributes
  const attrs = pers.Attributes?.Attribute || pers.Attribute || pers.Channels?.Channel || []
  const attrList = Array.isArray(attrs) ? attrs : [attrs]

  for (const attr of attrList) {
    const chName = attr['@_Name'] || attr.Name || `Ch ${Object.keys(channels).length + 1}`
    if (typeof chName !== 'string') continue
    const type = inferType(chName)
    channels[chName] = makeChannel(chName, type)
  }

  // Try to find modes
  const modeNodes = pers.Modes?.Mode || pers.Mode || []
  const mList = Array.isArray(modeNodes) ? modeNodes : [modeNodes]

  for (const mode of mList) {
    const modeName = mode['@_Name'] || mode.Name || 'Default'
    const modeChannels: string[] = []

    const chRefs = mode.Channels?.Channel || mode.Channel || mode.Attribute || []
    const refList = Array.isArray(chRefs) ? chRefs : [chRefs]
    for (const ref of refList) {
      const rName = typeof ref === 'string' ? ref : ref['@_Name'] || ref['#text'] || ''
      if (rName && channels[rName]) modeChannels.push(rName)
    }
    if (modeChannels.length > 0) {
      modes.push({ name: modeName, channels: modeChannels, channelCount: modeChannels.length })
    }
  }

  if (modes.length === 0 && Object.keys(channels).length > 0) {
    modes.push({ name: 'Default', channels: Object.keys(channels), channelCount: Object.keys(channels).length })
  }

  return {
    id, name, manufacturer: mfr,
    categories: guessCategories(name, channels),
    channels, modes,
    source: 'user', lastModified: new Date().toISOString()
  }
}

// ── Parser: GrandMA2/3 XML ───────────────────────────────────────────

export function parseGrandMA(content: string): FixtureDefinition {
  const parser = new XMLParser(SAFE_XML_OPTIONS)
  const doc = parser.parse(content)

  // GrandMA fixture XML can have various root elements
  const ft = doc.MA?.FixtureType || doc.FixtureType || doc.fixture || doc.Fixture || doc
  const name = ft['@_Name'] || ft['@_name'] || ft.Name || 'GrandMA Fixture'
  const mfr = ft['@_Manufacturer'] || ft['@_manufacturer'] || ft.Manufacturer || 'Unknown'
  const id = `${slugify(mfr)}/${slugify(name)}`

  const channels: Record<string, FixtureChannel> = {}
  const modes: FixtureMode[] = []

  // Parse DMX modes/channels
  const dmxModes = ft.DMXMode || ft.DMXModes?.DMXMode || ft.Modes?.Mode || ft.Mode || []
  const mList = Array.isArray(dmxModes) ? dmxModes : [dmxModes]

  for (const mode of mList) {
    const modeName = mode['@_Name'] || mode['@_name'] || 'Default'
    const modeChannels: string[] = []

    const chNodes = mode.DMXChannel || mode.Channel || mode.Channels?.Channel || []
    const chList = Array.isArray(chNodes) ? chNodes : [chNodes]

    for (const ch of chList) {
      const chName = ch['@_Name'] || ch['@_name'] || ch['@_Attribute'] ||
                     ch.Name || ch.Attribute || `Ch ${Object.keys(channels).length + 1}`
      if (typeof chName !== 'string') continue

      if (!channels[chName]) {
        channels[chName] = makeChannel(chName)
        const def = ch['@_Default'] || ch['@_default']
        if (def) channels[chName].defaultValue = parseInt(def) || 0
      }
      modeChannels.push(chName)
    }

    if (modeChannels.length > 0) {
      modes.push({ name: modeName, channels: modeChannels, channelCount: modeChannels.length })
    }
  }

  // If no modes found, try flat channel list
  if (modes.length === 0) {
    const flatChs = ft.Channels?.Channel || ft.Channel || ft.Attributes?.Attribute || []
    const fList = Array.isArray(flatChs) ? flatChs : [flatChs]
    for (const ch of fList) {
      const chName = ch['@_Name'] || ch['@_name'] || ch.Name || `Ch ${Object.keys(channels).length + 1}`
      if (typeof chName !== 'string') continue
      channels[chName] = makeChannel(chName)
    }
    if (Object.keys(channels).length > 0) {
      modes.push({ name: 'Default', channels: Object.keys(channels), channelCount: Object.keys(channels).length })
    }
  }

  return {
    id, name, manufacturer: mfr,
    categories: guessCategories(name, channels),
    channels, modes,
    source: 'user', lastModified: new Date().toISOString()
  }
}

// ── Parser: CSV ──────────────────────────────────────────────────────

export function parseCSV(content: string, fileName: string): FixtureDefinition {
  const sep = content.includes('\t') ? '\t' : content.includes(';') ? ';' : ','
  const lines = content.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV file must have a header row and at least one data row')

  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/^"(.*)"$/, '$1'))
  const rows = lines.slice(1).map(l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1')))

  // Try to detect CSV format
  const colName = headers.findIndex(h => h === 'channel' || h === 'name' || h === 'channel name' || h === 'function')
  const colType = headers.findIndex(h => h === 'type' || h === 'group' || h === 'category')
  const colDmx = headers.findIndex(h => h === 'dmx' || h === 'address' || h === 'offset' || h === 'channel number' || h === '#')
  const colDefault = headers.findIndex(h => h === 'default' || h === 'default value')

  if (colName < 0) {
    // Fallback: assume first column is channel name
    throw new Error('CSV must have a "Channel" or "Name" column header')
  }

  const channels: Record<string, FixtureChannel> = {}
  const channelOrder: string[] = []

  for (const row of rows) {
    const chName = row[colName]
    if (!chName) continue
    const type = colType >= 0 ? inferType(row[colType] || chName) : inferType(chName)
    const ch = makeChannel(chName, type)
    if (colDefault >= 0 && row[colDefault]) ch.defaultValue = parseInt(row[colDefault]) || 0
    channels[chName] = ch
    channelOrder.push(chName)
  }

  const baseName = fileName.replace(/\.(csv|tsv)$/i, '').replace(/[_-]/g, ' ')
  const name = titleCase(baseName)
  const id = `imported/${slugify(baseName)}`

  return {
    id, name, manufacturer: 'Imported',
    categories: guessCategories(name, channels),
    channels,
    modes: [{ name: 'Default', channels: channelOrder, channelCount: channelOrder.length }],
    source: 'user', lastModified: new Date().toISOString()
  }
}

// ── Category guessing ────────────────────────────────────────────────

function guessCategories(name: string, channels: Record<string, FixtureChannel>): string[] {
  const n = name.toLowerCase()
  const hasType = (t: string) => Object.values(channels).some(ch => ch.type === t)

  if (hasType('pan') || hasType('tilt')) {
    if (n.includes('spot')) return ['Moving Head']
    if (n.includes('wash')) return ['Moving Head']
    return ['Moving Head']
  }
  if (n.includes('par') || n.includes('slim')) return ['PAR']
  if (n.includes('bar') || n.includes('strip') || n.includes('batten')) return ['Pixel Bar']
  if (n.includes('strobe')) return ['Strobe']
  if (n.includes('laser')) return ['Laser']
  if (n.includes('fog') || n.includes('haze') || n.includes('smoke') || hasType('fog')) return ['Smoke']
  if (n.includes('dimmer') || Object.keys(channels).length === 1) return ['Dimmer']
  if (hasType('color')) return ['Color Changer']
  return ['Other']
}

// ── Main import function ─────────────────────────────────────────────

export function parseFixtureFile(filePath: string): FixtureDefinition {
  const ext = filePath.toLowerCase().split('.').pop() || ''
  const fileName = filePath.split(/[/\\]/).pop() || ''

  // Security: check file size before reading
  const fileStats = statSync(filePath)
  if (fileStats.size > MAX_FIXTURE_FILE_SIZE) {
    throw new Error(`Fixture file too large: ${(fileStats.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_FIXTURE_FILE_SIZE / 1024 / 1024} MB)`)
  }

  // GDTF is binary (ZIP), handle separately
  if (ext === 'gdtf') {
    return parseGDTF(filePath)
  }

  // Read file content
  const content = readFileSync(filePath, 'utf-8')
  const format = detectFormat(filePath, content)

  switch (format) {
    case 'ofl': {
      const data = JSON.parse(content)
      const mfr = data.manufacturer?.name || fileName.split(/[/\\]/).slice(-2, -1)[0] || 'Unknown'
      return parseOFL(data, mfr)
    }
    case 'native': {
      const data = JSON.parse(content) as FixtureDefinition
      if (!data.id) data.id = `imported/${slugify(data.name || 'fixture')}`
      if (!data.manufacturer) data.manufacturer = 'Imported'
      if (!data.categories) data.categories = ['Other']
      if (!data.modes) {
        data.modes = [{ name: 'Default', channels: Object.keys(data.channels), channelCount: Object.keys(data.channels).length }]
      }
      data.source = data.source || 'user'
      return data
    }
    case 'qlcplus':
      return parseQLCPlus(content)
    case 'avolites':
      return parseAvolites(content)
    case 'grandma':
      return parseGrandMA(content)
    case 'csv':
      return parseCSV(content, fileName)
    default:
      // Last resort: try JSON
      try {
        const data = JSON.parse(content)
        if (data.name && data.channels) {
          return parseFixtureFile(filePath) // recursive with native detection
        }
        if (data.availableChannels) {
          return parseOFL(data)
        }
      } catch { /* not JSON */ }

      // Try XML
      try {
        if (content.trim().startsWith('<')) {
          if (content.includes('qlcplus')) return parseQLCPlus(content)
          return parseGrandMA(content) // generic XML fallback
        }
      } catch { /* not XML */ }

      throw new Error(`Unsupported fixture file format: .${ext}`)
  }
}
