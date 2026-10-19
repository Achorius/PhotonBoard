// ============================================================
// PhotonBoard — Remote Web Server
// Serves the renderer as a web app and bridges WebSocket ↔ IPC
// so the full UI (including 3D) runs in the Mac's browser.
//
// URL:  http://<pi-ip>:9091   (add ?pin=XXXX when an access PIN is set)
// Port 9090 stays for Companion (lightweight protocol).
//
// WebSocket protocol:
//   → { type: 'auth-required' }                 PIN set and none given on the URL
//   ← { type: 'auth', pin }                     answer (or reconnect with ?pin=)
//   → { type: 'ready' }                         client admitted
//   ← { id, type: 'invoke', channel, args }     → { id, type: 'result', data } | { id, type: 'result', error }
//   ← { type: 'send', channel, args }           fire-and-forget
//   → { type: 'event', channel: 'state', data } Pi state, max ~20 Hz, only on change
//   Wrong/missing PIN → close code 4401.
// ============================================================

import http from 'node:http'
import { createReadStream, promises as fsp } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type { RemoteServerStatus, RemoteSettings } from '../shared/photonboard-api'
import { createRemoteInvokeHandler, handleRemoteSend, RemoteInputError, type RemoteInvokeDeps } from './remote-invoke'
import { ThrottledBroadcaster } from './state-broadcast'
import { makeVerifyClient, startClientAuth, type ClientAuth } from './remote-access'
import { AuthFailureLimiter, WS_CLOSE_AUTH_FAILED } from './remote-auth'
import { MAX_SHOW_FILE_SIZE } from './show-validation'

const WEB_PORT = 9091
// A show (≤16 MB) plus JSON/protocol overhead must fit in one message
const MAX_WS_MESSAGE_SIZE = MAX_SHOW_FILE_SIZE + 4 * 1024 * 1024
const WS_RATE_LIMIT = 200 // max messages per second per client
const BROADCAST_INTERVAL_MS = 50 // web remote: max 20 Hz
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024 // skip state frames for clients on a slow link
const LISTEN_RETRY_MS = 5000
const LISTEN_MAX_RETRIES = 12

export interface WebServerDeps extends RemoteInvokeDeps {
  rendererPath: string
  getRemoteSettings: () => RemoteSettings
}

let server: http.Server | null = null
let wss: WebSocketServer | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retries = 0
let status: RemoteServerStatus = { port: WEB_PORT, listening: false, clients: 0 }
const clients = new Map<WebSocket, ClientAuth>()
const limiter = new AuthFailureLimiter()

const broadcaster = new ThrottledBroadcaster<unknown>(
  BROADCAST_INTERVAL_MS,
  (state) => JSON.stringify({ type: 'event', channel: 'state', data: state }),
  (json) => {
    for (const [client, auth] of clients) {
      if (auth.authenticated && client.readyState === WebSocket.OPEN && client.bufferedAmount < MAX_BUFFERED_BYTES) {
        client.send(json)
      }
    }
  },
  () => clients.size > 0
)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.map':  'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.wasm': 'application/wasm',
  '.txt':  'text/plain; charset=utf-8',
}

export function startWebServer(deps: WebServerDeps): void {
  if (server) return
  const handleInvoke = createRemoteInvokeHandler(deps)

  // ---- HTTP server: serve static renderer files ----
  const canonicalRendererPath = resolve(deps.rendererPath)

  const httpServer = http.createServer((req, res) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")

    // Only allow GET/HEAD requests
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end('Method Not Allowed')
      return
    }

    let urlPath: string
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    } catch {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }
    if (urlPath === '/') urlPath = '/index.html'

    // Reject null bytes
    if (urlPath.includes('\0')) {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }

    // Use resolve() for canonical path comparison (prevents .. traversal)
    const filePath = resolve(join(canonicalRendererPath, urlPath))
    if (!filePath.startsWith(canonicalRendererPath + sep)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    // Async + streamed: never block the DMX output loop on disk I/O
    serveFile(filePath, req, res).catch(async () => {
      // SPA fallback for routes (no extension); a missing asset is a real 404
      if (extname(urlPath) === '') {
        const ok = await serveFile(join(canonicalRendererPath, 'index.html'), req, res).then(() => true, () => false)
        if (ok) return
      }
      if (!res.headersSent) res.writeHead(404)
      res.end('Not found')
    })
  })
  server = httpServer

  // ---- WebSocket: bridge IPC ----
  const wsServer = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_WS_MESSAGE_SIZE,
    verifyClient: makeVerifyClient('Web')
  })
  wss = wsServer

  // ws re-emits HTTP server errors (EADDRINUSE…): must be handled, never thrown
  wsServer.on('error', (err) => {
    console.error('[Web] WebSocket server error:', err.message)
  })

  wsServer.on('connection', (ws, req) => {
    const address = req.socket.remoteAddress
    console.log(`[Web] Remote client connected (${address})`)

    // Rate limiting state per client
    let messageCount = 0
    const rateLimitResetTimer = setInterval(() => { messageCount = 0 }, 1000)

    ws.on('error', (err) => {
      console.warn(`[Web] Client error (${address}):`, err.message)
    })

    const reply = (id: unknown, payload: { data?: unknown; error?: string }) => {
      if (typeof id !== 'string' && typeof id !== 'number') return
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ id, type: 'result', ...payload }))
      } catch (e) {
        // Result not serialisable: still answer, so the client doesn't wait for a timeout
        ws.send(JSON.stringify({ id, type: 'result', error: `Internal error: ${(e as Error).message}` }))
      }
    }

    const auth = startClientAuth(ws, req, {
      serverName: 'Web',
      settings: deps.getRemoteSettings(),
      limiter,
      onReady: () => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify({ type: 'ready' }))
        // Current state immediately
        const last = broadcaster.getLastJson()
        if (last) ws.send(last)
      }
    })
    clients.set(ws, auth)
    status = { ...status, clients: clients.size }

    ws.on('message', async (raw) => {
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return // not JSON: nothing to answer
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
      if (auth.handleMessage(msg)) return

      // Rate limiting: invokes get an error reply instead of silence
      messageCount++
      if (messageCount > WS_RATE_LIMIT) {
        if (msg.type === 'invoke') reply(msg.id, { error: 'Too many requests — slow down' })
        return
      }

      if (msg.type === 'invoke') {
        if (typeof msg.channel !== 'string') {
          reply(msg.id, { error: 'Invalid request' })
          return
        }
        const args = Array.isArray(msg.args) ? msg.args : []
        try {
          const data = await handleInvoke(msg.channel, args)
          reply(msg.id, { data })
        } catch (e) {
          const err = e as Error
          if (!(e instanceof RemoteInputError)) console.error(`[Web] ${msg.channel} failed:`, err.stack || err.message)
          reply(msg.id, { error: err.message || 'Request failed' })
        }
      } else if (msg.type === 'send') {
        if (typeof msg.channel !== 'string') return
        try {
          if (!handleRemoteSend(deps, msg.channel, Array.isArray(msg.args) ? msg.args : [])) {
            console.warn('[Web] Rejected send:', msg.channel.slice(0, 64))
          }
        } catch (e) {
          console.error('[Web] Send handler failed:', (e as Error).message)
        }
      }
    })

    ws.on('close', () => {
      clearInterval(rateLimitResetTimer)
      auth.dispose()
      clients.delete(ws)
      status = { ...status, clients: clients.size }
      console.log(`[Web] Remote client disconnected (${address})`)
    })
  })

  httpServer.on('listening', () => {
    retries = 0
    status = { ...status, listening: true, error: undefined }
    console.log(`[Web] Remote UI available at http://0.0.0.0:${WEB_PORT}`)
  })

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    const msg = err.code === 'EADDRINUSE'
      ? `Port ${WEB_PORT} is already in use by another program — the web remote is unavailable`
      : err.message
    console.error(`[Web] Server error: ${msg}`)
    status = { ...status, listening: false, error: msg }
    if (err.code === 'EADDRINUSE' && server === httpServer && retries < LISTEN_MAX_RETRIES) {
      retries++
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (server === httpServer) httpServer.listen(WEB_PORT, '0.0.0.0')
      }, LISTEN_RETRY_MS)
    }
  })

  httpServer.listen(WEB_PORT, '0.0.0.0')
}

async function serveFile(filePath: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const st = await fsp.stat(filePath)
  if (!st.isFile()) throw new Error('not a file')
  const ext = extname(filePath)
  const headers: Record<string, string | number> = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    // Vite assets are content-hashed; index.html must always be revalidated
    'Cache-Control': filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  await new Promise<void>((resolveStream) => {
    const stream = createReadStream(filePath)
    stream.on('error', () => { res.destroy(); resolveStream() })
    stream.on('end', () => resolveStream())
    stream.pipe(res)
  })
}

export function stopWebServer(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  broadcaster.dispose()
  for (const client of clients.keys()) {
    try { client.terminate() } catch { /* ignore */ }
  }
  clients.clear()
  if (wss) { wss.close(); wss = null }
  if (server) { server.close(); server = null }
  status = { port: WEB_PORT, listening: false, clients: 0 }
  console.log('[Web] Server stopped')
}

/**
 * Called when renderer sends state — forward to remote web clients.
 * Throttled to 20 Hz, serialised once, sent only when changed.
 */
export function broadcastToWeb(state: unknown): void {
  broadcaster.push(state)
}

/** Close every client so it must re-authenticate (PIN enabled or changed) */
export function disconnectWebClients(reason: string): void {
  for (const client of clients.keys()) {
    try { client.close(WS_CLOSE_AUTH_FAILED, reason) } catch { /* ignore */ }
  }
}

export function getWebServerStatus(): RemoteServerStatus {
  return { ...status, clients: clients.size }
}
