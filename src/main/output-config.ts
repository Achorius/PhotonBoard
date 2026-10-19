// ============================================================
// PhotonBoard — DMX output configuration (pure logic)
// Validation, defaults and legacy conversion for the machine output
// config persisted in <userData>/config/outputs.json.
// No electron / serialport imports here: unit-tested.
// ============================================================

import { MAX_UNIVERSES } from '../shared/types'
import type { ArtNetConfig, DmxOutputConfig, DmxOutputsConfig, UsbDmxConfig, UsbDmxDriver } from '../shared/types'

export const ARTNET_DEFAULT_PORT = 6454
const MAX_OUTPUTS_PER_TYPE = 64

export const USB_DMX_DRIVERS = [
  'enttec-open-dmx', 'enttec-pro', 'eurolite', 'eurolite-pro', 'showtec',
  'beamz', 'velleman', 'stairville', 'udmx', 'generic-ftdi'
] as const satisfies readonly UsbDmxDriver[]

/** Same behaviour as the historical renderer DEFAULT_ARTNET_CONFIG: broadcast universes 0-2 */
export function defaultOutputsConfig(): DmxOutputsConfig {
  return {
    artnet: [0, 1, 2].map(u => ({
      id: `artnet-${u + 1}`,
      enabled: true,
      host: '255.255.255.255',
      port: ARTNET_DEFAULT_PORT,
      universe: u,
      subnet: 0,
      net: 0
    })),
    usb: []
  }
}

// ---- Small validators ----

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOST_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

export function isValidIPv4(host: string): boolean {
  const m = IPV4_RE.exec(host)
  if (!m) return false
  return m.slice(1).every(o => Number(o) <= 255 && (o.length === 1 || !o.startsWith('0')))
}

/** IPv4 address or RFC-1123 host name (what an Art-Net target may be) */
export function isValidHost(host: unknown): host is string {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) return false
  if (/^[\d.]+$/.test(host)) return isValidIPv4(host)
  const labels = host.replace(/\.$/, '').split('.')
  return labels.length > 0 && labels.every(l => HOST_LABEL_RE.test(l))
}

const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/

function optionalLabel(v: unknown, where: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || v.length > 64) throw new Error(`${where}: label must be a text of at most 64 characters`)
  return v
}

function optionalBool(v: unknown, where: string, field: string, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt
  if (typeof v !== 'boolean') throw new Error(`${where}: ${field} must be true or false`)
  return v
}

function intField(v: unknown, where: string, field: string, min: number, max: number, dflt?: number): number {
  if ((v === undefined || v === null) && dflt !== undefined) return dflt
  if (!isInt(v, min, max)) throw new Error(`${where}: ${field} must be a whole number between ${min} and ${max}`)
  return v
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// ---- Entry validation ----

function validateArtnetEntry(raw: unknown, index: number): ArtNetConfig {
  const where = `Art-Net output ${index + 1}`
  if (!isPlainObject(raw)) throw new Error(`${where}: must be an object`)
  if (!isValidHost(raw.host)) throw new Error(`${where}: "${String(raw.host)}" is not a valid IPv4 address or host name`)
  const entry: ArtNetConfig = {
    host: raw.host,
    port: intField(raw.port, where, 'port', 1, 65535, ARTNET_DEFAULT_PORT),
    universe: intField(raw.universe, where, 'universe', 0, MAX_UNIVERSES - 1),
    subnet: intField(raw.subnet, where, 'subnet', 0, 15, 0),
    net: intField(raw.net, where, 'net', 0, 127, 0),
    enabled: optionalBool(raw.enabled, where, 'enabled', true)
  }
  if (raw.artnetUniverse !== undefined && raw.artnetUniverse !== null) {
    entry.artnetUniverse = intField(raw.artnetUniverse, where, 'Art-Net universe', 0, 15)
  }
  const label = optionalLabel(raw.label, where)
  if (label) entry.label = label
  if (typeof raw.id === 'string' && ID_RE.test(raw.id)) entry.id = raw.id
  return entry
}

function validateUsbEntry(raw: unknown, index: number, allowedPorts: Set<string> | null): UsbDmxConfig {
  const where = `USB output ${index + 1}`
  if (!isPlainObject(raw)) throw new Error(`${where}: must be an object`)
  if (typeof raw.driver !== 'string' || !(USB_DMX_DRIVERS as readonly string[]).includes(raw.driver)) {
    throw new Error(`${where}: unknown driver "${String(raw.driver)}"`)
  }
  if (typeof raw.portPath !== 'string' || raw.portPath.length === 0 || raw.portPath.length > 256) {
    throw new Error(`${where}: choose a serial port`)
  }
  if (allowedPorts && !allowedPorts.has(raw.portPath)) {
    throw new Error(`${where}: serial port "${raw.portPath}" was not found — rescan USB ports`)
  }
  const entry: UsbDmxConfig = {
    driver: raw.driver as UsbDmxDriver,
    portPath: raw.portPath,
    universe: intField(raw.universe, where, 'universe', 0, MAX_UNIVERSES - 1),
    enabled: optionalBool(raw.enabled, where, 'enabled', true)
  }
  const label = optionalLabel(raw.label, where)
  if (label) entry.label = label
  if (raw.serialNumber !== undefined && raw.serialNumber !== null && raw.serialNumber !== '') {
    if (typeof raw.serialNumber !== 'string' || raw.serialNumber.length > 128) {
      throw new Error(`${where}: invalid serial number`)
    }
    entry.serialNumber = raw.serialNumber
  }
  if (typeof raw.id === 'string' && ID_RE.test(raw.id)) entry.id = raw.id
  return entry
}

/**
 * Give every entry a unique id: valid explicit ids are reserved first (first
 * occurrence wins), then missing/duplicate ones get `<prefix>-<n>`.
 */
function assignIds(groups: { entries: { id?: string }[]; prefix: string }[]): void {
  const taken = new Set<string>()
  const needsId: { entry: { id?: string }; prefix: string }[] = []
  for (const { entries, prefix } of groups) {
    for (const entry of entries) {
      if (entry.id && !taken.has(entry.id)) taken.add(entry.id)
      else needsId.push({ entry, prefix })
    }
  }
  const counters = new Map<string, number>()
  for (const { entry, prefix } of needsId) {
    let n = counters.get(prefix) ?? 1
    while (taken.has(`${prefix}-${n}`)) n++
    entry.id = `${prefix}-${n}`
    taken.add(entry.id)
    counters.set(prefix, n + 1)
  }
}

export interface OutputValidationContext {
  /**
   * Paths reported by SerialPort.list(). When given, every USB portPath must be one
   * of them or one of `knownPorts`. Omit when loading the persisted file at startup
   * (an unplugged adapter must not erase its config).
   */
  availablePorts?: string[]
  /** Port paths already in the persisted config (allowed even while unplugged) */
  knownPorts?: string[]
}

export type OutputValidationResult =
  | { ok: true; config: DmxOutputsConfig }
  | { ok: false; error: string }

/** Strictly validate a full machine output config. Unknown fields are dropped. */
export function validateOutputsConfig(input: unknown, ctx: OutputValidationContext = {}): OutputValidationResult {
  try {
    if (!isPlainObject(input)) throw new Error('Output configuration must be an object')
    if (!Array.isArray(input.artnet)) throw new Error('Output configuration: "artnet" must be a list')
    if (!Array.isArray(input.usb)) throw new Error('Output configuration: "usb" must be a list')
    if (input.artnet.length > MAX_OUTPUTS_PER_TYPE || input.usb.length > MAX_OUTPUTS_PER_TYPE) {
      throw new Error(`At most ${MAX_OUTPUTS_PER_TYPE} outputs of each type`)
    }

    const allowed = ctx.availablePorts
      ? new Set([...ctx.availablePorts, ...(ctx.knownPorts ?? [])])
      : null

    const artnet = input.artnet.map((e, i) => validateArtnetEntry(e, i))
    const usb = input.usb.map((e, i) => validateUsbEntry(e, i, allowed))

    // One serial port can only be opened once
    const usedPorts = new Map<string, number>()
    usb.forEach((u, i) => {
      if (u.enabled === false) return
      const prev = usedPorts.get(u.portPath)
      if (prev !== undefined) {
        throw new Error(`USB outputs ${prev + 1} and ${i + 1} use the same port "${u.portPath}"`)
      }
      usedPorts.set(u.portPath, i)
    })

    assignIds([{ entries: artnet, prefix: 'artnet' }, { entries: usb, prefix: 'usb' }])
    return { ok: true, config: { artnet, usb } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Validate only an Art-Net list (legacy artnet.configure) */
export function validateArtnetList(input: unknown): { ok: true; artnet: ArtNetConfig[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Art-Net configuration must be a list' }
  const res = validateOutputsConfig({ artnet: input, usb: [] })
  return res.ok ? { ok: true, artnet: res.config.artnet } : res
}

/**
 * Convert a legacy DmxOutputConfig[] into a full config, starting from `current`.
 * The USB list is replaced by the USB entries of the list; the Art-Net list is
 * replaced only when the list contains Art-Net entries (older UI applied USB
 * settings with a USB-only list and must not kill Art-Net).
 */
export function fromLegacyList(list: unknown[], current: DmxOutputsConfig): unknown {
  const artnet: unknown[] = []
  const usb: unknown[] = []
  for (const item of list) {
    if (!isPlainObject(item)) return { invalid: true } // fails validation downstream
    if (item.type === 'artnet' && isPlainObject(item.artnet)) {
      artnet.push({ ...item.artnet, id: item.id, enabled: item.enabled !== false })
    } else if (item.type === 'usb-dmx' && isPlainObject(item.usbDmx)) {
      usb.push({ ...item.usbDmx, id: item.id, enabled: item.enabled !== false })
    }
  }
  return {
    artnet: artnet.length > 0 ? artnet : current.artnet,
    usb
  }
}

/** Legacy unified list (for DmxOutputsStatus.configs) */
export function toLegacyList(config: DmxOutputsConfig): DmxOutputConfig[] {
  return [
    ...config.artnet.map(a => ({ id: a.id || '', type: 'artnet' as const, enabled: a.enabled !== false, artnet: a })),
    ...config.usb.map(u => ({ id: u.id || '', type: 'usb-dmx' as const, enabled: u.enabled !== false, usbDmx: u }))
  ]
}

/** Art-Net universe actually put on the wire for this entry */
export function artnetOutputUniverse(c: ArtNetConfig): number {
  return c.artnetUniverse ?? c.universe
}

/** Problem with an entry's source universe, or null when it can be fed by the engine */
export function sourceUniverseProblem(universe: number, universeCount: number): string | null {
  if (universe >= universeCount) {
    return `Source universe ${universe} does not exist (PhotonBoard drives universes 0-${universeCount - 1})`
  }
  return null
}
