// ============================================================
// PhotonBoard — Remote access security helpers (pure logic)
// Origin check for the WebSocket servers, optional access PIN,
// brute-force limiter. No electron imports: unit-tested.
// ============================================================

import { timingSafeEqual, createHash } from 'crypto'
import type { RemoteSettings } from '../shared/photonboard-api'

/** WebSocket close code sent when the PIN is missing or wrong */
export const WS_CLOSE_AUTH_FAILED = 4401
/** Time a client gets to send `{type:'auth', pin}` when it did not pass `?pin=` */
export const AUTH_TIMEOUT_MS = 10_000

export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = { pinEnabled: false, pin: '' }

const PIN_RE = /^[A-Za-z0-9]{4,16}$/

export function validateRemoteSettings(input: unknown): { ok: true; settings: RemoteSettings } | { ok: false; error: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Remote settings must be an object' }
  }
  const raw = input as Record<string, unknown>
  if (typeof raw.pinEnabled !== 'boolean') return { ok: false, error: 'pinEnabled must be true or false' }
  const pin = raw.pin === undefined || raw.pin === null ? '' : raw.pin
  if (typeof pin !== 'string') return { ok: false, error: 'The PIN must be text' }
  if (raw.pinEnabled && !PIN_RE.test(pin)) {
    return { ok: false, error: 'The PIN must be 4 to 16 letters or digits' }
  }
  if (!raw.pinEnabled && pin !== '' && !PIN_RE.test(pin)) {
    return { ok: false, error: 'The PIN must be 4 to 16 letters or digits' }
  }
  return { ok: true, settings: { pinEnabled: raw.pinEnabled, pin } }
}

/** Constant-time PIN comparison (hash first so lengths always match) */
export function pinMatches(expected: string, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 64) return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(candidate).digest()
  return timingSafeEqual(a, b)
}

/** `?pin=` from a request URL ("/?pin=1234"), or null */
export function pinFromRequestUrl(url: string | undefined): string | null {
  if (!url) return null
  const q = url.indexOf('?')
  if (q === -1) return null
  try {
    return new URLSearchParams(url.slice(q + 1)).get('pin')
  } catch {
    return null
  }
}

// ---- Origin check ----

function stripPort(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end === -1 ? h : h.slice(1, end)
  }
  const colon = h.lastIndexOf(':')
  // "a:b:c" without brackets is a bare IPv6 address, not host:port
  if (colon !== -1 && h.indexOf(':') === colon) return h.slice(0, colon)
  return h
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

/**
 * Host names a LAN client may legitimately use to reach this machine. Anything
 * else (e.g. "evil.example.com" resolving to our IP) is a DNS-rebinding attempt.
 */
export function isLocalLookingHost(host: string, ownNames: string[]): boolean {
  const h = stripPort(host)
  if (!h) return false
  if (isIpLiteral(h)) return true
  if (h === 'localhost') return true
  if (ownNames.some(n => n.toLowerCase() === h)) return true
  if (!h.includes('.')) return true // single-label LAN name ("photonboard")
  return /\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(h)
}

/**
 * Decide whether a WebSocket upgrade with this Origin may connect.
 * - No Origin header (Companion, node clients): allowed — not a browser.
 * - Browser: the Origin's host must be the Host header's host or one of this
 *   machine's own addresses/names, and the Host must look local (DNS rebinding).
 */
export function isOriginAllowed(origin: string | undefined, hostHeader: string | undefined, ownAddresses: string[]): boolean {
  if (origin === undefined || origin === '') return true
  if (origin === 'null') return false // sandboxed iframes, file:// pages
  let originHost: string
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    originHost = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  const host = hostHeader ? stripPort(hostHeader) : ''
  if (host && !isLocalLookingHost(host, ownAddresses)) return false
  if (host && originHost === host) return true
  const own = new Set(['localhost', '127.0.0.1', '::1', ...ownAddresses.map(a => a.toLowerCase())])
  return own.has(originHost)
}

// ---- Brute-force limiter ----

/**
 * Counts PIN failures per remote address. After `maxFailures` within `windowMs`
 * the address is locked out for `lockoutMs` (even a correct PIN is refused).
 */
export class AuthFailureLimiter {
  private failures = new Map<string, { count: number; first: number; lockedUntil: number }>()

  constructor(
    private maxFailures = 8,
    private windowMs = 60_000,
    private lockoutMs = 60_000,
    private now: () => number = Date.now
  ) {}

  isLocked(address: string): boolean {
    const entry = this.failures.get(address)
    if (!entry) return false
    if (entry.lockedUntil > this.now()) return true
    if (entry.lockedUntil && entry.lockedUntil <= this.now()) this.failures.delete(address)
    return false
  }

  recordFailure(address: string): void {
    const now = this.now()
    if (this.failures.size > 1000) this.prune(now)
    const entry = this.failures.get(address)
    if (!entry || now - entry.first > this.windowMs) {
      this.failures.set(address, { count: 1, first: now, lockedUntil: 0 })
      return
    }
    entry.count++
    if (entry.count >= this.maxFailures) entry.lockedUntil = now + this.lockoutMs
  }

  recordSuccess(address: string): void {
    this.failures.delete(address)
  }

  private prune(now: number): void {
    for (const [addr, e] of this.failures) {
      if (e.lockedUntil <= now && now - e.first > this.windowMs) this.failures.delete(addr)
    }
  }
}
