// ============================================================
// PhotonBoard — Runtime helpers
// Environment detection (Electron / remote browser / node tests),
// a typed accessor for window.photonboard, a monotonic clock and
// the remote-command sender used by stores in remote mode.
//
// Everything here is safe to import under node (vitest): nothing
// touches `window` at module load time.
// ============================================================

import type { PhotonBoardAPI } from '@shared/photonboard-api'
import type { RemoteCommandType, WebRemoteCommandType } from '@shared/remote-commands'

/** window.photonboard, or undefined (node tests, very early boot). */
export function getBridge(): PhotonBoardAPI | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { photonboard?: PhotonBoardAPI }).photonboard
}

/**
 * True when the renderer runs in a browser through the WebSocket bridge
 * (remote UI). The Pi renderer is then the single source of truth: no local
 * mixer, engines or DMX output — store actions are forwarded as commands.
 */
export function isRemoteMode(): boolean {
  return !!getBridge()?.remote?.isRemote
}

/** True inside the Electron renderer (independent of import order). */
export function isElectronRuntime(): boolean {
  return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)
}

/** Monotonic milliseconds (performance.now when available). */
export function clockNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// ---------------------------------------------------------------
// Remote commands (browser → Pi)
// ---------------------------------------------------------------

let preflight: (() => void) | null = null
let inPreflight = false

/**
 * Remote mode: run before every command is sent. The content sync registers
 * its flush here so a command never overtakes the edit it depends on
 * (create a scene, then GO it).
 */
export function setRemoteCommandPreflight(fn: (() => void) | null): void {
  preflight = fn
}

/** Remote mode: run the preflight now (e.g. before an invoke such as Save). */
export function runRemotePreflight(): void {
  if (!isRemoteMode() || !preflight || inPreflight) return
  inPreflight = true
  try { preflight() } catch (e) { console.warn('[Remote] preflight failed:', e) } finally { inPreflight = false }
}

/** Send a command to the Pi renderer. No-op outside remote mode. */
export function sendRemoteCommand(type: RemoteCommandType | WebRemoteCommandType, payload?: unknown): void {
  if (!isRemoteMode()) return
  if (preflight && !inPreflight) {
    inPreflight = true
    try { preflight() } catch (e) { console.warn('[Remote] preflight failed:', e) } finally { inPreflight = false }
  }
  try {
    getBridge()?.remote.sendCommand(type, payload)
  } catch (e) {
    console.warn('[Remote] sendCommand failed:', type, e)
  }
}

interface ThrottleSlot {
  last: number
  timer: ReturnType<typeof setTimeout> | null
  type: RemoteCommandType
  payload: unknown
}
const throttleSlots = new Map<string, ThrottleSlot>()

/**
 * Leading + trailing throttle per `key` (e.g. one slot per fader). Dragging a
 * fader sends at most one command every `intervalMs`, and the final position
 * is always delivered.
 */
export function sendRemoteCommandThrottled(
  key: string,
  type: RemoteCommandType,
  payload: unknown,
  intervalMs = 40
): void {
  if (!isRemoteMode()) return
  let slot = throttleSlots.get(key)
  if (!slot) {
    slot = { last: -Infinity, timer: null, type, payload }
    throttleSlots.set(key, slot)
  }
  slot.type = type
  slot.payload = payload
  const now = clockNow()
  const wait = slot.last + intervalMs - now
  if (wait <= 0 && !slot.timer) {
    slot.last = now
    sendRemoteCommand(type, payload)
    return
  }
  if (slot.timer) return
  const s = slot
  s.timer = setTimeout(() => {
    s.timer = null
    s.last = clockNow()
    sendRemoteCommand(s.type, s.payload)
  }, Math.max(0, wait))
}

// ---------------------------------------------------------------
// Local-change hold-off (remote mode)
// While the user drags a fader in the browser, Pi broadcasts that were
// produced before the command arrived would snap the fader back. Every
// local change marks its field; incoming values for that field are
// ignored for HOLD_MS.
// ---------------------------------------------------------------

const HOLD_MS = 400
const localChanges = new Map<string, number>()

export function markLocalChange(field: string): void {
  if (!isRemoteMode()) return
  localChanges.set(field, clockNow())
}

export function isLocallyHeld(field: string, holdMs = HOLD_MS): boolean {
  const t = localChanges.get(field)
  if (t === undefined) return false
  if (clockNow() - t < holdMs) return true
  localChanges.delete(field)
  return false
}

// ---------------------------------------------------------------
// DMX value guard
// ---------------------------------------------------------------

/** Clamp anything to a valid DMX byte (NaN / undefined → 0). */
export function toDmx(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 255) return 255
  return Math.round(n)
}
