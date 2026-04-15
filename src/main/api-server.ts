// ============================================================
// PhotonBoard — WebSocket API Server
// Exposes PhotonBoard state and control to external apps
// (Bitfocus Companion, OSC bridges, custom controllers…)
//
// Protocol:
//   → Server broadcasts: { type: 'state', data: StageState }  at ~10Hz
//   ← Client sends:      { type: 'command', command: { type: string, payload?: any } }
//   → Server responds:   { type: 'commands', list: string[] }  on connect
// ============================================================

import { WebSocketServer, WebSocket } from 'ws'
import type { BrowserWindow } from 'electron'

const API_PORT = 9090
const MAX_API_MESSAGE_SIZE = 64 * 1024 // 64 KB max for API messages
const API_RATE_LIMIT = 100 // max messages per second per client

let wss: WebSocketServer | null = null
let syncInterval: ReturnType<typeof setInterval> | null = null
let lastState: any = null
let mainWindowRef: BrowserWindow | null = null

// Available commands (for discovery by Companion module)
const AVAILABLE_COMMANDS = [
  'set-grand-master',    // payload: number 0-255
  'toggle-blackout',     // no payload
  'toggle-blinder',      // payload: boolean
  'toggle-strobe',       // payload: boolean
  'toggle-timeline',     // no payload
  'go-cuelist',          // payload: cuelist id
  'stop-cuelist',        // payload: cuelist id
  'set-cuelist-fader',   // payload: { id, level }
  'select-group',        // payload: group id
  'select-all',          // no payload
  'clear-selection',     // no payload
  'clear-programmer'     // no payload
]

/**
 * Start the WebSocket API server.
 * Call after main window is created.
 */
export function startApiServer(mainWindow: BrowserWindow): void {
  if (wss) return
  mainWindowRef = mainWindow

  wss = new WebSocketServer({ port: API_PORT, host: '0.0.0.0', maxPayload: MAX_API_MESSAGE_SIZE })

  wss.on('listening', () => {
    console.log(`[API] WebSocket server listening on port ${API_PORT}`)
  })

  wss.on('error', (err) => {
    console.error('[API] WebSocket server error:', err.message)
  })

  wss.on('connection', (ws) => {
    console.log('[API] Client connected')

    // Rate limiting state per client
    let messageCount = 0
    const rateLimitResetTimer = setInterval(() => { messageCount = 0 }, 1000)

    // Send available commands on connect
    ws.send(JSON.stringify({
      type: 'commands',
      list: AVAILABLE_COMMANDS
    }))

    // Send current state immediately if available
    if (lastState) {
      ws.send(JSON.stringify({ type: 'state', data: lastState }))
    }

    // Handle incoming commands
    ws.on('message', (raw) => {
      // Rate limiting
      messageCount++
      if (messageCount > API_RATE_LIMIT) return

      try {
        const msg = JSON.parse(raw.toString())

        // Validate message structure
        if (!msg || typeof msg !== 'object' || msg.type !== 'command' || !msg.command) return

        // Validate command type is in whitelist
        const commandType = msg.command?.type
        if (typeof commandType !== 'string' || !AVAILABLE_COMMANDS.includes(commandType)) {
          console.warn('[API] Rejected unknown command:', commandType)
          return
        }

        // Relay to main renderer (same path as stage window commands)
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('stage:command', msg.command)
        }
      } catch (e) {
        console.error('[API] Invalid message:', e)
      }
    })

    ws.on('close', () => {
      clearInterval(rateLimitResetTimer)
      console.log('[API] Client disconnected')
    })
  })

  // Start state broadcast at ~10Hz (enough for button feedback)
  startStateBroadcast()
}

/**
 * Stop the API server.
 */
export function stopApiServer(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }
  if (wss) {
    wss.close()
    wss = null
  }
  mainWindowRef = null
  console.log('[API] Server stopped')
}

/**
 * Called by the IPC relay when renderer sends state.
 * Caches the state and broadcasts to all connected WebSocket clients.
 */
export function broadcastState(state: any): void {
  lastState = state
  if (!wss || wss.clients.size === 0) return

  const msg = JSON.stringify({ type: 'state', data: state })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg)
    }
  }
}

/**
 * Start requesting state from renderer at 10Hz for API broadcast.
 */
function startStateBroadcast(): void {
  if (syncInterval) return

  syncInterval = setInterval(() => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return
    // Only request if we have API clients
    if (wss && wss.clients.size > 0) {
      mainWindowRef.webContents.send('api:request-state')
    }
  }, 100) // 10Hz
}

/**
 * Get the number of connected API clients.
 */
export function getApiClientCount(): number {
  return wss?.clients.size ?? 0
}
