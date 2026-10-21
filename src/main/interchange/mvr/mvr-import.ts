// ============================================================
// PhotonBoard — MVR (My Virtual Rig, DIN SPEC 15801) import
//
// GeneralSceneDescription.xml + embedded GDTF fixture types →
//   • fixtures: every embedded GDTF (ctx.parseGdtf), library /
//     catalog lookup when the GDTF is missing or a placeholder,
//     a generic definition as the last resort
//   • patch: Fixture nodes of every layer, nested in GroupObject /
//     Truss / Fixture / SceneObject child lists; name, FixtureID /
//     FixtureIDNumeric / CustomId → fid, GDTFMode → mode, Addresses
//     (absolute "1025" or "3.1") → universe / address, DMXInvertPan
//     / Tilt; positions from the composed matrices (mm → m, MVR
//     axes → PhotonBoard axes) and the beam direction → mounting
//     location / tilt / direction
//   • groups: layers, positions (AUXData Position), named group
//     objects, classes and fixture functions, in fixture-ID order
//   • room: size from the rig bounds, truss bars from horizontal
//     trusses parallel to the stage front
// Everything else (scene objects, focus points, supports, video
// screens, custom commands, mappings…) is reported as a warning.
// ============================================================

import AdmZip from 'adm-zip'
import type { ImportContext, ImportedShowFragment, ImportWarning } from '../../../shared/interchange'
import { emptyFragment } from '../../../shared/interchange'
import type { FixtureChannel, FixtureDefinition, Group, PatchEntry, RoomConfig, TrussBar } from '../../../shared/types'
import { compactKey, slugify } from '../../fixture-convert-common'
import { cieTextToHex } from '../gdtf/color'
import { isZip, parseGdtfArchive } from '../gdtf/gdtf-import'
import { normalizeUuid } from '../gdtf/uuid'
import { attr, childText, elementChildren, kid, kids, parseXml, text, type XNode } from '../gdtf/xml'
import { IDENTITY, beamOf, compose, mountFromBeam, mvrToPb, normalize, parseMvrMatrix, type Transform, type Vec3 } from './geometry'

const MAX_XML_BYTES = 64 * 1024 * 1024
const MAX_GDTF_BYTES = 64 * 1024 * 1024

/** A fixture-like node found in the scene tree */
interface FixtureRec {
  kind: string
  uuid: string
  name: string
  world: Transform
  gdtfSpec: string
  gdtfMode: string
  fixtureId: string
  fixtureIdNumeric: number | null
  customId: number | null
  unitNumber: number | null
  addresses: { brk: number; raw: string }[]
  classing?: string
  position?: string
  fn?: string
  color?: string
  multipatch?: string
  invertPan: boolean
  invertTilt: boolean
  layer: string
  layerIndex: number
  groupPath: string[]
}

interface TrussRec {
  name: string
  world: Transform
  hints: string[]
  gdtfSpec: string
  position?: string
}

interface ResolvedType {
  def: FixtureDefinition
  /** Where the definition came from */
  how: 'gdtf' | 'library' | 'generic'
  /** Channel count of each DMX mode of the embedded GDTF (also for placeholders replaced by the library) */
  footprints: Map<string, number>
}

/** DMX address text → 0-based universe + 1-based address; null when unpatched */
export function parseMvrAddress(raw: string): { universe: number; address: number } | null {
  const s = raw.trim()
  const dotted = /^(\d+)\s*[.:]\s*(\d+)$/.exec(s)
  if (dotted) {
    const u = parseInt(dotted[1], 10)
    const a = parseInt(dotted[2], 10)
    if (u >= 1 && a >= 1 && a <= 512) return { universe: u - 1, address: a }
    if (u === 0 && a >= 1 && a <= 512) return { universe: 0, address: a }
    return null
  }
  const abs = parseInt(s, 10)
  if (!/^\d+$/.test(s) || !Number.isFinite(abs) || abs <= 0) return null
  return { universe: Math.floor((abs - 1) / 512), address: ((abs - 1) % 512) + 1 }
}

/** Numeric part of a FixtureID ("101", "A101", "#12") */
function numericId(s: string): number | null {
  const m = /(\d+)/.exec(s)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function intOrNull(s: string): number | null {
  if (!/^-?\d+$/.test(s.trim())) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

const GROUP_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#a3e635']

/** Capture & co. embed "placeholder" GDTFs (one generic dimmer attribute per channel) when the real type is not licensed */
export function looksLikePlaceholderGdtf(def: FixtureDefinition): boolean {
  const names = Object.keys(def.channels)
  return names.length >= 2 && names.every((n) => /^Dimmer \d+$/.test(n))
}

export async function parseMvr(bytes: Uint8Array, fileName: string, ctx: ImportContext): Promise<ImportedShowFragment> {
  if (!isZip(bytes)) throw new Error('Not an MVR file (not a ZIP archive)')
  const zip = new AdmZip(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const entries = zip.getEntries().filter((e) => !e.isDirectory)
  const byName = new Map<string, AdmZip.IZipEntry>()
  for (const e of entries) {
    const base = e.entryName.replace(/^.*[\\/]/, '')
    if (!byName.has(base.toLowerCase())) byName.set(base.toLowerCase(), e)
  }
  const gsdEntry = byName.get('generalscenedescription.xml')
  if (!gsdEntry) throw new Error('Not an MVR file (no GeneralSceneDescription.xml)')

  const showName = fileName.replace(/^.*[\\/]/, '').replace(/\.mvr$/i, '') || 'MVR'
  const fragment = emptyFragment('mvr', showName)
  const warnings = fragment.warnings
  const warn = (level: ImportWarning['level'], code: string, message: string, params?: Record<string, string | number>) => warnings.push({ level, code, message, params })

  let doc: XNode
  try {
    if (gsdEntry.header.size > MAX_XML_BYTES) throw new Error('GeneralSceneDescription.xml is too large')
    doc = parseXml(gsdEntry.getData().toString('utf-8'))
  } catch (e) {
    warn('error', 'mvr.invalidXml', `GeneralSceneDescription.xml could not be read: ${(e as Error).message}`)
    return fragment
  }
  const gsd = kid(doc, 'GeneralSceneDescription')
  if (!gsd) {
    warn('error', 'mvr.invalidXml', 'GeneralSceneDescription.xml has no GeneralSceneDescription node')
    return fragment
  }

  // ---- header ----
  const verMajor = attr(gsd, 'verMajor') ?? '1'
  const verMinor = attr(gsd, 'verMinor') ?? '0'
  const provider = attr(gsd, 'provider')
  const providerVersion = attr(gsd, 'providerVersion')
  const comment = [doc['#comment'], gsd['#comment']].flat().filter(Boolean).map((c) => String(c)).find((c) => /created by|exported/i.test(c))
  const commentApp = comment ? comment.replace(/^.*?(created by|exported (from|by))\s*/i, '').trim() : undefined
  const app = provider ? `${provider}${providerVersion ? ` ${providerVersion}` : ''}` : commentApp
  fragment.sourceApp = `${app ? `${app}, ` : ''}MVR ${verMajor}.${verMinor}`

  const scene = kid(gsd, 'Scene')
  const aux = kid(scene, 'AUXData')
  const classes = new Map<string, string>()
  for (const c of kids(aux, 'Class')) { const id = normalizeUuid(attr(c, 'uuid')); if (id) classes.set(id, attr(c, 'name') || 'Class') }
  const positions = new Map<string, string>()
  for (const p of kids(aux, 'Position')) { const id = normalizeUuid(attr(p, 'uuid')); if (id) positions.set(id, attr(p, 'name') || 'Position') }
  const symdefs = new Map<string, string>()
  for (const s of kids(aux, 'Symdef')) { const id = normalizeUuid(attr(s, 'uuid')); if (id) symdefs.set(id, attr(s, 'name') ?? '') }

  // ---- scene walk ----
  const fixtures: FixtureRec[] = []
  const trusses: TrussRec[] = []
  const ignored = new Map<string, number>()
  const extras = { customCommands: 0, mappings: 0, connections: 0, overwrites: 0, focus: 0, gobos: 0 }
  const count = (what: string) => ignored.set(what, (ignored.get(what) ?? 0) + 1)
  let depthGuard = 0

  const layers = kids(kid(scene, 'Layers'), 'Layer')
  layers.forEach((layer, layerIndex) => {
    const layerName = attr(layer, 'name') || `Layer ${layerIndex + 1}`
    const t = parseMvrMatrix(childText(layer, 'Matrix')) ?? IDENTITY
    walk(kid(layer, 'ChildList'), t, layerName, layerIndex, [])
  })
  if (layers.length === 0) warn('warning', 'mvr.noLayers', 'The MVR scene has no layer')

  function walk(list: XNode | undefined, parent: Transform, layer: string, layerIndex: number, groupPath: string[]): void {
    if (!list || depthGuard > 64) return
    depthGuard++
    for (const { tag, node } of elementChildren(list)) {
      const local = parseMvrMatrix(childText(node, 'Matrix')) ?? IDENTITY
      const world = compose(parent, local)
      const name = attr(node, 'name') ?? ''
      switch (tag) {
        case 'Fixture':
          fixtures.push(readFixture(tag, node, world, layer, layerIndex, groupPath))
          walk(kid(node, 'ChildList'), world, layer, layerIndex, groupPath)
          break
        case 'SceneObject':
        case 'VideoScreen':
        case 'Projector': {
          const spec = childText(node, 'GDTFSpec')
          const patched = kids(kid(node, 'Addresses'), 'Address').some((a) => parseMvrAddress(text(a)) !== null)
          if (spec && patched) fixtures.push(readFixture(tag, node, world, layer, layerIndex, groupPath))
          else count(tag)
          walk(kid(node, 'ChildList'), world, layer, layerIndex, groupPath)
          break
        }
        case 'GroupObject':
          walk(kid(node, 'ChildList'), world, layer, layerIndex, name ? [...groupPath, name] : groupPath)
          break
        case 'Truss': {
          const hints = kids(kid(node, 'Geometries'), 'Symbol').map((s) => symdefs.get(normalizeUuid(attr(s, 'symdef')) ?? '') ?? '')
          hints.push(...kids(kid(node, 'Geometries'), 'Geometry3D').map((g) => attr(g, 'fileName') ?? ''))
          trusses.push({ name, world, hints: [name, ...hints].filter(Boolean), gdtfSpec: childText(node, 'GDTFSpec'), position: normalizeUuid(childText(node, 'Position')) ?? undefined })
          walk(kid(node, 'ChildList'), world, layer, layerIndex, groupPath)
          break
        }
        case 'Support':
        case 'FocusPoint':
          count(tag)
          walk(kid(node, 'ChildList'), world, layer, layerIndex, groupPath)
          break
        case 'Matrix':
        case 'Classing':
          break
        default:
          count(tag)
          break
      }
    }
    depthGuard--
  }

  function readFixture(kind: string, node: XNode, world: Transform, layer: string, layerIndex: number, groupPath: string[]): FixtureRec {
    const addresses = kids(kid(node, 'Addresses'), 'Address').map((a) => ({ brk: parseInt(attr(a, 'break') ?? '0', 10) || 0, raw: text(a) }))
    if (kid(node, 'CustomCommands') && kids(kid(node, 'CustomCommands'), 'CustomCommand').length) extras.customCommands++
    if (kids(kid(node, 'Mappings'), 'Mapping').length) extras.mappings++
    if (kids(kid(node, 'Connections'), 'Connection').length) extras.connections++
    if (kids(kid(node, 'Overwrites'), 'Overwrite').length) extras.overwrites++
    if (childText(node, 'Focus')) extras.focus++
    if (kid(node, 'Gobo') && text(kid(node, 'Gobo'))) extras.gobos++
    const bool = (tag: string) => /^(true|1|yes|on)$/i.test(childText(node, tag))
    return {
      kind,
      uuid: normalizeUuid(attr(node, 'uuid')) ?? `${layerIndex}-${fixtures.length + 1}`,
      name: attr(node, 'name') ?? '',
      world,
      gdtfSpec: childText(node, 'GDTFSpec'),
      gdtfMode: childText(node, 'GDTFMode'),
      fixtureId: childText(node, 'FixtureID'),
      fixtureIdNumeric: intOrNull(childText(node, 'FixtureIDNumeric')),
      customId: intOrNull(childText(node, 'CustomId')),
      unitNumber: intOrNull(childText(node, 'UnitNumber')),
      addresses,
      classing: normalizeUuid(childText(node, 'Classing')) ?? undefined,
      position: normalizeUuid(childText(node, 'Position')) ?? undefined,
      fn: childText(node, 'Function') || undefined,
      color: cieTextToHex(childText(node, 'Color')),
      multipatch: normalizeUuid(attr(node, 'multipatch')) ?? undefined,
      invertPan: bool('DMXInvertPan'),
      invertTilt: bool('DMXInvertTilt'),
      layer,
      layerIndex,
      groupPath
    }
  }

  // ---- fixture types ----
  const typeCache = new Map<string, Promise<ResolvedType>>()
  const usedIds = new Set<string>()
  const resolveType = (rec: FixtureRec, footprintHint: number | undefined): Promise<ResolvedType> => {
    const key = rec.gdtfSpec ? `spec:${rec.gdtfSpec.toLowerCase()}` : `name:${rec.name.toLowerCase()}|${rec.gdtfMode}`
    let p = typeCache.get(key)
    if (!p) {
      p = loadType(rec, footprintHint)
      typeCache.set(key, p)
    }
    return p
  }

  const register = (def: FixtureDefinition): FixtureDefinition => {
    let id = def.id
    for (let i = 2; usedIds.has(id); i++) id = `${def.id}-${i}`
    usedIds.add(id)
    const copy = id === def.id ? def : { ...def, id }
    fragment.fixtures.push(copy)
    return copy
  }

  async function loadType(rec: FixtureRec, footprintHint: number | undefined): Promise<ResolvedType> {
    const spec = rec.gdtfSpec
    const entry = spec ? (byName.get(spec.toLowerCase()) ?? byName.get(`${spec.toLowerCase()}.gdtf`)) : undefined
    const [specMfr, specModel] = spec.replace(/\.gdtf$/i, '').split('@')
    let parsed: FixtureDefinition | null = null
    if (entry) {
      try {
        if (entry.header.size > MAX_GDTF_BYTES) throw new Error('file too large')
        const data = new Uint8Array(entry.getData())
        try { parsed = await ctx.parseGdtf(data, entry.entryName) } catch { parsed = null }
        if (!parsed) parsed = parseGdtfArchive(data, entry.entryName).definition
      } catch (e) {
        warn('warning', 'mvr.gdtfUnreadable', `GDTF "${spec}" could not be read (${(e as Error).message}); looking the fixture type up in the library`, { file: spec })
      }
    } else if (spec) {
      warn('warning', 'mvr.gdtfMissing', `GDTF "${spec}" is not embedded in the MVR; looking the fixture type up in the library`, { file: spec })
    }
    const mfr = parsed?.manufacturer ?? (specModel ? specMfr : '')
    const model = parsed?.name ?? (specModel ?? specMfr ?? rec.name)
    const footprints = new Map((parsed?.modes ?? []).map((m) => [m.name, m.channelCount] as [string, number]))
    if (parsed && looksLikePlaceholderGdtf(parsed)) {
      const footprint = parsed.modes.find((m) => modeMatches(m.name, rec.gdtfMode))?.channelCount ?? footprintHint
      const lib = await safeFind(mfr, model, footprint)
      if (lib) {
        warn('info', 'mvr.placeholderReplaced', `"${mfr} ${model}": the MVR embeds a placeholder GDTF (generic dimmer channels); the library definition "${lib.manufacturer} ${lib.name}" is used instead`, { fixture: `${mfr} ${model}` })
        return { def: register(lib), how: 'library', footprints }
      }
      warn('warning', 'mvr.placeholderKept', `"${mfr} ${model}": the MVR embeds a placeholder GDTF (generic dimmer channels) and no library definition matches; channels are generic`, { fixture: `${mfr} ${model}` })
    }
    if (parsed) return { def: register(parsed), how: 'gdtf', footprints }
    if (mfr || model) {
      const lib = await safeFind(mfr, model, footprintHint)
      if (lib) {
        warn('info', 'mvr.libraryMatch', `"${[mfr, model].filter(Boolean).join(' ')}" resolved from the library as "${lib.manufacturer} ${lib.name}"`, { fixture: model })
        return { def: register(lib), how: 'library', footprints }
      }
    }
    // Generic definition from what the MVR says
    const channelsFromMode = /(\d+)\s*(?:ch|chan|channel|dmx)/i.exec(rec.gdtfMode)?.[1]
    const count = Math.max(1, Math.min(512, Number(channelsFromMode) || footprintHint || 1))
    const name = model || rec.name || 'Fixture'
    const channels: Record<string, FixtureChannel> = {}
    const list: string[] = []
    for (let i = 0; i < count; i++) {
      const chName = count === 1 ? 'Dimmer' : `Channel ${i + 1}`
      channels[chName] = count === 1
        ? { name: chName, type: 'intensity', precedence: 'HTP', highlightValue: 255 }
        : { name: chName, type: 'generic', precedence: 'LTP' }
      list.push(chName)
    }
    warn('warning', 'mvr.genericType', `No fixture type found for "${[mfr, name].filter(Boolean).join(' ')}": a generic ${count}-channel definition was created`, { fixture: name, channels: count })
    const def: FixtureDefinition = {
      id: `mvr/${slugify(mfr || 'generic') || 'generic'}/${slugify(name) || 'fixture'}`,
      name,
      manufacturer: mfr || 'Generic',
      categories: ['Other'],
      channels,
      modes: [{ name: rec.gdtfMode || `${count} channel`, channels: list, channelCount: count }],
      source: 'user'
    }
    return { def: register(def), how: 'generic', footprints }
  }

  async function safeFind(mfr: string, model: string, channelCount: number | undefined): Promise<FixtureDefinition | null> {
    if (!model) return null
    try {
      return (await ctx.findFixture(mfr, model, channelCount)) ?? (channelCount ? await ctx.findFixture(mfr, model) : null)
    } catch {
      return null
    }
  }

  // ---- patch ----
  const patch: PatchEntry[] = []
  const unpatched: PatchEntry[] = []
  const fidTaken = new Set<number>()
  const recByPatchId = new Map<string, FixtureRec>()
  let multiBreak = 0
  let duplicateFid = 0
  let multipatchCount = 0
  const modeIssues = new Map<string, { fixture: string; wanted: string; used: string; count: number; sameFootprint: boolean }>()

  for (const rec of fixtures) {
    const resolved = await resolveType(rec, undefined)
    const def = resolved.def
    const footprint = [...resolved.footprints].find(([n]) => modeMatches(n, rec.gdtfMode))?.[1]
    const mode = pickMode(def, rec.gdtfMode, footprint)
    if (!mode) continue
    if (rec.gdtfMode && !modeMatches(mode.name, rec.gdtfMode) && resolved.how !== 'generic') {
      const key = `${def.id}|${rec.gdtfMode}`
      const issue = modeIssues.get(key) ?? { fixture: def.name, wanted: rec.gdtfMode, used: mode.name, count: 0, sameFootprint: footprint === mode.channelCount }
      issue.count++
      modeIssues.set(key, issue)
    }
    const pos = mvrToPb(rec.world.o)
    const position3D = { x: round3(pos.x / 1000), y: round3(pos.y / 1000), z: round3(pos.z / 1000) }
    const aim = mountFromBeam(mvrToPb(beamOf(rec.world)), position3D.y)
    const entry: PatchEntry = {
      id: `mvr-${rec.uuid.toLowerCase()}`,
      fixtureDefId: def.id,
      modeName: mode.name,
      universe: 0,
      address: 1,
      name: rec.name || def.name,
      groupIds: [],
      position3D,
      mountingLocation: aim.mountingLocation,
      mountingAngle: aim.mountingAngle,
      mountingPan: aim.mountingPan
    }
    if (rec.invertPan) entry.panInvert = true
    if (rec.invertTilt) entry.tiltInvert = true
    // Fixture number: FixtureIDNumeric, then the FixtureID text, then the CustomId
    const fid = (rec.fixtureIdNumeric && rec.fixtureIdNumeric > 0 ? rec.fixtureIdNumeric : null) ?? numericId(rec.fixtureId) ?? (rec.customId && rec.customId > 0 ? rec.customId : null)
    if (rec.multipatch) multipatchCount++
    if (fid !== null) {
      if (fidTaken.has(fid)) duplicateFid++
      else { entry.fid = fid; fidTaken.add(fid) }
    }
    // Address: the lowest break that is patched
    const patchedAddrs = rec.addresses.map((a) => ({ brk: a.brk, addr: parseMvrAddress(a.raw) })).filter((a) => a.addr !== null).sort((a, b) => a.brk - b.brk)
    if (new Set(patchedAddrs.map((a) => a.brk)).size > 1) multiBreak++
    recByPatchId.set(entry.id, rec)
    if (patchedAddrs.length > 0) {
      entry.universe = patchedAddrs[0].addr!.universe
      entry.address = patchedAddrs[0].addr!.address
      if (entry.address + mode.channelCount - 1 > 512) {
        warn('warning', 'mvr.addressOverflow', `"${entry.name}" at ${entry.universe + 1}.${entry.address} (${mode.channelCount} ch) runs past the end of the universe`, { fixture: entry.name })
      }
      patch.push(entry)
    } else {
      unpatched.push(entry)
    }
  }

  // Unpatched fixtures: consecutive addresses in the first free universe
  if (unpatched.length > 0) {
    let universe = patch.reduce((m, p) => Math.max(m, p.universe), -1) + 1
    let next = 1
    for (const e of unpatched) {
      const size = fragment.fixtures.find((f) => f.id === e.fixtureDefId)?.modes.find((m) => m.name === e.modeName)?.channelCount ?? 1
      if (next + size - 1 > 512) { universe++; next = 1 }
      e.universe = universe
      e.address = next
      next += size
      patch.push(e)
    }
    warn('warning', 'mvr.unpatched', `${unpatched.length} fixture(s) have no DMX address in the MVR; they were placed from universe ${unpatched[0].universe + 1}, address 1 — check the patch`, { count: unpatched.length })
  }

  // Console order: fixture ID, then address
  patch.sort((a, b) => (a.fid ?? Number.MAX_SAFE_INTEGER) - (b.fid ?? Number.MAX_SAFE_INTEGER) || a.universe - b.universe || a.address - b.address)
  fragment.patch = patch

  for (const m of modeIssues.values()) {
    if (m.sameFootprint) warn('info', 'mvr.modeMapped', `${m.count} × "${m.fixture}": DMX mode "${m.wanted}" mapped to "${m.used}" (same channel count)`, { fixture: m.fixture, mode: m.wanted, count: m.count })
    else warn('warning', 'mvr.modeNotFound', `${m.count} × "${m.fixture}": DMX mode "${m.wanted}" not found; using "${m.used}" — check the footprint`, { fixture: m.fixture, mode: m.wanted, count: m.count })
  }
  if (multiBreak > 0) warn('warning', 'mvr.multiBreak', `${multiBreak} fixture(s) use several DMX breaks; only the first break is patched`, { count: multiBreak })
  if (duplicateFid > 0) warn('warning', 'mvr.duplicateFixtureId', `${duplicateFid} fixture(s) repeat a fixture ID already used; they get a new number`, { count: duplicateFid })
  if (multipatchCount > 0) warn('info', 'mvr.multipatch', `${multipatchCount} multipatch fixture(s) were imported as separate fixtures`, { count: multipatchCount })

  // ---- groups ----
  const groups: Group[] = []
  const memberKeys = new Set<string>()
  const addGroup = (name: string, members: PatchEntry[]) => {
    if (members.length === 0) return
    const ordered = [...members].sort((a, b) => (a.fid ?? Number.MAX_SAFE_INTEGER) - (b.fid ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name))
    const key = ordered.map((m) => m.id).join('|')
    if (memberKeys.has(key)) return
    memberKeys.add(key)
    const colors = new Set(ordered.map((m) => recByPatchId.get(m.id)?.color).filter(Boolean))
    const color = colors.size === 1 ? [...colors][0]! : GROUP_PALETTE[groups.length % GROUP_PALETTE.length]
    const id = `mvr-group-${groups.length + 1}`
    groups.push({ id, name, color, fixtureIds: ordered.map((m) => m.id), number: groups.length + 1 })
    for (const m of ordered) m.groupIds.push(id)
  }
  const by = (keyOf: (r: FixtureRec) => string | undefined): Map<string, PatchEntry[]> => {
    const m = new Map<string, PatchEntry[]>()
    for (const p of patch) {
      const k = keyOf(recByPatchId.get(p.id)!)
      if (!k) continue
      m.set(k, [...(m.get(k) ?? []), p])
    }
    return m
  }
  const byLayer = by((r) => r.layer)
  if (byLayer.size > 1) for (const [name, members] of byLayer) addGroup(name, members)
  for (const [uuid, members] of by((r) => r.position)) addGroup(positions.get(uuid) ?? 'Position', members)
  const byGroupObject = new Map<string, PatchEntry[]>()
  for (const p of patch) {
    const r = recByPatchId.get(p.id)!
    r.groupPath.forEach((_, i) => {
      const k = r.groupPath.slice(0, i + 1).join(' / ')
      byGroupObject.set(k, [...(byGroupObject.get(k) ?? []), p])
    })
  }
  for (const [path, members] of byGroupObject) addGroup(path.split(' / ').pop()!, members)
  const byClass = by((r) => r.classing)
  if (byClass.size > 1) for (const [uuid, members] of byClass) addGroup(classes.get(uuid) ?? 'Class', members)
  for (const [fn, members] of by((r) => r.fn)) addGroup(fn, members)
  fragment.groups = groups

  // ---- room + trusses ----
  fragment.roomConfig = buildRoom(patch, trusses, fixtures, warn)

  // ---- what was not imported ----
  const labels: Record<string, string> = { SceneObject: 'scene objects', FocusPoint: 'focus points', Support: 'supports', VideoScreen: 'video screens', Projector: 'projectors' }
  const parts = [...ignored.entries()].map(([k, n]) => `${n} ${labels[k] ?? k}`)
  if (parts.length) warn('info', 'mvr.ignoredObjects', `Not imported (no DMX fixture): ${parts.join(', ')}`, { count: [...ignored.values()].reduce((a, b) => a + b, 0) })
  if (extras.focus > 0) warn('info', 'mvr.focusPoints', `${extras.focus} fixture(s) reference a focus point; the fixtures keep the orientation of the MVR, focus points are not imported`, { count: extras.focus })
  const extraParts = [
    extras.customCommands && `${extras.customCommands} with custom commands`,
    extras.mappings && `${extras.mappings} with video mappings`,
    extras.connections && `${extras.connections} with connections`,
    extras.overwrites && `${extras.overwrites} with GDTF overwrites`,
    extras.gobos && `${extras.gobos} with a custom gobo`
  ].filter(Boolean)
  if (extraParts.length) warn('info', 'mvr.ignoredProperties', `Fixture properties not imported: ${extraParts.join(', ')}`)
  if (fixtures.length === 0) warn('warning', 'mvr.noFixtures', 'The MVR contains no DMX fixture')
  return fragment
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function modeMatches(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b || a.toLowerCase() === b.toLowerCase() || compactKey(a) === compactKey(b)
}

function pickMode(def: FixtureDefinition, wanted: string, footprint?: number): FixtureDefinition['modes'][number] | undefined {
  if (def.modes.length === 0) return undefined
  if (!wanted) return def.modes[0]
  const w = compactKey(wanted)
  const partial = (modes: FixtureDefinition['modes']) => w ? modes.find((m) => { const k = compactKey(m.name); return !!k && (k.includes(w) || w.includes(k)) }) : undefined
  return def.modes.find((m) => m.name === wanted)
    ?? def.modes.find((m) => modeMatches(m.name, wanted))
    ?? def.modes.find((m) => m.shortName && modeMatches(m.shortName, wanted))
    ?? (footprint ? partial(def.modes.filter((m) => m.channelCount === footprint)) ?? def.modes.find((m) => m.channelCount === footprint) : undefined)
    ?? partial(def.modes)
    ?? (/(\d+)\s*(?:ch|chan|channel)/i.test(wanted) ? def.modes.find((m) => m.channelCount === Number(/(\d+)\s*(?:ch|chan|channel)/i.exec(wanted)![1])) : undefined)
    ?? def.modes[0]
}

/** Truss length (m) from names like "DT34/3 … (3.5m)", "FOH 12m", "2500 mm" */
function trussLengthHint(hints: string[]): number | null {
  for (const h of hints) {
    const m = /(\d+(?:[.,]\d+)?)\s*m\b(?!m)/i.exec(h)
    if (m) { const v = Number(m[1].replace(',', '.')); if (v > 0.2 && v < 100) return v }
    const mm = /(\d{3,5})\s*mm\b/i.exec(h)
    if (mm) { const v = Number(mm[1]) / 1000; if (v > 0.2 && v < 100) return v }
  }
  return null
}

function buildRoom(patch: PatchEntry[], trusses: TrussRec[], fixtures: FixtureRec[], warn: (level: ImportWarning['level'], code: string, message: string, params?: Record<string, string | number>) => void): RoomConfig {
  const pts: Vec3[] = patch.map((p) => p.position3D!).filter(Boolean)
  // Trusses parallel to the stage front (local X along world X, horizontal)
  const bars: TrussBar[] = []
  let skipped = 0
  for (const t of trusses) {
    const axis = normalize(t.world.r[0])
    const o = mvrToPb(t.world.o)
    const origin = { x: o.x / 1000, y: o.y / 1000, z: o.z / 1000 }
    if (Math.abs(axis.x) < 0.97 || Math.abs(axis.z) > 0.1) { skipped++; continue }
    let len = trussLengthHint(t.hints)
    if (len === null) {
      // From the fixtures hanging on it
      const near = fixtures.map((f) => mvrToPb(f.world.o)).map((p) => ({ x: p.x / 1000, y: p.y / 1000, z: p.z / 1000 }))
        .filter((p) => Math.abs(p.z - origin.z) < 0.4 && p.y <= origin.y + 0.3 && p.y >= origin.y - 1.2)
      len = near.length ? Math.max(1, Math.max(...near.map((p) => Math.abs(p.x - origin.x))) + 0.5) : 2
    }
    const x0 = origin.x
    const x1 = origin.x + Math.sign(axis.x) * len
    bars.push({ id: `mvr-truss-${bars.length + 1}`, name: t.name || `Truss ${bars.length + 1}`, z: Math.round(origin.z * 100) / 100, y: Math.round(origin.y * 100) / 100, width: Math.max(Math.abs(x0), Math.abs(x1)) * 2 })
    pts.push({ x: x0, y: origin.y, z: origin.z }, { x: x1, y: origin.y, z: origin.z })
  }
  // Merge collinear segments (same height and depth)
  const merged: TrussBar[] = []
  for (const b of bars) {
    const same = merged.find((m) => Math.abs(m.z - b.z) < 0.15 && Math.abs(m.y - b.y) < 0.15)
    if (same) {
      same.width = Math.max(same.width, b.width)
      if (/^Truss \d+$/.test(same.name) && !/^Truss \d+$/.test(b.name)) same.name = b.name
    } else merged.push({ ...b })
  }
  merged.forEach((b, i) => { b.id = `mvr-truss-${i + 1}`; b.width = Math.round(b.width * 10) / 10 })
  if (skipped > 0) warn('info', 'mvr.trussesSkipped', `${skipped} truss(es) are not parallel to the stage front (towers, side or diagonal trusses) and are not drawn; their fixtures keep their positions`, { count: skipped })

  const maxAbsX = pts.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0)
  const maxAbsZ = pts.reduce((m, p) => Math.max(m, Math.abs(p.z)), 0)
  const maxY = pts.reduce((m, p) => Math.max(m, p.y), 0)
  const up = (n: number) => Math.ceil(n * 2) / 2
  const width = up(Math.max(8, maxAbsX * 2 + 2))
  const depth = up(Math.max(6, maxAbsZ * 2 + 2))
  const height = up(Math.max(4, maxY + 1))
  return { width, depth, height, trussBars: merged.slice(0, 32), stageEdgeZ: 0 }
}
