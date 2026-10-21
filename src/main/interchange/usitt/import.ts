// ============================================================
// PhotonBoard — USITT ASCII → ImportedShowFragment (pure)
//
// USITT ASCII knows channels and intensity levels only:
//   channel N            → a 1-channel dimmer fixture "Channel N" (fid N)
//   PATCH N<d@level      → patched at absolute dimmer d (universe = ⌊(d-1)/512⌋)
//   no PATCH section     → 1:1 patch (channel N at DMX N), as on most consoles
//   CUE / $CUE           → cues of cuelist 1 / of $SEQUENCE lists (complete looks: tracking off)
//   GROUP / $GROUP       → groups (+ an intensity preset when levels are not all full)
//   SUB                  → one-cue cuelists "Sub N"
//   ETC Expression $MlPers / $MlPatch → moving-light fixture types and patch,
//     their desk channels carry attribute values (raw DMX)
// ============================================================

import { emptyFragment, type ImportedShowFragment, type ImportWarning } from '../../../shared/interchange'
import type { Cue, CueChannelValue, CuePart, Cuelist, FixtureChannel, FixtureDefinition, Group, PatchEntry, Preset } from '../../../shared/types'
import { maAttributeInfo } from '../ma/attributes'
import type { UsittDocument, UsittLevel } from './read'

const GROUP_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1']

export const USITT_DIMMER: FixtureDefinition = {
  id: 'usitt/dimmer', name: 'Dimmer', manufacturer: 'Generic', categories: ['Dimmer'],
  channels: { Dimmer: { name: 'Dimmer', type: 'intensity', defaultValue: 0, precedence: 'HTP' } },
  modes: [{ name: '1ch', channels: ['Dimmer'], channelCount: 1 }],
  source: 'user'
}

/** ETC Expression attribute names (6 characters) → channel names */
const ETC_ATTRIBUTES: Record<string, string> = {
  intens: 'DIM', intensity: 'DIM', pan: 'PAN', tilt: 'TILT', color: 'COLOR1', color2: 'COLOR2', colour: 'COLOR1',
  gobo: 'GOBO1', gobo2: 'GOBO2', gobrot: 'GOBO1_POS', gborot: 'GOBO1_POS', iris: 'IRIS', focus: 'FOCUS', zoom: 'ZOOM',
  prism: 'PRISM', frost: 'FROST', shuttr: 'SHUTTER', shutter: 'SHUTTER', strobe: 'STROBE', speed: 'PTSPEED',
  cyan: 'CYAN', magnta: 'MAGENTA', magenta: 'MAGENTA', yellow: 'YELLOW', red: 'RED', green: 'GREEN', blue: 'BLUE',
  ctc: 'CTO', cto: 'CTO', contrl: 'CONTROL1', control: 'CONTROL1'
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'
}

interface DeskChannel {
  patchId: string
  channel: string
}

export function usittToFragment(doc: UsittDocument, fileName: string): ImportedShowFragment {
  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  const frag = emptyFragment('usitt-ascii', baseName)
  const app = doc.console && doc.manufacturer && doc.console.toLowerCase().startsWith(doc.manufacturer.toLowerCase())
    ? doc.console
    : [doc.manufacturer, doc.console].filter(Boolean).join(' ')
  if (app) frag.sourceApp = doc.softwareVersion ? `${app} (${doc.softwareVersion})` : app
  const warnings: ImportWarning[] = frag.warnings
  warnings.push(...doc.warnings)
  const warn = (level: ImportWarning['level'], code: string, message: string, params?: Record<string, string | number>) =>
    warnings.push({ level, code, message, params })

  const desk = new Map<number, DeskChannel>()
  let maxUniverse = -1

  // ---- ETC Expression moving lights
  const mlDefs = new Map<string, { def: FixtureDefinition; deskOrder: string[] }>()
  for (const f of doc.mlFixtures) {
    const pers = f.personality ? doc.mlPersonalities.get(f.personality.toLowerCase()) : undefined
    if (!pers || f.startChannel === undefined) {
      warn('warning', 'usitt.mlIncomplete', `Moving light ${f.number}: personality or start channel missing, not imported`)
      continue
    }
    let entry = mlDefs.get(pers.name)
    if (!entry) {
      entry = buildMlDefinition(pers, doc.mlAttributes)
      mlDefs.set(pers.name, entry)
      frag.fixtures.push(entry.def)
    }
    const universe = Math.min(Math.max((f.port ?? 1) - 1, 0), 15)
    const address = f.address && f.address >= 1 && f.address <= 512 ? f.address : 1
    maxUniverse = Math.max(maxUniverse, universe)
    const p: PatchEntry = {
      id: `usitt-ml-${f.number}`, fixtureDefId: entry.def.id, modeName: entry.def.modes[0].name,
      universe, address, name: `${pers.name} ${f.number}`, groupIds: [], fid: f.startChannel
    }
    frag.patch.push(p)
    entry.deskOrder.forEach((ch, i) => desk.set(f.startChannel! + i, { patchId: p.id, channel: ch }))
  }
  if (doc.mlFixtures.length > 0) {
    warn('info', 'usitt.mlAssumed', 'ETC moving lights: one desk channel per attribute (16-bit pairs count once) is assumed; check the attribute values of the first cues')
  }

  // ---- conventional channels
  const used = new Set<number>()
  const addUse = (lv: UsittLevel[]) => lv.forEach(l => used.add(l.channel))
  for (const c of doc.cues) { addUse(c.levels); c.parts.forEach(p => addUse(p.levels)) }
  doc.groups.forEach(g => addUse(g.levels))
  doc.subs.forEach(s => addUse(s.levels))
  for (const ch of doc.patch.keys()) used.add(ch)
  const channels = [...used].filter(ch => !desk.has(ch)).sort((a, b) => a - b)

  for (const [, dims] of doc.patch) for (const d of dims) maxUniverse = Math.max(maxUniverse, Math.min(Math.floor((d.dimmer - 1) / 512), 15))
  const parkUniverse = Math.min(15, maxUniverse + 1)
  let parkAddr = 1
  let parkU = parkUniverse
  const placeholders: string[] = []
  let multiDimmer = 0
  let proportional = 0
  let unpatched = 0
  let usesDimmer = false
  for (const ch of channels) {
    const p: PatchEntry = {
      id: `usitt-ch-${ch}`, fixtureDefId: USITT_DIMMER.id, modeName: '1ch', universe: 0, address: 1,
      name: `Channel ${ch}`, groupIds: [], fid: ch
    }
    const dims = doc.patch.get(ch)
    if (dims && dims.length > 0) {
      const d = dims[0].dimmer
      p.universe = Math.min(Math.floor((d - 1) / 512), 15)
      p.address = ((d - 1) % 512) + 1
      if (dims.length > 1) multiDimmer++
      if (dims.some(x => x.level < 255)) proportional++
    } else if (!doc.hasPatch) {
      p.universe = Math.min(Math.floor((ch - 1) / 512), 15)
      p.address = ((ch - 1) % 512) + 1
      placeholders.push(p.id)
    } else {
      if (parkAddr > 512) { parkU = Math.min(15, parkU + 1); parkAddr = 1 }
      p.universe = parkU
      p.address = parkAddr++
      placeholders.push(p.id)
      unpatched++
    }
    frag.patch.push(p)
    desk.set(ch, { patchId: p.id, channel: 'Dimmer' })
    usesDimmer = true
  }
  if (usesDimmer) frag.fixtures.push(USITT_DIMMER)
  if (!doc.hasPatch && channels.length > 0) {
    warn('info', 'usitt.defaultPatch', 'The file has no PATCH: channels were patched 1:1 (channel N → DMX address N)')
  }
  if (unpatched > 0) warn('warning', 'usitt.unpatchedChannels', `${unpatched} channel(s) used in cues are not in the PATCH: patched from universe ${parkUniverse + 1}`, { count: unpatched })
  if (multiDimmer > 0) warn('warning', 'usitt.multiDimmer', `${multiDimmer} channel(s) control several dimmers: only the first dimmer was patched`, { count: multiDimmer })
  if (proportional > 0) warn('info', 'usitt.proportionalPatch', `${proportional} channel(s) have a proportional patch level below full: not imported (levels play at 100 %)`, { count: proportional })
  if (placeholders.length > 0) frag.placeholderFixtureIds = placeholders

  const unknownChannels = new Set<number>()
  const values = (levels: UsittLevel[], part?: number): CueChannelValue[] => {
    const map = new Map<string, CueChannelValue>()
    for (const l of levels) {
      const d = desk.get(l.channel)
      if (!d) { unknownChannels.add(l.channel); continue }
      const v: CueChannelValue = { fixtureId: d.patchId, channelName: d.channel, value: l.value }
      if (part !== undefined) v.part = part
      map.set(`${d.patchId}|${d.channel}|${part ?? 0}`, v)
    }
    return [...map.values()]
  }

  // ---- cues → cuelists
  const lists = new Map<number, Cue[]>()
  let downDelays = 0
  let links = 0
  const seen = new Map<number, Set<number>>()
  let duplicates = 0
  doc.cues.forEach((c, i) => {
    const list = lists.get(c.list) ?? []
    lists.set(c.list, list)
    const nums = seen.get(c.list) ?? new Set()
    seen.set(c.list, nums)
    if (nums.has(c.number)) duplicates++
    nums.add(c.number)
    const fadeIn = c.up ?? c.down ?? 0
    const cue: Cue = {
      id: `usitt-cue-${i + 1}`,
      name: c.text || `Cue ${c.number}`,
      number: c.number,
      values: values(c.levels),
      fadeIn,
      fadeOut: c.down ?? fadeIn,
      delay: c.upDelay ?? 0,
      followTime: null
    }
    if (c.downDelay && c.downDelay !== (c.upDelay ?? 0)) downDelays++
    const follow = c.followOn ?? c.wait
    if (follow !== undefined) { cue.followTime = follow; cue.followMode = 'after-go' }
    if (c.link !== undefined) links++
    if (c.block) cue.block = true
    if (c.parts.length > 0) {
      const parts: CuePart[] = []
      for (const p of c.parts) {
        const part: CuePart = { index: p.index }
        if (p.up !== undefined) part.fade = p.up
        if (p.down !== undefined) part.fadeOut = p.down
        if (p.upDelay !== undefined) part.delay = p.upDelay
        parts.push(part)
        cue.values.push(...values(p.levels, p.index))
      }
      cue.parts = parts
    }
    list.push(cue)
  })
  const listNumbers = [...lists.keys()].sort((a, b) => a - b)
  for (const n of listNumbers) {
    const cl: Cuelist = {
      id: `usitt-list-${n}`,
      name: doc.lists.get(n) ?? (listNumbers.length > 1 ? `Cue list ${n}` : frag.name),
      cues: lists.get(n)!,
      currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
      number: n,
      // USITT cues carry complete looks: channels not listed are out
      tracking: false
    }
    frag.cuelists.push(cl)
  }
  if (downDelays > 0) warn('info', 'usitt.downDelay', `${downDelays} cue(s) have a down delay different from the up delay: PhotonBoard uses one delay per cue`, { count: downDelays })
  if (links > 0) warn('warning', 'usitt.link', `${links} cue(s) LINK to another cue: links are not imported (cues play in order)`, { count: links })
  if (duplicates > 0) warn('info', 'usitt.duplicateCue', `${duplicates} cue number(s) appear more than once in the same list; kept in file order`, { count: duplicates })

  // ---- subs → one-cue cuelists
  let nextList = (listNumbers.length > 0 ? Math.max(...listNumbers) : 0) + 1
  for (const s of doc.subs) {
    const n = nextList++
    frag.cuelists.push({
      id: `usitt-sub-${s.number}`,
      name: s.text || `Sub ${s.number}`,
      cues: [{ id: `usitt-sub-${s.number}-cue`, name: s.text || `Sub ${s.number}`, number: 1, values: values(s.levels), fadeIn: s.up ?? 0, fadeOut: s.down ?? s.up ?? 0, delay: 0, followTime: null }],
      currentCueIndex: -1, isPlaying: false, isLooping: false, priority: 50, faderLevel: 255, flash: false,
      number: n, tracking: false
    })
  }
  if (doc.subs.length > 0) warn('info', 'usitt.subs', `${doc.subs.length} submaster(s) were imported as one-cue cuelists ("Sub N"); assign them to executor faders`, { count: doc.subs.length })

  // ---- groups (+ intensity presets for recorded levels)
  doc.groups.forEach((g, i) => {
    const id = `usitt-grp-${i + 1}`
    const fixtureIds: string[] = []
    const presetValues: Record<string, Record<string, number>> = {}
    let partial = false
    for (const l of g.levels) {
      const d = desk.get(l.channel)
      if (!d) { unknownChannels.add(l.channel); continue }
      if (l.value > 0 && !fixtureIds.includes(d.patchId)) fixtureIds.push(d.patchId)
      ;(presetValues[d.patchId] ??= {})[d.channel] = l.value
      if (l.value !== 255 || d.channel !== 'Dimmer') partial = true
    }
    const group: Group = { id, name: g.text || `Group ${g.number}`, color: GROUP_COLORS[i % GROUP_COLORS.length], fixtureIds }
    if (Number.isInteger(g.number)) group.number = g.number
    frag.groups.push(group)
    for (const pid of fixtureIds) frag.patch.find(p => p.id === pid)?.groupIds.push(id)
    if (partial) {
      const preset: Preset = { id: `usitt-pre-${i + 1}`, name: group.name, type: 'full', values: presetValues, scope: 'selective' }
      if (Number.isInteger(g.number)) preset.number = g.number
      frag.presets.push(preset)
    }
  })

  if (unknownChannels.size > 0) {
    warn('warning', 'usitt.unknownChannels', `Levels for channels that could not be resolved were skipped: ${[...unknownChannels].slice(0, 20).join(', ')}`, { count: unknownChannels.size })
  }
  return frag
}

function buildMlDefinition(pers: { name: string; channels: { offset: number; attribute: number; home: number; flags: string }[] }, attributes: Map<number, string>): { def: FixtureDefinition; deskOrder: string[] } {
  const channels: Record<string, FixtureChannel> = {}
  const slots: string[] = []
  const deskOrder: string[] = []
  const counts = new Map<string, number>()
  const sorted = [...pers.channels].sort((a, b) => a.offset - b.offset)
  let prevMsb: { name: string; attribute: number } | null = null
  for (const c of sorted) {
    if (prevMsb && c.attribute === prevMsb.attribute && c.attribute !== 0) {
      const fine = `${prevMsb.name} fine`
      channels[fine] = { name: fine, type: channels[prevMsb.name].type, defaultValue: 0, precedence: 'LTP', fineOf: prevMsb.name }
      slots[c.offset] = fine
      prevMsb = null
      continue
    }
    const attrName = c.attribute ? attributes.get(c.attribute) ?? `Attr ${c.attribute}` : `Ch ${c.offset + 1}`
    const mapped = ETC_ATTRIBUTES[attrName.trim().toLowerCase()]
    const info = maAttributeInfo(mapped ?? attrName)
    const base = mapped ? info.name : attrName
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    const name = n > 1 ? `${base} ${n}` : base
    channels[name] = {
      name, type: c.attribute ? info.type : 'generic', defaultValue: c.home,
      precedence: info.type === 'intensity' ? 'HTP' : 'LTP'
    }
    slots[c.offset] = name
    deskOrder.push(name)
    prevMsb = c.flags.includes('M') ? { name, attribute: c.attribute } : null
  }
  const list: string[] = []
  for (let i = 0; i < slots.length; i++) {
    const n = slots[i] ?? `Ch ${i + 1}`
    if (!channels[n]) channels[n] = { name: n, type: 'generic', defaultValue: 0, precedence: 'LTP' }
    list.push(n)
  }
  const types = new Set(Object.values(channels).map(c => c.type))
  const def: FixtureDefinition = {
    id: `usitt/${slug(pers.name)}`,
    name: pers.name,
    manufacturer: 'ETC personality',
    categories: types.has('pan') || types.has('tilt') ? ['Moving Head'] : ['Other'],
    channels,
    modes: [{ name: `${list.length}ch`, channels: list, channelCount: list.length }],
    source: 'user'
  }
  return { def, deskOrder }
}
