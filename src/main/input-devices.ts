// ============================================================
// PhotonBoard — Game controller diagnostics (Linux)
//
// The Follow panel asks main which game controllers the SYSTEM sees,
// to tell the operator why Chromium shows none:
//   - none at all            → cable / pairing
//   - seen, js node readable → press a button (Chromium only exposes a
//                              gamepad after a button press)
//   - seen, no js node       → joydev kernel module not loaded
//   - seen, node unreadable  → the user is not in the "input" group
// Chromium (Electron) reads gamepads on Linux through /dev/input/jsN.
//
// parseInputDevices() is pure (unit-tested); listGameControllers()
// reads /proc/bus/input/devices and checks the device nodes.
// ============================================================

import { accessSync, constants, existsSync, readFileSync } from 'fs'
import type { GameControllerDiagnostics, SystemGameController } from '../shared/photonboard-api'

const BTN_JOYSTICK = 0x120
const BTN_DIGI = 0x140 // end of the joystick / gamepad button block

export interface ProcInputDevice {
  name: string
  handlers: string[]
  /** KEY capability bitmap words, most significant first (as printed) */
  key: string[]
  vendor: string
  product: string
}

/** Parse /proc/bus/input/devices */
export function parseInputDevices(text: string): ProcInputDevice[] {
  const out: ProcInputDevice[] = []
  for (const block of text.split(/\n\s*\n/)) {
    if (!block.trim()) continue
    const dev: ProcInputDevice = { name: '', handlers: [], key: [], vendor: '', product: '' }
    for (const line of block.split('\n')) {
      const m = /^([A-Z]): (.*)$/.exec(line.trim())
      if (!m) continue
      const [, kind, rest] = m
      if (kind === 'N') dev.name = /Name="(.*)"/.exec(rest)?.[1] ?? rest
      else if (kind === 'H') dev.handlers = (/Handlers=(.*)/.exec(rest)?.[1] ?? '').trim().split(/\s+/).filter(Boolean)
      else if (kind === 'B' && rest.startsWith('KEY=')) dev.key = rest.slice(4).trim().split(/\s+/).filter(Boolean)
      else if (kind === 'I') {
        dev.vendor = /Vendor=([0-9a-f]+)/i.exec(rest)?.[1] ?? ''
        dev.product = /Product=([0-9a-f]+)/i.exec(rest)?.[1] ?? ''
      }
    }
    out.push(dev)
  }
  return out
}

/** Does a KEY bitmap (words of the kernel's `long`, 64 bits on arm64 / x64) have a bit in [from, to)? */
export function hasKeyInRange(words: string[], from: number, to: number, bitsPerWord = 64): boolean {
  const n = words.length
  for (let bit = from; bit < to; bit++) {
    const w = Math.floor(bit / bitsPerWord)
    if (w >= n) return false
    const word = words[n - 1 - w]
    let v: bigint
    try { v = BigInt(`0x${word}`) } catch { continue }
    if ((v >> BigInt(bit % bitsPerWord)) & 1n) return true
  }
  return false
}

/** A game controller: has a joystick node, or joystick / gamepad buttons */
export function isGameController(dev: ProcInputDevice): boolean {
  if (dev.handlers.some((h) => /^js\d+$/.test(h))) return true
  return hasKeyInRange(dev.key, BTN_JOYSTICK, BTN_DIGI)
}

function readable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** Game controllers the system sees, with what PhotonBoard can read */
export function listGameControllers(): GameControllerDiagnostics {
  if (process.platform !== 'linux') return { supported: false, controllers: [], joydev: null }
  let text = ''
  try {
    text = readFileSync('/proc/bus/input/devices', 'utf8')
  } catch {
    return { supported: false, controllers: [], joydev: null }
  }
  const controllers: SystemGameController[] = parseInputDevices(text).filter(isGameController).map((d) => {
    const js = d.handlers.find((h) => /^js\d+$/.test(h)) ?? null
    const event = d.handlers.find((h) => /^event\d+$/.test(h)) ?? null
    return {
      name: d.name || 'Game controller',
      js,
      event,
      jsReadable: js ? readable(`/dev/input/${js}`) : false,
      eventReadable: event ? readable(`/dev/input/${event}`) : false
    }
  })
  const joydev = existsSync('/sys/module/joydev') || controllers.some((c) => c.js !== null)
  return { supported: true, controllers, joydev }
}
