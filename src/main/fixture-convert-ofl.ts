// ============================================================
// PhotonBoard — Open Fixture Library (OFL) JSON → FixtureDefinition
//
// Follows the semantics of OFL's own model (lib/model/*.js):
// fine channels (fineChannelAliases + dmxValueResolution),
// switching channels, null ("no function") channels, matrix /
// template channels ($pixelKey, pixel groups, insert blocks),
// wheels and capability names. Every DMX range is scaled to the
// coarse (8-bit) channel, which is what the console addresses.
//
// Used by the online OFL download, file import and the offline
// catalog build (scripts/build-fixture-library.mjs). Pure.
// ============================================================

import type {
  FixtureCapability,
  FixtureCatalogProvenance,
  FixtureChannel,
  FixtureDefinition,
  FixtureMode,
  FixturePhysical,
  FixtureWheel,
  FixtureWheelSlot
} from '../shared/types'
import { clampByte, compact, defaultPrecedence, emitterColor, pixelLayoutFromCells, uniqueName } from './fixture-convert-common'

export interface OflConvertOptions {
  manufacturerKey: string
  fixtureKey: string
  /** Display name from OFL's manufacturers.json (falls back to the fixture's / the key) */
  manufacturerName?: string
  /** Definition id; default `${manufacturerKey}/${fixtureKey}` */
  id?: string
  source?: FixtureDefinition['source']
  catalog?: FixtureCatalogProvenance
  /** Set lastModified to now (online download); otherwise OFL's meta.lastModifyDate */
  stampNow?: boolean
}

type Json = Record<string, any>

type ChannelSpec =
  | { kind: 'coarse'; key: string; json: Json }
  | { kind: 'fine'; key: string; coarseKey: string; resolution: number }
  | { kind: 'switch'; key: string; triggerKey: string }

// ---------------------------------------------------------------
// DMX value scaling (port of OFL lib/scale-dmx-values.js)
// ---------------------------------------------------------------

function getBytes(value: number, resolution: number): number[] {
  const bytes: number[] = []
  let v = Math.max(0, Math.floor(value))
  for (let r = resolution; r > 0; r--) {
    const byte = v % 256
    bytes.push(byte)
    v = (v - byte) / 256
  }
  if (v > 0) return new Array(resolution).fill(255) // out of range: saturate
  return bytes.reverse()
}

function bytesToValue(bytes: number[]): number {
  return bytes.reduce((acc, b) => acc * 256 + b, 0)
}

export function scaleDmxValue(value: number, from: number, to: number): number {
  const bytes = getBytes(value, from)
  while (from < to) { bytes.push(bytes[from - 1]); from++ }
  while (from > to) { bytes.length--; from-- }
  return bytesToValue(bytes)
}

export function scaleDmxRange(start: number, end: number, from: number, to: number): [number, number] {
  let startBytes = getBytes(start, from)
  const endBytes = getBytes(end, from)
  let sr = from
  let er = from
  while (er < to) { endBytes.push(255); er++ }
  while (sr < to) { startBytes.push(0); sr++ }
  while (er > to) { endBytes.length--; er-- }
  while (sr > to) {
    const deleted = startBytes[sr - 1]
    startBytes.length--
    sr--
    if (deleted > 0 && bytesToValue(startBytes) < bytesToValue(endBytes)) {
      startBytes = getBytes(bytesToValue(startBytes) + 1, sr)
    }
  }
  return [bytesToValue(startBytes), bytesToValue(endBytes)]
}

// ---------------------------------------------------------------
// Matrix (port of OFL lib/model/Matrix.js)
// ---------------------------------------------------------------

interface MatrixInfo {
  pixelKeys: string[]
  groupKeys: string[]
  groups: Record<string, string[]>
  count: [number, number, number]
  byOrder(a: string, b: string, c: string): string[]
}

function buildMatrix(m: Json | undefined): MatrixInfo | null {
  if (!m || typeof m !== 'object') return null
  let structure: (string | null)[][][]
  let count: [number, number, number]
  if (Array.isArray(m.pixelKeys)) {
    structure = m.pixelKeys
    count = [1, 1, structure.length]
    for (const y of structure) {
      count[1] = Math.max(count[1], y.length)
      for (const x of y) count[0] = Math.max(count[0], x.length)
    }
  } else if (Array.isArray(m.pixelCount)) {
    count = [m.pixelCount[0] || 1, m.pixelCount[1] || 1, m.pixelCount[2] || 1]
    const axes = (['X', 'Y', 'Z'] as const).filter((_, i) => count[i] > 1)
    const keyOf = (x: number, y: number, z: number): string => {
      if (axes.length <= 1) return String(Math.max(x, y, z))
      if (axes.length === 2) {
        const first = axes.includes('X') ? x : y
        const last = axes.includes('Y') ? y : z
        return `(${first}, ${last})`
      }
      return `(${x}, ${y}, ${z})`
    }
    structure = []
    for (let z = 1; z <= count[2]; z++) {
      const ys: string[][] = []
      for (let y = 1; y <= count[1]; y++) {
        const xs: string[] = []
        for (let x = 1; x <= count[0]; x++) xs.push(keyOf(x, y, z))
        ys.push(xs)
      }
      structure.push(ys)
    }
  } else {
    return null
  }

  const positions: Record<string, [number, number, number]> = {}
  for (let z = 0; z < count[2]; z++) {
    for (let y = 0; y < count[1]; y++) {
      for (let x = 0; x < count[0]; x++) {
        const key = structure[z]?.[y]?.[x]
        if (typeof key === 'string') positions[key] = [x + 1, y + 1, z + 1]
      }
    }
  }
  const pixelKeys = Object.keys(positions).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const byOrder = (a: string, b: string, c: string): string[] => {
    const idx: Record<string, number> = { X: 0, Y: 1, Z: 2 }
    const [ia, ib, ic] = [idx[a], idx[b], idx[c]]
    return [...pixelKeys].sort((ka, kb) => {
      const pa = positions[ka]
      const pb = positions[kb]
      if (pa[ic] !== pb[ic]) return pa[ic] - pb[ic]
      if (pa[ib] !== pb[ib]) return pa[ib] - pb[ib]
      return pa[ia] - pb[ia]
    })
  }

  const groups: Record<string, string[]> = {}
  for (const [groupKey, group] of Object.entries((m.pixelGroups ?? {}) as Record<string, any>)) {
    if (Array.isArray(group)) groups[groupKey] = group.filter((k) => typeof k === 'string')
    else if (group === 'all') groups[groupKey] = pixelKeys
    else if (group && typeof group === 'object') {
      const tests = (['x', 'y', 'z'] as const).map((axis) => ((group[axis] ?? []) as string[]).map(numberConstraint))
      const nameTests = ((group.name ?? []) as string[]).map((p) => { const re = new RegExp(p); return (n: string) => re.test(n) })
      const keys = 'name' in group ? pixelKeys : byOrder('X', 'Y', 'Z')
      groups[groupKey] = keys.filter((k) => {
        const pos = positions[k]
        return tests.every((fns, i) => fns.every((fn) => fn(pos[i]))) && nameTests.every((fn) => fn(k))
      })
    }
  }
  return { pixelKeys, groupKeys: Object.keys(groups), groups, count, byOrder }
}

function numberConstraint(c: string): (pos: number) => boolean {
  if (c.startsWith('>=')) { const n = parseInt(c.slice(2), 10); return (p) => p >= n }
  if (c.startsWith('<=')) { const n = parseInt(c.slice(2), 10); return (p) => p <= n }
  if (c.startsWith('=')) { const n = parseInt(c.slice(1), 10); return (p) => p === n }
  const m = c.replace(/^even$/, '2n').replace(/^odd$/, '2n+1').match(/^(\d+)n(?:\+(\d+)|)$/)
  if (m) { const d = parseInt(m[1], 10); const r = parseInt(m[2] || '0', 10); return (p) => p % d === r }
  return () => true
}

function resolveTemplate(s: string, pixelKey: string): string {
  return s.split('$pixelKey').join(pixelKey)
}

// ---------------------------------------------------------------
// Entities / capability names (after OFL lib/model/Capability.js)
// ---------------------------------------------------------------

const UNIT_ALIASES: Record<string, string> = { deg: '°', 'm^3/min': 'm³/min' }

function startEnd(cap: Json, prop: string): [string, string] | null {
  if (cap[prop] !== undefined) return [String(cap[prop]), String(cap[prop])]
  if (cap[`${prop}Start`] !== undefined) return [String(cap[`${prop}Start`]), String(cap[`${prop}End`] ?? cap[`${prop}Start`])]
  return null
}

function parseEntity(s: string): { number: number; unit: string } | null {
  const m = s.match(/^(-?\d+(?:\.\d+)?)(.*)$/)
  return m ? { number: parseFloat(m[1]), unit: m[2] } : null
}

function startEndToString(pair: [string, string], propertyName: string | null = null, prepend = false): string {
  const [start, end] = pair
  const a = parseEntity(start)
  const b = parseEntity(end)
  if (!a || !b) {
    // keywords ("fast", "slow CW", "center", "off")
    if (start === end) return start
    const spec = / (CW|CCW|reverse)$/
    const sa = start.match(spec)
    const sb = end.match(spec)
    if (sa && sb && sa[1] === sb[1]) return `${sa[1]} ${start.replace(spec, '')}…${end.replace(spec, '')}`
    return `${start}…${end}`
  }
  const unit = UNIT_ALIASES[a.unit] ?? a.unit
  const words = [a.number === b.number && a.unit === b.unit ? `${a.number}${unit}` : `${a.number}…${b.number}${UNIT_ALIASES[b.unit] ?? b.unit}`]
  if (propertyName && unit === '%') words.push(propertyName)
  if (prepend) words.reverse()
  return words.join(' ')
}

function inBrackets(s: string, ...extra: (string | null | undefined)[]): string {
  const e = extra.filter((x): x is string => typeof x === 'string' && x !== '')
  return e.length ? `${s} (${e.join(', ')})` : s
}

function simpleName(cap: Json, name: string, prop: string, propertyName: string | null = null, prepend = false): string {
  const se = startEnd(cap, prop)
  return inBrackets(se ? `${name} ${startEndToString(se, propertyName, prepend)}` : name, cap.comment)
}

const SHUTTER_EFFECT_NAMES: Record<string, string> = {
  Open: 'Shutter open', Closed: 'Shutter closed', Strobe: 'Strobe', Pulse: 'Pulse strobe', RampUp: 'Ramp up strobe',
  RampDown: 'Ramp down strobe', RampUpDown: 'Ramp up and down strobe', Lightning: 'Lightning strobe effect',
  Spikes: 'Spikes strobe effect', Burst: 'Burst strobe effect'
}

const EFFECT_PRESETS: Record<string, string> = { ColorFade: 'Color fade', ColorJump: 'Color jump' }

// ---------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------

interface WheelCtx {
  name: string
  slots: Json[]
  type: string
}

function wheelType(slots: Json[]): string {
  const types = slots.map((s) => String(s?.type ?? 'Open'))
  const count = (t: string) => types.filter((x) => x === t).length
  const sorted = [...types].sort((a, b) => count(a) - count(b))
  const t = sorted.pop() ?? 'Gobo'
  return t.startsWith('AnimationGobo') ? 'AnimationGobo' : t
}

function slotIndex(wheel: WheelCtx, n: number): number {
  const len = wheel.slots.length
  return ((((n - 1) % len) + len) % len)
}

function slotName(wheel: WheelCtx, index: number): string {
  const slot = wheel.slots[index] ?? {}
  const type = String(slot.type ?? 'Open')
  const raw: string | null = typeof slot.name === 'string' && slot.name ? slot.name : null
  let name: string | null = raw
  if (type === 'Color') {
    if (raw && slot.colorTemperature) name = `${raw} (${slot.colorTemperature})`
    else if (!raw && slot.colorTemperature) name = String(slot.colorTemperature)
  } else if (type === 'Gobo') {
    if (raw === null) name = typeof slot.resource === 'string' ? `Gobo ${slot.resource.split('/').pop()}` : null
    else name = raw.startsWith('Gobo') ? raw : `Gobo ${raw}`
  } else if (type === 'Prism') {
    if (raw && slot.facets) name = `${slot.facets}-facet ${raw}`
    else if (!raw && slot.facets) name = `${slot.facets}-facet prism`
  } else if (type === 'Iris') {
    name = slot.openPercent !== undefined ? `Iris ${slot.openPercent}` : null
  } else if (type === 'Frost') {
    name = slot.frostIntensity !== undefined ? `Frost ${slot.frostIntensity}` : null
  } else if (type === 'AnimationGoboStart') {
    name = raw === null ? null : `${raw} Start`
  } else if (type === 'AnimationGoboEnd') {
    const prev = wheel.slots[index - 1]
    name = prev?.name ? `${prev.name} End` : null
  }
  if (name === null) {
    const ofType = wheel.slots.filter((s) => String(s?.type ?? 'Open') === type)
    const typeName = type.replace(/([a-z])([A-Z])/g, '$1 $2')
    name = ofType.length === 1 ? typeName : `${typeName} ${ofType.indexOf(slot) + 1}`
  }
  return name
}

function slotColors(wheel: WheelCtx, index: number): string[] | undefined {
  const slot = wheel.slots[index] ?? {}
  if (slot.type === 'Open') return ['#ffffff']
  if (slot.type === 'Closed') return ['#000000']
  return Array.isArray(slot.colors) && slot.colors.length ? slot.colors : undefined
}

/** Name / colours of the slot a slotNumber points at (x.5 = split between two slots) */
function slotAt(wheel: WheelCtx, n: number): { name: string; colors?: string[]; image?: string } {
  if (Number.isInteger(n)) {
    const i = slotIndex(wheel, n)
    const slot = wheel.slots[i] ?? {}
    return { name: slotName(wheel, i), colors: slotColors(wheel, i), image: typeof slot.resource === 'string' ? slot.resource : undefined }
  }
  const fi = slotIndex(wheel, Math.floor(n))
  const ci = slotIndex(wheel, Math.ceil(n))
  const floor = wheel.slots[fi] ?? {}
  if (floor.type === 'AnimationGoboStart') return { name: slotName(wheel, fi).replace(' Start', '') }
  const fc = slotColors(wheel, fi)
  const cc = slotColors(wheel, ci)
  return { name: `Split ${slotName(wheel, fi)} / ${slotName(wheel, ci)}`, colors: fc && cc ? [...fc, ...cc] : undefined }
}

const WHEEL_SLOT_TYPES: Record<string, FixtureWheelSlot['type']> = {
  Open: 'Open', Closed: 'Closed', Color: 'Color', Gobo: 'Gobo', Prism: 'Prism', Iris: 'Iris', Frost: 'Frost',
  AnimationGoboStart: 'Animation', AnimationGoboEnd: 'Animation'
}

// ---------------------------------------------------------------
// Channel type (OFL CoarseChannel.type → console channel type)
// ---------------------------------------------------------------

function nameType(name: string): FixtureChannel['type'] {
  const n = name.toLowerCase()
  if (/pan|tilt/.test(n) && /speed|time/.test(n)) return 'speed'
  if (/^pan\b/.test(n)) return 'pan'
  if (/^tilt\b/.test(n)) return 'tilt'
  if (/dimmer|intensity|brightness|master/.test(n)) return 'intensity'
  if (/strobe/.test(n)) return 'strobe'
  if (/shutter/.test(n)) return 'shutter'
  if (/gobo/.test(n)) return 'gobo'
  if (/prism/.test(n)) return 'prism'
  if (/red|green|blue|white|amber|\buv\b|cyan|magenta|yellow|lime|indigo|colou?r|cto|ctb/.test(n)) return 'color'
  if (/fog|haze|smoke/.test(n)) return 'fog'
  if (/speed/.test(n)) return 'speed'
  if (/effect|macro|program|auto|sound/.test(n)) return 'effect'
  if (/reset|control|lamp|function|mode/.test(n)) return 'maintenance'
  return 'generic'
}

function channelType(caps: Json[], name: string, wheelsOf: (cap: Json) => WheelCtx[]): FixtureChannel['type'] {
  const types = caps.map((c) => String(c.type))
  const has = (...t: string[]) => types.some((x) => t.includes(x))
  const wheelCapsAre = (wt: string) => caps.every((c) => !/^Wheel(Slot|Shake)$/.test(c.type) || wheelsOf(c).every((w) => w.type === wt))
  if (has('ColorIntensity')) return 'color'
  if (has('ColorPreset') || (has('WheelSlot') && caps.every((c) => c.type !== 'WheelSlot' || wheelsOf(c)[0]?.type === 'Color'))) return 'color'
  if (has('Pan', 'PanContinuous')) return 'pan'
  if (has('Tilt', 'TiltContinuous')) return 'tilt'
  if (has('Focus', 'Zoom', 'Iris', 'IrisEffect')) return 'generic'
  if (has('WheelSlot', 'WheelShake') && wheelCapsAre('Gobo')) return 'gobo'
  if (has('Prism')) return 'prism'
  if (has('ColorTemperature')) return 'color'
  if (has('Frost', 'FrostEffect')) return 'generic'
  if (has('Effect', 'EffectParameter', 'SoundSensitivity', 'WheelSlot')) return 'effect'
  if (has('ShutterStrobe', 'BladeInsertion', 'BladeRotation', 'BladeSystemRotation')) {
    const openClose = caps.some((c) => c.type === 'ShutterStrobe' && (c.shutterEffect === 'Open' || c.shutterEffect === 'Closed'))
    return openClose || !has('ShutterStrobe') ? 'shutter' : 'strobe'
  }
  if (has('Fog', 'FogOutput', 'FogType')) return 'fog'
  if (has('WheelSlotRotation', 'WheelRotation', 'WheelShake')) {
    return caps.some((c) => wheelsOf(c).some((w) => w.type === 'Gobo')) ? 'gobo' : 'speed'
  }
  if (has('PrismRotation')) return 'prism'
  if (has('BeamAngle', 'BeamPosition')) return 'generic'
  if (has('StrobeSpeed', 'StrobeDuration')) return 'strobe'
  if (has('PanTiltSpeed', 'EffectSpeed', 'EffectDuration', 'Rotation', 'Speed', 'Time')) return 'speed'
  if (has('Maintenance')) return 'maintenance'
  if (has('Intensity')) return 'intensity'
  if (types.length > 0 && types.every((t) => t === 'NoFunction' || t === 'Generic')) {
    const byName = nameType(name)
    return byName === 'intensity' ? 'generic' : byName
  }
  return nameType(name)
}

// ---------------------------------------------------------------
// Converter
// ---------------------------------------------------------------

function percentOrInt(raw: unknown, resolution: number): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw)
  if (typeof raw === 'string') {
    const m = raw.match(/^(-?\d+(?:\.\d+)?)%$/)
    if (m) return Math.floor((parseFloat(m[1]) / 100) * (Math.pow(256, resolution) - 1))
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function convertOflFixture(json: Json, opts: OflConvertOptions): FixtureDefinition {
  if (!json || typeof json !== 'object') throw new Error('Not an OFL fixture')
  if (typeof json.redirectTo === 'string') throw new Error(`Redirect to ${json.redirectTo}`)
  if (!Array.isArray(json.modes) || json.modes.length === 0) throw new Error('No modes')

  const manufacturer = opts.manufacturerName || json.manufacturer?.name || titleCaseKey(opts.manufacturerKey)
  const name = typeof json.name === 'string' && json.name ? json.name : titleCaseKey(opts.fixtureKey)
  const id = opts.id ?? `${opts.manufacturerKey}/${opts.fixtureKey}`

  // ---- wheels ----
  const wheelByName = new Map<string, WheelCtx>()
  for (const [wName, wJson] of Object.entries((json.wheels ?? {}) as Record<string, Json>)) {
    const slots = Array.isArray(wJson?.slots) ? wJson.slots : []
    if (slots.length) wheelByName.set(wName, { name: wName, slots, type: wheelType(slots) })
  }

  // ---- all channels by key ----
  const specs = new Map<string, ChannelSpec>()
  const addCoarse = (key: string, chJson: Json) => {
    specs.set(key, { kind: 'coarse', key, json: chJson })
    const fines: unknown[] = Array.isArray(chJson.fineChannelAliases) ? chJson.fineChannelAliases : []
    fines.forEach((alias, i) => {
      if (typeof alias === 'string') specs.set(alias, { kind: 'fine', key: alias, coarseKey: key, resolution: i + 2 })
    })
    const caps = capsOf(chJson, 1)
    for (const alias of Object.keys(caps[0]?.switchChannels ?? {})) {
      specs.set(alias, { kind: 'switch', key: alias, triggerKey: key })
    }
  }
  for (const [key, chJson] of Object.entries((json.availableChannels ?? {}) as Record<string, Json>)) {
    if (chJson && typeof chJson === 'object') addCoarse(key, chJson)
  }
  const matrix = buildMatrix(json.matrix)
  if (matrix && json.templateChannels) {
    const allKeys = [...matrix.pixelKeys, ...matrix.groupKeys]
    for (const [tKey, tJson] of Object.entries(json.templateChannels as Record<string, Json>)) {
      const tString = JSON.stringify(tJson)
      for (const pk of allKeys) {
        const key = resolveTemplate(tKey, pk)
        if (specs.has(key)) continue // availableChannels override matrix channels
        addCoarse(key, JSON.parse(resolveTemplate(tString, pk)))
      }
    }
  }

  // ---- channel builders ----
  const built = new Map<string, FixtureChannel>()

  function capsOf(chJson: Json, valueResolution: number): Json[] {
    if (chJson.capability && typeof chJson.capability === 'object') {
      return [{ dmxRange: [0, Math.pow(256, valueResolution) - 1], ...chJson.capability }]
    }
    return Array.isArray(chJson.capabilities) ? chJson.capabilities.filter((c: unknown) => c && typeof c === 'object') : []
  }

  function resolutionOf(chJson: Json): { max: number; value: number } {
    const max = 1 + (Array.isArray(chJson.fineChannelAliases) ? chJson.fineChannelAliases.length : 0)
    const map: Record<string, number> = { '8bit': 1, '16bit': 2, '24bit': 3 }
    const value = typeof chJson.dmxValueResolution === 'string' && map[chJson.dmxValueResolution] ? Math.min(map[chJson.dmxValueResolution], 4) : max
    return { max, value }
  }

  function wheelsOfCap(cap: Json, chName: string): WheelCtx[] {
    let names: string[]
    if (cap.wheel !== undefined) names = [cap.wheel].flat().filter((n): n is string => typeof n === 'string')
    else if (String(cap.type).includes('Wheel')) names = [chName]
    else names = []
    return names.map((n) => wheelByName.get(n)).filter((w): w is WheelCtx => !!w)
  }

  function capLabel(cap: Json, chName: string): { label: string; colors?: string[]; image?: string; wheelSlot?: number; wheel?: string } {
    const wheels = wheelsOfCap(cap, chName)
    const slotNum = startEnd(cap, 'slotNumber')
    const wheel = wheels.length === 1 ? wheels[0] : undefined
    const slots = wheel && slotNum ? [slotAt(wheel, parseFloat(slotNum[0])), slotAt(wheel, parseFloat(slotNum[1]))] : null
    const slotLabel = (): string => {
      if (!slots || !slotNum) return 'Unknown wheel slot'
      return slotNum[0] === slotNum[1] ? slots[0].name : slots.map((s) => s.name).join(' … ')
    }
    const out: { label: string; colors?: string[]; image?: string; wheelSlot?: number; wheel?: string } = { label: '' }
    if (wheel) out.wheel = wheel.name
    if (slots && slotNum) {
      const n = parseFloat(slotNum[0])
      if (Number.isInteger(n)) out.wheelSlot = n
      if (slots[0].colors) out.colors = slotNum[0] === slotNum[1] ? slots[0].colors : [...slots[0].colors, ...(slots[1].colors ?? [])]
      if (slots[0].image && slotNum[0] === slotNum[1]) out.image = slots[0].image
    }
    const comment: string | undefined = typeof cap.comment === 'string' && cap.comment ? cap.comment : undefined
    const se = (p: string) => startEnd(cap, p)
    switch (cap.type) {
      case 'NoFunction': out.label = comment || 'No function'; break
      case 'ShutterStrobe': {
        let n = SHUTTER_EFFECT_NAMES[cap.shutterEffect] ?? 'Strobe'
        if (cap.randomTiming) n = `Random ${n.toLowerCase()}`
        if (cap.soundControlled === true) n += ' sound-controlled'
        const sp = se('speed'); if (sp) n += ` ${startEndToString(sp, 'speed')}`
        const du = se('duration'); if (du) n += ` ${startEndToString(du, 'duration')}`
        out.label = inBrackets(n, comment)
        break
      }
      case 'StrobeSpeed': out.label = simpleName(cap, 'Strobe speed', 'speed'); break
      case 'StrobeDuration': out.label = simpleName(cap, 'Strobe duration', 'duration'); break
      case 'Intensity': out.label = simpleName(cap, 'Intensity', 'brightness'); break
      case 'ColorIntensity': out.label = simpleName(cap, String(cap.color ?? 'Color'), 'brightness'); break
      case 'ColorPreset': {
        const n = comment || 'Color preset'
        const ct = se('colorTemperature')
        out.label = ct ? inBrackets(n, startEndToString(ct)) : n
        const colors = Array.isArray(cap.colors) ? cap.colors : Array.isArray(cap.colorsStart) ? [...cap.colorsStart, ...(cap.colorsEnd ?? [])] : undefined
        if (colors?.length) out.colors = colors
        break
      }
      case 'ColorTemperature': out.label = simpleName(cap, 'Color temperature', 'colorTemperature'); break
      case 'Pan': out.label = simpleName(cap, 'Pan', 'angle', 'angle', true); break
      case 'PanContinuous': out.label = simpleName(cap, 'Pan', 'speed', 'speed', true); break
      case 'Tilt': out.label = simpleName(cap, 'Tilt', 'angle', 'angle', true); break
      case 'TiltContinuous': out.label = simpleName(cap, 'Tilt', 'speed', 'speed', true); break
      case 'PanTiltSpeed': {
        const p = se('speed') ? 'speed' : 'duration'
        const v = se(p)
        out.label = inBrackets(`Pan/tilt movement ${v ? (parseEntity(v[0])?.unit === '%' ? `${p} ` : '') + startEndToString(v) : ''}`.trim(), comment)
        break
      }
      case 'WheelSlot': out.label = inBrackets(slotLabel(), comment); break
      case 'WheelShake': {
        let n = slotNum ? slotLabel() : wheels.map((w) => w.name).join(', ') || 'Wheel'
        if (cap.isShaking === 'slot') n += ' slot'
        n += ' shake'
        const a = se('shakeAngle'); if (a) n += ` ${startEndToString(a, 'angle', true)}`
        const s = se('shakeSpeed'); if (s) n += ` ${startEndToString(s, 'speed', true)}`
        out.label = inBrackets(n, comment)
        break
      }
      case 'WheelSlotRotation': {
        const base = slots ? slots[0].name : wheel ? wheel.type.replace(/^Gobo$/, 'Gobo stencil') : 'Wheel slot'
        const p = se('speed') ? 'speed' : 'angle'
        out.label = simpleName(cap, `${base} rotation`, p, p, true)
        break
      }
      case 'WheelRotation': {
        const p = se('speed') ? 'speed' : 'angle'
        out.label = simpleName(cap, `${wheel ? wheel.name : 'Wheel'} rotation`, p, p, true)
        break
      }
      case 'Effect': {
        let n = String(cap.effectName ?? EFFECT_PRESETS[cap.effectPreset] ?? 'Effect')
        if (cap.effectPreset && cap.soundControlled === true) n += ' sound-controlled'
        const pa = se('parameter'); if (pa) n += ` ${startEndToString(pa)}`
        const sp = se('speed'); if (sp) n += ` ${startEndToString(sp, 'speed')}`
        const du = se('duration'); if (du) n += ` ${startEndToString(du, 'duration')}`
        const ss = se('soundSensitivity')
        out.label = inBrackets(n, ss ? `sound sensitivity ${startEndToString(ss)}` : null, comment)
        break
      }
      case 'EffectSpeed': out.label = simpleName(cap, 'Effect speed', 'speed'); break
      case 'EffectDuration': out.label = simpleName(cap, 'Effect duration', 'duration'); break
      case 'EffectParameter': { const pa = se('parameter'); out.label = `${comment || 'Effect parameter'}${pa ? ` ${startEndToString(pa)}` : ''}`; break }
      case 'SoundSensitivity': out.label = simpleName(cap, 'Sound sensitivity', 'soundSensitivity'); break
      case 'BeamAngle': out.label = simpleName(cap, 'Beam', 'angle', 'angle', true); break
      case 'BeamPosition': {
        const h = se('horizontalAngle'); const v = se('verticalAngle')
        out.label = inBrackets(h && v ? `Beam position (${startEndToString(h)}, ${startEndToString(v)})` : h ? `Horizontal beam position ${startEndToString(h)}` : v ? `Vertical beam position ${startEndToString(v)}` : 'Beam position', comment)
        break
      }
      case 'Focus': out.label = simpleName(cap, 'Focus', 'distance', 'distance'); break
      case 'Zoom': out.label = simpleName(cap, 'Zoom', 'angle', 'beam angle'); break
      case 'Iris': out.label = simpleName(cap, 'Iris', 'openPercent', 'open'); break
      case 'IrisEffect': { let n = `Iris ${cap.effectName ?? 'effect'}`; const sp = se('speed'); if (sp) n += ` ${startEndToString(sp, 'speed')}`; out.label = inBrackets(n, comment); break }
      case 'Frost': out.label = simpleName(cap, 'Frost', 'frostIntensity'); break
      case 'FrostEffect': { let n = `Frost ${cap.effectName ?? 'effect'}`; const sp = se('speed'); if (sp) n += ` ${startEndToString(sp, 'speed')}`; out.label = inBrackets(n, comment); break }
      case 'Prism': {
        let n = 'Prism'
        const sp = se('speed'); const an = se('angle')
        if (sp) n += ` ${startEndToString(sp, 'speed')}`
        else if (an) n += ` ${startEndToString(an, 'angle')}`
        out.label = inBrackets(n, comment)
        break
      }
      case 'PrismRotation': { const p = se('speed') ? 'speed' : 'angle'; out.label = simpleName(cap, 'Prism rotation', p, p, true); break }
      case 'BladeInsertion': out.label = simpleName(cap, `Blade ${cap.blade ?? ''} insertion`.replace('  ', ' '), 'insertion'); break
      case 'BladeRotation': out.label = simpleName(cap, `Blade ${cap.blade ?? ''} rotation`.replace('  ', ' '), 'angle', 'angle', true); break
      case 'BladeSystemRotation': out.label = simpleName(cap, 'Blade system rotation', 'angle', 'angle', true); break
      case 'Fog': { let n = String(cap.fogType ?? 'Fog'); const fo = se('fogOutput'); if (fo) n += ` ${startEndToString(fo)}`; out.label = inBrackets(n, comment); break }
      case 'FogOutput': out.label = simpleName(cap, 'Fog output', 'fogOutput'); break
      case 'FogType': out.label = inBrackets(`Fog type: ${cap.fogType ?? ''}`, comment); break
      case 'Rotation': { const p = se('speed') ? 'speed' : 'angle'; out.label = simpleName(cap, 'Rotation', p, p, true); break }
      case 'Speed': out.label = simpleName(cap, 'Speed', 'speed'); break
      case 'Time': out.label = simpleName(cap, 'Time', 'time'); break
      case 'Maintenance': {
        let n = comment || 'Maintenance'
        const pa = se('parameter'); if (pa) n += ` ${startEndToString(pa)}`
        out.label = inBrackets(n, cap.hold ? `hold ${cap.hold}` : null)
        break
      }
      case 'Generic': out.label = comment || 'Generic'; break
      default: out.label = comment ? `${cap.type}: ${comment}` : String(cap.type ?? 'Generic')
    }
    return out
  }

  /** Console capability type: OFL's, with shutter open/closed made explicit (Blinder / programmer look for them) */
  function capType(cap: Json): string {
    if (cap.type === 'ShutterStrobe') {
      if (cap.shutterEffect === 'Open') return 'ShutterOpen'
      if (cap.shutterEffect === 'Closed') return 'ShutterClose'
    }
    return String(cap.type ?? 'Generic')
  }

  function buildCoarse(spec: Extract<ChannelSpec, { kind: 'coarse' }>): FixtureChannel {
    const res = resolutionOf(spec.json)
    const caps = capsOf(spec.json, res.value)
    const chName = typeof spec.json.name === 'string' && spec.json.name ? spec.json.name : spec.key
    const type = channelType(caps, chName, (c) => wheelsOfCap(c, chName))
    const capabilities: FixtureCapability[] = caps.map((cap) => {
      const range = Array.isArray(cap.dmxRange) && cap.dmxRange.length === 2
        ? scaleDmxRange(Number(cap.dmxRange[0]) || 0, Number(cap.dmxRange[1]) || 0, res.value, 1)
        : [0, 255] as [number, number]
      const info = capLabel(cap, chName)
      const color = cap.type === 'ColorIntensity' ? emitterColor(cap.color) : info.colors?.[0]
      const ct = startEnd(cap, 'colorTemperature')
      return compact<FixtureCapability>({
        dmxRange: [clampByte(range[0]), clampByte(range[1])],
        type: capType(cap),
        label: info.label,
        color,
        colors: info.colors && info.colors.length > 1 ? info.colors : undefined,
        colorTemperature: ct ? startEndToString(ct) : undefined,
        wheel: info.wheel,
        wheelSlot: info.wheelSlot,
        image: info.image
      })
    })
    const ch: FixtureChannel = { name: spec.key, type, precedence: spec.json.precedence === 'HTP' || spec.json.precedence === 'LTP' ? spec.json.precedence : defaultPrecedence(type) }
    if ('defaultValue' in spec.json) {
      const raw = percentOrInt(spec.json.defaultValue, res.value)
      if (raw !== null) ch.defaultValue = clampByte(scaleDmxValue(Math.max(0, raw), res.value, 1))
    }
    if (type === 'intensity') ch.highlightValue = 255
    if (Array.isArray(spec.json.fineChannelAliases) && spec.json.fineChannelAliases.length) ch.fineChannelAliases = spec.json.fineChannelAliases.filter((a: unknown) => typeof a === 'string')
    if (capabilities.length) ch.capabilities = capabilities
    return ch
  }

  function buildFine(spec: Extract<ChannelSpec, { kind: 'fine' }>): FixtureChannel {
    const coarseSpec = specs.get(spec.coarseKey) as Extract<ChannelSpec, { kind: 'coarse' }>
    const coarse = channelFor(spec.coarseKey)
    const ch: FixtureChannel = { name: spec.key, type: coarse.type, precedence: coarse.precedence, fineOf: spec.coarseKey }
    if ('defaultValue' in coarseSpec.json) {
      const res = resolutionOf(coarseSpec.json)
      const raw = percentOrInt(coarseSpec.json.defaultValue, res.value)
      if (raw !== null) ch.defaultValue = scaleDmxValue(Math.max(0, raw), res.value, spec.resolution) % 256
    }
    return ch
  }

  function buildSwitch(spec: Extract<ChannelSpec, { kind: 'switch' }>): FixtureChannel {
    const trigger = specs.get(spec.triggerKey) as Extract<ChannelSpec, { kind: 'coarse' }>
    const res = resolutionOf(trigger.json)
    const caps = capsOf(trigger.json, res.value)
    const def = percentOrInt(trigger.json.defaultValue ?? 0, res.value) ?? 0
    const cap = caps.find((c) => Array.isArray(c.dmxRange) && def >= c.dmxRange[0] && def <= c.dmxRange[1]) ?? caps[0]
    const target = cap?.switchChannels?.[spec.key]
    const base = typeof target === 'string' && specs.has(target) && target !== spec.key ? channelFor(target) : null
    const ch: FixtureChannel = base
      ? { ...base, name: spec.key }
      : { name: spec.key, type: nameType(spec.key), precedence: 'LTP' }
    if (base?.fineOf) ch.fineOf = base.fineOf
    return ch
  }

  const building = new Set<string>()
  function channelFor(key: string): FixtureChannel {
    const cached = built.get(key)
    if (cached) return cached
    const spec = specs.get(key)
    let ch: FixtureChannel
    if (!spec || building.has(key)) {
      ch = { name: key, type: nameType(key), precedence: 'LTP' }
    } else {
      building.add(key)
      ch = spec.kind === 'coarse' ? buildCoarse(spec) : spec.kind === 'fine' ? buildFine(spec) : buildSwitch(spec)
      building.delete(key)
    }
    built.set(key, ch)
    return ch
  }

  // ---- modes ----
  const channels: Record<string, FixtureChannel> = {}
  const nullNames = new Map<number, string>() // n-th null channel (fixture-wide, like OFL) → name
  const modes: FixtureMode[] = []
  const takenNames = { has: (n: string) => specs.has(n) || n in channels }

  for (const modeJson of json.modes as Json[]) {
    const keys: (string | null)[] = []
    const cells = new Map<string, number[]>()
    let cellsUsable = true
    for (const ref of (Array.isArray(modeJson?.channels) ? modeJson.channels : []) as unknown[]) {
      if (ref !== null && typeof ref === 'object' && (ref as Json).insert === 'matrixChannels') {
        const block = ref as Json
        const pixelKeys = repeatForKeys(block.repeatFor, matrix)
        const templates: string[] = Array.isArray(block.templateChannels) ? block.templateChannels : []
        if (block.channelOrder === 'perChannel') {
          if (pixelKeys.length > 1 && templates.length > 1) cellsUsable = false
          for (const t of templates) for (const pk of pixelKeys) { pushCell(cells, pk, keys.length); keys.push(resolveTemplate(t, pk)) }
        } else {
          for (const pk of pixelKeys) for (const t of templates) { pushCell(cells, pk, keys.length); keys.push(resolveTemplate(t, pk)) }
        }
      } else if (ref === null || typeof ref === 'string') {
        keys.push(ref as string | null)
      }
    }

    let nullCount = 0
    const modeChannels = keys.map((key) => {
      if (key === null) {
        nullCount++
        let n = nullNames.get(nullCount)
        if (!n) {
          n = uniqueName('No function', takenNames)
          nullNames.set(nullCount, n)
          channels[n] = { name: n, type: 'generic', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'NoFunction', label: 'No function' }] }
        }
        return n
      }
      if (!(key in channels)) channels[key] = channelFor(key)
      return key
    })

    const mode: FixtureMode = { name: String(modeJson?.name ?? 'Default'), channels: modeChannels, channelCount: modeChannels.length }
    if (typeof modeJson?.shortName === 'string' && modeJson.shortName && modeJson.shortName !== mode.name) mode.shortName = modeJson.shortName
    if (matrix && cells.size > 1 && cellsUsable) {
      const [cx, cy] = matrix.count
      const layout = pixelLayoutFromCells(mode, [...cells.values()], { columns: cx, rows: cy })
      if (layout) mode.pixelLayout = layout
    }
    modes.push(mode)
  }

  // ---- physical ----
  let physical: FixturePhysical | undefined
  const p = json.physical
  if (p && typeof p === 'object') {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    physical = compact<FixturePhysical>({
      dimensions: Array.isArray(p.dimensions) && p.dimensions.length === 3 ? p.dimensions : undefined,
      weight: num(p.weight),
      power: num(p.power),
      DMXconnector: typeof p.DMXconnector === 'string' ? p.DMXconnector : undefined,
      bulb: p.bulb && typeof p.bulb === 'object'
        ? compact({ type: typeof p.bulb.type === 'string' ? p.bulb.type : undefined, lumens: num(p.bulb.lumens), colorTemperature: num(p.bulb.colorTemperature) })
        : undefined,
      lens: Array.isArray(p.lens?.degreesMinMax) ? { degreesMinMax: p.lens.degreesMinMax as [number, number] } : undefined,
      panRange: num(p.focus?.panMax),
      tiltRange: num(p.focus?.tiltMax)
    })
    if (physical.bulb && Object.keys(physical.bulb).length === 0) delete physical.bulb
    if (Object.keys(physical).length === 0) physical = undefined
  }

  // ---- wheels ----
  const wheels: FixtureWheel[] = [...wheelByName.values()].map((w) => ({
    name: w.name,
    slots: w.slots.map((s, i) => {
      const colors = Array.isArray(s?.colors) && s.colors.length ? s.colors as string[] : undefined
      return compact<FixtureWheelSlot>({
        type: WHEEL_SLOT_TYPES[s?.type] ?? 'Gobo',
        name: slotName(w, i),
        color: colors?.[0],
        colors: colors && colors.length > 1 ? colors : undefined,
        colorTemperature: s?.colorTemperature !== undefined ? String(s.colorTemperature) : undefined,
        facets: typeof s?.facets === 'number' ? s.facets : undefined,
        imageFile: typeof s?.resource === 'string' ? s.resource : undefined
      })
    })
  }))

  const def: FixtureDefinition = {
    id,
    name,
    manufacturer,
    categories: Array.isArray(json.categories) && json.categories.length ? json.categories.filter((c: unknown) => typeof c === 'string') : ['Other'],
    channels,
    modes
  }
  if (typeof json.shortName === 'string' && json.shortName && json.shortName !== name) def.shortName = json.shortName
  if (physical) def.physical = physical
  if (wheels.length) def.wheels = wheels
  def.source = opts.source ?? 'ofl'
  def.sourceUrl = `https://open-fixture-library.org/${opts.manufacturerKey}/${opts.fixtureKey}`
  const lastModified = opts.stampNow ? new Date().toISOString() : (typeof json.meta?.lastModifyDate === 'string' ? json.meta.lastModifyDate : undefined)
  if (lastModified) def.lastModified = lastModified
  if (opts.catalog) def.catalog = opts.catalog
  return def
}

function pushCell(cells: Map<string, number[]>, pixelKey: string, index: number): void {
  const list = cells.get(pixelKey)
  if (list) list.push(index)
  else cells.set(pixelKey, [index])
}

function repeatForKeys(repeatFor: unknown, matrix: MatrixInfo | null): string[] {
  if (Array.isArray(repeatFor)) return repeatFor.filter((k): k is string => typeof k === 'string')
  if (!matrix || typeof repeatFor !== 'string') return []
  if (repeatFor === 'eachPixelGroup') return matrix.groupKeys
  if (repeatFor === 'eachPixelABC') return matrix.pixelKeys
  const order = repeatFor.replace('eachPixel', '')
  if (/^[XYZ]{3}$/.test(order)) return matrix.byOrder(order[0], order[1], order[2])
  return matrix.pixelKeys
}

function titleCaseKey(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
