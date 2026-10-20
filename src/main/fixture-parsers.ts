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
import { convertOflFixture } from './fixture-convert-ofl'
import { convertQxfFixture } from './fixture-convert-qxf'

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
  const mfr = manufacturer || data?.manufacturer?.name || 'Unknown'
  const name = data?.name || 'Unknown Fixture'
  const json = { ...data }
  // A bare channel list without modes: one mode with every channel
  if (!Array.isArray(json.modes) || json.modes.length === 0) {
    json.modes = [{ name: 'Default', channels: Object.keys(json.availableChannels ?? {}) }]
  }
  const def = convertOflFixture(json, {
    manufacturerKey: slugify(mfr) || 'unknown',
    fixtureKey: slugify(name) || 'fixture',
    manufacturerName: mfr,
    source: 'ofl',
    stampNow: true
  })
  delete def.sourceUrl // a local file: the slugs need not be OFL keys
  return def
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
  // Same converter as the offline catalog (presets, 16-bit pairs, heads → pixel layouts)
  return convertQxfFixture(content, { source: 'user', stampNow: true })
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

// ── Parser: PhotonBoard native JSON ──────────────────────────────────

export function parseNativeJSON(data: any): FixtureDefinition {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.channels || typeof data.channels !== 'object') {
    throw new Error('Not a PhotonBoard fixture definition (missing channels)')
  }
  const fixture = data as FixtureDefinition
  if (!fixture.id) fixture.id = `imported/${slugify(fixture.name || 'fixture')}`
  if (!fixture.manufacturer) fixture.manufacturer = 'Imported'
  if (!fixture.categories) fixture.categories = ['Other']
  if (!fixture.modes) {
    fixture.modes = [{ name: 'Default', channels: Object.keys(fixture.channels), channelCount: Object.keys(fixture.channels).length }]
  }
  fixture.source = fixture.source || 'user'
  return fixture
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
    case 'native':
      return parseNativeJSON(JSON.parse(content))
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
        // Sniff the content directly — never re-enter parseFixtureFile here: the
        // extension would still be unknown and we would recurse forever.
        if (data && typeof data === 'object') {
          if (data.availableChannels) return parseOFL(data)
          if (data.name && data.channels) return parseNativeJSON(data)
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
