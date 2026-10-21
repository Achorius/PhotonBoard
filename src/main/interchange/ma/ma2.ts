// ============================================================
// PhotonBoard — grandMA2 XML export reader (pure)
//
// grandMA2 `Export` writes `<MA xmlns="http://schemas.malighting.de/
// grandma2/xml/MA" major_vers minor_vers stream_vers>` files:
//   fixture layers (patch):  <Layer><Fixture fixture_id|channel_id name>
//     <FixtureType name="3 Mac 250+ Mode 2"/><SubFixture><Patch><Address>n
//     (absolute DMX address: (universe-1)*512 + address, 0 = unpatched)
//     <AbsolutePosition><Location x y z/><Rotation x y z/></…><Channel/>…
//   sequences: <Sequ index name><Cue index><Number number sub_number/>
//     <CueDatas><CueData><Channel fixture_id|channel_id subfixture_id
//     attribute_name/><Value>…</Value></CueData></CueDatas>
//     <CuePart index name basic_fade basic_outfade basic_delay…/>
//   presets: <Preset index name><Values><Channels><PresetValue Value>
//     <Channel fixture_id attribute_name/>…
//   groups: <Group index name><Subfixtures><Subfixture fix_id|cha_id sub_index/>
//   macros: <Macro index name><Macroline index delay><text>…</text>
//   effects: <Effect index name><Effectline attribute v1_a v2_a phase_a…>
// Values are percent, except PAN / TILT which grandMA2 writes in degrees.
// ============================================================

import { maAttributeInfo } from './attributes'
import {
  addWarning, emptyMaDocument,
  type MaCue, type MaDocument, type MaEffect, type MaFixtureDecl, type MaGroup, type MaMacro, type MaPreset,
  type MaRef, type MaSequence, type MaValue
} from './model'
import type { CuePart } from '../../../shared/types'
import { attr, child, childTags, children, cueNumber, descendants, maTime, num, text, yes, type XmlNode } from './xml'

const HANDLED = new Set(['info', 'layer', 'layers', 'sequ', 'sequences', 'sequencepool', 'preset', 'presets', 'presetpool',
  'group', 'groups', 'macro', 'macros', 'macropool', 'effect', 'effects', 'effectpool'])

export function readMa2Xml(root: XmlNode, doc: MaDocument = emptyMaDocument('ma2-xml')): MaDocument {
  const ma = children(root, 'MA')[0]
  if (!ma) throw new Error('Not a grandMA2 XML file')
  const major = attr(ma, 'major_vers'), minor = attr(ma, 'minor_vers'), stream = attr(ma, 'stream_vers')
  if (!doc.sourceApp && major) doc.sourceApp = `grandMA2 ${major}.${minor ?? 0}.${stream ?? 0}`
  const info = child(ma, 'Info')
  const showfile = attr(info, 'showfile')
  if (showfile && !doc.showName) doc.showName = showfile

  for (const layer of descendants(ma, 'Layer')) {
    const layerName = attr(layer, 'name')
    for (const fx of children(layer, 'Fixture')) {
      const d = readFixture(fx, layerName)
      if (d) doc.fixtures.push(d)
    }
  }
  for (const s of descendants(ma, 'Sequ')) doc.sequences.push(readSequence(s))
  for (const p of descendants(ma, 'Preset')) doc.presets.push(readPreset(p, ma))
  let layouts = 0
  for (const g of descendants(ma, 'Group')) {
    const grp = readGroup(g)
    if (grp) doc.groups.push(grp)
    else layouts++
  }
  if (layouts > 0) addWarning(doc.warnings, { level: 'info', code: 'ma2.layoutsNotImported', message: `grandMA2 layout views are not imported (${layouts})`, params: { count: layouts } })
  for (const m of descendants(ma, 'Macro')) doc.macros.push(readMacro(m))
  for (const e of descendants(ma, 'Effect')) {
    const fx = readEffect(e)
    if (fx.lines.length > 0) doc.effects.push(fx)
  }
  const other = childTags(ma).filter(t => !HANDLED.has(t.toLowerCase()))
  if (other.length > 0) addWarning(doc.warnings, { level: 'info', code: 'ma.notImported', message: `grandMA2 objects not imported: ${other.join(', ')}`, params: { objects: other.join(', ') } })
  return doc
}

function intAttr(node: XmlNode | undefined, ...names: string[]): number | undefined {
  const n = num(attr(node, ...names))
  return n === undefined ? undefined : Math.round(n)
}

/** fixture_id / channel_id (+ subfixture_id / sub_index) → reference */
function refOf(node: XmlNode | undefined): MaRef | null {
  if (!node) return null
  const fid = intAttr(node, 'fixture_id', 'fix_id')
  const cid = intAttr(node, 'channel_id', 'cha_id')
  const ref: MaRef | null = fid !== undefined ? { idType: 'fixture', id: fid } : cid !== undefined ? { idType: 'channel', id: cid } : null
  if (!ref) return null
  const sub = intAttr(node, 'subfixture_id', 'sub_index')
  if (sub !== undefined && sub > 1) ref.sub = sub
  return ref
}

/** Absolute grandMA2 DMX address → 0-based universe + address; 0 = unpatched */
export function splitMa2Address(abs: number): { universe: number; address: number } | null {
  if (!Number.isFinite(abs) || abs < 1) return null
  return { universe: Math.min(Math.floor((abs - 1) / 512), 15), address: ((abs - 1) % 512) + 1 }
}

function readFixture(fx: XmlNode, layer?: string): MaFixtureDecl | null {
  const ref = refOf(fx)
  if (!ref) return null
  delete ref.sub
  const ft = child(fx, 'FixtureType')
  const d: MaFixtureDecl = { ref, name: attr(fx, 'name'), typeName: attr(ft, 'name') ?? text(ft, 'Name'), layer }
  const subs = children(fx, 'SubFixture')
  let footprint = 0
  const addresses: number[] = []
  for (const s of subs) {
    footprint += children(s, 'Channel').length
    for (const a of descendants(child(s, 'Patch'), 'Address')) {
      const n = num(text(a))
      if (n !== undefined && n > 0) addresses.push(n)
    }
  }
  if (footprint > 0) d.footprint = footprint
  if (addresses.length > 0) {
    const p = splitMa2Address(addresses[0])
    if (p) { d.universe = p.universe; d.address = p.address }
    if (addresses.length > 1) d.extraBreaks = addresses.length - 1
  }
  if (yes(attr(fx, 'is_multipatch')) === true) d.extraBreaks = (d.extraBreaks ?? 0) + 1
  const pos = descendants(fx, 'AbsolutePosition')[0]
  const loc = child(pos, 'Location')
  if (loc) d.position = { x: num(attr(loc, 'x')) ?? 0, y: num(attr(loc, 'y')) ?? 0, z: num(attr(loc, 'z')) ?? 0 }
  const rot = child(pos, 'Rotation')
  if (rot) {
    const r = { x: num(attr(rot, 'x')) ?? 0, y: num(attr(rot, 'y')) ?? 0, z: num(attr(rot, 'z')) ?? 0 }
    if (r.x || r.y || r.z) d.rotation = r
  }
  return d
}

/** grandMA2 values: PAN / TILT are degrees, everything else percent */
function valueOf(ref: MaRef, attribute: string, raw: string | undefined): MaValue | null {
  const value = num(raw)
  if (value === undefined) return null
  const physical = maAttributeInfo(attribute).physical === 'degrees'
  return { ref, attribute, value, unit: physical ? 'physical' : 'percent' }
}

function readSequence(s: XmlNode): MaSequence {
  const seq: MaSequence = { name: attr(s, 'name') ?? '', cues: [] }
  const index = intAttr(s, 'index')
  // `index` is the 0-based pool slot in pool exports; a single exported sequence has index 0
  if (index !== undefined && index > 0) seq.number = index
  const tracking = yes(attr(s, 'tracking'))
  if (tracking !== undefined) seq.tracking = tracking
  const wrap = yes(attr(s, 'wrap_around', 'wraparound'))
  if (wrap !== undefined) seq.loop = wrap
  for (const c of children(s, 'Cue')) {
    if (yes(attr(c, 'nil')) === true) continue // <Cue xsi:nil="true"/> = cue zero placeholder
    const cue = readCue(c)
    if (cue) seq.cues.push(cue)
  }
  return seq
}

function readCue(c: XmlNode): MaCue | null {
  const numberNode = child(c, 'Number')
  const number = cueNumber(attr(numberNode, 'number'), attr(numberNode, 'sub_number')) ?? num(attr(c, 'index'))
  if (number === undefined) return null
  const values: MaValue[] = []
  const cue: MaCue = { number, values }
  const parts: CuePart[] = []
  for (const p of children(c, 'CuePart')) {
    const index = intAttr(p, 'index') ?? 0
    const name = attr(p, 'name')
    const fade = maTime(attr(p, 'basic_fade', 'fade'))
    const outFade = maTime(attr(p, 'basic_outfade', 'outfade', 'basic_out_fade'))
    const delay = maTime(attr(p, 'basic_delay', 'delay'))
    const outDelay = maTime(attr(p, 'basic_outdelay', 'outdelay', 'basic_out_delay'))
    if (index === 0) {
      if (name) cue.name = name
      if (fade !== undefined) cue.fade = fade
      if (outFade !== undefined) cue.outFade = outFade
      if (delay !== undefined) cue.delay = delay
      if (outDelay !== undefined) cue.outDelay = outDelay
    } else {
      const part: CuePart = { index }
      if (name) part.name = name
      if (fade !== undefined) part.fade = fade
      if (outFade !== undefined) part.fadeOut = outFade
      if (delay !== undefined) part.delay = delay
      parts.push(part)
    }
  }
  if (parts.length > 0) cue.parts = parts
  if (!cue.name) cue.name = attr(c, 'name')
  const trig = (attr(c, 'trig', 'trigger', 'trig_type') ?? '').trim().toLowerCase()
  if (trig) cue.trig = trig
  const trigTime = maTime(attr(c, 'trig_time', 'trigger_time'))
  if (trigTime !== undefined) cue.trigTime = trigTime
  for (const cd of descendants(c, 'CueData')) {
    const ref = refOf(child(cd, 'Channel'))
    const attribute = attr(child(cd, 'Channel'), 'attribute_name', 'attribute')
    if (!ref || !attribute) continue
    const v = valueOf(ref, attribute, text(cd, 'Value') ?? attr(cd, 'value', 'Value'))
    if (!v) continue
    const part = intAttr(cd, 'value_multipart_index', 'part')
    if (part !== undefined && part > 0) v.part = part
    const fade = maTime(attr(cd, 'fade'))
    const delay = maTime(attr(cd, 'delay'))
    if (fade !== undefined) v.fade = fade
    if (delay !== undefined) v.delay = delay
    values.push(v)
  }
  return cue
}

function readPreset(p: XmlNode, root: XmlNode): MaPreset {
  const preset: MaPreset = { name: attr(p, 'name') ?? '', scope: 'selective', values: [] }
  const index = intAttr(p, 'index')
  if (index !== undefined) preset.number = index
  // Pool: <PresetPool index="2"> wrapper when the whole pool is exported
  for (const pool of descendants(root, 'PresetPool')) {
    if (children(pool, 'Preset').includes(p)) {
      const n = intAttr(pool, 'index')
      if (n !== undefined) preset.pool = n
    }
  }
  const pool = intAttr(p, 'preset_pool', 'pool', 'type')
  if (pool !== undefined) preset.pool = pool
  if (/universal/i.test(attr(p, 'mode', 'preset_mode') ?? '')) preset.scope = 'universal'
  if (/global/i.test(attr(p, 'mode', 'preset_mode') ?? '')) preset.scope = 'global'
  for (const pv of descendants(p, 'PresetValue')) {
    const chan = child(pv, 'Channel')
    const attribute = attr(chan, 'attribute_name', 'attribute')
    const ref = refOf(chan)
    if (!attribute) continue
    const v = valueOf(ref ?? { idType: 'universal', id: 1 }, attribute, attr(pv, 'Value', 'value') ?? text(pv, 'Value'))
    if (v) preset.values.push(v)
  }
  return preset
}

function readGroup(g: XmlNode): MaGroup | null {
  const subs = child(g, 'Subfixtures') ?? child(g, 'SubFixtures')
  if (!subs || child(g, 'LayoutData')) return null
  const items: MaRef[] = []
  for (const s of children(subs, 'Subfixture')) {
    const ref = refOf(s)
    if (ref) items.push(ref)
  }
  const group: MaGroup = { name: attr(g, 'name') ?? '', items }
  const index = intAttr(g, 'index')
  if (index !== undefined && index > 0) group.number = index
  return group
}

function readMacro(m: XmlNode): MaMacro {
  const macro: MaMacro = { name: attr(m, 'name') ?? '', lines: [] }
  const index = intAttr(m, 'index')
  if (index !== undefined && index > 0) macro.number = index
  for (const l of children(m, 'Macroline')) {
    const command = text(l, 'text') ?? attr(l, 'text', 'command') ?? ''
    if (!command.trim() || yes(attr(l, 'disabled')) === true) continue
    const wait = maTime(attr(l, 'delay', 'wait'))
    macro.lines.push(wait !== undefined ? { command, wait } : { command })
  }
  return macro
}

function readEffect(e: XmlNode): MaEffect {
  const effect: MaEffect = { name: attr(e, 'name') ?? 'Effect', lines: [] }
  const index = intAttr(e, 'index')
  if (index !== undefined && index > 0) effect.number = index
  const forms = new Map<string, string>()
  for (const f of descendants(e, 'Form')) {
    const i = attr(f, 'index')
    const n = attr(f, 'name')
    if (i !== undefined && n) forms.set(i, n)
  }
  for (const line of children(e, 'Effectline')) {
    const attribute = attr(line, 'attribute')
    if (!attribute) continue
    const flags = child(line, 'flags')
    const fixtures: MaRef[] = []
    for (const f of descendants(line, 'Fixture')) {
      const n = num(text(f))
      if (n !== undefined) fixtures.push({ idType: 'fixture', id: Math.round(n) })
    }
    for (const f of descendants(line, 'Channel')) {
      const n = num(text(f))
      if (n !== undefined) fixtures.push({ idType: 'channel', id: Math.round(n) })
    }
    effect.lines.push({
      attribute,
      fixtures,
      form: forms.get(attr(flags, 'form_index') ?? '') ?? attr(line, 'form'),
      low: num(attr(line, 'v1_a')),
      high: num(attr(line, 'v2_a')),
      phaseFrom: num(attr(line, 'phase_a')),
      phaseTo: num(attr(line, 'phase_b')),
      rate: num(attr(line, 'rate')),
      width: num(attr(line, 'width_a'))
    })
  }
  return effect
}
