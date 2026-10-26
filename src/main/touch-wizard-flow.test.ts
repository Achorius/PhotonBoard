import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CalibrationFlow, IdentifyFlow } from './touch-wizard-flow'
import { CALIBRATION_TARGETS, IDENTITY, applyToPoint, calibrationMatrix } from './touch-setup'
import { hasTouchDown, inputEventSize, watchPanelTouches } from './touch-events'

const PANEL = '1-1.4.4|wch.cn TouchScreen'
const OTHER = '1-1.3|ILITEK'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function identify(opts: Partial<ConstructorParameters<typeof IdentifyFlow>[0]> = {}) {
  const finish = vi.fn()
  const flow = new IdentifyFlow({ outputs: ['HDMI-1', 'HDMI-2'], panels: [PANEL], onChange: () => {}, onFinish: finish, ...opts })
  flow.start()
  return { flow, finish }
}

describe('assignment wizard', () => {
  it("the owner's case: 1 panel, 2 screens — skip screen 1, touch on screen 2 assigns it there, done", () => {
    const { flow, finish } = identify()
    expect(flow.step).toBe(0)
    flow.tap('chrome')        // Skip tapped on an overlay…
    flow.button('skip')
    vi.advanceTimersByTime(600)
    expect(flow.step).toBe(1)
    flow.rawTouch(PANEL)       // …then the panel is touched on step 2
    vi.advanceTimersByTime(300)
    expect(flow.phase).toBe('assigned')
    vi.advanceTimersByTime(900)
    expect(finish).toHaveBeenCalledWith({ canceled: false, results: [null, PANEL] })
  })

  it('a touch on the Skip button (raw touch + button-bar tap) skips instead of assigning', () => {
    const { flow, finish } = identify()
    flow.rawTouch(PANEL)
    vi.advanceTimersByTime(80)
    flow.tap('chrome')
    flow.button('skip')
    vi.advanceTimersByTime(2000)
    expect(flow.step).toBe(1)
    expect(flow.results[0]).toBeNull()
    expect(finish).not.toHaveBeenCalled()
    // a button-bar tap that arrives BEFORE the raw touch also wins
    flow.tap('chrome')
    flow.rawTouch(PANEL)
    vi.advanceTimersByTime(400)
    expect(flow.phase).toBe('touch')
  })

  it('every panel assigned → ends early; panels already assigned are ignored later', () => {
    const { flow, finish } = identify({ outputs: ['HDMI-1', 'HDMI-2', 'HDMI-3'], panels: [PANEL, OTHER] })
    flow.rawTouch(OTHER)
    vi.advanceTimersByTime(1200)
    expect(flow.step).toBe(1)
    flow.rawTouch(OTHER) // already on screen 1
    vi.advanceTimersByTime(1200)
    expect(flow.step).toBe(1)
    flow.rawTouch(PANEL)
    vi.advanceTimersByTime(1200)
    expect(finish).toHaveBeenCalledWith({ canceled: false, results: [OTHER, PANEL, null] })
  })

  it('a step times out (auto-skip); the last one ends the wizard; unknown keys are ignored', () => {
    const { flow, finish } = identify({ stepMs: 20_000 })
    flow.rawTouch('9-9|nope')
    expect(flow.remainingMs()).toBe(20_000)
    vi.advanceTimersByTime(20_000 + 600)
    expect(flow.step).toBe(1)
    vi.advanceTimersByTime(20_000 + 600)
    expect(finish).toHaveBeenCalledWith({ canceled: false, results: [null, null] })
  })

  it('Cancel ends with canceled:true', () => {
    const { flow, finish } = identify()
    flow.rawTouch(PANEL)
    flow.button('cancel')
    vi.advanceTimersByTime(5000)
    expect(finish).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledWith({ canceled: true, results: [null, null] })
  })

  it('no access to the event nodes: overlay taps (not mouse) stand for the only panel', () => {
    const { flow, finish } = identify({ fallbackPanel: PANEL })
    flow.tap('content', 'mouse')
    vi.advanceTimersByTime(400)
    expect(flow.phase).toBe('touch')
    flow.tap('content', 'touch')
    vi.advanceTimersByTime(1300)
    expect(finish).toHaveBeenCalledWith({ canceled: false, results: [PANEL, null] })
  })
})

describe('calibration wizard', () => {
  function calibrate(err = IDENTITY) {
    const applied: (number[] | null)[] = []
    const finish = vi.fn()
    const flow = new CalibrationFlow({
      width: 1920,
      height: 1080,
      orientation: IDENTITY,
      apply: async (c) => { applied.push(c) },
      onChange: () => {},
      onFinish: finish
    })
    /** Where the operator's touch on a target is measured with the uncalibrated matrix */
    const at = (p: { x: number; y: number }) => applyToPoint(err, p.x, p.y)
    return { flow, finish, applied, at }
  }
  const settle = async () => { await vi.advanceTimersByTimeAsync(400) }

  it('applies NO calibration first, 4 targets, then the candidate, centre check, Save', async () => {
    const { flow, finish, applied, at } = calibrate([1, 0, 0.025, 0, 1, -0.018, 0, 0, 1])
    await flow.start()
    expect(applied).toEqual([null])
    expect(flow.phase).toBe('targets')
    for (const t of CALIBRATION_TARGETS) {
      expect(flow.target).toEqual(t)
      const m = at(t)
      flow.tap(m.x, m.y, 'content')
      await settle()
    }
    expect(flow.phase).toBe('check')
    expect(applied).toHaveLength(2)
    const c = applied[1]!
    expect(c.map((v) => +v.toFixed(4))).toEqual([1, 0, -0.025, 0, 1, 0.018])
    // with the calibration applied the centre lands 3 px off
    flow.tap(0.5 + 3 / 1920, 0.5, 'content')
    expect(flow.phase).toBe('result')
    expect(flow.errorPx).toBeCloseTo(3)
    flow.button('save')
    expect(finish).toHaveBeenCalledWith({ action: 'save', calibration: c, errorPx: expect.closeTo(3) })
  })

  it('an inconsistent set is rejected; Retry starts over without calibration; Cancel cancels', async () => {
    const { flow, finish, applied } = calibrate()
    await flow.start()
    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.65, y: 0.7 }, { x: 0.1, y: 0.9 }]
    for (const p of pts) { flow.tap(p.x, p.y, 'content'); await settle() }
    expect(flow.phase).toBe('failed')
    expect(flow.failure).toBe('inconsistent')
    flow.button('save') // not offered
    expect(finish).not.toHaveBeenCalled()
    flow.button('retry')
    await settle()
    expect(flow.phase).toBe('targets')
    expect(flow.points).toEqual([])
    expect(applied).toEqual([null, null])
    flow.button('cancel')
    expect(finish).toHaveBeenCalledWith({ action: 'cancel' })
  })

  it('taps on buttons, double taps and taps while busy do not count', async () => {
    const { flow } = calibrate()
    flow.tap(0.1, 0.1, 'content') // busy (starting)
    await flow.start()
    flow.tap(0.5, 0.05, 'chrome')
    flow.tap(0.1, 0.1, 'content')
    flow.tap(0.1, 0.1, 'content') // bounce
    expect(flow.points).toHaveLength(1)
  })

  it('gives up after a long idle time', async () => {
    const { flow, finish } = calibrate()
    await flow.start()
    await vi.advanceTimersByTimeAsync(91_000)
    expect(finish).toHaveBeenCalledWith({ action: 'cancel' })
    expect(calibrationMatrix(null)).toEqual(IDENTITY)
  })
})

describe('raw touch reader', () => {
  function ev(type: number, code: number, value: number, size = 24): Buffer {
    const b = Buffer.alloc(size)
    b.writeUInt16LE(type, size - 8)
    b.writeUInt16LE(code, size - 6)
    b.writeInt32LE(value, size - 4)
    return b
  }

  it('input_event size by architecture; touch-down = key press or new contact', () => {
    expect(inputEventSize('arm64')).toBe(24)
    expect(inputEventSize('x64')).toBe(24)
    expect(inputEventSize('arm')).toBe(16)
    expect(hasTouchDown(Buffer.concat([ev(3, 0x35, 900), ev(0, 0, 0)]), 24)).toBe(false) // motion only
    expect(hasTouchDown(Buffer.concat([ev(3, 0x39, 12), ev(3, 0x35, 900)]), 24)).toBe(true) // ABS_MT_TRACKING_ID ≥ 0
    expect(hasTouchDown(ev(3, 0x39, -1), 24)).toBe(false) // contact lifted
    expect(hasTouchDown(ev(1, 0x14a, 1), 24)).toBe(true) // BTN_TOUCH down
    expect(hasTouchDown(ev(1, 0x14a, 0), 24)).toBe(false)
    expect(hasTouchDown(ev(1, 0x14a, 1, 16), 16)).toBe(true)
  })

  it('unreadable nodes are reported, never thrown; the test hook (PB_TOUCH_FAKE_EVENTS) reports a panel by port', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-fake-ev-'))
    try {
      const touched: string[] = []
      const w = watchPanelTouches([{ key: PANEL, port: '1-1.4.4', nodes: ['/nonexistent/event3'] }], (k) => touched.push(k), { env: { PB_TOUCH_FAKE_EVENTS: dir } })
      expect(w.failures).toEqual(['/nonexistent/event3: ENOENT'])
      writeFileSync(join(dir, 'a'), '1-1.4.4\n')
      writeFileSync(join(dir, 'b'), '7-7\n')
      await vi.advanceTimersByTimeAsync(250)
      expect(touched).toEqual([PANEL])
      w.stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
