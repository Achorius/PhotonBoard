// ============================================================
// PhotonBoard — Connection admission for both WebSocket servers
// (web remote :9091 and Companion API :9090): Origin check at the
// HTTP upgrade, then the optional PIN (`?pin=` on the URL or a first
// `{type:'auth', pin}` message). Failure closes with code 4401.
// ============================================================

import { networkInterfaces, hostname } from 'os'
import type { IncomingMessage } from 'http'
import type { WebSocket } from 'ws'
import type { RemoteSettings } from '../shared/photonboard-api'
import {
  AUTH_TIMEOUT_MS,
  AuthFailureLimiter,
  WS_CLOSE_AUTH_FAILED,
  isOriginAllowed,
  pinFromRequestUrl,
  pinMatches
} from './remote-auth'

let cachedAddresses: string[] = []
let cachedAt = 0

/** This machine's IP addresses and names (refreshed every 30 s: DHCP, Wi-Fi changes) */
export function ownAddresses(): string[] {
  const now = Date.now()
  if (now - cachedAt < 30_000 && cachedAddresses.length) return cachedAddresses
  const list = new Set<string>(['localhost', '127.0.0.1', '::1'])
  try {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces || []) list.add(iface.address.toLowerCase())
    }
  } catch { /* ignore */ }
  try {
    const h = hostname().toLowerCase()
    list.add(h)
    if (!h.endsWith('.local')) list.add(`${h}.local`)
  } catch { /* ignore */ }
  cachedAddresses = Array.from(list)
  cachedAt = now
  return cachedAddresses
}

/** Non-internal IPv4 addresses, for display ("connect to http://…:9091") */
export function lanAddresses(): string[] {
  const out: string[] = []
  try {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address)
      }
    }
  } catch { /* ignore */ }
  return out
}

/** `verifyClient` for ws: reject cross-site browser pages (CSWSH / DNS rebinding) */
export function makeVerifyClient(serverName: string) {
  return (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, message?: string) => void) => {
    const origin = info.origin || (info.req.headers.origin as string | undefined)
    if (isOriginAllowed(origin, info.req.headers.host, ownAddresses())) {
      cb(true)
    } else {
      console.warn(`[${serverName}] Rejected WebSocket from origin ${origin} (host ${info.req.headers.host})`)
      cb(false, 403, 'Forbidden origin')
    }
  }
}

export interface ClientAuth {
  /** True once the client may use the API */
  readonly authenticated: boolean
  /**
   * Feed every incoming message through this first. Returns true when the
   * message was consumed by the auth handshake (do not process it further).
   */
  handleMessage(msg: any): boolean
  dispose(): void
}

/**
 * Start the auth handshake for a new connection. `onReady` runs exactly once,
 * when the client is admitted (immediately when no PIN is configured).
 */
export function startClientAuth(
  ws: WebSocket,
  req: IncomingMessage,
  opts: {
    serverName: string
    settings: RemoteSettings
    limiter: AuthFailureLimiter
    onReady: () => void
  }
): ClientAuth {
  const address = req.socket.remoteAddress || 'unknown'
  let authenticated = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const reject = (reason: string) => {
    if (timer) { clearTimeout(timer); timer = null }
    try { ws.close(WS_CLOSE_AUTH_FAILED, reason) } catch { /* already closed */ }
  }

  const admit = () => {
    if (timer) { clearTimeout(timer); timer = null }
    authenticated = true
    opts.onReady()
  }

  const check = (pin: unknown) => {
    if (opts.limiter.isLocked(address)) {
      console.warn(`[${opts.serverName}] ${address}: too many wrong PINs, locked out`)
      reject('Too many wrong PINs — wait a minute')
      return
    }
    if (pinMatches(opts.settings.pin, pin)) {
      opts.limiter.recordSuccess(address)
      admit()
    } else {
      opts.limiter.recordFailure(address)
      console.warn(`[${opts.serverName}] ${address}: wrong or missing PIN`)
      reject('PIN required')
    }
  }

  if (!opts.settings.pinEnabled) {
    admit()
  } else {
    const queryPin = pinFromRequestUrl(req.url)
    if (queryPin !== null) {
      check(queryPin)
    } else if (opts.limiter.isLocked(address)) {
      reject('Too many wrong PINs — wait a minute')
    } else {
      try { ws.send(JSON.stringify({ type: 'auth-required' })) } catch { /* closed */ }
      timer = setTimeout(() => reject('PIN required'), AUTH_TIMEOUT_MS)
    }
  }

  return {
    get authenticated() { return authenticated },
    handleMessage(msg: any): boolean {
      if (msg && msg.type === 'auth') {
        if (!authenticated) check(msg.pin)
        else { try { ws.send(JSON.stringify({ type: 'auth-ok' })) } catch { /* closed */ } }
        return true
      }
      if (!authenticated) {
        // Anything before a successful auth is a failure
        reject('PIN required')
        return true
      }
      return false
    },
    dispose() {
      if (timer) { clearTimeout(timer); timer = null }
    }
  }
}
