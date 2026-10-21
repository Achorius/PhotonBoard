// ============================================================
// PhotonBoard — grandMA3 XML export reader (pure)
//
// grandMA3 writes objects as `<GMA3 DataVersion="x.y.z.w">` XML with the
// `Export` command / the pool "Export" buttons (gma3_library folders):
//   <Sequence Name Tracking WrapAround…><Cue No Name TrigType TrigTime>
//     <Part CueInFade CueOutFade CueInDelay…><…><Phaser IDType ID Attribute>
//       <Step Absolute|AbsolutePhys|Relative…/></Phaser>
//   <Preset Name PresetModeInternal><PresetData><Phaser…><Step…/>
//   <Group Name><SelectionData><Item IDType ID X Y Z/>
//   <Macro Name><MacroLine Command Wait/>
//   <FixtureType Name Manufacturer><DMXModes><DMXMode Name><DMXChannels>
//     <DMXChannel Coarse Fine Default><LogicalChannel Attribute>
//   patch export (2.4+): <Fixture FID CID IDType Name FixtureType Mode Patch>
// Values are found wherever <Phaser> appears under a cue part / preset,
// so wrapper elements that differ between versions do not matter.
// Absolute = percent, AbsolutePhys = physical unit (degrees for pan / tilt).
// ============================================================

import type { CueFeature, CuePart, PresetScope } from '../../../shared/types'
import {
  addWarning, emptyMaDocument, idTypeName, parseMaId,
  type MaCue, type MaDocument, type MaFixtureDecl, type MaFixtureType, type MaFixtureTypeChannel, type MaGroup,
  type MaMacro, type MaPreset, type MaRef, type MaSequence, type MaValue, type MaValueUnit
} from './model'
import { attr, child, childTags, children, cueNumber, descendants, maTime, num, yes, type XmlNode } from './xml'

/** grandMA3 preset timing slots (Preset1Fade…Preset7Fade) → cue feature */
const PRESET_SLOT_FEATURE: Record<number, CueFeature> = {
  1: 'intensity', 2: 'position', 3: 'beam', 4: 'colour', 5: 'beam', 6: 'beam', 7: 'control'
}

const HANDLED = new Set(['sequence', 'sequences', 'preset', 'presets', 'group', 'groups', 'macro', 'macros', 'fixturetype',
  'fixturetypes', 'fixture', 'fixtures', 'patch', 'stages', 'stage', 'layers', 'layer'])

export function readMa3Xml(root: XmlNode, doc: MaDocument = emptyMaDocument('ma3-xml')): MaDocument {
  const gma3 = children(root, 'GMA3')[0]
  if (!gma3) throw new Error('Not a grandMA3 XML file')
  const version = attr(gma3, 'DataVersion')
  if (version && !doc.sourceApp) doc.sourceApp = `grandMA3 ${version}`

  const warn = (level: 'info' | 'warning', code: string, message: string, params?: Record<string, string | number>) =>
    addWarning(doc.warnings, { level, code, message, params })

  // ---- fixture types (patch / library export)
  for (const ft of descendants(gma3, 'FixtureType')) {
    const t = readFixtureType(ft)
    if (t) doc.fixtureTypes.push(t)
  }

  // ---- patch: Fixture elements that carry a patch / type (not FixtureType internals)
  for (const fx of descendants(gma3, 'Fixture')) {
    const decl = readFixture(fx)
    if (decl) doc.fixtures.push(decl)
  }

  // ---- data pool objects
  for (const s of descendants(gma3, 'Sequence')) doc.sequences.push(readSequence(s, doc))
  for (const p of descendants(gma3, 'Preset')) doc.presets.push(readPreset(p, doc))
  for (const g of descendants(gma3, 'Group')) {
    const grp = readGroup(g)
    if (grp) doc.groups.push(grp)
  }
  for (const m of descendants(gma3, 'Macro')) doc.macros.push(readMacro(m))

  const other = childTags(gma3).filter(t => !HANDLED.has(t.toLowerCase()))
  if (other.length > 0) {
    warn('info', 'ma.notImported', `grandMA3 objects not imported: ${other.join(', ')}`)
  }
  return doc
}

function readFixtureType(ft: XmlNode): MaFixtureType | null {
  const name = attr(ft, 'Name')
  const modesNode = descendants(ft, 'DMXMode')
  if (!name || modesNode.length === 0) return null
  const modes: MaFixtureType['modes'] = []
  for (const m of modesNode) {
    const channels: MaFixtureTypeChannel[] = []
    let nextOffset = 1
    for (const ch of descendants(m, 'DMXChannel')) {
      const logical = child(ch, 'LogicalChannel')
      const attribute = attr(logical, 'Attribute') ?? attr(ch, 'Attribute') ?? attr(child(logical, 'ChannelFunction'), 'Attribute')
      // grandMA3: Coarse="1" Fine="2"; GDTF: Offset="1,2"
      let coarse = num(attr(ch, 'Coarse'))
      let fine = num(attr(ch, 'Fine'))
      const offset = attr(ch, 'Offset')
      if (coarse === undefined && offset) {
        const parts = offset.split(',').map(x => Number(x.trim())).filter(Number.isFinite)
        coarse = parts[0]
        fine = parts[1]
      }
      if (coarse === undefined) coarse = nextOffset
      nextOffset = Math.max(nextOffset, (fine ?? coarse) + 1)
      if (!attribute || coarse < 1 || coarse > 512) continue
      const out: MaFixtureTypeChannel = { attribute, coarse }
      if (fine !== undefined && fine >= 1 && fine <= 512) out.fine = fine
      const dflt = attr(ch, 'Default')
      if (dflt && /^[0-9a-f]{2,8}$/i.test(dflt)) {
        // grandMA3 writes DMX defaults as hex scaled to 24 bit ("FFFFFF")
        const raw = parseInt(dflt, 16)
        out.default = Math.round((raw / (Math.pow(16, dflt.length) - 1)) * 255)
      } else if (dflt && /^\d+\/\d+$/.test(dflt)) {
        // GDTF "128/1"
        const [v, bytes] = dflt.split('/').map(Number)
        out.default = bytes > 1 ? v >> (8 * (bytes - 1)) : v
      }
      channels.push(out)
    }
    modes.push({ name: attr(m, 'Name') ?? `Mode ${modes.length + 1}`, channels })
  }
  return { name, manufacturer: attr(ft, 'Manufacturer'), shortName: attr(ft, 'ShortName'), modes }
}

/** "1.001", "1.1", "2.512" → 0-based universe + address */
export function parseMa3Patch(v: string | undefined): { universe: number; address: number } | null {
  if (!v) return null
  const m = /^\s*(\d+)\s*\.\s*(\d+)\s*$/.exec(v)
  if (!m) return null
  const u = Number(m[1])
  const a = Number(m[2])
  if (u < 1 || a < 1 || a > 512) return null
  return { universe: Math.min(u - 1, 15), address: a }
}

function readFixture(fx: XmlNode): MaFixtureDecl | null {
  const fid = parseMaId(attr(fx, 'FID', 'FixtureID', 'Fixture_ID'))
  const cid = parseMaId(attr(fx, 'CID', 'ChannelID', 'Channel_ID'))
  const typeName = attr(fx, 'FixtureType', 'Type')
  if (!fid && !cid) return null
  if (!typeName && !attr(fx, 'Patch')) return null
  const idTypeAttr = attr(fx, 'IDType')
  const ref: MaRef = fid
    ? { idType: 'fixture', id: fid.id }
    : { idType: idTypeAttr && !/^(fixture|0)$/i.test(idTypeAttr) ? idTypeName(idTypeAttr) : 'channel', id: cid!.id }
  const decl: MaFixtureDecl = { ref, name: attr(fx, 'Name'), typeName, modeName: attr(fx, 'Mode', 'DMXMode') }
  const patch = parseMa3Patch(attr(fx, 'Patch', 'Address'))
  if (patch) { decl.universe = patch.universe; decl.address = patch.address }
  const x = num(attr(fx, 'PosX')), y = num(attr(fx, 'PosY')), z = num(attr(fx, 'PosZ'))
  if (x !== undefined || y !== undefined || z !== undefined) decl.position = { x: metres(x), y: metres(y), z: metres(z) }
  const rx = num(attr(fx, 'RotX')), ry = num(attr(fx, 'RotY')), rz = num(attr(fx, 'RotZ'))
  if (rx !== undefined || ry !== undefined || rz !== undefined) decl.rotation = { x: rx ?? 0, y: ry ?? 0, z: rz ?? 0 }
  return decl
}

/** grandMA3 stage positions are metres; very large values are taken as millimetres */
function metres(v: number | undefined): number {
  if (v === undefined) return 0
  return Math.abs(v) > 200 ? v / 1000 : v
}

function readSequence(s: XmlNode, doc: MaDocument): MaSequence {
  const seq: MaSequence = { name: attr(s, 'Name') ?? '', cues: [] }
  const no = num(attr(s, 'No', 'Index'))
  if (no !== undefined && no > 0) seq.number = Math.round(no)
  const tracking = yes(attr(s, 'Tracking'))
  if (tracking !== undefined) seq.tracking = tracking
  const wrap = yes(attr(s, 'WrapAround'))
  if (wrap !== undefined) seq.loop = wrap
  const prio = (attr(s, 'Priority') ?? '').toLowerCase()
  const PRIO: Record<string, number> = { lowest: 10, low: 30, ltp: 50, high: 70, highest: 90, htp: 50, swap: 50, super: 100 }
  if (PRIO[prio] !== undefined) seq.priority = PRIO[prio]
  for (const c of children(s, 'Cue')) {
    const cue = readCue(c, doc)
    if (cue) seq.cues.push(cue)
  }
  return seq
}

function readCue(c: XmlNode, doc: MaDocument): MaCue | null {
  const name = attr(c, 'Name')
  const parts = children(c, 'Part')
  const number = cueNumber(attr(c, 'No', 'Number'))
  const values: MaValue[] = []
  const cue: MaCue = { number: number ?? 0, name, values }
  // OffCue (no number, Release) and CueZero carry no programmed data in exports
  if (number === undefined || (number === 0 && /^cuezero$/i.test(name ?? ''))) {
    const hasData = parts.some(p => descendants(p, 'Phaser').length > 0)
    if (!hasData) return null
    if (number === undefined) return null
  }
  const trig = (attr(c, 'TrigType', 'Trigger') ?? '').trim().toLowerCase()
  if (trig) cue.trig = trig
  const trigTime = maTime(attr(c, 'TrigTime'))
  if (trigTime !== undefined) cue.trigTime = trigTime
  const extraParts: CuePart[] = []
  for (const p of parts) {
    const partNo = partIndex(attr(p, 'Part', 'No', 'Index'), parts.indexOf(p))
    const fade = maTime(attr(p, 'CueInFade', 'CueFade', 'Fade'))
    const outFade = maTime(attr(p, 'CueOutFade', 'OutFade'))
    const delay = maTime(attr(p, 'CueInDelay', 'CueDelay', 'Delay'))
    const outDelay = maTime(attr(p, 'CueOutDelay', 'OutDelay'))
    if (partNo === 0) {
      if (fade !== undefined) cue.fade = fade
      if (outFade !== undefined) cue.outFade = outFade
      if (delay !== undefined) cue.delay = delay
      if (outDelay !== undefined) cue.outDelay = outDelay
      for (let slot = 1; slot <= 7; slot++) {
        const f = maTime(attr(p, `Preset${slot}Fade`))
        const d = maTime(attr(p, `Preset${slot}Delay`))
        if (f === undefined && d === undefined) continue
        const feature = PRESET_SLOT_FEATURE[slot]
        const ft = (cue.featureTiming ??= {})
        const cur = (ft[feature] ??= {})
        if (f !== undefined) cur.fade = f
        if (d !== undefined) cur.delay = d
      }
    } else {
      const part: CuePart = { index: partNo }
      const pname = attr(p, 'Name')
      if (pname) part.name = pname
      if (fade !== undefined) part.fade = fade
      if (outFade !== undefined) part.fadeOut = outFade
      if (delay !== undefined) part.delay = delay
      extraParts.push(part)
    }
    values.push(...readPhasers(p, doc, partNo))
  }
  if (extraParts.length > 0) cue.parts = extraParts
  if (yes(attr(c, 'Block')) === true) cue.block = true
  return cue
}

/** Part numbers: "0", "1", "0.1" (part 0, recipe line 1) → 0 / 1 */
function partIndex(v: string | undefined, fallback: number): number {
  const n = num(v)
  if (n === undefined) return fallback
  return Math.max(0, Math.floor(n))
}

function readPhasers(node: XmlNode, doc: MaDocument, part?: number): MaValue[] {
  const out: MaValue[] = []
  for (const ph of descendants(node, 'Phaser')) {
    const attribute = attr(ph, 'Attribute')
    const id = parseMaId(attr(ph, 'ID', 'Fixture', 'FID'))
    if (!attribute || !id) continue
    const ref: MaRef = { idType: idTypeName(attr(ph, 'IDType')), id: id.id }
    const sub = id.sub ?? num(attr(ph, 'SubID', 'Sub'))
    if (sub !== undefined && sub > 0) ref.sub = sub
    const steps = children(ph, 'Step')
    const step = steps[0] ?? ph
    if (steps.length > 1) {
      addWarning(doc.warnings, { level: 'warning', code: 'ma3.phaser', message: 'Phasers (multi-step values) are imported as their first step; rebuild them as PhotonBoard effects' })
    }
    let value: number | undefined
    let unit: MaValueUnit = 'percent'
    const abs = attr(step, 'Absolute', 'Value')
    const absPhys = attr(step, 'AbsolutePhys')
    const rel = attr(step, 'Relative') ?? attr(step, 'RelativePhys')
    if (abs !== undefined && num(abs) !== undefined) value = num(abs)
    else if (absPhys !== undefined && num(absPhys) !== undefined) { value = num(absPhys); unit = 'physical' }
    else if (rel !== undefined && num(rel) !== undefined) { value = num(rel); unit = 'relative' }
    const presetRef = attr(ph, 'AbsPreset', 'Preset') ?? attr(step, 'AbsPreset', 'Preset')
    const pr = presetRef ? /(\d+)\.(\d+)/.exec(presetRef) : null
    if (value === undefined) {
      if (!presetRef) continue
      addWarning(doc.warnings, { level: 'warning', code: 'ma3.presetOnly', message: 'Values that only reference a preset (no stored value) were skipped' })
      continue
    }
    const v: MaValue = { ref, attribute, value, unit }
    if (part !== undefined && part > 0) v.part = part
    const fade = maTime(attr(ph, 'Fade') ?? attr(step, 'Fade'))
    const delay = maTime(attr(ph, 'Delay') ?? attr(step, 'Delay'))
    if (fade !== undefined) v.fade = fade
    if (delay !== undefined) v.delay = delay
    if (pr) v.presetRef = `${Number(pr[1])}.${Number(pr[2])}`
    out.push(v)
  }
  return out
}

function readPreset(p: XmlNode, doc: MaDocument): MaPreset {
  const mode = (attr(p, 'PresetModeInternal', 'PresetMode', 'Mode') ?? '').toLowerCase()
  const scope: PresetScope = mode.startsWith('universal') ? 'universal' : mode.startsWith('global') ? 'global' : 'selective'
  const preset: MaPreset = { name: attr(p, 'Name') ?? '', scope, values: readPhasers(p, doc) }
  // "Preset 4.2" style numbering when the export carries it
  const no = attr(p, 'No', 'Index', 'Number')
  const m = no ? /^(\d+)\.(\d+)$/.exec(no.trim()) : null
  if (m) { preset.pool = Number(m[1]); preset.number = Number(m[2]) } else if (num(no) !== undefined) preset.number = Math.round(num(no)!)
  const pool = num(attr(p, 'Pool', 'PoolNo', 'Family'))
  if (pool !== undefined) preset.pool = pool
  return preset
}

function readGroup(g: XmlNode): MaGroup | null {
  const items: MaRef[] = []
  for (const it of descendants(g, 'Item')) {
    const id = parseMaId(attr(it, 'ID'))
    if (!id) continue
    const ref: MaRef = { idType: idTypeName(attr(it, 'IDType')), id: id.id }
    if (id.sub) ref.sub = id.sub
    items.push(ref)
  }
  const group: MaGroup = { name: attr(g, 'Name') ?? '', items }
  const no = num(attr(g, 'No', 'Index'))
  if (no !== undefined && no > 0) group.number = Math.round(no)
  return group
}

function readMacro(m: XmlNode): MaMacro {
  const macro: MaMacro = { name: attr(m, 'Name') ?? '', lines: [] }
  const no = num(attr(m, 'No', 'Index'))
  if (no !== undefined && no > 0) macro.number = Math.round(no)
  for (const l of children(m, 'MacroLine')) {
    const command = attr(l, 'Command') ?? ''
    if (!command.trim() || yes(attr(l, 'Enabled')) === false) continue
    const wait = maTime(attr(l, 'Wait'))
    macro.lines.push(wait !== undefined ? { command, wait } : { command })
  }
  return macro
}
