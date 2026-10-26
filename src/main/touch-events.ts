// ============================================================
// PhotonBoard — "which touch panel was touched?" (Linux evdev)
//
// The assignment wizard must not rely on the current touch → screen
// mapping (it is what is wrong), so main reads the panels' event nodes
// directly: read-only and NOT grabbed (EVIOCGRAB is never used), so X
// still gets every event. The kiosk user is in group "input".
//
// Nodes are opened O_NONBLOCK and polled: a blocking read would hold a
// libuv thread-pool thread until the next touch (and could starve file
// I/O of the whole app).
//
// Test hook (end-to-end tests only): PB_TOUCH_FAKE_EVENTS=<dir> — a file
// dropped there whose content is a panel's USB port ("1-1.4.4") counts as
// a touch on that panel (the file is consumed).
// ============================================================

import { closeSync, constants, openSync, promises as fsp, read as fsRead, readFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

const EV_KEY = 0x01
const EV_ABS = 0x03
const ABS_MT_TRACKING_ID = 0x39
const POLL_MS = 40

/** Size of struct input_event: timeval (2 longs) + type u16 + code u16 + value s32 */
export function inputEventSize(arch: string = process.arch): number {
  return /64|s390x/.test(arch) ? 24 : 16
}

/**
 * Does this chunk of input_events hold a touch-down? (a key/button press —
 * BTN_TOUCH, BTN_LEFT… — or a new multitouch contact)
 */
export function hasTouchDown(buf: Buffer, size: number = inputEventSize()): boolean {
  const off = size - 8
  for (let i = 0; i + size <= buf.length; i += size) {
    const type = buf.readUInt16LE(i + off)
    const code = buf.readUInt16LE(i + off + 2)
    const value = buf.readInt32LE(i + off + 4)
    if (type === EV_KEY && value === 1) return true
    if (type === EV_ABS && code === ABS_MT_TRACKING_ID && value >= 0) return true
  }
  return false
}

export interface TouchWatchPanel {
  key: string
  port: string
  nodes: string[]
}

export interface TouchWatcher {
  /** Nodes actually opened (0 with no access: the wizard falls back to pointer events) */
  readonly opened: number
  /** Nodes that could not be opened, with why */
  readonly failures: string[]
  stop(): void
}

export interface TouchWatchOptions {
  env?: NodeJS.ProcessEnv
}

/** Watch panels; `onTouch(key)` on every touch-down of a panel. Never throws. */
export function watchPanelTouches(panels: TouchWatchPanel[], onTouch: (key: string) => void, opts: TouchWatchOptions = {}): TouchWatcher {
  const env = opts.env ?? process.env
  const fds: { fd: number; key: string; busy: boolean }[] = []
  const failures: string[] = []
  const size = inputEventSize()
  const buf = Buffer.alloc(size * 64)
  let stopped = false

  for (const p of panels) {
    for (const node of p.nodes) {
      try {
        fds.push({ fd: openSync(node, constants.O_RDONLY | constants.O_NONBLOCK), key: p.key, busy: false })
      } catch (e) {
        failures.push(`${node}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`)
      }
    }
  }

  // Drain what is already queued (a finger still down from the tap that started the wizard)
  const timers: ReturnType<typeof setInterval>[] = []
  if (fds.length) {
    let primed = false
    setTimeout(() => { primed = true }, 150)
    timers.push(setInterval(() => {
      for (const f of fds) {
        if (f.busy || stopped) continue
        f.busy = true
        fsRead(f.fd, buf, 0, buf.length, null, (err, n) => {
          f.busy = false
          if (stopped || err || !n) return // EAGAIN: nothing new
          if (primed && hasTouchDown(buf.subarray(0, n), size)) onTouch(f.key)
        })
      }
    }, POLL_MS))
  }

  const fakeDir = env.PB_TOUCH_FAKE_EVENTS
  if (fakeDir) {
    timers.push(setInterval(() => {
      let names: string[] = []
      try { names = readdirSync(fakeDir).sort() } catch { return }
      for (const name of names) {
        const file = join(fakeDir, name)
        let port = ''
        try { port = readFileSync(file, 'utf8').trim(); unlinkSync(file) } catch { continue }
        const panel = panels.find((p) => p.port === port || p.key === port)
        if (panel && !stopped) onTouch(panel.key)
      }
    }, 100))
  }

  return {
    opened: fds.length + (fakeDir ? 1 : 0),
    failures,
    stop() {
      if (stopped) return
      stopped = true
      for (const t of timers) clearInterval(t)
      for (const f of fds) {
        // Close once no read is in flight (O_NONBLOCK reads return at once)
        const close = () => { if (f.busy) setTimeout(close, POLL_MS); else { try { closeSync(f.fd) } catch { /* already closed */ } } }
        close()
      }
    }
  }
}

/** For the device-change watcher: a cheap fingerprint of the input devices */
export async function inputDevicesFingerprint(): Promise<string> {
  try {
    return await fsp.readFile('/proc/bus/input/devices', 'utf8')
  } catch {
    return ''
  }
}
