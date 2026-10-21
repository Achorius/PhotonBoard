// ============================================================
// PhotonBoard — grandMA model → ImportedShowFragment (pure)
//
// 1. fixture types: definitions written in the file (MA3 FixtureType
//    XML, GDTF next to it) → library / offline catalog (ctx.findFixture)
//    → generic definition built from what the file tells (footprint +
//    attributes used by its cues / presets), with a warning.
// 2. patch: declared fixtures (MA2 layer export, MA3 patch export);
//    fixtures only referenced by number (FID / CID) in cues, presets or
//    groups become placeholders, patched on a free "parking" universe and
//    listed in `placeholderFixtureIds` so the merge step can bind them to
//    fixtures of the open show that have the same FID.
// 3. values: percent → DMX (16-bit when the mode has a fine channel),
//    pan / tilt degrees → DMX through the fixture's pan / tilt range.
// ============================================================

import { emptyFragment, type ImportContext, type ImportedShowFragment, type ImportWarning } from '../../../shared/interchange'
import { presetFamilyOf } from '../../../shared/attribute-families'
import {
  PRESET_FAMILY_NUMBER,
  type Cue, type CueChannelValue, type Cuelist, type Effect, type FixtureChannel, type FixtureDefinition,
  type FixtureMode, type Group, type PatchEntry, type Preset, type PresetType, type WaveformType
} from '../../../shared/types'
import { findChannelForAttribute, findFineChannel, maAttributeInfo } from './attributes'
import { addWarning, refKey, type MaDocument, type MaFixtureDecl, type MaFixtureType, type MaRef, type MaValue } from './model'

const GROUP_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1']
const DEFAULT_PAN_RANGE = 540
const DEFAULT_TILT_RANGE = 270

/** grandMA preset pool → PhotonBoard family */
export function presetTypeOfPool(pool: number | undefined): PresetType | undefined {
  switch (pool) {
    case 1: return 'intensity'
    case 2: return 'position'
    case 3: return 'gobo'
    case 4: return 'color'
    case 5: return 'beam'
    case 6: return 'focus'
    case 7: return 'control'
    case 8: return 'beam' // Shapers
    case 9: return 'control' // Video
    case 0: case 21: case 22: case 23: case 24: case 25: return 'full'
    default: return undefined
  }
}

interface Resolved {
  entry: PatchEntry
  def: FixtureDefinition
  mode: FixtureMode
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
}

/** "3 Mac 250+ Mode 2", "FixtureType 3 'Mac Aura'", "Robe@Robin MegaPointe" → manufacturer + model */
export function splitTypeName(raw: string, manufacturer?: string): { manufacturer: string; model: string } {
  let s = raw.trim().replace(/^FixtureType\s+/i, '').replace(/^\d+\s+/, '').replace(/^['"]|['"]$/g, '').trim()
  let mfr = manufacturer?.trim() ?? ''
  const at = s.indexOf('@')
  if (at > 0) {
    if (!mfr) mfr = s.slice(0, at).trim()
    s = s.slice(at + 1).trim()
  }
  return { manufacturer: mfr, model: s }
}

function typeKey(name: string): string {
  const { model } = splitTypeName(name)
  return model.toLowerCase().replace(/\s+/g, ' ')
}

/** Definition from a grandMA3 FixtureType (XML) */
export function maFixtureTypeToDefinition(ft: MaFixtureType): FixtureDefinition {
  const { manufacturer, model } = splitTypeName(ft.name, ft.manufacturer)
  const channels: Record<string, FixtureChannel> = {}
  const modes: FixtureMode[] = []
  for (const m of ft.modes) {
    const slots: string[] = []
    const used = new Map<string, number>()
    for (const ch of [...m.channels].sort((a, b) => a.coarse - b.coarse)) {
      const info = maAttributeInfo(ch.attribute)
      const count = (used.get(info.name) ?? 0) + 1
      used.set(info.name, count)
      const name = count > 1 ? `${info.name} ${count}` : info.name
      if (!channels[name]) channels[name] = makeChannel(name, info.type, ch.default)
      slots[ch.coarse - 1] = name
      if (ch.fine) {
        const fine = `${name} fine`
        if (!channels[fine]) channels[fine] = { ...makeChannel(fine, info.type), fineOf: name }
        slots[ch.fine - 1] = fine
      }
    }
    const list: string[] = []
    for (let i = 0; i < slots.length; i++) {
      const n = slots[i] ?? `Ch ${i + 1}`
      if (!channels[n]) channels[n] = makeChannel(n, 'generic')
      list.push(n)
    }
    if (list.length > 0) modes.push({ name: m.name || `Mode ${modes.length + 1}`, channels: list, channelCount: list.length })
  }
  if (modes.length === 0) {
    channels.Dimmer = makeChannel('Dimmer', 'intensity')
    modes.push({ name: 'Default', channels: ['Dimmer'], channelCount: 1 })
  }
  const mfr = manufacturer || 'grandMA'
  return {
    id: `ma-import/${slug(mfr)}-${slug(model)}`,
    name: model || 'grandMA fixture',
    manufacturer: mfr,
    shortName: ft.shortName,
    categories: guessCategories(channels),
    channels, modes,
    source: 'user'
  }
}

function makeChannel(name: string, type: FixtureChannel['type'], defaultValue?: number): FixtureChannel {
  return {
    name, type,
    defaultValue: defaultValue ?? (type === 'pan' || type === 'tilt' ? 128 : 0),
    precedence: type === 'intensity' ? 'HTP' : 'LTP'
  }
}

function guessCategories(channels: Record<string, FixtureChannel>): string[] {
  const types = new Set(Object.values(channels).map(c => c.type))
  if (types.has('pan') || types.has('tilt')) return ['Moving Head']
  if (types.has('color')) return ['Color Changer']
  if (Object.keys(channels).length === 1 && types.has('intensity')) return ['Dimmer']
  return ['Other']
}

/** A definition built from attribute names only (no channel layout in the file) */
function genericDefinition(id: string, name: string, attributes: string[], footprint: number | undefined): FixtureDefinition {
  const infos = [...new Map(attributes.map(a => [maAttributeInfo(a).name, maAttributeInfo(a)])).values()]
    .sort((a, b) => a.order - b.order)
  const channels: Record<string, FixtureChannel> = {}
  const list: string[] = []
  for (const info of infos) {
    channels[info.name] = makeChannel(info.name, info.type)
    list.push(info.name)
  }
  const total = Math.max(list.length, footprint ?? 0, 1)
  if (list.length === 0) {
    channels.Dimmer = makeChannel('Dimmer', 'intensity')
    list.push('Dimmer')
  }
  while (list.length < total) {
    const n = `Ch ${list.length + 1}`
    channels[n] = makeChannel(n, 'generic')
    list.push(n)
  }
  return {
    id, name, manufacturer: 'grandMA (imported)', categories: guessCategories(channels), channels,
    modes: [{ name: `${list.length}ch`, channels: list, channelCount: list.length }],
    source: 'user'
  }
}

const GENERIC_DIMMER: FixtureDefinition = {
  id: 'ma-import/generic-dimmer', name: 'Dimmer', manufacturer: 'Generic', categories: ['Dimmer'],
  channels: { Dimmer: { name: 'Dimmer', type: 'intensity', defaultValue: 0, precedence: 'HTP' } },
  modes: [{ name: '1ch', channels: ['Dimmer'], channelCount: 1 }],
  source: 'user'
}

function pickMode(def: FixtureDefinition, modeName: string | undefined, footprint: number | undefined): FixtureMode {
  if (modeName) {
    const clean = modeName.replace(/^DMXMode\s+/i, '').replace(/^\d+\s+/, '').replace(/^['"]|['"]$/g, '').trim().toLowerCase()
    const exact = def.modes.find(m => m.name.toLowerCase() === clean || m.shortName?.toLowerCase() === clean)
    if (exact) return exact
  }
  if (footprint) {
    const byCount = def.modes.find(m => m.channelCount === footprint)
    if (byCount) return byCount
  }
  return def.modes[0]
}

function patchIdOf(ref: MaRef): string {
  if (ref.idType === 'fixture') return `ma-fix-${ref.id}`
  if (ref.idType === 'channel') return `ma-ch-${ref.id}`
  return `ma-${slug(ref.idType)}-${ref.id}`
}

function refLabel(ref: MaRef): string {
  const t = ref.idType === 'fixture' ? 'Fixture' : ref.idType === 'channel' ? 'Channel' : ref.idType
  return `${t} ${ref.id}`
}

const deg2rad = (d: number) => (d * Math.PI) / 180

export async function buildFragment(doc: MaDocument, ctx: ImportContext, fileName: string): Promise<ImportedShowFragment> {
  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  const frag: ImportedShowFragment = emptyFragment(doc.format, doc.showName || baseName)
  if (doc.sourceApp) frag.sourceApp = doc.sourceApp
  const warn = (level: ImportWarning['level'], code: string, message: string, params?: Record<string, string | number>) =>
    addWarning(frag.warnings, { level, code, message, params })
  for (const w of doc.warnings) addWarning(frag.warnings, w)

  // ---- 1. fixture types written in the file
  const fileDefs = new Map<string, FixtureDefinition>()
  for (const ft of doc.fixtureTypes) {
    const d = maFixtureTypeToDefinition(ft)
    fileDefs.set(typeKey(ft.name), d)
    if (ft.shortName) fileDefs.set(typeKey(ft.shortName), d)
  }
  for (const d of doc.embeddedDefinitions) {
    fileDefs.set(typeKey(d.name), d)
    fileDefs.set(typeKey(`${d.manufacturer}@${d.name}`), d)
  }
  const outDefs = new Map<string, FixtureDefinition>()

  // ---- 2. attributes used per fixture
  const usage = new Map<string, Set<string>>()
  const referenced = new Map<string, MaRef>()
  const use = (ref: MaRef, attribute?: string) => {
    if (ref.idType === 'universal') return
    const k = refKey(ref)
    if (!referenced.has(k)) referenced.set(k, { idType: ref.idType, id: ref.id })
    if (!attribute) return
    let set = usage.get(k)
    if (!set) usage.set(k, (set = new Set()))
    set.add(attribute)
  }
  for (const s of doc.sequences) for (const c of s.cues) for (const v of c.values) use(v.ref, v.attribute)
  for (const p of doc.presets) for (const v of p.values) use(v.ref, v.attribute)
  for (const e of doc.effects) for (const l of e.lines) for (const r of l.fixtures) use(r, l.attribute)
  for (const g of doc.groups) for (const r of g.items) use(r)

  // ---- 3. declared fixtures → patch
  const resolved = new Map<string, Resolved>()
  const lookupCache = new Map<string, FixtureDefinition | null>()
  let maxUniverse = -1
  const declared = new Map<string, MaFixtureDecl>()
  for (const d of doc.fixtures) {
    const k = refKey(d.ref)
    if (declared.has(k)) {
      warn('info', 'ma.duplicateFixture', 'A fixture number appears more than once (multipatch); only the first is imported', { fixture: refLabel(d.ref), count: 1 })
      continue
    }
    declared.set(k, d)
    if (d.universe !== undefined && d.address !== undefined) maxUniverse = Math.max(maxUniverse, d.universe)
  }

  const typeAttributes = new Map<string, Set<string>>()
  for (const [k, d] of declared) {
    const tk = typeKey(d.typeName ?? '')
    let set = typeAttributes.get(tk)
    if (!set) typeAttributes.set(tk, (set = new Set()))
    for (const a of usage.get(k) ?? []) set.add(a)
  }

  async function resolveType(d: MaFixtureDecl): Promise<{ def: FixtureDefinition; embedded: boolean }> {
    const typeName = d.typeName?.trim() || 'Unknown'
    const tk = typeKey(typeName)
    const inFile = fileDefs.get(tk)
    if (inFile) return { def: inFile, embedded: true }
    const { manufacturer, model } = splitTypeName(typeName, d.typeManufacturer)
    const attrs = [...(typeAttributes.get(tk) ?? [])]
    if (/^(generic\s+)?dimmer(\s*\d+)?$/i.test(model) || (d.footprint === 1 && attrs.every(a => maAttributeInfo(a).key === 'dimmer'))) {
      return { def: GENERIC_DIMMER, embedded: true }
    }
    const cacheKey = `${manufacturer}|${model}|${d.footprint ?? ''}`
    if (!lookupCache.has(cacheKey)) {
      let found: FixtureDefinition | null = null
      const candidates = [model, model.replace(/\s+(mode\s*\S+|\d+\s*ch\w*|00|standard|basic|extended|16\s*bit.*|vector|shapes only.*)$/i, '').trim()]
      for (const cand of [...new Set(candidates)].filter(Boolean)) {
        try {
          found = await ctx.findFixture(manufacturer, cand, d.footprint)
          if (!found && d.footprint) found = await ctx.findFixture(manufacturer, cand)
        } catch { found = null }
        if (found) break
      }
      lookupCache.set(cacheKey, found)
    }
    const found = lookupCache.get(cacheKey)
    if (found) return { def: found, embedded: false }
    const id = `ma-import/${slug(model)}${d.footprint ? `-${d.footprint}ch` : ''}`
    let generic = outDefs.get(id)
    if (!generic) {
      generic = genericDefinition(id, model, attrs, d.footprint)
      warn('warning', 'ma.genericFixtureType',
        `Fixture type "${typeName}" was not found in the library or catalog: a generic type was built from the attributes used in the file (DMX channel order is a guess). Replace it with the real fixture type.`,
        { type: typeName })
    }
    return { def: generic, embedded: true }
  }

  const unpatched: string[] = []
  for (const [k, d] of declared) {
    const { def, embedded } = await resolveType(d)
    if (embedded) outDefs.set(def.id, def)
    const mode = pickMode(def, d.modeName, d.footprint)
    if (d.footprint && mode.channelCount !== d.footprint && !def.id.startsWith('ma-import/')) {
      warn('warning', 'ma.footprintMismatch', `Fixture type "${def.name}": no mode with ${d.footprint} channels, mode "${mode.name}" used`, { type: def.name, footprint: d.footprint, mode: mode.name })
    }
    const entry: PatchEntry = {
      id: patchIdOf(d.ref),
      fixtureDefId: def.id,
      modeName: mode.name,
      universe: d.universe ?? 0,
      address: d.address ?? 1,
      name: d.name?.trim() || `${def.name} ${d.ref.id}`,
      groupIds: []
    }
    if (d.ref.idType === 'fixture' || (d.ref.idType === 'channel' && !declared.has(`fixture:${d.ref.id}`))) entry.fid = d.ref.id
    if (d.position) entry.position3D = { x: round3(d.position.x), y: round3(d.position.z), z: round3(d.position.y) }
    if (d.rotation) entry.rotation3D = { rx: round3(deg2rad(d.rotation.x)), ry: round3(deg2rad(d.rotation.z)), rz: round3(deg2rad(d.rotation.y)) }
    if (d.extraBreaks) warn('info', 'ma.multiBreak', 'Fixtures with several DMX breaks or multipatch addresses: only the first address is imported', { fixture: entry.name, count: 1 })
    resolved.set(k, { entry, def, mode })
    if (d.universe === undefined || d.address === undefined) unpatched.push(k) // parked below
  }

  // ---- 4. parking universe for unpatched and placeholder fixtures
  const parkUniverse = Math.min(15, maxUniverse + 1)
  let parkU = parkUniverse
  let parkAddr = 1
  const park = (entry: PatchEntry, mode: FixtureMode) => {
    const size = Math.max(1, mode.channelCount)
    if (parkAddr + size - 1 > 512) {
      if (parkU < 15) { parkU++; parkAddr = 1 } else { parkAddr = 1 }
    }
    entry.universe = parkU
    entry.address = parkAddr
    parkAddr += size
  }
  for (const k of unpatched) {
    const r = resolved.get(k)!
    park(r.entry, r.mode)
  }
  if (unpatched.length > 0) {
    warn('warning', 'ma.unpatchedFixtures', `${unpatched.length} fixture(s) had no DMX address in the file; they were patched from universe ${parkUniverse + 1}`, { count: unpatched.length, universe: parkUniverse + 1 })
  }

  const placeholders: string[] = []
  const placeholderDefs = new Map<string, FixtureDefinition>()
  for (const [k, ref] of referenced) {
    if (resolved.has(k)) continue
    const attrs = [...(usage.get(k) ?? [])]
    const sig = [...new Set(attrs.map(a => maAttributeInfo(a).name))].sort((a, b) => maAttributeInfo(a).order - maAttributeInfo(b).order)
    const id = `ma-import/placeholder-${slug(sig.join('-') || 'dimmer')}`
    let def = placeholderDefs.get(id)
    if (!def) {
      def = genericDefinition(id, `grandMA fixture (${sig.join(', ') || 'Dimmer'})`, attrs, undefined)
      placeholderDefs.set(id, def)
      outDefs.set(id, def)
    }
    const mode = def.modes[0]
    const entry: PatchEntry = {
      id: patchIdOf(ref), fixtureDefId: def.id, modeName: mode.name, universe: 0, address: 1,
      name: refLabel(ref), groupIds: []
    }
    if (ref.idType === 'fixture' || (ref.idType === 'channel' && !referenced.has(`fixture:${ref.id}`) && !declared.has(`fixture:${ref.id}`))) entry.fid = ref.id
    park(entry, mode)
    resolved.set(k, { entry, def, mode })
    placeholders.push(entry.id)
  }
  if (placeholders.length > 0) {
    warn('warning', 'ma.placeholderFixtures',
      `${placeholders.length} fixture(s) are used by cues, presets or groups but their patch is not in the file: placeholders were created from universe ${parkUniverse + 1}. Import the patch too (grandMA3: Patch export / MVR; grandMA2: fixture layer XML) or merge into a show that has the same fixture IDs.`,
      { count: placeholders.length, universe: parkUniverse + 1 })
    frag.placeholderFixtureIds = placeholders
  }

  for (const r of resolved.values()) frag.patch.push(r.entry)
  frag.fixtures.push(...outDefs.values())

  // ---- value conversion
  const channelCache = new Map<string, string | null>()
  let rangeWarned = false
  const unmapped = new Set<string>()
  const physicalSkipped = new Set<string>()
  let relativeSkipped = 0

  function fraction(v: MaValue, r: Resolved, channel: string): number | null {
    const info = maAttributeInfo(v.attribute)
    if (v.unit === 'relative') { relativeSkipped++; return null }
    if (v.unit === 'physical' && info.physical === 'degrees') {
      const ch = r.def.channels[channel]
      let range = ch?.physicalFrom !== undefined && ch?.physicalTo !== undefined ? Math.abs(ch.physicalTo - ch.physicalFrom) : undefined
      if (!range) range = info.key === 'pan' ? r.def.physical?.panRange : r.def.physical?.tiltRange
      if (!range) {
        range = info.key === 'pan' ? DEFAULT_PAN_RANGE : DEFAULT_TILT_RANGE
        if (!rangeWarned) {
          rangeWarned = true
          warn('info', 'ma.assumedRange', `Pan / tilt values are in degrees: fixture types without a pan / tilt range use ${DEFAULT_PAN_RANGE}° / ${DEFAULT_TILT_RANGE}°`, { pan: DEFAULT_PAN_RANGE, tilt: DEFAULT_TILT_RANGE })
        }
      }
      return clamp01(0.5 + v.value / range)
    }
    if (v.unit === 'physical' && info.key !== 'dimmer') {
      physicalSkipped.add(v.attribute)
      return null
    }
    return clamp01(v.value / 100)
  }

  function convert(v: MaValue): { patchId: string; values: { channel: string; dmx: number }[] } | null {
    const r = resolved.get(refKey(v.ref))
    if (!r) return null
    const ck = `${r.def.id}|${r.mode.name}|${v.attribute}|${v.ref.sub ?? 1}`
    let channel = channelCache.get(ck)
    if (channel === undefined) {
      channel = findChannelForAttribute(r.def, r.mode, v.attribute, v.ref.sub ?? 1)
      channelCache.set(ck, channel)
    }
    if (!channel) {
      unmapped.add(`${v.attribute} (${r.def.name})`)
      return null
    }
    const f = fraction(v, r, channel)
    if (f === null) return null
    const fine = findFineChannel(r.def, r.mode, channel)
    if (fine) {
      const v16 = Math.round(f * 65535)
      return { patchId: r.entry.id, values: [{ channel, dmx: v16 >> 8 }, { channel: fine, dmx: v16 & 255 }] }
    }
    return { patchId: r.entry.id, values: [{ channel, dmx: Math.round(f * 255) }] }
  }

  // ---- groups
  doc.groups.forEach((g, i) => {
    const id = `ma-grp-${i + 1}`
    const fixtureIds: string[] = []
    for (const ref of g.items) {
      const r = resolved.get(refKey(ref))
      if (r && !fixtureIds.includes(r.entry.id)) {
        fixtureIds.push(r.entry.id)
        if (!r.entry.groupIds.includes(id)) r.entry.groupIds.push(id)
      }
    }
    const group: Group = { id, name: g.name || `Group ${i + 1}`, color: GROUP_COLORS[i % GROUP_COLORS.length], fixtureIds }
    if (g.number !== undefined) group.number = g.number
    frag.groups.push(group)
  })

  // ---- presets
  const presetByRef = new Map<string, Preset>()
  const nextNumber = new Map<PresetType, number>()
  doc.presets.forEach((p, i) => {
    const values: Record<string, Record<string, number>> = {}
    const universal: Record<string, number> = {}
    const families = new Set<PresetType>()
    for (const v of p.values) {
      if (v.ref.idType === 'universal') {
        const info = maAttributeInfo(v.attribute)
        if (v.unit === 'relative') { relativeSkipped++; continue }
        let f: number
        if (v.unit === 'physical' && info.physical === 'degrees') f = clamp01(0.5 + v.value / (info.key === 'pan' ? DEFAULT_PAN_RANGE : DEFAULT_TILT_RANGE))
        else f = clamp01(v.value / 100)
        universal[info.key] = Math.round(f * 255)
        families.add(presetFamilyOf(info.name, info.type))
        continue
      }
      const c = convert(v)
      if (!c) continue
      const r = resolved.get(refKey(v.ref))!
      const target = (values[c.patchId] ??= {})
      for (const x of c.values) {
        target[x.channel] = x.dmx
        const ch = r.def.channels[x.channel]
        if (!ch?.fineOf) families.add(presetFamilyOf(x.channel, ch?.type, ch?.precedence))
      }
    }
    const type = presetTypeOfPool(p.pool) ?? (families.size === 1 ? [...families][0] : 'full')
    const number = p.number ?? (nextNumber.get(type) ?? 1)
    nextNumber.set(type, Math.max(nextNumber.get(type) ?? 1, number + 1))
    const preset: Preset = { id: `ma-pre-${i + 1}`, name: p.name || `Preset ${PRESET_FAMILY_NUMBER[type]}.${number}`, type, values, number }
    if (Object.keys(universal).length > 0) {
      preset.universal = universal
      preset.scope = Object.keys(values).length > 0 ? 'selective' : 'universal'
    } else {
      preset.scope = 'selective'
    }
    if (p.scope === 'global') {
      warn('info', 'ma.globalPreset', 'Global presets are imported with the values of the fixtures they were stored for (selective)')
    }
    frag.presets.push(preset)
    if (p.pool !== undefined && p.number !== undefined) presetByRef.set(`${p.pool}.${p.number}`, preset)
  })

  // ---- cuelists
  const usedSeqNumbers = new Set(doc.sequences.map(s => s.number).filter((n): n is number => n !== undefined))
  let autoSeq = 1
  let unsupportedTriggers = new Set<string>()
  doc.sequences.forEach((s, si) => {
    const cues = [...s.cues].sort((a, b) => a.number - b.number)
    const out: Cue[] = []
    cues.forEach((c, ci) => {
      const valueMap = new Map<string, CueChannelValue>()
      for (const v of c.values) {
        const conv = convert(v)
        if (!conv) continue
        for (const x of conv.values) {
          const cv: CueChannelValue = { fixtureId: conv.patchId, channelName: x.channel, value: x.dmx }
          if (v.fade !== undefined) cv.fade = v.fade
          if (v.delay !== undefined) cv.delay = v.delay
          if (v.part !== undefined && v.part > 0) cv.part = v.part
          if (v.presetRef) {
            const p = presetByRef.get(v.presetRef)
            if (p) cv.presetId = p.id
          }
          valueMap.set(`${cv.fixtureId}|${cv.channelName}|${cv.part ?? 0}`, cv)
        }
      }
      const fadeIn = c.fade ?? 0
      const cue: Cue = {
        id: `ma-seq-${si + 1}-cue-${ci + 1}`,
        name: c.name?.trim() || `Cue ${c.number}`,
        number: c.number,
        values: [...valueMap.values()],
        fadeIn,
        fadeOut: c.outFade ?? fadeIn,
        delay: c.delay ?? 0,
        followTime: null
      }
      if (c.featureTiming && Object.keys(c.featureTiming).length > 0) cue.featureTiming = c.featureTiming
      if (c.parts && c.parts.length > 0) cue.parts = c.parts
      if (c.block) cue.block = true
      out.push(cue)
    })
    // grandMA triggers sit on the cue that is started automatically;
    // PhotonBoard's follow sits on the cue before it.
    for (let i = 0; i < cues.length; i++) {
      const trig = cues[i].trig
      if (!trig || trig === 'go' || trig === '') continue
      const prevIndex = i > 0 ? i - 1 : (s.loop ? cues.length - 1 : -1)
      if (trig === 'follow' || trig === 'time') {
        if (prevIndex < 0 || prevIndex === i) continue
        const prev = out[prevIndex]
        if (trig === 'follow') { prev.followTime = 0; prev.followMode = 'after-fade' } else { prev.followTime = cues[i].trigTime ?? 0; prev.followMode = 'after-go' }
      } else {
        unsupportedTriggers.add(trig)
      }
    }
    let number = s.number
    if (number === undefined) {
      while (usedSeqNumbers.has(autoSeq)) autoSeq++
      number = autoSeq++
    }
    const cl: Cuelist = {
      id: `ma-seq-${si + 1}`,
      name: s.name || `Sequence ${number}`,
      cues: out,
      currentCueIndex: -1,
      isPlaying: false,
      isLooping: s.loop ?? false,
      priority: s.priority ?? 50,
      faderLevel: 255,
      flash: false,
      number
    }
    if (s.tracking !== undefined) cl.tracking = s.tracking
    frag.cuelists.push(cl)
  })
  if (unsupportedTriggers.size > 0) {
    warn('warning', 'ma.triggerUnsupported', `Cue triggers not available in PhotonBoard were imported as manual GO: ${[...unsupportedTriggers].join(', ')}`, { triggers: [...unsupportedTriggers].join(', ') })
    unsupportedTriggers = new Set()
  }

  // ---- macros
  doc.macros.forEach((m, i) => {
    frag.macros.push({
      id: `ma-mac-${i + 1}`,
      number: m.number ?? i + 1,
      name: m.name || `Macro ${i + 1}`,
      lines: m.lines.map(l => (l.wait !== undefined && l.wait > 0 ? { command: l.command, wait: l.wait } : { command: l.command }))
    })
  })
  if (doc.macros.length > 0) {
    warn('info', 'ma.macroSyntax', 'Macro lines keep their grandMA command text; check them against the PhotonBoard command line (keywords like Store, Label, Assign or options /Merge are grandMA-specific)')
  }

  // ---- effects (grandMA2 effect lines)
  let effectIndex = 0
  for (const e of doc.effects) {
    for (const line of e.lines) {
      const info = maAttributeInfo(line.attribute)
      const fixtureIds = line.fixtures.map(r => resolved.get(refKey(r))?.entry.id).filter((x): x is string => !!x)
      const low = line.low ?? 0
      const high = line.high ?? 100
      const scale = info.physical === 'degrees' ? 1 / (info.key === 'pan' ? DEFAULT_PAN_RANGE : DEFAULT_TILT_RANGE) : 1 / 100
      const fx: Effect = {
        id: `ma-fx-${++effectIndex}`,
        name: e.lines.length > 1 ? `${e.name} ${info.name}` : e.name,
        waveform: waveformOf(line.form),
        speed: line.rate && line.rate > 0 ? round3(line.rate) : 1,
        depth: Math.round(clamp01(Math.abs(high - low) * scale) * 255),
        offset: 0,
        channelType: info.name,
        fixtureIds,
        fan: Math.abs((line.phaseTo ?? 0) - (line.phaseFrom ?? 0)) % 361,
        isRunning: false
      }
      if (e.number !== undefined) fx.number = e.number
      frag.effects.push(fx)
    }
  }
  if (doc.effects.length > 0) warn('info', 'ma.effectApproximate', 'grandMA effects are approximated (form → waveform, low / high → depth, phase spread → fan); speed is not exported by grandMA and was set to 1 Hz × rate')

  if (unmapped.size > 0) {
    warn('warning', 'ma.attributeNotMapped', `Values of attributes without a matching channel were skipped: ${[...unmapped].slice(0, 12).join(', ')}${unmapped.size > 12 ? '…' : ''}`, { count: unmapped.size, attributes: `${[...unmapped].slice(0, 12).join(', ')}${unmapped.size > 12 ? '…' : ''}` })
  }
  if (physicalSkipped.size > 0) {
    warn('warning', 'ma.physicalValue', `Values stored in physical units (Hz, °K…) cannot be converted to DMX and were skipped: ${[...physicalSkipped].join(', ')}`, { attributes: [...physicalSkipped].join(', ') })
  }
  if (relativeSkipped > 0) {
    warn('warning', 'ma.relativeValue', `${relativeSkipped} relative value(s) (grandMA relative layer) were skipped`, { count: relativeSkipped })
  }
  return frag
}

function waveformOf(form: string | undefined): WaveformType {
  const f = (form ?? '').toLowerCase()
  if (/sin|cos|circle/.test(f)) return 'sine'
  if (/ramp|saw/.test(f)) return 'sawtooth'
  if (/pwm|square|step|flyout|chase/.test(f)) return 'square'
  if (/random/.test(f)) return 'random'
  if (/bump|pulse/.test(f)) return 'pulse'
  if (/swing|triangle|phase/.test(f)) return 'triangle'
  return 'sine'
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
