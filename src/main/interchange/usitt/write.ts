// ============================================================
// PhotonBoard — USITT ASCII writer (pure)
//
// USITT ASCII 3.0 carries channels and intensity only, so the export is
// the "conventional" view of the show:
//   fixture (fid)  → channel; its intensity channel's DMX address → dimmer
//   cues           → CUE records with the full intensity look of each cue
//                    (tracking resolved; channels that go out are written
//                    at 0 so tracking and non-tracking readers agree)
//   groups         → GROUP records
// Additional cuelists use the $SEQUENCE / $CUE extension (ETC Congo,
// OLC); consoles without it read cue list 1 only. Colour, position, beam
// values, presets, chases, effects, executors and macros cannot be
// represented: each produces a warning.
// ============================================================

import type { ImportWarning } from '../../../shared/interchange'
import { attributeRoleOf } from '../../../shared/attribute-families'
import type { Cuelist, FixtureDefinition, PatchEntry, ShowFile } from '../../../shared/types'

const MAX_LINE = 80
const EOL = '\r\n'

interface ExportChannel {
  number: number
  patch: PatchEntry
  /** Name of the intensity channel in the fixture mode */
  intensity: string | null
  /** Absolute dimmer (1-based) */
  dimmer: number | null
}

function hex(v: number): string {
  return 'H' + Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase()
}

function time(v: number): string {
  const r = Math.round(Math.max(0, v) * 100) / 100
  return String(r)
}

function cueNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

/** ASCII-only text for TEXT; the original goes to $$TEXT when it differs */
function asciiText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/!/g, '.').slice(0, MAX_LINE - 6).trim()
}

/** Wrap "KEY a b c…" items over several lines of at most 80 characters */
function wrap(prefix: string, items: string[], indent = ''): string[] {
  const lines: string[] = []
  let cur = indent + prefix
  let count = 0
  for (const it of items) {
    if (count > 0 && cur.length + 1 + it.length > MAX_LINE) {
      lines.push(cur)
      cur = indent + prefix
      count = 0
    }
    cur += ' ' + it
    count++
  }
  if (count > 0) lines.push(cur)
  return lines
}

function intensityChannel(def: FixtureDefinition | undefined, modeName: string): { name: string; offset: number } | null {
  if (!def) return null
  const mode = def.modes.find(m => m.name === modeName) ?? def.modes[0]
  if (!mode) return null
  for (let i = 0; i < mode.channels.length; i++) {
    const n = mode.channels[i]
    const ch = def.channels[n]
    if (ch?.fineOf) continue
    if (attributeRoleOf(n, ch?.type, ch?.precedence) === 'dimmer' && !/fine/i.test(n)) return { name: n, offset: i }
  }
  return null
}

export function writeUsitt(show: ShowFile, fixtures: FixtureDefinition[], appVersion?: string): { text: string; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = []
  const warn = (level: ImportWarning['level'], code: string, message: string, params?: Record<string, string | number>) =>
    warnings.push({ level, code, message, params })
  const defs = new Map(fixtures.map(f => [f.id, f]))

  // ---- channel numbers: fixture ID when unique, else the next free number
  const taken = new Set<number>()
  const channels: ExportChannel[] = []
  const byPatch = new Map<string, ExportChannel>()
  for (const p of show.patch) if (p.fid !== undefined && p.fid >= 1 && Number.isInteger(p.fid) && !taken.has(p.fid)) taken.add(p.fid)
  const assigned = new Set<number>()
  let next = Math.max(0, ...taken) + 1
  let noDimmer = 0
  for (const p of show.patch) {
    let number = p.fid !== undefined && Number.isInteger(p.fid) && p.fid >= 1 && !assigned.has(p.fid) ? p.fid : undefined
    if (number === undefined) number = next++
    assigned.add(number)
    const def = defs.get(p.fixtureDefId)
    const inten = intensityChannel(def, p.modeName)
    const dimmer = inten ? p.universe * 512 + p.address + inten.offset : null
    if (!inten) noDimmer++
    const ec: ExportChannel = { number, patch: p, intensity: inten?.name ?? null, dimmer: dimmer && dimmer <= 32767 ? dimmer : null }
    channels.push(ec)
    byPatch.set(p.id, ec)
  }
  channels.sort((a, b) => a.number - b.number)
  if (noDimmer > 0) {
    warn('warning', 'usitt.noIntensity', `${noDimmer} fixture(s) have no intensity channel (e.g. RGB-only LEDs): they are written as unpatched channels without levels`, { count: noDimmer })
  }

  const out: string[] = []
  out.push('! PhotonBoard - USITT ASCII export')
  out.push(`! Show: ${asciiText(show.name)}`)
  out.push('IDENT 3:0')
  out.push('MANUFACTURER PhotonBoard')
  out.push(`CONSOLE PhotonBoard${appVersion ? ' ' + asciiText(appVersion) : ''}`)
  out.push('CLEAR ALL')
  const maxChannel = channels.reduce((m, c) => Math.max(m, c.number), 0)
  const maxDimmer = channels.reduce((m, c) => Math.max(m, c.dimmer ?? 0), 0)
  if (maxChannel > 0) out.push(`SET CHANNELS ${maxChannel}`)
  if (maxDimmer > 0) out.push(`SET DIMMERS ${maxDimmer}`)
  out.push('')

  // ---- patch
  const patchItems = channels.filter(c => c.dimmer !== null).map(c => `${c.number}<${c.dimmer}@FL`)
  if (patchItems.length > 0) {
    out.push('! Patch: channel = fixture number, dimmer = DMX address of its intensity')
    out.push('! channel, (universe-1)*512 + address')
    out.push(...wrap('PATCH 1', patchItems))
    out.push('')
  }

  // ---- cues
  const nonIntensity = { count: 0 }
  const cuelists = [...show.cuelists].sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999))
  cuelists.forEach((cl, i) => {
    if (cl.cues.length === 0) return
    const listNo = cl.number ?? i + 1
    if (i === 0) {
      out.push(`! Cue list ${listNo}: ${asciiText(cl.name)}`)
    } else {
      out.push(`! Cue list ${listNo}: ${asciiText(cl.name)} (extension $SEQUENCE / $CUE)`)
      out.push(`$SEQUENCE ${listNo} 0 ${asciiText(cl.name)}`)
    }
    writeCues(cl, i === 0 ? null : listNo, byPatch, out, nonIntensity, warn)
    out.push('')
  })
  if (cuelists.filter(c => c.cues.length > 0).length > 1) {
    warn('info', 'usitt.extraLists', 'Cuelists after the first are written with the $SEQUENCE / $CUE extension (ETC Congo, OLC); other consoles only read the first cue list')
  }
  if (nonIntensity.count > 0) {
    warn('warning', 'usitt.nonIntensity', `${nonIntensity.count} colour / position / beam value(s) cannot be represented in USITT ASCII (intensity only) and were left out`, { count: nonIntensity.count })
  }

  // ---- groups
  const groups = [...show.groups].sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999))
  if (groups.length > 0) out.push('! Groups')
  groups.forEach((g, i) => {
    const chans = g.fixtureIds.map(id => byPatch.get(id)).filter((c): c is ExportChannel => !!c)
    if (chans.length === 0) return
    out.push(`GROUP ${g.number ?? i + 1}`)
    out.push(...textLines(g.name))
    out.push(...wrap('CHAN', chans.map(c => `${c.number}/${hex(255)}`), '  '))
    out.push('')
  })

  // ---- what cannot be written
  const lost: string[] = []
  if (show.presets.length) lost.push(`${show.presets.length} preset(s)`)
  if (show.chases.length) lost.push(`${show.chases.length} chase(s)`)
  if (show.effects.length) lost.push(`${show.effects.length} effect(s)`)
  if (show.macros?.length) lost.push(`${show.macros.length} macro(s)`)
  if (show.executor?.pages?.length) lost.push('executor pages')
  if (show.timeline?.clips?.length) lost.push('timeline')
  if (show.patch.some(p => p.position3D)) lost.push('3D positions')
  if (lost.length > 0) warn('warning', 'usitt.notRepresentable', `Not representable in USITT ASCII, left out: ${lost.join(', ')} — use the PhotonBoard show file or MVR for those`)

  out.push('ENDDATA')
  return { text: out.join(EOL) + EOL, warnings }
}

function textLines(name: string): string[] {
  const ascii = asciiText(name)
  const lines: string[] = []
  if (ascii) lines.push(`  TEXT ${ascii}`)
  if (name.trim() && ascii !== name.trim()) lines.push(`  $$TEXT ${name.trim().replace(/[\r\n]/g, ' ')}`)
  return lines
}

function writeCues(
  cl: Cuelist,
  extList: number | null,
  byPatch: Map<string, ExportChannel>,
  out: string[],
  nonIntensity: { count: number },
  warn: (level: ImportWarning['level'], code: string, message: string) => void
): void {
  const tracking = cl.tracking !== false
  let state = new Map<number, number>() // channel number → level of the previous cue
  let featureLost = false
  let followApprox = false
  for (const cue of cl.cues) {
    const own = new Map<number, number>()
    const parts = new Map<number, Map<number, number>>()
    for (const v of cue.values) {
      const ec = byPatch.get(v.fixtureId)
      if (!ec) continue
      if (ec.intensity !== v.channelName) {
        if (!/fine/i.test(v.channelName)) nonIntensity.count++
        continue
      }
      if (v.part !== undefined && v.part > 0) {
        const pm = parts.get(v.part) ?? new Map()
        pm.set(ec.number, v.value)
        parts.set(v.part, pm)
      } else {
        own.set(ec.number, v.value)
      }
    }
    // Full look of this cue
    const look = new Map<number, number>(tracking && !cue.block ? state : [])
    for (const [ch, v] of own) look.set(ch, v)
    for (const pm of parts.values()) for (const [ch, v] of pm) look.set(ch, v)
    // Base CHAN: the full look except channels set only by a part (written under PART)
    const levels: string[] = []
    const chs = new Set([...look.keys(), ...state.keys()])
    for (const ch of [...chs].sort((a, b) => a - b)) {
      if (!own.has(ch) && partOf(parts, ch)) continue
      const v = look.get(ch) ?? 0
      if (v > 0 || (state.get(ch) ?? 0) > 0) levels.push(`${ch}/${hex(v)}`)
    }

    out.push(extList === null ? `CUE ${cueNum(cue.number)}` : `$CUE ${extList} ${cueNum(cue.number)}`)
    out.push(...textLines(cue.name))
    const inten = cue.featureTiming?.intensity
    const up = inten?.fade ?? cue.fadeIn
    const delay = inten?.delay ?? cue.delay
    if (cue.featureTiming && Object.keys(cue.featureTiming).some(k => k !== 'intensity')) featureLost = true
    out.push(`  UP ${time(up)}${delay > 0 ? ' ' + time(delay) : ''}`)
    out.push(`  DOWN ${time(cue.fadeOut)}${delay > 0 ? ' ' + time(delay) : ''}`)
    if (typeof cue.followTime === 'number' && cue.followTime >= 0) {
      // USITT FOLLOWON counts from the GO; PhotonBoard's default counts from the end of the fade
      const t = cue.followMode === 'after-go' ? cue.followTime : cue.followTime + Math.max(cue.fadeIn, cue.fadeOut) + cue.delay
      if (cue.followMode !== 'after-go') followApprox = true
      out.push(`  FOLLOWON ${time(t)}`)
    }
    out.push(...wrap('CHAN', levels, '  '))
    for (const [index, pm] of [...parts.entries()].sort((a, b) => a[0] - b[0])) {
      const p = cue.parts?.find(x => x.index === index)
      out.push(`  PART ${index}`)
      out.push(`    UP ${time(p?.fade ?? up)}${p?.delay ? ' ' + time(p.delay) : ''}`)
      out.push(`    DOWN ${time(p?.fadeOut ?? cue.fadeOut)}`)
      out.push(...wrap('CHAN', [...pm.entries()].sort((a, b) => a[0] - b[0]).map(([ch, v]) => `${ch}/${hex(v)}`), '    '))
    }
    if (cue.block) out.push('  $$CUEBLOCK 1')
    out.push('')
    state = look
  }
  if (featureLost) warn('info', 'usitt.featureTiming', 'Per-feature timing other than intensity cannot be written; cue times use the intensity timing')
  if (followApprox) warn('info', 'usitt.followApprox', 'Follow times counted from the end of the fade were converted to FOLLOWON times counted from the GO (fade + delay + follow)')
}

function partOf(parts: Map<number, Map<number, number>>, ch: number): boolean {
  for (const pm of parts.values()) if (pm.has(ch)) return true
  return false
}

