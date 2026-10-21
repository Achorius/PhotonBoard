/**
 * Universal Fixture File Parsers
 *
 * Supports: OFL JSON, GDTF (.gdtf), QLC+ (.qxf), Avolites (.d4),
 *           GrandMA2/3 (.xml), CSV, PhotonBoard native JSON
 */

import { readFileSync, statSync } from 'fs'
import { XMLParser } from 'fast-xml-parser'
import type { FixtureDefinition, FixtureChannel, FixtureMode, FixtureCapability } from '../shared/types'
import { convertOflFixture } from './fixture-convert-ofl'
import { convertQxfFixture } from './fixture-convert-qxf'
import { parseGdtfArchive } from './interchange/gdtf/gdtf-import'

// Security: max file sizes to prevent denial-of-service
const MAX_FIXTURE_FILE_SIZE = 10 * 1024 * 1024  // 10 MB max fixture file

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

  return parseGDTFBuffer(readFileSync(filePath), filePath)
}

/** A GDTF archive already in memory (uploaded, read from disk) */
export function parseGDTFBuffer(data: Buffer, fileName = 'fixture.gdtf'): FixtureDefinition {
  if (data.length > MAX_FIXTURE_FILE_SIZE) {
    throw new Error(`GDTF file too large: ${(data.length / 1024 / 1024).toFixed(1)} MB (max ${MAX_FIXTURE_FILE_SIZE / 1024 / 1024} MB)`)
  }
  // One reader and one converter for every .gdtf (fixture library, File › Import, embedded in an MVR):
  // the interchange GDTF module (16/24-bit offsets, geometry references, channel sets, wheels,
  // physical data; description.xml size guard)
  return parseGdtfArchive(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), fileName).definition
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
