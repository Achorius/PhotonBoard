// ============================================================
// PhotonBoard — Touchscreen setup (Linux, X11)
//
// Settings › Display › Touchscreens sets every touch panel up by touch,
// without leaving PhotonBoard:
//   - panels: a USB port with at least one event node udev calls a
//     touchscreen / tablet; EVERY X pointer device on that port belongs to
//     it (cheap panels expose 2-3 HID interfaces, each its own xinput id)
//   - outputs: the active xrandr outputs (desktop geometry)
//   - settings per panel (output, rotation, invert X/Y, calibration) saved
//     in ~/.config/photonboard/touch.json (atomic write); panels without
//     settings follow the automatic order of the touch helper
//     (scripts/photonboard-map-touch.sh, which stays out of the way once
//     touch.json exists)
//   - apply: one 3×3 "Coordinate Transformation Matrix" per panel, set on
//     each of its xinput ids:
//       OutputMap (same math as `xinput map-to-output`)
//         · Orientation (rotation / invert, normalized [0,1] space)
//         · Calibration (affine, normalized device space)
//
// The parsers and the matrix math are pure (unit-tested on the field data
// of a Pi 5 with two HDMI screens and one "wch.cn TouchScreen"). Commands
// run through execFile only (no shell); nothing here throws to callers.
// ============================================================

import { execFile as nodeExecFile } from 'child_process'
import { existsSync, mkdirSync, promises as fsp, readFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type {
  TouchOutput,
  TouchPanel,
  TouchPanelSettings,
  TouchRotation,
  TouchSetupConfig,
  TouchSetupInfo
} from '../shared/photonboard-api'
import { atomicWriteFile } from './atomic-write'
import type { ExecFileLike } from './touch-diagnostics'

export const CTM_PROP = 'Coordinate Transformation Matrix'
export const HELPER_CONF = '/etc/photonboard/touch-map.conf'
const EXEC_TIMEOUT_MS = 5000

// ---------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------

const ROTATIONS: Record<string, TouchRotation> = { normal: 0, left: 90, inverted: 180, right: 270 }

/** `xrandr --query` → active outputs (connected AND with a geometry) + desktop size */
export function parseXrandr(text: string): { outputs: TouchOutput[]; desktop: { width: number; height: number } } {
  const outputs: TouchOutput[] = []
  let desktop: { width: number; height: number } | null = null
  for (const line of text.split('\n')) {
    const screen = /^Screen \d+:.*\bcurrent (\d+) x (\d+)/.exec(line)
    if (screen) {
      desktop = { width: Number(screen[1]), height: Number(screen[2]) }
      continue
    }
    const m = /^(\S+) connected( primary)? (\d+)x(\d+)\+(\d+)\+(\d+)(?: (normal|left|inverted|right))?/.exec(line)
    if (!m) continue
    outputs.push({
      name: m[1],
      primary: !!m[2],
      width: Number(m[3]),
      height: Number(m[4]),
      x: Number(m[5]),
      y: Number(m[6]),
      rotation: ROTATIONS[m[7] ?? 'normal']
    })
  }
  if (!desktop) {
    desktop = {
      width: Math.max(0, ...outputs.map((o) => o.x + o.width)),
      height: Math.max(0, ...outputs.map((o) => o.y + o.height))
    }
  }
  return { outputs: sortOutputs(outputs), desktop }
}

/** Natural order ("1-1.2" < "1-1.10", "HDMI-1" < "HDMI-2") */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

/** Screen order: by name (HDMI-1 = screen 1), like the touch helper */
export function sortOutputs(outputs: TouchOutput[]): TouchOutput[] {
  return [...outputs].sort((a, b) => naturalCompare(a.name, b.name))
}

export interface XinputEntry {
  id: number
  name: string
  role: 'master' | 'slave'
  kind: 'pointer' | 'keyboard'
}

/** `xinput list` → devices (name without the tree characters) */
export function parseXinputList(text: string): XinputEntry[] {
  const out: XinputEntry[] = []
  for (const line of text.split('\n')) {
    const m = /^(.*?)\s*\bid=(\d+)\s*\[(master|slave)\s+(pointer|keyboard)/.exec(line)
    if (!m) continue
    const name = m[1].replace(/^[\s⎡⎜⎣↳~]+/u, '').trim()
    out.push({ id: Number(m[2]), name, role: m[3] as 'master' | 'slave', kind: m[4] as 'pointer' | 'keyboard' })
  }
  return out
}

/** `xinput list-props <id>` → its Device Node */
export function parseDeviceNode(text: string): string | null {
  return /Device Node \(\d+\):\s*"([^"]*)"/.exec(text)?.[1] || null
}

/** `xinput list-props <id>` → its Coordinate Transformation Matrix (9 numbers) */
export function parseCtm(text: string): Mat3 | null {
  const m = /Coordinate Transformation Matrix \(\d+\):\s*([^\n]+)/.exec(text)
  if (!m) return null
  const v = m[1].split(',').map((s) => Number(s.trim()))
  return v.length === 9 && v.every(Number.isFinite) ? (v as Mat3) : null
}

/** sysfs path (`udevadm info -q path`) → USB port ("1-1.4.4"), null when not on USB */
export function usbPortFromPath(path: string): string | null {
  const parts = path.split('/').filter((p) => /^\d+-\d+(\.\d+)*$/.test(p))
  return parts.length ? parts[parts.length - 1] : null
}

/** `udevadm info -q property` → KEY=VALUE map */
export function parseUdevProps(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export function isTouchProps(props: Record<string, string>): boolean {
  return props.ID_INPUT_TOUCHSCREEN === '1' || props.ID_INPUT_TABLET === '1'
}

/** /etc/photonboard/touch-map.conf (shell assignments) → the keys the automatic order uses */
export interface HelperConf {
  swap: boolean
  touchName: string
  outputs: string[]
  portMap: Record<string, string>
}

export function parseHelperConf(text: string): HelperConf {
  const vars: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Z_]+)=(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    const q = value[0]
    if ((q === '"' || q === "'") && value.indexOf(q, 1) > 0) value = value.slice(1, value.indexOf(q, 1))
    else value = value.replace(/\s+#.*$/, '')
    vars[m[1]] = value
  }
  const portMap: Record<string, string> = {}
  for (const pair of (vars.PORT_MAP ?? '').split(/\s+/).filter(Boolean)) {
    const i = pair.indexOf('=')
    if (i > 0) portMap[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return {
    swap: vars.SWAP === '1',
    touchName: vars.TOUCH_NAME ?? '',
    outputs: (vars.OUTPUTS ?? '').split(/\s+/).filter(Boolean),
    portMap
  }
}

export const EMPTY_HELPER_CONF: HelperConf = { swap: false, touchName: '', outputs: [], portMap: {} }

// ---------------------------------------------------------------
// Panels
// ---------------------------------------------------------------

/** One X slave pointer with what udev says about its node */
export interface PointerDevice {
  id: number
  name: string
  node: string | null
  port: string | null
  touch: boolean
  ctm: Mat3 | null
}

/** An event node udev knows (all of /dev/input, and the nodes of X devices) */
export interface EventNode {
  node: string
  port: string | null
  touch: boolean
}

export interface RawPanel {
  key: string
  port: string
  name: string
  ids: number[]
  nodes: string[]
  ctm: Mat3 | null
}

export function panelKey(port: string, name: string): string {
  return `${port}|${name}`
}

/**
 * Group the X pointers into panels: one per USB port holding a touch node;
 * every pointer on that port is part of it, pointers on other ports never.
 * `touchName` (helper config TOUCH_NAME): pointers named so also make
 * their port a panel.
 */
export function groupPanels(pointers: PointerDevice[], nodes: EventNode[], touchName = ''): RawPanel[] {
  const touchPorts = new Set<string>()
  for (const n of nodes) if (n.touch && n.port) touchPorts.add(n.port)
  for (const p of pointers) {
    if (!p.port) continue
    if (p.touch || (touchName && p.name.includes(touchName))) touchPorts.add(p.port)
  }
  const panels: RawPanel[] = []
  for (const port of [...touchPorts].sort(naturalCompare)) {
    const devices = pointers.filter((p) => p.port === port).sort((a, b) => a.id - b.id)
    if (!devices.length) continue // a touch node X does not use: nothing to map
    const named = devices.find((d) => d.touch) ?? devices[0]
    const nodeSet = new Set<string>()
    for (const n of nodes) if (n.port === port) nodeSet.add(n.node)
    for (const d of devices) if (d.node) nodeSet.add(d.node)
    panels.push({
      key: panelKey(port, named.name),
      port,
      name: named.name,
      ids: devices.map((d) => d.id),
      nodes: [...nodeSet].sort(naturalCompare),
      ctm: named.ctm
    })
  }
  return panels
}

// ---------------------------------------------------------------
// Matrices (row-major 3×3, normalized coordinates)
// ---------------------------------------------------------------

export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
    }
  }
  return r
}

/** Affine inverse (bottom row 0 0 1); null when singular */
export function invertAffine(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f] = m
  const det = a * e - b * d
  if (Math.abs(det) < 1e-12) return null
  const ia = e / det
  const ib = -b / det
  const id = -d / det
  const ie = a / det
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f), 0, 0, 1]
}

export function applyToPoint(m: Mat3, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] }
}

/** Same as `xinput map-to-output` (unrotated): the output's rectangle within the desktop */
export function outputMatrix(o: Pick<TouchOutput, 'x' | 'y' | 'width' | 'height'>, desktop: { width: number; height: number }): Mat3 {
  const W = desktop.width || 1
  const H = desktop.height || 1
  return [o.width / W, 0, o.x / W, 0, o.height / H, o.y / H, 0, 0, 1]
}

export function normalizeRotation(deg: number): TouchRotation {
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  return r as TouchRotation
}

/**
 * Orientation in normalized space: rotation (counter-clockwise, as
 * `xinput map-to-output` does for a rotated output), then invert X / Y in
 * screen space.
 */
export function orientationMatrix(rotation: number, invertX = false, invertY = false): Mat3 {
  const R: Record<TouchRotation, Mat3> = {
    0: IDENTITY,
    90: [0, -1, 1, 1, 0, 0, 0, 0, 1],
    180: [-1, 0, 1, 0, -1, 1, 0, 0, 1],
    270: [0, 1, 0, -1, 0, 1, 0, 0, 1]
  }
  let m = R[normalizeRotation(rotation)]
  if (invertY) m = multiply([1, 0, 0, 0, -1, 1, 0, 0, 1], m)
  if (invertX) m = multiply([-1, 0, 1, 0, 1, 0, 0, 0, 1], m)
  return m
}

export function calibrationMatrix(c: number[] | null | undefined): Mat3 {
  return c && c.length === 6 ? [c[0], c[1], c[2], c[3], c[4], c[5], 0, 0, 1] : IDENTITY
}

/** Orientation of a panel on an output: its own rotation plus the output's xrandr rotation */
export function panelOrientation(settings: Pick<TouchPanelSettings, 'rotation' | 'invertX' | 'invertY'> | null, output: Pick<TouchOutput, 'rotation'>): Mat3 {
  return orientationMatrix((settings?.rotation ?? 0) + (output.rotation ?? 0), settings?.invertX ?? false, settings?.invertY ?? false)
}

/** The panel's Coordinate Transformation Matrix: OutputMap · Orientation · Calibration */
export function panelMatrix(output: TouchOutput, desktop: { width: number; height: number }, settings: Pick<TouchPanelSettings, 'rotation' | 'invertX' | 'invertY' | 'calibration'> | null): Mat3 {
  return multiply(multiply(outputMatrix(output, desktop), panelOrientation(settings, output)), calibrationMatrix(settings?.calibration))
}

/** Numbers for `xinput set-prop` (6 decimals, no "-0") */
export function formatMatrix(m: Mat3): string[] {
  return m.map((v) => {
    const r = Number(v.toFixed(6))
    return String(Object.is(r, -0) ? 0 : r)
  })
}

/** What a matrix maps to: an output, 'all' (whole desktop), or 'custom' */
export function outputFromCtm(ctm: Mat3 | null, outputs: TouchOutput[], desktop: { width: number; height: number }): string | null {
  if (!ctm) return null
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => applyToPoint(ctm, x, y))
  const x0 = Math.min(...corners.map((p) => p.x))
  const x1 = Math.max(...corners.map((p) => p.x))
  const y0 = Math.min(...corners.map((p) => p.y))
  const y1 = Math.max(...corners.map((p) => p.y))
  const near = (a: number, b: number) => Math.abs(a - b) < 0.06
  const W = desktop.width || 1
  const H = desktop.height || 1
  for (const o of outputs) {
    if (near(x0, o.x / W) && near(x1, (o.x + o.width) / W) && near(y0, o.y / H) && near(y1, (o.y + o.height) / H)) return o.name
  }
  if (near(x0, 0) && near(x1, 1) && near(y0, 0) && near(y1, 1)) return 'all'
  return 'custom'
}

// ---------------------------------------------------------------
// Calibration fit
// ---------------------------------------------------------------

export interface Point { x: number; y: number }

/** Solve a 3×3 linear system (Gaussian elimination, partial pivoting); null when singular */
function solve3(A: number[][], b: number[]): number[] | null {
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    if (Math.abs(M[pivot][col]) < 1e-12) return null
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let k = col; k < 4; k++) M[r][k] -= f * M[col][k]
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]]
}

export interface AffineFit {
  /** [a, b, c, d, e, f]: expected ≈ (a·x + b·y + c, d·x + e·y + f) of measured */
  coefficients: number[]
  /** Largest distance between a corrected point and its target (normalized) */
  maxError: number
}

/** Least-squares affine fit C with C·measured ≈ expected (≥ 3 points); null when degenerate */
export function fitAffine(measured: Point[], expected: Point[]): AffineFit | null {
  if (measured.length < 3 || measured.length !== expected.length) return null
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const Atx = [0, 0, 0]
  const Aty = [0, 0, 0]
  measured.forEach((m, i) => {
    const row = [m.x, m.y, 1]
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) AtA[r][c] += row[r] * row[c]
      Atx[r] += row[r] * expected[i].x
      Aty[r] += row[r] * expected[i].y
    }
  })
  const px = solve3(AtA, Atx)
  const py = solve3(AtA, Aty)
  if (!px || !py) return null
  const coefficients = [...px, ...py]
  if (!coefficients.every(Number.isFinite)) return null
  const C = calibrationMatrix(coefficients)
  let maxError = 0
  measured.forEach((m, i) => {
    const p = applyToPoint(C, m.x, m.y)
    maxError = Math.max(maxError, Math.hypot(p.x - expected[i].x, p.y - expected[i].y))
  })
  return { coefficients, maxError }
}

/** Largest fit error accepted (normalized: 4 % of the screen) */
export const MAX_FIT_ERROR = 0.04

/** Calibration targets: corners inset by 10 %, in this order (then the centre check) */
export const CALIBRATION_TARGETS: Point[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 }
]
export const CALIBRATION_CHECK: Point = { x: 0.5, y: 0.5 }

export type CalibrationOutcome =
  | { ok: true; calibration: number[]; fitError: number }
  | { ok: false; reason: 'degenerate' | 'inconsistent' | 'implausible'; fitError?: number }

/**
 * From the touches measured (normalized within the output, with the
 * panel's matrix applied WITHOUT calibration) to the device-space
 * calibration of touch.json: fit C_out on the screen side, then
 * C = O⁻¹ · C_out · O (O = the panel's orientation), so that
 * OutputMap · O · C = OutputMap · C_out · O.
 */
export function computeCalibration(measured: Point[], expected: Point[], orientation: Mat3): CalibrationOutcome {
  const fit = fitAffine(measured, expected)
  if (!fit) return { ok: false, reason: 'degenerate' }
  if (fit.maxError > MAX_FIT_ERROR) return { ok: false, reason: 'inconsistent', fitError: fit.maxError }
  const [a, b, , d, e] = fit.coefficients
  const det = a * e - b * d
  // A real panel is never off by more than 2× nor mirrored by calibration (orientation does that)
  if (!(det > 0.25 && det < 4)) return { ok: false, reason: 'implausible', fitError: fit.maxError }
  const inv = invertAffine(orientation)
  if (!inv) return { ok: false, reason: 'degenerate' }
  const dev = multiply(multiply(inv, calibrationMatrix(fit.coefficients)), orientation)
  return { ok: true, calibration: dev.slice(0, 6).map((v) => Number(v.toFixed(6)) + 0), fitError: fit.maxError }
}

// ---------------------------------------------------------------
// Saved setup (touch.json)
// ---------------------------------------------------------------

export function touchConfigPath(env: NodeJS.ProcessEnv = process.env, home: string = safeHome()): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'photonboard', 'touch.json')
}

function safeHome(): string {
  try { return homedir() } catch { return '/tmp' }
}

/** Valid settings from anything (renderer input, file); null when unusable */
export function sanitizeSettings(raw: unknown): TouchPanelSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const output = typeof r.output === 'string' && /^[\w.:-]{1,64}$/.test(r.output) ? r.output : null
  const rotation = typeof r.rotation === 'number' && [0, 90, 180, 270].includes(r.rotation) ? (r.rotation as TouchRotation) : 0
  let calibration: number[] | null = null
  if (Array.isArray(r.calibration) && r.calibration.length === 6 && r.calibration.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 100)) {
    calibration = (r.calibration as number[]).map((v) => Number(v.toFixed(6)) + 0)
  }
  return { output, rotation, invertX: r.invertX === true, invertY: r.invertY === true, calibration }
}

export function isDefaultSettings(s: TouchPanelSettings): boolean {
  return s.output === null && s.rotation === 0 && !s.invertX && !s.invertY && !s.calibration
}

export function splitPanelKey(key: string): { port: string; name: string } | null {
  const i = key.indexOf('|')
  if (i <= 0) return null
  const port = key.slice(0, i)
  return /^\d+-\d+(\.\d+)*$/.test(port) ? { port, name: key.slice(i + 1) } : null
}

export function sanitizeConfig(raw: unknown): TouchSetupConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const panels = (raw as { panels?: unknown }).panels
  if (!panels || typeof panels !== 'object') return null
  const out: TouchSetupConfig = { version: 1, panels: {} }
  for (const [key, value] of Object.entries(panels as Record<string, unknown>)) {
    const id = splitPanelKey(key)
    const settings = sanitizeSettings(value)
    if (id && settings) out.panels[key] = { ...id, ...settings }
  }
  return out
}

export function readTouchConfig(path: string): TouchSetupConfig | null {
  try {
    if (!existsSync(path)) return null
    return sanitizeConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

/** Save atomically; an empty setup removes the file (the touch helper takes over again) */
export async function writeTouchConfig(path: string, config: TouchSetupConfig): Promise<void> {
  const panels: TouchSetupConfig['panels'] = {}
  for (const [key, p] of Object.entries(config.panels)) if (!isDefaultSettings(p)) panels[key] = p
  if (!Object.keys(panels).length) {
    try { unlinkSync(path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  await atomicWriteFile(path, `${JSON.stringify({ version: 1, panels }, null, 2)}\n`)
}

/** Merge settings for some panels over a saved setup */
export function mergeConfig(saved: TouchSetupConfig | null, updates: Record<string, unknown>): TouchSetupConfig {
  const out: TouchSetupConfig = { version: 1, panels: { ...(saved?.panels ?? {}) } }
  for (const [key, value] of Object.entries(updates)) {
    const id = splitPanelKey(key)
    const settings = sanitizeSettings(value)
    if (id && settings) out.panels[key] = { ...id, ...settings }
  }
  return out
}

/** Drop one panel's settings (by key or by port), or all of them */
export function dropFromConfig(saved: TouchSetupConfig | null, which?: string): TouchSetupConfig {
  if (!which) return { version: 1, panels: {} }
  const panels: TouchSetupConfig['panels'] = {}
  for (const [key, p] of Object.entries(saved?.panels ?? {})) if (key !== which && p.port !== which) panels[key] = p
  return { version: 1, panels }
}

// ---------------------------------------------------------------
// Assignment plan
// ---------------------------------------------------------------

/**
 * Output of every panel: its saved output when connected, else the
 * automatic order of the touch helper — PORT_MAP, then panels by USB port
 * matched with the outputs not taken (OUTPUTS, or by name), SWAP.
 */
export function assignOutputs(panels: { key: string; port: string }[], outputs: TouchOutput[], saved: TouchSetupConfig | null, conf: HelperConf = EMPTY_HELPER_CONF): Map<string, { output: string | null; automatic: boolean }> {
  const names = new Set(outputs.map((o) => o.name))
  const plan = new Map<string, { output: string | null; automatic: boolean }>()
  const taken = new Set<string>()
  for (const p of panels) {
    const s = saved?.panels[p.key]
    if (s?.output && names.has(s.output)) {
      plan.set(p.key, { output: s.output, automatic: false })
      taken.add(s.output)
    }
  }
  let auto = panels.filter((p) => !plan.has(p.key))
  for (const p of auto) {
    const o = conf.portMap[p.port]
    if (o && names.has(o) && !taken.has(o)) {
      plan.set(p.key, { output: o, automatic: true })
      taken.add(o)
    }
  }
  auto = auto.filter((p) => !plan.has(p.key)).sort((a, b) => naturalCompare(a.port, b.port))
  if (conf.swap && auto.length >= 2) auto = [auto[1], auto[0], ...auto.slice(2)]
  const order = (conf.outputs.length ? conf.outputs.filter((o) => names.has(o)) : outputs.map((o) => o.name)).filter((o) => !taken.has(o))
  auto.forEach((p, i) => plan.set(p.key, { output: order[i] ?? null, automatic: true }))
  return plan
}

// ---------------------------------------------------------------
// System access (xrandr / xinput / udevadm)
// ---------------------------------------------------------------

export interface TouchSystemDeps {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  execFile?: ExecFileLike
  /** Folder scanned for event nodes (default /dev/input) */
  inputDir?: string
  configPath?: string
  helperConfPath?: string
  readDir?: (dir: string) => Promise<string[]>
  readFile?: (path: string) => string | null
}

export function run(deps: TouchSystemDeps, file: string, args: string[]): Promise<{ ok: boolean; stdout: string; error: string | null }> {
  const env = deps.env ?? process.env
  const exec = deps.execFile ?? (nodeExecFile as unknown as ExecFileLike)
  return new Promise((done) => {
    try {
      exec(file, args, { timeout: EXEC_TIMEOUT_MS, env: { ...env, DISPLAY: env.DISPLAY || ':0' }, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
        const out = String(stdout ?? '')
        if (!err) done({ ok: true, stdout: out, error: null })
        else done({ ok: false, stdout: out, error: String(stderr ?? '').trim() || err.message || String(err) })
      })
    } catch (e) {
      done({ ok: false, stdout: '', error: e instanceof Error ? e.message : String(e) })
    }
  })
}

/** Why there is no touch setup here (null = X11 on Linux) */
export function unsupportedReason(deps: TouchSystemDeps): 'not-linux' | 'wayland' | null {
  if ((deps.platform ?? process.platform) !== 'linux') return 'not-linux'
  const env = deps.env ?? process.env
  if (env.XDG_SESSION_TYPE === 'wayland' || (env.WAYLAND_DISPLAY && !env.DISPLAY)) return 'wayland'
  return null
}

function readHelperConf(deps: TouchSystemDeps): HelperConf {
  const path = deps.helperConfPath ?? (deps.env ?? process.env).PB_TOUCH_CONF ?? HELPER_CONF
  try {
    const text = deps.readFile ? deps.readFile(path) : existsSync(path) ? readFileSync(path, 'utf8') : null
    return text ? parseHelperConf(text) : EMPTY_HELPER_CONF
  } catch {
    return EMPTY_HELPER_CONF
  }
}

export interface TouchScan {
  info: TouchSetupInfo
  raw: RawPanel[]
}

function emptyInfo(configPath: string, saved: TouchSetupConfig | null, extra: Partial<TouchSetupInfo>): TouchSetupInfo {
  return { supported: false, outputs: [], panels: [], desktop: { width: 0, height: 0 }, saved, configPath, ...extra }
}

/** Outputs, panels (grouped by USB port), saved setup and the current assignment */
export async function scanTouchSetup(deps: TouchSystemDeps = {}): Promise<TouchScan> {
  const configPath = deps.configPath ?? touchConfigPath(deps.env ?? process.env)
  const saved = readTouchConfig(configPath)
  const reason = unsupportedReason(deps)
  if (reason) return { info: emptyInfo(configPath, saved, { reason }), raw: [] }
  try {
    const [xr, xl] = await Promise.all([run(deps, 'xrandr', ['--query']), run(deps, 'xinput', ['list'])])
    if (!xr.ok || !xl.ok) return { info: emptyInfo(configPath, saved, { reason: 'no-x', error: xr.error || xl.error || undefined }), raw: [] }
    const { outputs, desktop } = parseXrandr(xr.stdout)
    const entries = parseXinputList(xl.stdout).filter((e) => e.role === 'slave' && e.kind === 'pointer')

    const udevCache = new Map<string, Promise<EventNode>>()
    const udev = (node: string): Promise<EventNode> => {
      let p = udevCache.get(node)
      if (!p) {
        p = Promise.all([run(deps, 'udevadm', ['info', '-q', 'path', '-n', node]), run(deps, 'udevadm', ['info', '-q', 'property', '-n', node])])
          .then(([path, props]) => ({
            node,
            port: path.ok ? usbPortFromPath(path.stdout.trim()) : null,
            touch: props.ok && isTouchProps(parseUdevProps(props.stdout))
          }))
        udevCache.set(node, p)
      }
      return p
    }

    const pointers: PointerDevice[] = await Promise.all(entries.map(async (e) => {
      const props = await run(deps, 'xinput', ['list-props', String(e.id)])
      const node = props.ok ? parseDeviceNode(props.stdout) : null
      const u = node ? await udev(node) : null
      return { id: e.id, name: e.name, node, port: u?.port ?? null, touch: u?.touch ?? false, ctm: props.ok ? parseCtm(props.stdout) : null }
    }))

    const inputDir = deps.inputDir ?? (deps.env ?? process.env).PB_INPUT_DIR ?? '/dev/input'
    let names: string[] = []
    try { names = deps.readDir ? await deps.readDir(inputDir) : await fsp.readdir(inputDir) } catch { /* no /dev/input (container, tests) */ }
    const nodes = await Promise.all([
      ...names.filter((n) => /^event\d+$/.test(n)).map((n) => udev(join(inputDir, n))),
      ...pointers.filter((p) => p.node).map((p) => udev(p.node!))
    ])

    const conf = readHelperConf(deps)
    const raw = groupPanels(pointers, nodes, conf.touchName)
    const plan = assignOutputs(raw, outputs, saved, conf)
    const panels: TouchPanel[] = raw.map((p) => {
      const a = plan.get(p.key) ?? { output: null, automatic: true }
      const s = saved?.panels[p.key]
      return {
        key: p.key,
        port: p.port,
        name: p.name,
        ids: p.ids,
        nodes: p.nodes,
        saved: s ? { output: s.output, rotation: s.rotation, invertX: s.invertX, invertY: s.invertY, calibration: s.calibration } : null,
        output: a.output,
        automatic: a.automatic,
        current: outputFromCtm(p.ctm, outputs, desktop)
      }
    })
    return { info: { supported: true, outputs, panels, desktop, saved, configPath }, raw }
  } catch (e) {
    return { info: emptyInfo(configPath, saved, { reason: 'error', error: e instanceof Error ? e.message : String(e) }), raw: [] }
  }
}

export async function listTouchSetup(deps: TouchSystemDeps = {}): Promise<TouchSetupInfo> {
  return (await scanTouchSetup(deps)).info
}

export interface AppliedPanel {
  key: string
  output: string | null
  ids: number[]
  matrix: Mat3 | null
  ok: boolean
  error?: string
}

/** Settings used for one apply, over the saved ones (wizards: calibration off, candidate…) */
export type SettingsOverride = Map<string, Partial<TouchPanelSettings>>

/** The settings a panel is applied with */
export function effectiveSettings(panel: TouchPanel, override?: Partial<TouchPanelSettings>): TouchPanelSettings {
  const base: TouchPanelSettings = panel.saved ?? { output: null, rotation: 0, invertX: false, invertY: false, calibration: null }
  return { ...base, ...(override ?? {}) }
}

/** Set every panel's matrix on each of its xinput ids */
export async function applyScan(info: TouchSetupInfo, deps: TouchSystemDeps = {}, override?: SettingsOverride): Promise<AppliedPanel[]> {
  const out: AppliedPanel[] = []
  for (const panel of info.panels) {
    const settings = effectiveSettings(panel, override?.get(panel.key))
    const outputName = override?.get(panel.key)?.output ?? panel.output
    const output = info.outputs.find((o) => o.name === outputName)
    if (!output) {
      out.push({ key: panel.key, output: null, ids: panel.ids, matrix: null, ok: true })
      continue
    }
    const matrix = panelMatrix(output, info.desktop, settings)
    const values = formatMatrix(matrix)
    const errors: string[] = []
    for (const id of panel.ids) {
      const r = await run(deps, 'xinput', ['set-prop', String(id), CTM_PROP, ...values])
      if (!r.ok) errors.push(`id ${id}: ${r.error}`)
    }
    out.push({ key: panel.key, output: output.name, ids: panel.ids, matrix, ok: errors.length === 0, error: errors.join('; ') || undefined })
  }
  return out
}

/** Scan, then apply the saved setup (automatic order for the rest) */
export async function applyTouchSetup(deps: TouchSystemDeps = {}, override?: SettingsOverride): Promise<{ info: TouchSetupInfo; applied: AppliedPanel[] }> {
  const { info } = await scanTouchSetup(deps)
  if (!info.supported) return { info, applied: [] }
  const applied = await applyScan(info, deps, override)
  // The panels' "current" now reflects what was just set
  const panels = info.panels.map((p) => {
    const a = applied.find((x) => x.key === p.key)
    return a?.matrix ? { ...p, current: outputFromCtm(a.matrix, info.outputs, info.desktop) } : p
  })
  return { info: { ...info, panels }, applied }
}
