// ============================================================
// PhotonBoard — WebSocket API Server
// Exposes PhotonBoard state and control to external apps
// (Bitfocus Companion, OSC bridges, custom controllers…)
//
// Protocol:
//   ← Client (optional, when a PIN is set): { type: 'auth', pin }  (or ws://host:9090/?pin=…)
//   → Server on admission:  { type: 'auth-ok' }, { type: 'commands', list: string[] }
//   → Server broadcasts:    { type: 'state', data: SlimState }  max ~10 Hz, only on change
//   ← Client sends:         { type: 'command', command: { type: string, payload?: any } }
//   Wrong/missing PIN → connection closed with code 4401.
// The state is slim (no DMX values, no cue contents): see slimStateForCompanion.
// ============================================================

import { WebSocketServer, WebSocket } from 'ws'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/types'
import { REMOTE_COMMANDS, isRemoteCommandType } from '../shared/remote-commands'
import type { RemoteServerStatus, RemoteSettings } from '../shared/photonboard-api'
import { ThrottledBroadcaster, slimStateForCompanion } from './state-broadcast'
import { makeVerifyClient, startClientAuth, type ClientAuth } from './remote-access'
import { AuthFailureLimiter, WS_CLOSE_AUTH_FAILED } from './remote-auth'

const API_PORT = Number(process.env.PHOTONBOARD_API_PORT) || 9090
const MAX_API_MESSAGE_SIZE = 64 * 1024 // 64 KB max for API messages
const API_RATE_LIMIT = 100 // max messages per second per client
const BROADCAST_INTERVAL_MS = 100 // Companion: max 10 Hz
const REQUEST_STATE_INTERVAL_MS = 250 // ask the renderer for state at 4 Hz while clients are connected
const LISTEN_RETRY_MS = 5000
const LISTEN_MAX_RETRIES = 12
const MAX_BUFFERED_BYTES = 1024 * 1024

export interface ApiServerDeps {
  getMainWindow: () => BrowserWindow | null
  getRemoteSettings: () => RemoteSettings
}

let wss: WebSocketServer | null = null
let deps: ApiServerDeps | null = null
let syncInterval: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retries = 0
let status: RemoteServerStatus = { port: API_PORT, listening: false, clients: 0 }
const clients = new Map<WebSocket, ClientAuth>()
const limiter = new AuthFailureLimiter()

const broadcaster = new ThrottledBroadcaster<unknown>(
  BROADCAST_INTERVAL_MS,
  (state) => JSON.stringify({ type: 'state', data: slimStateForCompanion(state) }),
  (json) => {
    for (const [client, auth] of clients) {
      if (auth.authenticated && client.readyState === WebSocket.OPEN && client.bufferedAmount < MAX_BUFFERED_BYTES) {
        client.send(json)
      }
    }
  },
  () => clients.size > 0
)

function sendToMainWindow(channel: string, ...args: unknown[]): void {
  const win = deps?.getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

/**
 * Start the WebSocket API server.
 */
export function startApiServer(d: ApiServerDeps): void {
  if (wss) return
  deps = d
  listen()
  startStateRequests()
}

function listen(): void {
  const server = new WebSocketServer({
    port: API_PORT,
    host: '0.0.0.0',
    maxPayload: MAX_API_MESSAGE_SIZE,
    verifyClient: makeVerifyClient('API')
  })
  wss = server

  server.on('listening', () => {
    retries = 0
    status = { ...status, listening: true, error: undefined }
    console.log(`[API] WebSocket server listening on port ${API_PORT}`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    const msg = err.code === 'EADDRINUSE'
      ? `Port ${API_PORT} is already in use by another program — Companion cannot connect`
      : err.message
    console.error(`[API] WebSocket server error: ${msg}`)
    status = { ...status, listening: false, error: msg }
    if (wss === server) {
      wss = null
      try { server.close() } catch { /* ignore */ }
      if (retries < LISTEN_MAX_RETRIES && deps) {
        retries++
        retryTimer = setTimeout(() => { retryTimer = null; if (deps && !wss) listen() }, LISTEN_RETRY_MS)
      }
    }
  })

  server.on('connection', (ws, req) => {
    const address = req.socket.remoteAddress
    console.log(`[API] Client connected (${address})`)

    // Rate limiting state per client
    let messageCount = 0
    const rateLimitResetTimer = setInterval(() => { messageCount = 0 }, 1000)

    ws.on('error', (err) => {
      console.warn(`[API] Client error (${address}):`, err.message)
    })

    const auth = startClientAuth(ws, req, {
      serverName: 'API',
      settings: deps!.getRemoteSettings(),
      limiter,
      onReady: () => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify({ type: 'auth-ok' }))
        // Send available commands on connect (for discovery by Companion module)
        ws.send(JSON.stringify({ type: 'commands', list: REMOTE_COMMANDS }))
        // Current state immediately if available
        const last = broadcaster.getLastJson()
        if (last) ws.send(last)
        sendToMainWindow(IPC.API_REQUEST_STATE)
      }
    })
    clients.set(ws, auth)
    status = { ...status, clients: clients.size }

    // Handle incoming commands
    ws.on('message', (raw) => {
      messageCount++
      if (messageCount > API_RATE_LIMIT) return

      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return // ignore malformed JSON
      }
      if (!msg || typeof msg !== 'object') return
      if (auth.handleMessage(msg)) return

      if (msg.type !== 'command' || !msg.command || typeof msg.command !== 'object') return

      // Validate command type against the shared whitelist
      const commandType = msg.command.type
      if (!isRemoteCommandType(commandType)) {
        console.warn('[API] Rejected unknown command:', typeof commandType === 'string' ? commandType.slice(0, 64) : commandType)
        return
      }

      // Relay to main renderer (same path as stage window commands)
      sendToMainWindow(IPC.STAGE_COMMAND, { type: commandType, payload: msg.command.payload })
    })

    ws.on('close', () => {
      clearInterval(rateLimitResetTimer)
      auth.dispose()
      clients.delete(ws)
      status = { ...status, clients: clients.size }
      console.log(`[API] Client disconnected (${address})`)
    })
  })
}

/**
 * Stop the API server.
 */
export function stopApiServer(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  broadcaster.dispose()
  for (const client of clients.keys()) {
    try { client.terminate() } catch { /* ignore */ }
  }
  clients.clear()
  if (wss) {
    wss.close()
    wss = null
  }
  deps = null
  status = { port: API_PORT, listening: false, clients: 0 }
  console.log('[API] Server stopped')
}

/**
 * Called by the IPC relay when renderer sends state.
 * Throttled to 10 Hz, slimmed, serialised once, sent only when changed.
 */
export function broadcastState(state: unknown): void {
  broadcaster.push(state)
}

/** Close every client so it must re-authenticate (PIN enabled or changed) */
export function disconnectApiClients(reason: string): void {
  for (const client of clients.keys()) {
    try { client.close(WS_CLOSE_AUTH_FAILED, reason) } catch { /* ignore */ }
  }
}

/**
 * Request state from the renderer at 4 Hz while API clients are connected
 * (the renderer also pushes on every change).
 */
function startStateRequests(): void {
  if (syncInterval) return
  syncInterval = setInterval(() => {
    if (clients.size > 0) sendToMainWindow(IPC.API_REQUEST_STATE)
  }, REQUEST_STATE_INTERVAL_MS)
}

export function getApiServerStatus(): RemoteServerStatus {
  return { ...status, clients: clients.size }
}

/**
 * Get the number of connected API clients.
 */
export function getApiClientCount(): number {
  return clients.size
}
