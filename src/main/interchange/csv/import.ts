// ============================================================
// CSV patch import (any console / Lightwright / Vectorworks / Excel
// sheet): one row per fixture. Columns are detected from the headers
// (or from the content), and the wizard can correct them
// (ImportContext.options.tabular). Fixture types are resolved through
// the library / offline catalog; a generic type is made from the
// channel count when nothing matches, so no row is lost.
//
// Coordinates: CAD convention (X = left → right, Y = depth towards
// upstage, Z = height) → PhotonBoard (x, y = height, z = depth).
// ============================================================

import type { FixtureChannel, FixtureDefinition, Group, PatchEntry } from '../../../shared/types'
import { MAX_UNIVERSES, DMX_CHANNELS_PER_UNIVERSE } from '../../../shared/types'
import {
  emptyFragment, type ImportContext, type ImportedShowFragment, type ImportWarning, type TabularField, type TabularImportInfo
} from '../../../shared/interchange'
import { decodeText, detectDelimiter, parseRows, type Delimiter } from './table'
import { detectColumns, headerUnitFactor, looksLikeHeader } from './columns'
import { parseAddressCell, parseUniverseCell, splitAbsolute } from './address'

const GROUP_COLORS = ['#3b82f6', '#22c55e', '#e85d04', '#a855f7', '#eab308', '#06b6d4', '#ef4444', '#f97316']
const MAX_ROWS = 20_000
const DEG = Math.PI / 180

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function modeKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Number with a decimal point or (in ;/tab files) a decimal comma */
function parseNumber(raw: string, decimalComma: boolean): number | null {
  let s = String(raw ?? '').trim().replace(/\s| | /g, '')
  if (!s) return null
  s = s.replace(/(m|mm|cm|ft|in|°|deg)$/i, '')
  if (decimalComma && /^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A generic fixture type for a channel count (nothing matched in the library / catalog) */
export function genericDefinition(label: string, channelCount: number): FixtureDefinition {
  const n = Math.max(1, Math.min(DMX_CHANNELS_PER_UNIVERSE, Math.round(channelCount)))
  const names = n === 1 ? ['Dimmer'] : Array.from({ length: n }, (_, i) => `Channel ${i + 1}`)
  const channels: Record<string, FixtureChannel> = {}
  for (const name of names) {
    const intensity = n === 1
    channels[name] = {
      name,
      type: intensity ? 'intensity' : 'generic',
      defaultValue: 0,
      ...(intensity ? { highlightValue: 255 } : {}),
      precedence: intensity ? 'HTP' : 'LTP'
    }
  }
  const base = slug(label) || 'fixture'
  return {
    id: `import/${base}-${n}ch`,
    name: label || (n === 1 ? 'Generic Dimmer' : `Generic ${n}ch`),
    manufacturer: 'Generic',
    categories: [n === 1 ? 'Dimmer' : 'Other'],
    channels,
    modes: [{ name: `${n}ch`, channels: names, channelCount: n }],
    source: 'user'
  }
}

/** Mode of `def` named like `wanted`, else with `channels` channels, else the first */
export function pickMode(def: FixtureDefinition, wanted: string | undefined, channels: number | undefined): { name: string; exact: boolean } | null {
  if (def.modes.length === 0) return null
  if (wanted) {
    const k = modeKey(wanted)
    const byName = def.modes.find((m) => modeKey(m.name) === k || (m.shortName && modeKey(m.shortName) === k))
    if (byName) return { name: byName.name, exact: true }
    const num = /(\d+)\s*(ch|channels?|canaux|dmx)?/i.exec(wanted)
    const count = num ? parseInt(num[1], 10) : NaN
    const byCount = def.modes.find((m) => m.channelCount === count)
    if (byCount && /ch|chan|canaux|dmx|mode/i.test(wanted)) return { name: byCount.name, exact: true }
    const partial = def.modes.find((m) => modeKey(m.name).includes(k) || k.includes(modeKey(m.name)))
    if (partial && k.length >= 2) return { name: partial.name, exact: true }
  }
  if (channels) {
    const byCount = def.modes.find((m) => m.channelCount === channels)
    if (byCount) return { name: byCount.name, exact: true }
  }
  return { name: def.modes[0].name, exact: !wanted && !channels }
}

interface Row {
  index: number
  cells: Partial<Record<TabularField, string>>
}

export async function importCsvPatch(bytes: Uint8Array, fileName: string, ctx: ImportContext): Promise<ImportedShowFragment> {
  const name = fileName.replace(/\.(csv|tsv|txt)$/i, '') || 'CSV patch'
  const fragment = emptyFragment('csv-patch', name)
  const warn = (w: ImportWarning) => { fragment.warnings.push(w) }

  const text = decodeText(bytes)
  const opts = ctx.options?.tabular
  const delimiter: Delimiter = opts?.delimiter ?? detectDelimiter(text)
  const all = parseRows(text, delimiter, MAX_ROWS + 1)
  if (all.length > MAX_ROWS) {
    all.length = MAX_ROWS
    warn({ level: 'warning', code: 'tooManyRows', params: { max: MAX_ROWS } })
  }
  const nonComment = all.filter((r) => !/^(#|\/\/)/.test(r[0] ?? ''))
  if (nonComment.length === 0) {
    warn({ level: 'error', code: 'emptyFile' })
    fragment.tabular = { delimiter, hasHeader: false, headers: [], columns: [], sample: [], rowCount: 0, confident: false }
    return fragment
  }
  const hasHeader = opts?.hasHeader ?? looksLikeHeader(nonComment[0])
  const dataRows = hasHeader ? nonComment.slice(1) : nonComment
  const detected = detectColumns(hasHeader ? nonComment[0] : null, dataRows)
  const width = Math.max(detected.columns.length, hasHeader ? nonComment[0].length : 0)
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => nonComment[0][i] ?? '')
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  let columns: (TabularField | null)[] = detected.columns
  if (opts?.columns) {
    columns = Array.from({ length: width }, (_, i) => opts.columns![i] ?? null)
    // one column per field
    const seen = new Set<TabularField>()
    columns = columns.map((f) => (f && !seen.has(f) ? (seen.add(f), f) : null))
  }
  const tabular: TabularImportInfo = {
    delimiter,
    hasHeader,
    headers,
    columns,
    sample: dataRows.slice(0, 8).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
    rowCount: dataRows.length,
    confident: opts?.columns ? true : detected.confident
  }
  fragment.tabular = tabular

  const col = (f: TabularField) => columns.indexOf(f)
  if (col('address') < 0 && col('universe') < 0) warn({ level: 'warning', code: 'csvNoAddressColumn' })
  if (col('model') < 0 && col('fixtureType') < 0 && col('channels') < 0) warn({ level: 'warning', code: 'csvNoTypeColumn' })

  const rows: Row[] = dataRows.map((cells, index) => {
    const out: Row['cells'] = {}
    columns.forEach((f, i) => { if (f && cells[i] !== undefined && cells[i] !== '') out[f] = cells[i] })
    return { index, cells: out }
  }).filter((r) => Object.keys(r.cells).length > 0)

  const decimalComma = delimiter !== ','
  const unit = (f: TabularField) => (col(f) >= 0 ? headerUnitFactor(headers[col(f)]) : 1)
  const factors = { x: unit('x'), y: unit('y'), z: unit('z') }

  // Universe numbering: 1-based unless the file uses universe 0
  const universeCol = col('universe') >= 0
  const zeroBasedColumn = universeCol && rows.some((r) => parseUniverseCell(r.cells.universe ?? '') === 0)
  const zeroBasedDotted = rows.some((r) => parseAddressCell(r.cells.address ?? '')?.universe === 0)

  // Fixture types, resolved once per (maker, model, mode, channels)
  const defs = new Map<string, FixtureDefinition>()
  const resolved = new Map<string, { def: FixtureDefinition; mode: string; channelCount: number } | null>()
  const notFound = new Map<string, number>()
  const genericCount = new Map<string, number>()
  const modeMismatch = new Set<string>()

  const resolveType = async (cells: Row['cells']) => {
    const maker = (cells.manufacturer ?? '').trim()
    const model = (cells.model ?? '').trim()
    const typeText = (cells.fixtureType ?? '').trim()
    const modeText = (cells.mode ?? '').trim()
    const channels = cells.channels ? parseNumber(cells.channels, false) ?? undefined : undefined
    const key = `${maker}|${model}|${typeText}|${modeText}|${channels ?? ''}`
    if (resolved.has(key)) return resolved.get(key)!
    let def: FixtureDefinition | null = null
    const label = [maker, model || typeText].filter(Boolean).join(' ')
    if (model || maker) def = await ctx.findFixture(maker, model || typeText, channels)
    if (!def && typeText) {
      // "Robe Robin 600 LEDWash": try the first one / two words as the manufacturer
      const words = typeText.split(/\s+/)
      def = await ctx.findFixture(maker, typeText, channels)
      for (let k = 1; !def && k <= Math.min(2, words.length - 1); k++) {
        def = await ctx.findFixture(words.slice(0, k).join(' '), words.slice(k).join(' '), channels)
      }
    }
    let result: { def: FixtureDefinition; mode: string; channelCount: number } | null = null
    if (def) {
      const mode = pickMode(def, modeText || undefined, channels)
      if (mode) {
        if (!mode.exact && (modeText || channels)) modeMismatch.add(`${def.manufacturer} ${def.name}`)
        const count = def.modes.find((m) => m.name === mode.name)?.channelCount ?? channels ?? 1
        result = { def, mode: mode.name, channelCount: count }
      }
    }
    if (!result) {
      if (label) notFound.set(label, (notFound.get(label) ?? 0) + 1)
      const count = channels ?? (/\b(\d{1,3})\s*ch/i.exec(modeText)?.[1] ? parseInt(/\b(\d{1,3})\s*ch/i.exec(modeText)![1], 10) : 1)
      const generic = genericDefinition(label, count)
      genericCount.set(generic.name, (genericCount.get(generic.name) ?? 0) + 1)
      result = { def: generic, mode: generic.modes[0].name, channelCount: generic.modes[0].channelCount }
    }
    if (!defs.has(result.def.id)) defs.set(result.def.id, result.def)
    else result.def = defs.get(result.def.id)!
    resolved.set(key, result)
    return result
  }

  const groups = new Map<string, Group>()
  const groupOf = (label: string): Group => {
    const key = label.trim()
    let g = groups.get(key.toLowerCase())
    if (!g) {
      g = { id: `csv-group-${groups.size + 1}`, name: key, color: GROUP_COLORS[groups.size % GROUP_COLORS.length], fixtureIds: [] }
      groups.set(key.toLowerCase(), g)
    }
    return g
  }
  const groupSplit = delimiter === ',' ? /[;|+/]/ : /[,|+/]/

  let skipped = 0
  let badFid = 0
  let noAddress: PatchEntry[] = []
  const counts = new Map<string, number>()
  const footprints = new Map<string, number>()
  let maxPos = 0

  for (const row of rows) {
    const c = row.cells
    const type = await resolveType(c)
    const id = `csv-${row.index + 1}`
    // Address
    let universe: number | undefined
    let address: number | undefined
    const parsed = c.address ? parseAddressCell(c.address) : null
    if (c.address && !parsed) {
      warn({ level: 'warning', code: 'csvBadAddress', params: { row: row.index + 1 + (hasHeader ? 1 : 0), value: c.address } })
    }
    if (parsed) {
      if (parsed.absolute) {
        const abs = splitAbsolute(parsed.address)
        universe = abs.universe
        address = abs.address
      } else if (parsed.universe !== undefined) {
        universe = zeroBasedDotted ? parsed.universe : parsed.universe - 1
        address = parsed.address
      } else {
        address = parsed.address
      }
    }
    if (universe === undefined && c.universe) {
      const u = parseUniverseCell(c.universe)
      if (u !== null) universe = zeroBasedColumn ? u : u - 1
    }
    if (address !== undefined && universe === undefined) universe = 0
    if (universe !== undefined && (universe < 0 || universe >= MAX_UNIVERSES)) {
      skipped++
      warn({ level: 'warning', code: 'universeOutOfRange', params: { name: c.name ?? id, universe: universe + 1, max: MAX_UNIVERSES } })
      continue
    }
    if (address !== undefined && address + type.channelCount - 1 > DMX_CHANNELS_PER_UNIVERSE) {
      skipped++
      warn({ level: 'warning', code: 'addressOverflow', params: { name: c.name ?? id, address: `${(universe ?? 0) + 1}.${String(address).padStart(3, '0')}` } })
      continue
    }
    // Fixture id (number)
    let fid: number | undefined
    if (c.fid) {
      const n = parseNumber(c.fid, decimalComma)
      if (n !== null && Number.isInteger(n) && n >= 1 && n <= 99999) fid = n
      else badFid++
    }
    const typeName = type.def.name
    const label = (c.name ?? '').trim() || (fid !== undefined ? `${typeName} ${fid}` : '')
    const entry: PatchEntry = {
      id,
      fixtureDefId: type.def.id,
      modeName: type.mode,
      universe: universe ?? 0,
      address: address ?? 0,
      name: label,
      groupIds: []
    }
    if (!label) {
      const n = (counts.get(typeName) ?? 0) + 1
      counts.set(typeName, n)
      entry.name = `${typeName} ${n}`
    }
    if (fid !== undefined) entry.fid = fid
    // Position (CAD axes → PhotonBoard axes)
    const x = c.x ? parseNumber(c.x, decimalComma) : null
    const y = c.y ? parseNumber(c.y, decimalComma) : null
    const z = c.z ? parseNumber(c.z, decimalComma) : null
    if (x !== null || y !== null || z !== null) {
      const px = (x ?? 0) * factors.x
      const py = (z ?? 0) * factors.z
      const pz = (y ?? 0) * factors.y
      maxPos = Math.max(maxPos, Math.abs(px), Math.abs(py), Math.abs(pz))
      entry.position3D = { x: px, y: py, z: pz }
    }
    const rx = c.rotX ? parseNumber(c.rotX, decimalComma) : null
    const ry = c.rotY ? parseNumber(c.rotY, decimalComma) : null
    const rz = c.rotZ ? parseNumber(c.rotZ, decimalComma) : null
    if (rx !== null || ry !== null || rz !== null) {
      entry.rotation3D = { rx: (rx ?? 0) * DEG, ry: (rz ?? 0) * DEG, rz: (ry ?? 0) * DEG }
    }
    // Groups (selection order = row order) and hanging positions
    const groupNames = [
      ...(c.groups ? c.groups.split(groupSplit).map((s) => s.trim()).filter(Boolean) : []),
      ...(c.position ? [c.position.trim()] : [])
    ]
    for (const gname of groupNames) {
      const g = groupOf(gname)
      if (!g.fixtureIds.includes(id)) g.fixtureIds.push(id)
      if (!entry.groupIds.includes(g.id)) entry.groupIds.push(g.id)
    }
    footprints.set(id, type.channelCount)
    if (address === undefined) noAddress.push(entry)
    fragment.patch.push(entry)
  }

  // Rows without an address: patched one after the other after the last used address
  if (noAddress.length > 0) {
    const used = new Map<number, number>() // universe → last used channel
    for (const p of fragment.patch) {
      if (p.address === 0) continue
      const end = p.address + (footprints.get(p.id) ?? 1) - 1
      used.set(p.universe, Math.max(used.get(p.universe) ?? 0, end))
    }
    let u = used.size > 0 ? Math.max(...used.keys()) : 0
    let next = (used.get(u) ?? 0) + 1
    const placed: PatchEntry[] = []
    for (const p of noAddress) {
      const n = footprints.get(p.id) ?? 1
      if (next + n - 1 > DMX_CHANNELS_PER_UNIVERSE) { u++; next = 1 }
      if (u >= MAX_UNIVERSES) break
      p.universe = u
      p.address = next
      next += n
      placed.push(p)
    }
    const lost = new Set(noAddress.filter((p) => !placed.includes(p)).map((p) => p.id))
    if (lost.size > 0) {
      fragment.patch = fragment.patch.filter((p) => !lost.has(p.id))
      for (const g of groups.values()) g.fixtureIds = g.fixtureIds.filter((id) => !lost.has(id))
      skipped += lost.size
    }
    warn({ level: 'info', code: 'csvAutoAddressed', params: { count: placed.length } })
    noAddress = []
  }

  fragment.fixtures = [...defs.values()]
  fragment.groups = [...groups.values()].filter((g) => g.fixtureIds.length > 0)

  for (const [label, count] of notFound) warn({ level: 'warning', code: 'fixtureTypeNotFound', params: { type: label, count } })
  if (genericCount.size > 0) warn({ level: 'info', code: 'genericFixturesCreated', params: { count: genericCount.size } })
  for (const t of modeMismatch) warn({ level: 'warning', code: 'modeNotFound', params: { type: t } })
  if (badFid > 0) warn({ level: 'info', code: 'csvBadFixtureId', params: { count: badFid } })
  if (skipped > 0) warn({ level: 'warning', code: 'rowsSkipped', params: { count: skipped } })
  if (maxPos > 200 && factors.x === 1 && factors.y === 1 && factors.z === 1) {
    // No unit in the headers and stage-sized values over 200: millimetres (CAD exports)
    for (const p of fragment.patch) {
      if (p.position3D) p.position3D = { x: p.position3D.x / 1000, y: p.position3D.y / 1000, z: p.position3D.z / 1000 }
    }
    warn({ level: 'info', code: 'csvPositionsMm' })
  }
  if (fragment.patch.some((p) => p.position3D)) warn({ level: 'info', code: 'csvAxes' })
  return fragment
}
