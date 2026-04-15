// ============================================================
// PhotonBoard — Remote Web Server
// Serves the renderer as a web app and bridges WebSocket ↔ IPC
// so the full UI (including 3D) runs in the Mac's browser.
//
// URL:  http://<pi-ip>:9091
// Port 9090 stays for Companion (lightweight protocol).
// ============================================================

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { ShowFileManager } from './show-file'
import { DmxEngine } from './dmx-engine'
import { DmxOutputManager } from './dmx-output-manager'
import { OFLService } from './ofl-service'
import { IPC } from '../shared/types'

const WEB_PORT = 9091
const MAX_WS_MESSAGE_SIZE = 5 * 1024 * 1024 // 5 MB max WebSocket message
const WS_RATE_LIMIT = 200 // max messages per second per client

let server: http.Server | null = null
let wss: WebSocketServer | null = null
let mainWindowRef: BrowserWindow | null = null
let dmxEngineRef: DmxEngine | null = null
let outputManagerRef: DmxOutputManager | null = null
let showManagerRef: ShowFileManager | null = null
let oflServiceRef: OFLService | null = null

// Last state from renderer (for immediate sync to new remote clients)
let lastState: any = null

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
}

export function startWebServer(
  mainWindow: BrowserWindow,
  dmxEngine: DmxEngine,
  outputManager: DmxOutputManager,
  showManager: ShowFileManager,
  oflService: OFLService
): void {
  if (server) return
  mainWindowRef = mainWindow
  dmxEngineRef = dmxEngine
  outputManagerRef = outputManager
  showManagerRef = showManager
  oflServiceRef = oflService

  // ---- Renderer build path ----
  // app.getAppPath() returns the correct base whether packaged (asar or unpacked app/)
  // or in dev mode. Renderer is always at <appPath>/out/renderer.
  const rendererPath = join(app.getAppPath(), 'out', 'renderer')

  // ---- HTTP server: serve static renderer files ----
  const canonicalRendererPath = resolve(rendererPath)

  server = http.createServer((req, res) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'")

    // Only allow GET requests
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end('Method Not Allowed')
      return
    }

    let urlPath = req.url?.split('?')[0] || '/'
    if (urlPath === '/') urlPath = '/index.html'

    // Reject null bytes and encoded traversal attempts
    if (urlPath.includes('\0') || urlPath.includes('%00')) {
      res.writeHead(400)
      res.end('Bad Request')
      return
    }

    // Use resolve() for canonical path comparison (prevents symlink/.. traversal)
    const filePath = resolve(join(rendererPath, urlPath))

    // Security: canonical path must be inside renderer directory
    if (!filePath.startsWith(canonicalRendererPath + '/') && filePath !== canonicalRendererPath) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    try {
      const data = readFileSync(filePath)
      const ext = extname(filePath)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(data)
    } catch {
      // SPA fallback: serve index.html for any missing route
      try {
        const html = readFileSync(join(rendererPath, 'index.html'))
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('Not found')
      }
    }
  })

  // ---- WebSocket: bridge IPC ----
  wss = new WebSocketServer({ server, maxPayload: MAX_WS_MESSAGE_SIZE })

  wss.on('connection', (ws) => {
    console.log('[Web] Remote client connected')

    // Rate limiting state per client
    let messageCount = 0
    let rateLimitResetTimer = setInterval(() => { messageCount = 0 }, 1000)

    // Send current state immediately
    if (lastState) {
      ws.send(JSON.stringify({ type: 'event', channel: 'state', data: lastState }))
    }

    ws.on('message', async (raw) => {
      // Rate limiting: drop messages if client exceeds limit
      messageCount++
      if (messageCount > WS_RATE_LIMIT) {
        return // silently drop
      }

      // Message size check (defense in depth — maxPayload already enforces this)
      if (raw.toString().length > MAX_WS_MESSAGE_SIZE) {
        return
      }

      try {
        const msg = JSON.parse(raw.toString())

        // Validate message structure
        if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
          return
        }

        if (msg.type === 'invoke') {
          if (typeof msg.channel !== 'string') return
          // Request-response (like ipcMain.handle)
          const result = await handleInvoke(msg.channel, msg.args || [])
          ws.send(JSON.stringify({ id: msg.id, type: 'result', data: result }))
        } else if (msg.type === 'send') {
          if (typeof msg.channel !== 'string') return
          // Fire-and-forget (like ipcMain.on)
          handleSend(msg.channel, msg.args || [])
        }
      } catch (e: any) {
        console.error('[Web] Message error:', e.message)
      }
    })

    ws.on('close', () => {
      clearInterval(rateLimitResetTimer)
      console.log('[Web] Remote client disconnected')
    })
  })

  server.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`[Web] Remote UI available at http://0.0.0.0:${WEB_PORT}`)
  })

  server.on('error', (err) => {
    console.error('[Web] Server error:', err.message)
  })
}

export function stopWebServer(): void {
  if (wss) { wss.close(); wss = null }
  if (server) { server.close(); server = null }
  mainWindowRef = null
  console.log('[Web] Server stopped')
}

/**
 * Called when renderer sends state — forward to remote web clients.
 */
export function broadcastToWeb(state: any): void {
  lastState = state
  if (!wss || wss.clients.size === 0) return
  const msg = JSON.stringify({ type: 'event', channel: 'state', data: state })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg)
    }
  }
}

/**
 * Forward a command from remote web client to the main renderer.
 */
function relayToRenderer(channel: string, ...args: any[]): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, ...args)
  }
}

// Allowed invoke channels — reject anything not in this list
const ALLOWED_INVOKE_CHANNELS = new Set([
  IPC.DMX_GET_VALUES,
  IPC.ARTNET_CONFIGURE, IPC.ARTNET_GET_STATUS,
  IPC.DMX_OUTPUTS_CONFIGURE, IPC.DMX_OUTPUTS_GET_STATUS, IPC.DMX_OUTPUTS_SCAN_USB,
  IPC.SHOW_NEW, IPC.SHOW_SAVE, IPC.SHOW_SAVE_AS, IPC.SHOW_LOAD,
  IPC.SHOW_GET_RECENT, IPC.SHOW_LOAD_LAST, IPC.SHOW_GET_PATH, IPC.SHOW_REVEAL,
  IPC.FIXTURES_SCAN, IPC.FIXTURES_GET_ALL, IPC.FIXTURES_IMPORT,
  IPC.FIXTURES_OFL_SEARCH, IPC.FIXTURES_OFL_DOWNLOAD,
  IPC.FIXTURES_SAVE, IPC.FIXTURES_DELETE,
  IPC.APP_GET_VERSION,
  'remote:load-show', 'remote:upload-show'
])

// ---- Handle invoke (request-response) ----
async function handleInvoke(channel: string, args: any[]): Promise<any> {
  if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
    console.warn('[Web] Rejected unknown invoke channel:', channel)
    return null
  }
  switch (channel) {
    // DMX
    case IPC.DMX_GET_VALUES:
      return Array.from(dmxEngineRef!.getUniverse(args[0]))

    // ArtNet
    case IPC.ARTNET_CONFIGURE:
      outputManagerRef!.configureArtnet(args[0])
      return true
    case IPC.ARTNET_GET_STATUS:
      return outputManagerRef!.getArtnetStatus()

    // DMX Outputs
    case IPC.DMX_OUTPUTS_CONFIGURE:
      await outputManagerRef!.configure(args[0])
      return true
    case IPC.DMX_OUTPUTS_GET_STATUS:
      return outputManagerRef!.getStatus()
    case IPC.DMX_OUTPUTS_SCAN_USB:
      return outputManagerRef!.scanUsbPorts()

    // Show
    case IPC.SHOW_NEW:
      return showManagerRef!.newShow()
    case IPC.SHOW_SAVE: {
      if (typeof args[0] !== 'string' || args[0].length > 10 * 1024 * 1024) {
        return { success: false, error: 'Invalid or oversized show data' }
      }
      const show = JSON.parse(args[0])
      if (!show || typeof show !== 'object' || !show.version || !Array.isArray(show.patch)) {
        return { success: false, error: 'Invalid show structure' }
      }
      const saveResult = showManagerRef!.save(show)
      if (saveResult.needsSaveAs) {
        // Remote: auto-save to default path (no dialog available)
        const defaultDir = showManagerRef!.getDefaultShowsDir()
        const filename = `${(show.name || 'Show').replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`
        const savePath = resolve(join(defaultDir, filename))
        // Ensure path stays inside shows directory
        if (!savePath.startsWith(resolve(defaultDir) + '/')) {
          return { success: false, error: 'Invalid show name' }
        }
        return showManagerRef!.saveAs(show, savePath)
      }
      return saveResult
    }
    case IPC.SHOW_SAVE_AS: {
      if (typeof args[0] !== 'string' || args[0].length > 10 * 1024 * 1024) {
        return { success: false, error: 'Invalid or oversized show data' }
      }
      const show = JSON.parse(args[0])
      if (!show || typeof show !== 'object' || !show.version || !Array.isArray(show.patch)) {
        return { success: false, error: 'Invalid show structure' }
      }
      const defaultDir = showManagerRef!.getDefaultShowsDir()
      const filename = `${(show.name || 'Show').replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`
      const savePath = resolve(join(defaultDir, filename))
      if (!savePath.startsWith(resolve(defaultDir) + '/')) {
        return { success: false, error: 'Invalid show name' }
      }
      return showManagerRef!.saveAs(show, savePath)
    }
    case IPC.SHOW_LOAD: {
      // Remote: return list of available shows for the client to pick
      const shows = showManagerRef!.listShows()
      return { type: 'show-list', shows }
    }
    case IPC.SHOW_GET_RECENT:
      return showManagerRef!.getRecent()
    case IPC.SHOW_LOAD_LAST:
      return showManagerRef!.loadLastShow()
    case IPC.SHOW_GET_PATH:
      return showManagerRef!.getCurrentPath()
    case IPC.SHOW_REVEAL:
      return true // no-op remotely

    // Fixtures
    case IPC.FIXTURES_SCAN: {
      const fixturesDir = join(app.getPath('userData'), 'fixtures')
      return showManagerRef!.scanFixtures(fixturesDir)
    }
    case IPC.FIXTURES_GET_ALL: {
      const fixtures = showManagerRef!.getAllFixtures()
      const result: any[] = []
      for (const f of fixtures) {
        try { JSON.stringify(f); result.push(f) } catch { /* skip */ }
      }
      return JSON.stringify(result)
    }
    case IPC.FIXTURES_IMPORT:
      return null // dialogs don't work remotely
    case IPC.FIXTURES_OFL_SEARCH: {
      // Validate search query
      if (typeof args[0] !== 'string' || args[0].length > 200) {
        return []
      }
      return oflServiceRef!.search(args[0])
    }
    case IPC.FIXTURES_OFL_DOWNLOAD: {
      // Validate manufacturer/fixture keys (alphanumeric + hyphens only)
      if (typeof args[0] !== 'string' || typeof args[1] !== 'string') return null
      if (!/^[a-z0-9-]+$/i.test(args[0]) || !/^[a-z0-9-]+$/i.test(args[1])) {
        return { success: false, error: 'Invalid fixture key' }
      }
      const fixture = await oflServiceRef!.download(args[0], args[1])
      showManagerRef!.saveUserFixture(fixture)
      return fixture
    }
    case IPC.FIXTURES_SAVE: {
      if (typeof args[0] !== 'string' || args[0].length > MAX_WS_MESSAGE_SIZE) return { success: false, error: 'Invalid data' }
      return showManagerRef!.saveUserFixture(JSON.parse(args[0]))
    }
    case IPC.FIXTURES_DELETE: {
      // Validate fixture ID (prevent path traversal via fixture ID)
      if (typeof args[0] !== 'string' || args[0].includes('..') || args[0].includes('\0')) {
        return { success: false, error: 'Invalid fixture ID' }
      }
      return showManagerRef!.deleteUserFixture(args[0])
    }

    // App
    case IPC.APP_GET_VERSION:
      return app.getVersion()

    // Remote-specific: load a specific show by path
    case 'remote:load-show': {
      const requestedPath = args[0]
      if (typeof requestedPath !== 'string') {
        return { success: false, error: 'Invalid path' }
      }
      // Security: validate path is inside allowed show directories
      const canonicalPath = resolve(requestedPath)
      const allowedDirs = [
        resolve(showManagerRef!.getDefaultShowsDir()),
        resolve(join(app.getPath('userData'), 'shows'))
      ]
      const isAllowed = allowedDirs.some(dir =>
        canonicalPath.startsWith(dir + '/') || canonicalPath === dir
      )
      if (!isAllowed) {
        console.warn('[Web] Blocked load attempt outside shows directory:', requestedPath)
        return { success: false, error: 'Access denied: path outside allowed directories' }
      }
      // Validate file extension
      if (!canonicalPath.endsWith('.pbshow')) {
        return { success: false, error: 'Invalid file type' }
      }
      return showManagerRef!.load(canonicalPath)
    }

    // Remote-specific: upload a .pbshow file from the browser
    case 'remote:upload-show': {
      try {
        const fileContent = args[0] as string   // JSON text
        const fileName = (args[1] as string) || 'Uploaded Show.pbshow'

        // Validate inputs are strings
        if (typeof fileContent !== 'string' || typeof fileName !== 'string') {
          return { success: false, error: 'Invalid input types' }
        }

        // Size limit: 10 MB max show file
        if (fileContent.length > 10 * 1024 * 1024) {
          return { success: false, error: 'Show file too large (max 10 MB)' }
        }

        // Validate JSON
        let show: any
        try {
          show = JSON.parse(fileContent)
        } catch {
          return { success: false, error: 'Invalid JSON in show file' }
        }

        // Schema validation: must be a valid show file structure
        if (!show || typeof show !== 'object' ||
            typeof show.version !== 'string' ||
            !Array.isArray(show.patch) ||
            (show.cuelists && !Array.isArray(show.cuelists)) ||
            (show.groups && !Array.isArray(show.groups)) ||
            (show.name && typeof show.name !== 'string')) {
          return { success: false, error: 'Not a valid .pbshow file' }
        }

        // Sanitize filename (keep accents/spaces, remove filesystem-unsafe chars and traversal)
        const safeName = fileName
          .replace(/\.pbshow$/i, '')
          .replace(/[/\\:*?"<>|]/g, '_')
          .replace(/\.\./g, '_')  // Remove directory traversal sequences
          .trim() || 'Uploaded Show'
        const destPath = resolve(join(showManagerRef!.getDefaultShowsDir(), `${safeName}.pbshow`))

        // Security: verify resolved path is still inside shows directory
        const allowedDir = resolve(showManagerRef!.getDefaultShowsDir())
        if (!destPath.startsWith(allowedDir + '/')) {
          return { success: false, error: 'Invalid filename' }
        }

        // Save to disk
        const saveResult = showManagerRef!.saveAs(show, destPath)
        if (!saveResult.success) {
          return { success: false, error: saveResult.error || 'Failed to save file' }
        }

        // Load to set as current show (updates recent files, currentFilePath)
        const loadResult = showManagerRef!.load(destPath)
        if (!loadResult.success) {
          return { success: false, error: loadResult.error || 'Saved but failed to load' }
        }

        // Tell Pi renderer to apply the uploaded show
        relayToRenderer(IPC.STAGE_COMMAND, { type: 'apply-show', payload: loadResult.show })

        console.log(`[Web] Show uploaded: ${safeName} (${destPath})`)
        return { success: true, show: loadResult.show, path: destPath }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }

    default:
      console.warn('[Web] Unknown invoke channel:', channel)
      return null
  }
}

// ---- Handle send (fire-and-forget) ----

// Allowed send channels — reject anything not in this list
const ALLOWED_SEND_CHANNELS = new Set([
  IPC.DMX_SET_CHANNEL,
  IPC.DMX_SET_CHANNELS,
  IPC.DMX_BLACKOUT,
  IPC.STAGE_COMMAND,
  'api:state'
])

function handleSend(channel: string, args: any[]): void {
  if (!ALLOWED_SEND_CHANNELS.has(channel)) {
    console.warn('[Web] Rejected unknown send channel:', channel)
    return
  }

  switch (channel) {
    case IPC.DMX_SET_CHANNEL: {
      // Validate DMX values: universe (0-15), channel (0-511), value (0-255)
      const universe = typeof args[0] === 'number' ? Math.max(0, Math.min(15, args[0] | 0)) : 0
      const ch = typeof args[1] === 'number' ? Math.max(0, Math.min(511, args[1] | 0)) : 0
      const val = typeof args[2] === 'number' ? Math.max(0, Math.min(255, args[2] | 0)) : 0
      dmxEngineRef!.setChannel(universe, ch, val)
      break
    }
    case IPC.DMX_SET_CHANNELS: {
      const universe = typeof args[0] === 'number' ? Math.max(0, Math.min(15, args[0] | 0)) : 0
      if (args[1] && typeof args[1] === 'object') {
        for (const [ch, val] of Object.entries(args[1])) {
          const chNum = Math.max(0, Math.min(511, parseInt(ch) || 0))
          const valNum = Math.max(0, Math.min(255, (typeof val === 'number' ? val : 0) | 0))
          dmxEngineRef!.setChannel(universe, chNum, valNum)
        }
      }
      break
    }
    case IPC.DMX_BLACKOUT:
      dmxEngineRef!.blackout()
      break
    case IPC.STAGE_COMMAND:
      // Validate command structure before relaying
      if (args[0] && typeof args[0] === 'object' && typeof args[0].type === 'string') {
        relayToRenderer(IPC.STAGE_COMMAND, args[0])
      }
      break
    case 'api:state':
      // Remote client sending state (if it's the active editor)
      break
  }
}
