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
import { join, extname } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { ShowFileManager } from './show-file'
import { DmxEngine } from './dmx-engine'
import { DmxOutputManager } from './dmx-output-manager'
import { OFLService } from './ofl-service'
import { IPC } from '../shared/types'

const WEB_PORT = 9091

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
  // In production: resources/app.asar/out/renderer
  // In dev: out/renderer
  const rendererPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar', 'out', 'renderer')
    : join(app.getAppPath(), 'out', 'renderer')

  // ---- HTTP server: serve static renderer files ----
  server = http.createServer((req, res) => {
    // CORS for development
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET')

    let urlPath = req.url?.split('?')[0] || '/'
    if (urlPath === '/') urlPath = '/index.html'

    const filePath = join(rendererPath, urlPath)

    // Security: don't serve outside renderer directory
    if (!filePath.startsWith(rendererPath)) {
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
  wss = new WebSocketServer({ server })

  wss.on('connection', (ws) => {
    console.log('[Web] Remote client connected')

    // Send current state immediately
    if (lastState) {
      ws.send(JSON.stringify({ type: 'event', channel: 'state', data: lastState }))
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'invoke') {
          // Request-response (like ipcMain.handle)
          const result = await handleInvoke(msg.channel, msg.args || [])
          ws.send(JSON.stringify({ id: msg.id, type: 'result', data: result }))
        } else if (msg.type === 'send') {
          // Fire-and-forget (like ipcMain.on)
          handleSend(msg.channel, msg.args || [])
        }
      } catch (e: any) {
        console.error('[Web] Message error:', e.message)
      }
    })

    ws.on('close', () => {
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

// ---- Handle invoke (request-response) ----
async function handleInvoke(channel: string, args: any[]): Promise<any> {
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
      const show = JSON.parse(args[0])
      const saveResult = showManagerRef!.save(show)
      if (saveResult.needsSaveAs) {
        // Remote: auto-save to default path (no dialog available)
        const defaultDir = showManagerRef!.getDefaultShowsDir()
        const filename = `${show.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`
        return showManagerRef!.saveAs(show, join(defaultDir, filename))
      }
      return saveResult
    }
    case IPC.SHOW_SAVE_AS: {
      const show = JSON.parse(args[0])
      const defaultDir = showManagerRef!.getDefaultShowsDir()
      const filename = `${show.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`
      return showManagerRef!.saveAs(show, join(defaultDir, filename))
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
    case IPC.FIXTURES_OFL_SEARCH:
      return oflServiceRef!.search(args[0])
    case IPC.FIXTURES_OFL_DOWNLOAD: {
      const fixture = await oflServiceRef!.download(args[0], args[1])
      showManagerRef!.saveUserFixture(fixture)
      return fixture
    }
    case IPC.FIXTURES_SAVE:
      return showManagerRef!.saveUserFixture(JSON.parse(args[0]))
    case IPC.FIXTURES_DELETE:
      return showManagerRef!.deleteUserFixture(args[0])

    // App
    case IPC.APP_GET_VERSION:
      return app.getVersion()

    // Remote-specific: load a specific show by path
    case 'remote:load-show': {
      return showManagerRef!.load(args[0])
    }

    default:
      console.warn('[Web] Unknown invoke channel:', channel)
      return null
  }
}

// ---- Handle send (fire-and-forget) ----
function handleSend(channel: string, args: any[]): void {
  switch (channel) {
    case IPC.DMX_SET_CHANNEL:
      dmxEngineRef!.setChannel(args[0], args[1], args[2])
      break
    case IPC.DMX_SET_CHANNELS:
      for (const [ch, val] of Object.entries(args[1] as Record<number, number>)) {
        dmxEngineRef!.setChannel(args[0], parseInt(ch), val as number)
      }
      break
    case IPC.DMX_BLACKOUT:
      dmxEngineRef!.blackout()
      break
    case IPC.STAGE_COMMAND:
      // Remote sends command to main renderer (same as stage window)
      relayToRenderer(IPC.STAGE_COMMAND, args[0])
      break
    case 'api:state':
      // Remote client sending state (if it's the active editor)
      break
    default:
      console.warn('[Web] Unknown send channel:', channel)
  }
}
