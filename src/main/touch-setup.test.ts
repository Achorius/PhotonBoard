import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  CALIBRATION_TARGETS,
  IDENTITY,
  applyToPoint,
  applyTouchSetup,
  assignOutputs,
  calibrationMatrix,
  computeCalibration,
  dropFromConfig,
  fitAffine,
  formatMatrix,
  groupPanels,
  mergeConfig,
  multiply,
  orientationMatrix,
  outputFromCtm,
  outputMatrix,
  panelMatrix,
  parseCtm,
  parseDeviceNode,
  parseHelperConf,
  parseUdevProps,
  parseXinputList,
  parseXrandr,
  readTouchConfig,
  sanitizeSettings,
  scanTouchSetup,
  touchConfigPath,
  unsupportedReason,
  usbPortFromPath,
  writeTouchConfig,
  type Mat3,
  type Point
} from './touch-setup'

const ROOT = join(__dirname, '..', '..')
const FIELD = join(ROOT, 'test-fixtures', 'touch', 'pi5-field')
const BIN = join(ROOT, 'test-fixtures', 'touch', 'bin')
const read = (f: string) => readFileSync(join(FIELD, f), 'utf8')

const close = (a: number[], b: number[], eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps)

describe('parsers on the field data (Pi 5, 2 HDMI screens, 1 wch.cn panel)', () => {
  it('xrandr: two outputs side by side on a 3840×1080 desktop', () => {
    const { outputs, desktop } = parseXrandr(read('xrandr.txt'))
    expect(desktop).toEqual({ width: 3840, height: 1080 })
    expect(outputs).toEqual([
      { name: 'HDMI-1', primary: true, x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
      { name: 'HDMI-2', primary: false, x: 1920, y: 0, width: 1920, height: 1080, rotation: 0 }
    ])
  })

  it('xrandr: rotated outputs, disconnected / disabled ones, no Screen line', () => {
    const { outputs, desktop } = parseXrandr([
      'HDMI-2 connected 1080x1920+1920+0 left (normal left inverted right x axis y axis) 527mm x 296mm',
      'HDMI-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 0mm x 0mm',
      'DSI-1 connected (normal left inverted right x axis y axis)',
      'Composite-1 disconnected (normal left inverted right x axis y axis)'
    ].join('\n'))
    expect(outputs.map((o) => [o.name, o.rotation, o.width])).toEqual([['HDMI-1', 0, 1920], ['HDMI-2', 90, 1080]])
    expect(desktop).toEqual({ width: 3000, height: 1920 })
  })

  it('xinput list: names without the tree, roles and kinds', () => {
    const list = parseXinputList(read('xinput-list.txt'))
    const pointers = list.filter((e) => e.role === 'slave' && e.kind === 'pointer')
    expect(pointers.map((e) => `${e.id}:${e.name}`)).toEqual([
      '4:Virtual core XTEST pointer', '6:Logitech Wireless Mouse', '7:Logitech Wireless Keyboard PID:4075',
      '8:wch.cn TouchScreen', '9:wch.cn TouchScreen', '11:vc4-hdmi-0', '12:vc4-hdmi-1'
    ])
    expect(list.find((e) => e.id === 10)).toMatchObject({ name: 'wch.cn TouchScreen', kind: 'keyboard' })
    expect(list.find((e) => e.id === 2)).toMatchObject({ role: 'master', kind: 'pointer' })
  })

  it('list-props: device node and matrix', () => {
    const props = "Device 'wch.cn TouchScreen':\n\tDevice Enabled (115):\t1\n\tCoordinate Transformation Matrix (116):\t0.500000, 0.000000, 0.500000, 0.000000, 1.000000, 0.000000, 0.000000, 0.000000, 1.000000\n\tDevice Node (270):\t\"/dev/input/event3\"\n"
    expect(parseDeviceNode(props)).toBe('/dev/input/event3')
    expect(parseCtm(props)).toEqual([0.5, 0, 0.5, 0, 1, 0, 0, 0, 1])
    expect(parseDeviceNode("Device 'Virtual core XTEST pointer':\n\tDevice Enabled (115):\t1\n")).toBeNull()
  })

  it('udev: USB port from the sysfs path, touch flags', () => {
    expect(usbPortFromPath(read('udev/event3.path').trim())).toBe('1-1.4.4')
    expect(usbPortFromPath(read('udev/event0.path').trim())).toBe('1-1.4.2')
    expect(usbPortFromPath(read('udev/event6.path').trim())).toBeNull()
    expect(parseUdevProps(read('udev/event3.props')).ID_INPUT_TOUCHSCREEN).toBe('1')
  })

  it('helper config: SWAP, OUTPUTS, PORT_MAP, TOUCH_NAME, comments and quotes', () => {
    expect(parseHelperConf([
      '# PhotonBoard touchscreen mapping',
      'SWAP=1',
      "TOUCH_NAME='wch.cn TouchScreen'",
      'OUTPUTS="HDMI-2 HDMI-1"  # order',
      'PORT_MAP="1-1=HDMI-2 1-2=HDMI-1"'
    ].join('\n'))).toEqual({ swap: true, touchName: 'wch.cn TouchScreen', outputs: ['HDMI-2', 'HDMI-1'], portMap: { '1-1': 'HDMI-2', '1-2': 'HDMI-1' } })
  })
})

describe('panels', () => {
  const pointers = [
    { id: 6, name: 'Logitech Wireless Mouse', node: '/dev/input/event0', port: '1-1.4.2', touch: false, ctm: null },
    { id: 7, name: 'Logitech Wireless Keyboard PID:4075', node: '/dev/input/event1', port: '1-1.4.2', touch: false, ctm: null },
    { id: 9, name: 'wch.cn TouchScreen', node: '/dev/input/event4', port: '1-1.4.4', touch: false, ctm: null },
    { id: 8, name: 'wch.cn TouchScreen', node: '/dev/input/event3', port: '1-1.4.4', touch: true, ctm: IDENTITY },
    { id: 11, name: 'vc4-hdmi-0', node: '/dev/input/event6', port: null, touch: false, ctm: null }
  ]

  it('one panel per touch USB port, with EVERY pointer of that port (ids 8 AND 9), never the mouse receiver', () => {
    const panels = groupPanels(pointers, [{ node: '/dev/input/event5', port: '1-1.4.4', touch: false }])
    expect(panels).toEqual([{
      key: '1-1.4.4|wch.cn TouchScreen',
      port: '1-1.4.4',
      name: 'wch.cn TouchScreen',
      ids: [8, 9],
      nodes: ['/dev/input/event3', '/dev/input/event4', '/dev/input/event5'],
      ctm: IDENTITY
    }])
  })

  it('a touch node X does not use makes no panel; TOUCH_NAME adds ports by name', () => {
    expect(groupPanels(pointers.filter((p) => p.port !== '1-1.4.4'), [{ node: '/dev/input/event3', port: '1-1.4.4', touch: true }])).toEqual([])
    expect(groupPanels(pointers, [], 'Logitech').map((p) => p.port)).toEqual(['1-1.4.2', '1-1.4.4'])
  })
})

describe('matrices', () => {
  const desktop = { width: 3840, height: 1080 }
  const hdmi1 = { name: 'HDMI-1', primary: true, x: 0, y: 0, width: 1920, height: 1080, rotation: 0 as const }
  const hdmi2 = { name: 'HDMI-2', primary: false, x: 1920, y: 0, width: 1920, height: 1080, rotation: 0 as const }

  it('like xinput map-to-output: HDMI-2 on a 3840×1080 desktop → [0.5 0 0.5; 0 1 0; 0 0 1]', () => {
    expect(outputMatrix(hdmi2, desktop)).toEqual([0.5, 0, 0.5, 0, 1, 0, 0, 0, 1])
    expect(outputMatrix(hdmi1, desktop)).toEqual([0.5, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(formatMatrix(panelMatrix(hdmi2, desktop, null))).toEqual(['0.5', '0', '0.5', '0', '1', '0', '0', '0', '1'])
  })

  it('like xinput map-to-output on rotated outputs (left = 90°, inverted, right = 270°)', () => {
    // xinput transform.c: 90 → [0 -w x+w; h 0 y], 180 → [-w 0 x+w; 0 -h y+h], 270 → [0 w x; -h 0 y+h]
    const o = { ...hdmi2, width: 1080, height: 1920 }
    const d = { width: 3000, height: 1920 }
    const w = 1080 / 3000, h = 1, x = 1920 / 3000, y = 0
    expect(close(panelMatrix({ ...o, rotation: 90 }, d, null), [0, -w, x + w, h, 0, y, 0, 0, 1])).toBe(true)
    expect(close(panelMatrix({ ...o, rotation: 180 }, d, null), [-w, 0, x + w, 0, -h, y + h, 0, 0, 1])).toBe(true)
    expect(close(panelMatrix({ ...o, rotation: 270 }, d, null), [0, w, x, -h, 0, y + h, 0, 0, 1])).toBe(true)
  })

  it('orientation: corners go where expected; invert X / Y in screen space; panel + output rotation add up', () => {
    const corner = (m: Mat3, x: number, y: number) => { const p = applyToPoint(m, x, y); return [+p.x.toFixed(6), +p.y.toFixed(6)] }
    expect(corner(orientationMatrix(90), 0, 0)).toEqual([1, 0])
    expect(corner(orientationMatrix(180), 0, 0)).toEqual([1, 1])
    expect(corner(orientationMatrix(270), 0, 0)).toEqual([0, 1])
    expect(corner(orientationMatrix(0, true), 0.2, 0.3)).toEqual([0.8, 0.3])
    expect(corner(orientationMatrix(0, false, true), 0.2, 0.3)).toEqual([0.2, 0.7])
    expect(corner(orientationMatrix(90, true), 0, 0)).toEqual([0, 0])
    expect(close(orientationMatrix(0, true, true), orientationMatrix(180))).toBe(true)
    expect(close(panelMatrix({ ...hdmi1, rotation: 90 }, desktop, { rotation: 270, invertX: false, invertY: false, calibration: null }), outputMatrix(hdmi1, desktop))).toBe(true)
  })

  it('calibration is applied first, in device space', () => {
    const m = panelMatrix(hdmi2, desktop, { rotation: 0, invertX: false, invertY: false, calibration: [1, 0, -0.1, 0, 1, 0, 0, 0, 1].slice(0, 6) })
    expect(close(m, multiply(outputMatrix(hdmi2, desktop), calibrationMatrix([1, 0, -0.1, 0, 1, 0])))).toBe(true)
    expect(formatMatrix([-0.0000001, 1 / 3, 0, 0, 1, 0, 0, 0, 1]).slice(0, 2)).toEqual(['0', '0.333333'])
  })

  it('reads back which output a matrix maps to', () => {
    const outputs = [hdmi1, hdmi2]
    expect(outputFromCtm([0.5, 0, 0.5, 0, 1, 0, 0, 0, 1], outputs, desktop)).toBe('HDMI-2')
    expect(outputFromCtm([0.5, 0, 0, 0, 1, 0, 0, 0, 1], outputs, desktop)).toBe('HDMI-1')
    expect(outputFromCtm(IDENTITY, outputs, desktop)).toBe('all')
    expect(outputFromCtm([0.2, 0, 0.1, 0, 0.3, 0, 0, 0, 1], outputs, desktop)).toBe('custom')
    expect(outputFromCtm(panelMatrix(hdmi2, desktop, { rotation: 180, invertX: false, invertY: false, calibration: null }), outputs, desktop)).toBe('HDMI-2')
  })
})

describe('calibration fit', () => {
  const targets = CALIBRATION_TARGETS
  /** What the panel reports for each target when its raw → screen error is `err` */
  const measure = (err: Mat3, pts: Point[] = targets) => { const inv = invertAffine3(err); return pts.map((p) => applyToPoint(inv, p.x, p.y)) }
  function invertAffine3(m: Mat3): Mat3 {
    const [a, b, c, d, e, f] = m
    const det = a * e - b * d
    return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det, 0, 0, 1]
  }

  it('recovers a pure offset exactly', () => {
    const measured = targets.map((p) => ({ x: p.x + 0.03, y: p.y - 0.02 }))
    const fit = fitAffine(measured, targets)!
    expect(close(fit.coefficients, [1, 0, -0.03, 0, 1, 0.02])).toBe(true)
    expect(fit.maxError).toBeLessThan(1e-9)
  })

  it('recovers scale + offset + a small rotation (identity orientation)', () => {
    const err: Mat3 = [1.05, 0.02, -0.03, -0.015, 0.94, 0.04, 0, 0, 1]
    const measured = measure(err)
    const r = computeCalibration(measured, targets, IDENTITY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(close(r.calibration, err.slice(0, 6), 1e-5)).toBe(true)
    // the centre lands on the centre
    const c = applyToPoint(calibrationMatrix(r.calibration), ...(Object.values(measure(err, [{ x: 0.5, y: 0.5 }])[0]) as [number, number]))
    expect(Math.hypot(c.x - 0.5, c.y - 0.5)).toBeLessThan(1e-6)
  })

  it('in device space when the panel is rotated / inverted: OutputMap·O·C equals the screen-side correction', () => {
    for (const O of [orientationMatrix(90), orientationMatrix(180, true), orientationMatrix(0, false, true), orientationMatrix(270, true, true)]) {
      const err: Mat3 = [0.97, 0, 0.025, 0, 1.03, -0.02, 0, 0, 1]
      const measured = measure(err)
      const r = computeCalibration(measured, targets, O)
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      // device d measured as m = O·d: the full chain must send each raw point to its target
      targets.forEach((t, i) => {
        const dInv = invertAffine3(O)
        const d = applyToPoint(dInv, measured[i].x, measured[i].y)
        const s = applyToPoint(multiply(O, calibrationMatrix(r.calibration)), d.x, d.y)
        expect(Math.hypot(s.x - t.x, s.y - t.y)).toBeLessThan(1e-6)
      })
    }
  })

  it('rejects an inconsistent set (one touch way off), a degenerate or implausible one', () => {
    const bad = targets.map((p, i) => (i === 2 ? { x: p.x - 0.2, y: p.y - 0.15 } : p))
    const r = computeCalibration(bad, targets, IDENTITY)
    expect(r).toMatchObject({ ok: false, reason: 'inconsistent' })
    expect(computeCalibration(targets.map(() => ({ x: 0.5, y: 0.5 })), targets, IDENTITY)).toMatchObject({ ok: false, reason: 'degenerate' })
    // mirrored by "calibration": orientation's job, not calibration's
    expect(computeCalibration(targets.map((p) => ({ x: 1 - p.x, y: p.y })), targets, IDENTITY)).toMatchObject({ ok: false, reason: 'implausible' })
    expect(fitAffine(targets.slice(0, 2), targets.slice(0, 2))).toBeNull()
  })
})

describe('saved setup (touch.json)', () => {
  it('path: $XDG_CONFIG_HOME or ~/.config, /photonboard/touch.json', () => {
    expect(touchConfigPath({}, '/home/photonboard')).toBe('/home/photonboard/.config/photonboard/touch.json')
    expect(touchConfigPath({ XDG_CONFIG_HOME: '/x' }, '/home/p')).toBe('/x/photonboard/touch.json')
  })

  it('sanitizes what it is given', () => {
    expect(sanitizeSettings({ output: 'HDMI-2', rotation: 90, invertX: true, invertY: 'yes', calibration: [1, 0, 0.0000004, 0, 1, 0] }))
      .toEqual({ output: 'HDMI-2', rotation: 90, invertX: true, invertY: false, calibration: [1, 0, 0, 0, 1, 0] })
    expect(sanitizeSettings({ output: '../../x y', rotation: 45, calibration: [1, 2] })).toEqual({ output: null, rotation: 0, invertX: false, invertY: false, calibration: null })
    expect(sanitizeSettings(null)).toBeNull()
  })

  it('writes atomically, reads back, merges, drops; an empty setup removes the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-touchcfg-'))
    try {
      const path = join(dir, 'photonboard', 'touch.json')
      expect(readTouchConfig(path)).toBeNull()
      const key = '1-1.4.4|wch.cn TouchScreen'
      let cfg = mergeConfig(null, { [key]: { output: 'HDMI-2', rotation: 0, invertX: false, invertY: false, calibration: null }, 'bad key': { output: 'HDMI-1' } })
      await writeTouchConfig(path, cfg)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, panels: { [key]: { port: '1-1.4.4', name: 'wch.cn TouchScreen', output: 'HDMI-2', rotation: 0, invertX: false, invertY: false, calibration: null } } })
      expect(readTouchConfig(path)).toEqual(cfg)
      cfg = dropFromConfig(cfg, '1-1.4.4')
      await writeTouchConfig(path, cfg)
      expect(existsSync(path)).toBe(false)
      writeFileSync(join(dir, 'broken.json'), '{nope')
      expect(readTouchConfig(join(dir, 'broken.json'))).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('assignment plan', () => {
  const outputs = parseXrandr(read('xrandr.txt')).outputs
  const panel = { key: '1-1.4.4|wch.cn TouchScreen', port: '1-1.4.4' }
  const other = { key: '1-1.4.1|ILITEK', port: '1-1.4.1' }

  it('automatic: panels by USB port, outputs by name (the owner\'s panel lands on HDMI-1)', () => {
    expect([...assignOutputs([panel], outputs, null)]).toEqual([[panel.key, { output: 'HDMI-1', automatic: true }]])
    expect(Object.fromEntries(assignOutputs([panel, other], outputs, null))).toEqual({
      [other.key]: { output: 'HDMI-1', automatic: true },
      [panel.key]: { output: 'HDMI-2', automatic: true }
    })
  })

  it('saved output wins; automatic panels take the outputs left', () => {
    const saved = mergeConfig(null, { [panel.key]: { output: 'HDMI-1' } })
    expect(Object.fromEntries(assignOutputs([panel, other], outputs, saved))).toEqual({
      [panel.key]: { output: 'HDMI-1', automatic: false },
      [other.key]: { output: 'HDMI-2', automatic: true }
    })
    // a saved output that is not connected falls back to automatic
    const gone = mergeConfig(null, { [panel.key]: { output: 'HDMI-3' } })
    expect(assignOutputs([panel], outputs, gone).get(panel.key)).toEqual({ output: 'HDMI-1', automatic: true })
  })

  it('helper config: PORT_MAP, SWAP, OUTPUTS', () => {
    expect(assignOutputs([panel], outputs, null, parseHelperConf('PORT_MAP="1-1.4.4=HDMI-2"')).get(panel.key)?.output).toBe('HDMI-2')
    expect(assignOutputs([panel, other], outputs, null, parseHelperConf('SWAP=1')).get(panel.key)?.output).toBe('HDMI-1')
    expect(assignOutputs([panel], outputs, null, parseHelperConf('OUTPUTS="HDMI-2 HDMI-1"')).get(panel.key)?.output).toBe('HDMI-2')
  })
})

describe.skipIf(process.platform !== 'linux')('scan + apply with the fake xinput / xrandr / udevadm (field data)', () => {
  function env() {
    const state = mkdtempSync(join(tmpdir(), 'pb-touchsys-'))
    mkdirSync(join(state, 'input'))
    return {
      state,
      deps: {
        platform: 'linux' as const,
        env: { PATH: `${BIN}:${process.env.PATH}`, PB_FAKE_TOUCH_DIR: FIELD, PB_FAKE_TOUCH_STATE: state, DISPLAY: ':0' },
        inputDir: join(state, 'input'),
        configPath: join(state, 'config', 'photonboard', 'touch.json'),
        helperConfPath: join(state, 'none.conf')
      }
    }
  }
  const calls = (state: string) => (existsSync(join(state, 'calls.log')) ? readFileSync(join(state, 'calls.log'), 'utf8').trim().split('\n') : [])

  it('finds 2 outputs and ONE panel (xinput ids 8 and 9), automatically on HDMI-1', async () => {
    const { state, deps } = env()
    try {
      const { info } = await scanTouchSetup(deps)
      expect(info.supported).toBe(true)
      expect(info.outputs.map((o) => o.name)).toEqual(['HDMI-1', 'HDMI-2'])
      expect(info.desktop).toEqual({ width: 3840, height: 1080 })
      expect(info.panels).toEqual([{
        key: '1-1.4.4|wch.cn TouchScreen',
        port: '1-1.4.4',
        name: 'wch.cn TouchScreen',
        ids: [8, 9],
        nodes: ['/dev/input/event3', '/dev/input/event4'],
        saved: null,
        output: 'HDMI-1',
        automatic: true,
        current: 'all'
      }])
    } finally {
      rmSync(state, { recursive: true, force: true })
    }
  })

  it('apply: the panel on HDMI-2 → set-prop on ids 8 AND 9 = [0.5 0 0.5 0 1 0 0 0 1]', async () => {
    const { state, deps } = env()
    try {
      await writeTouchConfig(deps.configPath, mergeConfig(null, { '1-1.4.4|wch.cn TouchScreen': { output: 'HDMI-2' } }))
      const { info, applied } = await applyTouchSetup(deps)
      expect(applied).toHaveLength(1)
      expect(applied[0]).toMatchObject({ output: 'HDMI-2', ids: [8, 9], ok: true })
      expect(calls(state)).toEqual([
        'set-prop 8 Coordinate Transformation Matrix 0.5 0 0.5 0 1 0 0 0 1',
        'set-prop 9 Coordinate Transformation Matrix 0.5 0 0.5 0 1 0 0 0 1'
      ])
      expect(info.panels[0]).toMatchObject({ output: 'HDMI-2', automatic: false, current: 'HDMI-2' })
      // read back from xinput on the next scan
      expect((await scanTouchSetup(deps)).info.panels[0].current).toBe('HDMI-2')
    } finally {
      rmSync(state, { recursive: true, force: true })
    }
  })

  it('unsupported: off Linux, under Wayland, without X', async () => {
    expect(unsupportedReason({ platform: 'darwin' })).toBe('not-linux')
    expect(unsupportedReason({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' } })).toBe('wayland')
    expect(unsupportedReason({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe('wayland')
    expect(unsupportedReason({ platform: 'linux', env: { DISPLAY: ':0' } })).toBeNull()
    const r = await scanTouchSetup({ platform: 'linux', env: { PATH: '/nonexistent' }, configPath: '/nonexistent/touch.json' })
    expect(r.info).toMatchObject({ supported: false, reason: 'no-x' })
  })
})

describe.skipIf(process.platform !== 'linux')('touch helper (scripts/photonboard-map-touch.sh) with stub tools', () => {
  const SCRIPT = join(ROOT, 'scripts', 'photonboard-map-touch.sh')
  function runHelper(args: string[], opts: { conf?: string; appConfig?: boolean } = {}) {
    const home = mkdtempSync(join(tmpdir(), 'pb-helper-'))
    mkdirSync(join(home, 'input'))
    if (opts.conf) writeFileSync(join(home, 'touch-map.conf'), opts.conf)
    if (opts.appConfig) {
      mkdirSync(join(home, '.config', 'photonboard'), { recursive: true })
      writeFileSync(join(home, '.config', 'photonboard', 'touch.json'), '{"version":1,"panels":{"1-1.4.4|wch.cn TouchScreen":{"output":"HDMI-2"}}}\n')
    }
    const env = {
      PATH: `${BIN}:${process.env.PATH}`,
      HOME: home,
      PB_FAKE_TOUCH_DIR: FIELD,
      PB_FAKE_TOUCH_STATE: home,
      PB_INPUT_DIR: join(home, 'input'),
      PB_TOUCH_CONF: join(home, 'touch-map.conf'),
      PB_TOUCH_LOG: join(home, 'map.log'),
      PB_TOUCH_WAIT: '0',
      DISPLAY: ':0'
    }
    const stdout = execFileSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 20000 })
    const log = existsSync(env.PB_TOUCH_LOG) ? readFileSync(env.PB_TOUCH_LOG, 'utf8') : ''
    const calls = existsSync(join(home, 'calls.log')) ? readFileSync(join(home, 'calls.log'), 'utf8').trim().split('\n') : []
    rmSync(home, { recursive: true, force: true })
    return { stdout, log, calls }
  }

  it('maps EVERY pointer of the panel (ids 8 and 9), never the Logitech receiver or the HDMI CEC devices', () => {
    const r = runHelper([])
    expect(r.calls).toEqual(['map-to-output 8 HDMI-1', 'map-to-output 9 HDMI-1'])
    expect(r.log).toContain('Done: 2 mapped, 0 failed.')
  })

  it('--list shows the plan without applying; PORT_MAP is honoured', () => {
    const r = runHelper(['--list'], { conf: 'PORT_MAP="1-1.4.4=HDMI-2"\n' })
    expect(r.stdout).toContain('would map id=8 (port 1-1.4.4) → HDMI-2')
    expect(r.stdout).toContain('would map id=9 (port 1-1.4.4) → HDMI-2')
    expect(r.stdout).not.toMatch(/id=(6|7|11|12) /)
    expect(r.calls).toEqual([])
  })

  it('touch.json from PhotonBoard: apply mode does nothing, --report shows the saved setup', () => {
    const applied = runHelper([], { appConfig: true })
    expect(applied.calls).toEqual([])
    expect(applied.log).toContain('managed by PhotonBoard')
    const report = runHelper(['--report'], { appConfig: true })
    expect(report.stdout).toContain('== PhotonBoard touch setup')
    expect(report.stdout).toContain('"output":"HDMI-2"')
    expect(report.stdout).toContain('would map id=9')
    expect(report.calls).toEqual([])
  })
})
