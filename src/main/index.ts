import { app, BrowserWindow, ipcMain, dialog, session, Menu, shell, screen } from 'electron'
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { basename, join } from 'path'
import { DmxEngine } from './dmx-engine'
import { DmxOutputManager } from './dmx-output-manager'
import { ShowFileManager } from './show-file'
import { OFLService } from './ofl-service'
import { FixtureCatalog, defaultCatalogDirs, installCatalogFixture, installMissingShowFixtures, isCatalogId, sanitizeCatalogQuery } from './fixture-catalog'
import { IPC, MAX_UNIVERSES, type DmxOutputsConfig } from '../shared/types'
import type { RemovableDrive, RemoteStatus, ShowLoadResult, ShowSaveResult, SimpleResult } from '../shared/photonboard-api'
import { startApiServer, stopApiServer, broadcastState, disconnectApiClients, getApiServerStatus } from './api-server'
import { startWebServer, stopWebServer, broadcastToWeb, disconnectWebClients, getWebServerStatus } from './web-server'
import { loadJsonConfig, saveJsonConfig } from './config-store'
import { defaultOutputsConfig, validateOutputsConfig } from './output-config'
import { RemoteSettingsStore } from './remote-settings'
import { PiSaveCoordinator } from './pi-save-coordinator'
import { lanAddresses } from './remote-access'
import { parseShowArg } from './remote-invoke'
import { sanitizeShowName, SHOW_EXTENSION } from './show-validation'
import { mt, setMainLanguage } from './messages'
import { listGameControllers } from './input-devices'
import { RemovableWatcher, copyFileName, driveOf, ejectDrive, isInsideDrive, removableRoots, safeTextFileName } from './removable-drives'
import { INSTALLED_TOUCH_HELPER, touchRemap, touchReport, type HelperDirs } from './touch-diagnostics'
import { TouchSetupService } from './touch-wizards'
import { touchConfigPath } from './touch-setup'
import { atomicWriteFile } from './atomic-write'
import { userInfo } from 'os'
import { existsSync } from 'fs'
import { createInterchangeHost, type InterchangeHost } from './interchange'
import { DemoLibrary, defaultDemoDirs } from './demos'
import { CONSOLE_BACKGROUND, SPLASH_MAX_MS, openSplash, splashDisabled, type Splash } from './splash'
import pkg from '../../package.json'

/**
 * The engine holds every universe the UI can patch (16 × 512 bytes). Outputs
 * only read the universes they are configured for and skip unchanged frames,
 * and the renderer sends only changed channels, so unused universes cost nothing.
 */
const UNIVERSE_COUNT = MAX_UNIVERSES

function safeLog(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
  try { console[level](...args) } catch { /* stdout pipe closed */ }
}

// A show controller must not die mid-show: keep running, but log loudly
// (with stack) and reflect output-related failures in the output status.
process.on('uncaughtException', (err) => {
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'EPIPE' || e?.message === 'write EPIPE') return // stdout closed (dev terminal)
  const outputRelated = outputManager?.noteUncaughtError(err) ?? false
  safeLog('error', `\n[Main] ===== UNCAUGHT EXCEPTION${outputRelated ? ' (DMX output)' : ''} — PhotonBoard keeps running =====\n${e?.stack || String(err)}\n`)
})
process.on('unhandledRejection', (reason) => {
  const outputRelated = outputManager?.noteUncaughtError(reason) ?? false
  safeLog('error', `[Main] Unhandled promise rejection${outputRelated ? ' (DMX output)' : ''}:`, (reason as Error)?.stack || reason)
})
process.stdout?.on('error', () => { /* ignore EPIPE */ })
process.stderr?.on('error', () => { /* ignore EPIPE */ })

let mainWindow: BrowserWindow | null = null
let stageWindow: BrowserWindow | null = null
let stageSyncInterval: ReturnType<typeof setInterval> | null = null
let dmxEngine: DmxEngine
let outputManager: DmxOutputManager | undefined
let showManager: ShowFileManager
let oflService: OFLService
let fixtureCatalog: FixtureCatalog
let remoteSettings: RemoteSettingsStore
let piSave: PiSaveCoordinator
let cleanedUp = false
let removable: RemovableWatcher | null = null
let interchange: InterchangeHost
let demos: DemoLibrary
/** Start-up splash (null once the console is shown, or when PB_NO_SPLASH=1) */
let splash: Splash | null = null
/** Settings › Display › Touchscreens (Linux X11) */
let touchSetup: TouchSetupService | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

function sendToMainWindow(channel: string, ...args: unknown[]): boolean {
  const win = getMainWindow()
  if (!win) return false
  win.webContents.send(channel, ...args)
  return true
}

/** Native menu labels, in the console UI language (renderer → app:set-language) */
const MENU_LABELS = {
  en: {
    about: 'About PhotonBoard', hide: 'Hide PhotonBoard', hideOthers: 'Hide Others', unhide: 'Show All', quit: 'Quit PhotonBoard',
    file: 'File', newShow: 'New Show', open: 'Open…', openDemo: 'Open a Demo…', save: 'Save', saveAs: 'Save As…', close: 'Close Window',
    importFile: 'Import…', exportFile: 'Export…',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    view: 'View', reload: 'Reload', forceReload: 'Force Reload', devTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Full Screen',
    window: 'Window', minimize: 'Minimize', zoom: 'Zoom', stage: 'Stage Window', front: 'Bring All to Front'
  },
  fr: {
    about: 'À propos de PhotonBoard', hide: 'Masquer PhotonBoard', hideOthers: 'Masquer les autres', unhide: 'Tout afficher', quit: 'Quitter PhotonBoard',
    file: 'Fichier', newShow: 'Nouveau show', open: 'Ouvrir…', openDemo: 'Ouvrir une démo…', save: 'Enregistrer', saveAs: 'Enregistrer sous…', close: 'Fermer la fenêtre',
    importFile: 'Importer…', exportFile: 'Exporter…',
    edit: 'Édition', undo: 'Annuler', redo: 'Rétablir', cut: 'Couper', copy: 'Copier', paste: 'Coller', selectAll: 'Tout sélectionner',
    view: 'Présentation', reload: 'Recharger', forceReload: 'Forcer le rechargement', devTools: 'Outils de développement',
    resetZoom: 'Taille réelle', zoomIn: 'Agrandir', zoomOut: 'Réduire', fullscreen: 'Plein écran',
    window: 'Fenêtre', minimize: 'Placer dans le Dock', zoom: 'Réduire/agrandir', stage: 'Fenêtre Stage', front: 'Tout ramener au premier plan'
  }
} as const

type MenuLanguage = keyof typeof MENU_LABELS
let menuLanguage: MenuLanguage = 'en'

function createMenu(): void {
  const isMac = process.platform === 'darwin'
  const L = MENU_LABELS[menuLanguage]
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const, label: L.about },
        { type: 'separator' as const },
        { role: 'hide' as const, label: L.hide },
        { role: 'hideOthers' as const, label: L.hideOthers },
        { role: 'unhide' as const, label: L.unhide },
        { type: 'separator' as const },
        { role: 'quit' as const, label: L.quit }
      ]
    }] : []),
    {
      label: L.file,
      submenu: [
        {
          label: L.newShow,
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToMainWindow('menu:new')
        },
        { type: 'separator' },
        {
          label: L.open,
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToMainWindow('menu:load')
        },
        {
          label: L.openDemo,
          click: () => sendToMainWindow('menu:open-demo')
        },
        { type: 'separator' },
        {
          label: L.save,
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToMainWindow('menu:save')
        },
        {
          label: L.saveAs,
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendToMainWindow('menu:save-as')
        },
        { type: 'separator' },
        {
          label: L.importFile,
          accelerator: 'CmdOrCtrl+I',
          click: () => sendToMainWindow('menu:import')
        },
        {
          label: L.exportFile,
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendToMainWindow('menu:export')
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const, label: L.close } : { role: 'quit' as const, label: L.quit }
      ]
    },
    {
      label: L.edit,
      submenu: [
        // The renderer decides: text undo inside a field, show undo (lib/history.ts) elsewhere
        { label: L.undo, accelerator: 'CmdOrCtrl+Z', click: () => sendToMainWindow('menu:undo') },
        { label: L.redo, accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y', click: () => sendToMainWindow('menu:redo') },
        { type: 'separator' as const },
        { role: 'cut' as const, label: L.cut },
        { role: 'copy' as const, label: L.copy },
        { role: 'paste' as const, label: L.paste },
        { role: 'selectAll' as const, label: L.selectAll }
      ]
    },
    {
      label: L.view,
      submenu: [
        { role: 'reload' as const, label: L.reload },
        { role: 'forceReload' as const, label: L.forceReload },
        { role: 'toggleDevTools' as const, label: L.devTools },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: L.resetZoom },
        { role: 'zoomIn' as const, label: L.zoomIn },
        { role: 'zoomOut' as const, label: L.zoomOut },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: L.fullscreen }
      ]
    },
    {
      label: L.window,
      submenu: [
        { role: 'minimize' as const, label: L.minimize },
        { role: 'zoom' as const, label: L.zoom },
        { type: 'separator' as const },
        {
          label: L.stage,
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => toggleStageWindow()
        },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const, label: L.front }
        ] : [
          { role: 'close' as const, label: L.close }
        ])
      ]
    }
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/** URLs our own windows may navigate to (the bundled renderer or the dev server) */
function isAppUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && url.startsWith(devUrl)) return true
  return url.startsWith('file://')
}

/**
 * Security for every web contents: no navigation away from the app, no new
 * windows. Plain web links are handed to the system browser.
 */
function hardenWebContents(contents: Electron.WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
}

async function listRemovable(refresh: boolean): Promise<RemovableDrive[]> {
  if (!removable) return []
  return refresh ? removable.refresh() : removable.current
}

/** The drives, rescanned when `path` is not on one we know (just plugged) */
async function drivesFor(path: unknown): Promise<RemovableDrive[]> {
  if (!removable) return []
  if (driveOf(path, removable.current)) return removable.current
  return removable.refresh()
}

/** Eject a stick by its mount point (console and web remote) */
async function ejectRemovable(drivePath: unknown): Promise<SimpleResult> {
  const drives = await drivesFor(drivePath)
  const drive = driveOf(drivePath, drives)
  if (!drive || drive.path !== drivePath) return { success: false, error: mt('usbNotOnStick') }
  const result = await ejectDrive(drive.path)
  void removable?.refresh()
  return result
}

/**
 * USB sticks: watch the removable mount roots; the console window is told
 * when sticks come and go. PHOTONBOARD_REMOVABLE_ROOTS (":"-separated)
 * replaces the roots and accepts plain folders (end-to-end tests).
 */
function startRemovableWatcher(): void {
  const override = process.env.PHOTONBOARD_REMOVABLE_ROOTS
  let user = ''
  try { user = userInfo().username } catch { /* no passwd entry */ }
  const roots = override ? override.split(':').filter(Boolean) : removableRoots(process.platform, user)
  removable = new RemovableWatcher(roots, (drives) => {
    sendToMainWindow(IPC.REMOVABLE_CHANGED, drives)
  }, { requireMount: !override })
  removable.start()
}

function setupPermissions(): void {
  // Grant only MIDI permissions (required for Web MIDI in Electron 33+)
  // All other permissions are denied for security
  const ALLOWED_PERMISSIONS = new Set(['midi', 'midiSysex'])
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const granted = ALLOWED_PERMISSIONS.has(permission)
    if (!granted) safeLog('log', `[Security] Denied permission: ${permission}`)
    callback(granted)
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission)
  })
}

/**
 * Show the console window once it is ready (it is created hidden): through
 * the splash when there is one (minimum display time, fade out), and at the
 * latest after SPLASH_MAX_MS whatever happens.
 */
function revealWhenReady(win: BrowserWindow): void {
  let revealed = false
  const reveal = () => {
    if (revealed) return
    revealed = true
    clearTimeout(safety)
    const show = () => {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
    }
    const current = splash
    splash = null
    if (current) current.finish(show)
    else show()
  }
  const safety = setTimeout(() => {
    if (!revealed) safeLog('warn', `[Main] Console window not ready after ${SPLASH_MAX_MS} ms — showing it anyway`)
    reveal()
  }, SPLASH_MAX_MS)
  win.once('ready-to-show', reveal)
  win.once('closed', () => {
    clearTimeout(safety)
    splash?.destroy()
    splash = null
  })
}

function createWindow(): void {
  const isLinux = process.platform === 'linux'

  // Note: sandbox stays off because the preloads are built as ES modules
  // (index.mjs), which sandboxed preloads cannot load. contextIsolation is on
  // and nodeIntegration off, so the page itself never gets Node access.
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    // Shown by revealWhenReady (after the splash): no white flash, no half-drawn UI
    show: false,
    backgroundColor: CONSOLE_BACKGROUND,
    fullscreen: isLinux,
    titleBarStyle: isLinux ? 'default' : 'hiddenInset',
    trafficLightPosition: isLinux ? undefined : { x: 15, y: 15 },
    autoHideMenuBar: isLinux,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer drives the DMX mixer/engines on timers: Chromium must not
      // throttle them when the console window is hidden or minimised.
      backgroundThrottling: false
    }
  })
  mainWindow = win
  revealWhenReady(win)

  // Disable Electron's built-in scroll-to-zoom (we handle zoom ourselves in canvas)
  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(0)
    win.webContents.setZoomFactor(1)
  })

  // Dev or production
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Forward renderer console to main stdout for debugging (safe against EPIPE)
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      safeLog('log', '[Renderer:ERR]', message)
    } else if (message.includes('[PhotonBoard]') || message.includes('[MIDI]') || message.includes('patch') || message.includes('Patch')) {
      safeLog('log', '[Renderer]', message)
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    safeLog('error', `[Main] Renderer process gone (${details.reason}, exit ${details.exitCode}) — DMX output holds the last look`)
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // Close stage window when main window closes
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.close()
    }
  })
}

function outputsConfigPath(): string {
  return join(app.getPath('userData'), 'config', 'outputs.json')
}

/**
 * DMX engine + outputs. The output configuration is machine config owned by
 * main (config/outputs.json): it is applied here at startup, before and
 * independently of any renderer.
 */
function initDmxEngine(): void {
  dmxEngine = new DmxEngine(UNIVERSE_COUNT)
  const path = outputsConfigPath()
  const manager = new DmxOutputManager({
    universeCount: UNIVERSE_COUNT,
    persist: (config: DmxOutputsConfig) => saveJsonConfig(path, config)
  })
  outputManager = manager

  const loaded = loadJsonConfig<DmxOutputsConfig>(
    path,
    (raw) => {
      // No port check at startup: an unplugged adapter must keep its config
      const res = validateOutputsConfig(raw)
      return res.ok ? { ok: true, value: res.config } : res
    },
    defaultOutputsConfig
  )
  safeLog('log', `[DMX] Output config from ${loaded.source}: ${loaded.value.artnet.length} Art-Net, ${loaded.value.usb.length} USB`)

  // ~40 Hz output loop — every tick goes to all outputs (ArtNet + USB)
  dmxEngine.onFrame((universes) => {
    manager.send(universes, Date.now())
  })
  dmxEngine.start()
  manager.apply(loaded.value).catch((e) => safeLog('error', '[DMX] Applying output config failed:', e))
}

function dialogParent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? getMainWindow()
}

async function showSaveDialog(event: IpcMainInvokeEvent, opts: SaveDialogOptions) {
  const parent = dialogParent(event)
  return parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts)
}

async function showOpenDialog(event: IpcMainInvokeEvent, opts: OpenDialogOptions) {
  const parent = dialogParent(event)
  return parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts)
}

function defaultSavePath(name: unknown): string {
  return join(showManager.getDefaultShowsDir(), `${sanitizeShowName(name)}${SHOW_EXTENSION}`)
}

function getRemoteStatus(): RemoteStatus {
  return { web: getWebServerStatus(), api: getApiServerStatus(), addresses: lanAddresses() }
}

function registerIpcHandlers(): void {
  const outputs = outputManager!

  // --- DMX ---
  ipcMain.on(IPC.DMX_SET_CHANNEL, (_event, universe: number, channel: number, value: number) => {
    dmxEngine.setChannel(universe, channel, value)
  })

  ipcMain.on(IPC.DMX_SET_CHANNELS, (_event, universe: number, channels: Record<number, number>) => {
    if (!channels || typeof channels !== 'object') return
    for (const [ch, val] of Object.entries(channels)) {
      dmxEngine.setChannel(universe, Number(ch), val)
    }
  })

  ipcMain.handle(IPC.DMX_GET_VALUES, (_event, universe: number) => {
    return Array.from(dmxEngine.getUniverse(universe))
  })

  ipcMain.on(IPC.DMX_BLACKOUT, () => {
    dmxEngine.blackout()
  })

  // Strobe chop in step with the output frames (renderer mixer: dmx-mixer syncStrobeChop)
  ipcMain.on(IPC.DMX_STROBE_CHOP, (_event, chop: unknown) => {
    if (!chop || typeof chop !== 'object') {
      dmxEngine.setStrobeChop(null)
      return
    }
    const { rate, channels } = chop as { rate?: unknown; channels?: unknown }
    if (typeof rate !== 'number' || !channels || typeof channels !== 'object') {
      dmxEngine.setStrobeChop(null)
      return
    }
    dmxEngine.setStrobeChop(rate, channels as Record<number, number[]>)
  })

  // --- ArtNet (legacy compat: replaces only the Art-Net part, persists) ---
  ipcMain.handle(IPC.ARTNET_CONFIGURE, async (_event, configs: unknown) => {
    const result = await outputs.configureArtnet(configs)
    if (!result.success) throw new Error(result.error)
    return true
  })

  ipcMain.handle(IPC.ARTNET_GET_STATUS, () => {
    return outputs.getArtnetStatus()
  })

  // --- DMX Outputs (machine config) ---
  ipcMain.handle(IPC.DMX_OUTPUTS_CONFIGURE, (_event, config: unknown) => {
    return outputs.configure(config)
  })

  ipcMain.handle(IPC.DMX_OUTPUTS_GET_CONFIG, () => {
    return outputs.getConfig()
  })

  ipcMain.handle(IPC.DMX_OUTPUTS_GET_STATUS, () => {
    return outputs.getStatus()
  })

  ipcMain.handle(IPC.DMX_OUTPUTS_SCAN_USB, async () => {
    return outputs.scanUsbPorts()
  })

  // --- Show File ---
  ipcMain.handle(IPC.SHOW_NEW, () => {
    return showManager.newShow()
  })

  ipcMain.handle(IPC.SHOW_SAVE, async (event, showArg: unknown, opts?: { requestId?: string }): Promise<ShowSaveResult> => {
    let show
    try { show = parseShowArg(showArg) } catch (e) { return { success: false, error: (e as Error).message } }

    // Answer to a remote client's Save (PiSaveCoordinator): write where the remote asked
    const claim = piSave.claim(opts?.requestId)
    if (claim) {
      const result = await showManager.saveAs(show, claim.path)
      piSave.complete(claim.id, result)
      return result
    }

    const saveResult = await showManager.save(show)
    if (saveResult.needsSaveAs) {
      const result = await showSaveDialog(event, {
        filters: [{ name: mt('showFileFilter'), extensions: ['pbshow'] }],
        defaultPath: defaultSavePath(show.name)
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      return showManager.saveAs(show, result.filePath)
    }
    const { needsSaveAs: _ignored, ...rest } = saveResult
    return rest
  })

  ipcMain.handle(IPC.SHOW_LOAD, async (event): Promise<ShowLoadResult> => {
    const result = await showOpenDialog(event, {
      filters: [{ name: mt('showFileFilter'), extensions: ['pbshow'] }],
      defaultPath: showManager.getDefaultShowsDir(),
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true }
    return showManager.load(result.filePaths[0])
  })

  ipcMain.handle(IPC.SHOW_SAVE_AS, async (event, showArg: unknown, opts?: { name?: string }): Promise<ShowSaveResult> => {
    let show
    try { show = parseShowArg(showArg) } catch (e) { return { success: false, error: (e as Error).message } }
    const currentPath = showManager.getCurrentPath()
    const result = await showSaveDialog(event, {
      filters: [{ name: mt('showFileFilter'), extensions: ['pbshow'] }],
      defaultPath: typeof opts?.name === 'string' ? defaultSavePath(opts.name) : currentPath || defaultSavePath(show.name)
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    return showManager.saveAs(show, result.filePath)
  })

  ipcMain.handle(IPC.SHOW_LIST, () => {
    return showManager.listShowNames()
  })

  ipcMain.handle(IPC.SHOW_LOAD_BY_NAME, async (_event, name: unknown): Promise<ShowLoadResult> => {
    const path = showManager.findShowByName(name)
    if (!path) return { success: false, error: mt('showNotFound', { name: String(name) }) }
    return showManager.load(path)
  })

  ipcMain.handle(IPC.SHOW_GET_RECENT, () => {
    return showManager.getRecent()
  })

  // --- Demo content (resources/demos): read-only, named by id ---
  ipcMain.handle(IPC.DEMOS_LIST, () => demos.list())

  /** A demo show, opened as a new unsaved show (Save asks for a name: the demo itself stays untouched) */
  ipcMain.handle(IPC.DEMOS_OPEN, async (_event, id: unknown): Promise<ShowLoadResult> => {
    const path = demos.showPath(id)
    if (!path) return { success: false, error: mt('demoNotFound') }
    const read = await showManager.readShow(path)
    if (!read.success || !read.show) return { success: false, error: read.error }
    await showManager.runShowReadHook(read.show)
    showManager.newShow({ resetCurrent: true })
    return { success: true, show: read.show }
  })

  // --- Fixtures ---
  ipcMain.handle(IPC.FIXTURES_SCAN, () => {
    const fixturesDir = join(app.getPath('userData'), 'fixtures')
    return showManager.scanFixtures(fixturesDir)
  })

  ipcMain.handle(IPC.FIXTURES_GET_ALL, () => {
    // Return as JSON string to avoid Electron structured clone dropping multi-cell fixtures
    const fixtures = showManager.getAllFixtures()
    const result: unknown[] = []
    for (const f of fixtures) {
      try {
        JSON.stringify(f) // test if this fixture serializes
        result.push(f)
      } catch (e) {
        safeLog('error', '[Main] Failed to serialize fixture:', f.id, f.name, (e as Error).message)
      }
    }
    return JSON.stringify(result)
  })

  ipcMain.handle(IPC.FIXTURES_IMPORT, async (event) => {
    const result = await showOpenDialog(event, {
      filters: [
        { name: mt('fixtureFilterAll'), extensions: ['json', 'gdtf', 'qxf', 'd4', 'r20', 'xml', 'csv', 'tsv'] },
        { name: mt('fixtureFilterGdtf'), extensions: ['gdtf'] },
        { name: mt('fixtureFilterQlc'), extensions: ['qxf'] },
        { name: mt('fixtureFilterAvo'), extensions: ['d4', 'r20'] },
        { name: mt('fixtureFilterXml'), extensions: ['xml'] },
        { name: mt('fixtureFilterJson'), extensions: ['json'] },
        { name: mt('fixtureFilterCsv'), extensions: ['csv', 'tsv'] },
        { name: mt('allFiles'), extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths.map(filePath => showManager.importFixtureFile(filePath))
  })

  // --- OFL Online Library ---
  ipcMain.handle(IPC.FIXTURES_OFL_SEARCH, async (_e, query: unknown) => {
    if (typeof query !== 'string' || query.length > 200) return []
    return oflService.search(query)
  })

  ipcMain.handle(IPC.FIXTURES_OFL_DOWNLOAD, async (_e, manufacturerKey: string, fixtureKey: string) => {
    const fixture = await oflService.download(manufacturerKey, fixtureKey)
    // Save to user fixtures dir
    showManager.saveUserFixture(fixture)
    return fixture
  })

  // --- Offline fixture catalog (OFL + QLC+, bundled) ---
  ipcMain.handle(IPC.FIXTURES_CATALOG_INFO, () => fixtureCatalog.info())

  ipcMain.handle(IPC.FIXTURES_CATALOG_SEARCH, (_e, query: unknown) => fixtureCatalog.search(sanitizeCatalogQuery(query)))

  // Definitions are returned as JSON text (see FIXTURES_GET_ALL)
  ipcMain.handle(IPC.FIXTURES_CATALOG_GET, async (_e, id: unknown) => {
    if (!isCatalogId(id)) throw new Error('Invalid fixture ID')
    const def = await fixtureCatalog.get(id)
    return def ? JSON.stringify(def) : null
  })

  ipcMain.handle(IPC.FIXTURES_CATALOG_INSTALL, async (_e, id: unknown) => {
    if (!isCatalogId(id)) throw new Error('Invalid fixture ID')
    return JSON.stringify(await installCatalogFixture(fixtureCatalog, showManager, id))
  })

  ipcMain.handle(IPC.FIXTURES_SAVE, async (_e, fixtureJson: unknown) => {
    try {
      const fixture = typeof fixtureJson === 'string' ? JSON.parse(fixtureJson) : fixtureJson
      return showManager.saveUserFixture(fixture)
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.FIXTURES_DELETE, async (_e, fixtureId: string) => {
    return showManager.deleteUserFixture(fixtureId)
  })

  // --- Interchange (src/main/interchange): other software's files ---
  // Results cross IPC as JSON text (fixture definitions, see FIXTURES_GET_ALL)
  ipcMain.handle(IPC.INTERCHANGE_FORMATS, () => interchange.listFormats())

  ipcMain.handle(IPC.INTERCHANGE_IMPORT, async (event, raw: unknown) => {
    const req = (raw && typeof raw === 'object' ? raw : {}) as { path?: unknown; startDir?: unknown; format?: unknown; options?: unknown }
    const run = {
      format: typeof req.format === 'string' ? req.format : undefined,
      options: req.options && typeof req.options === 'object' ? req.options as never : undefined
    }
    let path = typeof req.path === 'string' && req.path.length > 0 && req.path.length < 4096 ? req.path : null
    if (!path) {
      const result = await showOpenDialog(event, {
        title: mt('interchangeImportTitle'),
        filters: [
          { name: mt('interchangeFilterAll'), extensions: interchange.importExtensions() },
          { name: mt('allFiles'), extensions: ['*'] }
        ],
        defaultPath: typeof req.startDir === 'string' && req.startDir ? req.startDir : showManager.getDefaultShowsDir(),
        properties: ['openFile']
      })
      if (result.canceled || !result.filePaths.length) return JSON.stringify({ success: false, canceled: true })
      path = result.filePaths[0]
    }
    return JSON.stringify(await interchange.importPath(path, run))
  })

  ipcMain.handle(IPC.INTERCHANGE_IMPORT_DATA, async (_event, fileName: unknown, data: unknown, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as { format?: unknown; options?: unknown }
    const bytes = data instanceof Uint8Array ? data : null
    if (!bytes || typeof fileName !== 'string') return JSON.stringify({ success: false, errorCode: 'unreadable', error: 'Invalid file data' })
    return JSON.stringify(await interchange.importBytes(bytes, fileName, {
      format: typeof o.format === 'string' ? o.format : undefined,
      options: o.options && typeof o.options === 'object' ? o.options as never : undefined
    }))
  })

  ipcMain.handle(IPC.INTERCHANGE_EXPORT, async (event, raw: unknown) => {
    let req: { format?: unknown; show?: unknown; fixtures?: unknown }
    try { req = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof req) ?? {} } catch { return { success: false, error: 'Invalid export request' } }
    const out = await interchange.exportShow(String(req.format ?? ''), req.show, req.fixtures)
    if (!out.success) return out
    const result = await showSaveDialog(event, {
      title: mt('interchangeExportTitle'),
      filters: [{ name: out.extension.toUpperCase(), extensions: [out.extension] }, { name: mt('allFiles'), extensions: ['*'] }],
      defaultPath: join(showManager.getDefaultShowsDir(), out.fileName)
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      await atomicWriteFile(result.filePath, Buffer.from(out.bytes))
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
    return { success: true, path: result.filePath, warnings: out.warnings }
  })

  ipcMain.handle(IPC.INTERCHANGE_EXPORT_DATA, async (_event, raw: unknown) => {
    let req: { format?: unknown; show?: unknown; fixtures?: unknown }
    try { req = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof req) ?? {} } catch { return { success: false, error: 'Invalid export request' } }
    const out = await interchange.exportShow(String(req.format ?? ''), req.show, req.fixtures)
    if (!out.success) return out
    return { success: true, fileName: out.fileName, data: Buffer.from(out.bytes).toString('base64'), warnings: out.warnings }
  })

  ipcMain.handle(IPC.INTERCHANGE_EXPORT_FIXTURE, async (event, raw: unknown) => {
    let req: { format?: unknown; fixture?: unknown }
    try { req = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof req) ?? {} } catch { return { success: false, error: 'Invalid export request' } }
    const out = await interchange.exportFixture(String(req.format ?? ''), req.fixture)
    if (!out.success) return out
    // The exporter's file name ("Manufacturer@Model@Revision.gdtf" for GDTF) is the default
    const result = await showSaveDialog(event, {
      title: mt('interchangeExportFixtureTitle'),
      filters: [{ name: out.extension.toUpperCase(), extensions: [out.extension] }, { name: mt('allFiles'), extensions: ['*'] }],
      defaultPath: join(showManager.getDefaultShowsDir(), out.fileName)
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      await atomicWriteFile(result.filePath, Buffer.from(out.bytes))
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
    return { success: true, path: result.filePath, fileName: out.fileName, warnings: out.warnings }
  })

  ipcMain.handle(IPC.INTERCHANGE_EXPORT_FIXTURE_DATA, async (_event, raw: unknown) => {
    let req: { format?: unknown; fixture?: unknown }
    try { req = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof req) ?? {} } catch { return { success: false, error: 'Invalid export request' } }
    const out = await interchange.exportFixture(String(req.format ?? ''), req.fixture)
    if (!out.success) return out
    return { success: true, fileName: out.fileName, data: Buffer.from(out.bytes).toString('base64'), warnings: out.warnings }
  })

  // --- Show helpers ---
  ipcMain.handle(IPC.SHOW_GET_PATH, () => {
    return showManager.getCurrentPath()
  })

  ipcMain.handle(IPC.SHOW_LOAD_LAST, () => {
    return showManager.loadLastShow()
  })

  ipcMain.handle(IPC.SHOW_REVEAL, async () => {
    const path = showManager.getCurrentPath()
    if (path) {
      shell.showItemInFolder(path)
      return true
    }
    // Fallback: open the shows directory
    const err = await shell.openPath(showManager.getDefaultShowsDir())
    return err === ''
  })

  // --- Remote access (Electron only: never reachable from remote clients) ---
  ipcMain.handle(IPC.REMOTE_GET_SETTINGS, () => {
    return remoteSettings.get()
  })

  ipcMain.handle(IPC.REMOTE_SET_SETTINGS, (_event, settings: unknown) => {
    return remoteSettings.set(settings)
  })

  ipcMain.handle(IPC.REMOTE_GET_STATUS, () => {
    return getRemoteStatus()
  })

  // --- App ---
  ipcMain.handle(IPC.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  // Follow panel: game controllers the OS sees (why Chromium shows none)
  ipcMain.handle(IPC.APP_GAME_CONTROLLERS, () => listGameControllers())

  // Settings › Touchscreens (Linux): the touch helper's report / re-map.
  // Console only — the web remote never reaches these.
  const touchDirs = (): HelperDirs => ({
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    appPath: app.getAppPath(),
    mainDir: __dirname
  })
  ipcMain.handle(IPC.SYSTEM_TOUCH_REPORT, () => touchReport({ dirs: touchDirs() }))
  ipcMain.handle(IPC.SYSTEM_TOUCH_REMAP, () => touchRemap({ dirs: touchDirs() }))

  // Touchscreen setup: panels ↔ screens, orientation, calibration, wizards.
  // Console only (the web remote never reaches ipcMain). Never throws.
  const touch = new TouchSetupService({
    deps: () => ({}),
    language: () => menuLanguage,
    preloadPath: join(__dirname, '../preload/touch-overlay.mjs'),
    // At start / on device changes: once PhotonBoard owns the setup (touch.json), or on the Pi kiosk
    autoApply: () => existsSync(touchConfigPath()) || existsSync(INSTALLED_TOUCH_HELPER) || process.env.PB_TOUCH_AUTO_APPLY === '1',
    focusConsole: () => getMainWindow()?.focus(),
    log: (...args) => safeLog('log', ...args)
  })
  touchSetup = touch
  const touchFailure = (e: unknown) => ({ ok: false, reason: 'error' as const, error: e instanceof Error ? e.message : String(e) })
  ipcMain.handle(IPC.TOUCH_SETUP_LIST, () => touch.list())
  ipcMain.handle(IPC.TOUCH_SETUP_SAVE, (_event, config: unknown) => touch.save(config))
  ipcMain.handle(IPC.TOUCH_SETUP_RESET, (_event, which: unknown) => touch.reset(which))
  ipcMain.handle(IPC.TOUCH_SETUP_IDENTIFY, () => touch.identify().catch((e) => ({ ...touchFailure(e), assignments: [] })))
  ipcMain.handle(IPC.TOUCH_SETUP_CALIBRATE, (_event, port: unknown) => touch.calibrate(port).catch(touchFailure))
  ipcMain.handle(IPC.TOUCH_SETUP_TEST, () => touch.test().catch((e) => ({ ...touchFailure(e), touches: {} })))

  // --- USB sticks (removable-drives.ts) ---
  ipcMain.handle(IPC.REMOVABLE_LIST, (_event, refresh: unknown) => listRemovable(refresh === true))

  /** Copy a show from a stick into the shows folder, then open that copy */
  const importFromDrive = async (path: string, overwrite: boolean): Promise<ShowLoadResult> => {
    const read = await showManager.readShow(path)
    if (!read.success || !read.show) return { ...read, path }
    await showManager.runShowReadHook(read.show)
    const name = basename(path).replace(/\.pbshow$/i, '')
    let target: string
    try { target = showManager.pathForName(name) } catch (e) { return { success: false, error: (e as Error).message } }
    if (!overwrite && existsSync(target)) return { success: false, exists: true, path }
    const saved = await showManager.saveAs({ ...read.show, name }, target)
    if (!saved.success) return { success: false, error: saved.error, path }
    return { success: true, show: { ...read.show, name }, path: target }
  }

  ipcMain.handle(IPC.REMOVABLE_IMPORT_SHOW, async (_event, path: unknown, opts?: { overwrite?: unknown }): Promise<ShowLoadResult> => {
    const drives = await drivesFor(path)
    if (!isInsideDrive(path, drives) || !/\.pbshow$/i.test(path)) return { success: false, error: mt('usbNotOnStick') }
    return importFromDrive(path, opts?.overwrite === true)
  })

  ipcMain.handle(IPC.REMOVABLE_BROWSE, async (event, drivePath: unknown): Promise<ShowLoadResult> => {
    const drives = removable ? await removable.refresh() : []
    const start = driveOf(drivePath, drives) ?? drives.find((d) => d.shows.length > 0) ?? drives[0]
    const result = await showOpenDialog(event, {
      filters: [{ name: mt('showFileFilter'), extensions: ['pbshow'] }],
      defaultPath: start?.path ?? showManager.getDefaultShowsDir(),
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true }
    const file = result.filePaths[0]
    if (isInsideDrive(file, drives)) return importFromDrive(file, false)
    return showManager.load(file)
  })

  ipcMain.handle(IPC.REMOVABLE_SAVE_COPY, async (_event, drivePath: unknown, showArg: unknown, opts?: { overwrite?: unknown }): Promise<ShowSaveResult> => {
    const drives = await drivesFor(drivePath)
    const drive = driveOf(drivePath, drives)
    if (!drive) return { success: false, error: mt('usbNotOnStick') }
    let show
    try { show = parseShowArg(showArg) } catch (e) { return { success: false, error: (e as Error).message } }
    const file = join(drive.path, copyFileName(show.name))
    if (opts?.overwrite !== true && existsSync(file)) return { success: false, exists: true, path: file }
    try {
      await atomicWriteFile(file, JSON.stringify({ ...show, modifiedAt: new Date().toISOString() }, null, 2))
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      return { success: false, error: err.code === 'ENOSPC' ? mt('usbFull') : err.code === 'EROFS' || err.code === 'EACCES' ? mt('usbReadOnly') : err.message }
    }
    void removable?.refresh()
    return { success: true, path: file }
  })

  ipcMain.handle(IPC.REMOVABLE_EJECT, (_event, drivePath: unknown) => ejectRemovable(drivePath))

  /** A text file (touchscreen diagnostic…) at the ROOT of a listed stick */
  ipcMain.handle(IPC.REMOVABLE_SAVE_TEXT, async (_event, drivePath: unknown, fileName: unknown, text: unknown): Promise<ShowSaveResult> => {
    const drives = await drivesFor(drivePath)
    const drive = driveOf(drivePath, drives)
    if (!drive || drive.path !== drivePath) return { success: false, error: mt('usbNotOnStick') }
    const name = safeTextFileName(fileName)
    if (!name || typeof text !== 'string' || text.length > 8 * 1024 * 1024) return { success: false, error: mt('usbInvalidFile') }
    const file = join(drive.path, name)
    try {
      await atomicWriteFile(file, text)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      return { success: false, error: err.code === 'ENOSPC' ? mt('usbFull') : err.code === 'EROFS' || err.code === 'EACCES' ? mt('usbReadOnly') : err.message }
    }
    void removable?.refresh()
    return { success: true, path: file }
  })

  ipcMain.on(IPC.APP_QUIT, () => {
    app.quit()
  })

  // Console UI language → native menus
  ipcMain.on(IPC.APP_SET_LANGUAGE, (_event, locale: unknown) => {
    const next: MenuLanguage = locale === 'fr' ? 'fr' : 'en'
    // Dialogs, show file errors and remote answers follow it too
    setMainLanguage(next)
    if (next !== savedLanguage) {
      // Remembered for the next start (splash tagline, native menus before the UI loads)
      savedLanguage = next
      try { saveJsonConfig(languageConfigPath(), { language: next }) } catch (e) { safeLog('warn', '[Main] Could not save the UI language:', (e as Error).message) }
    }
    if (next === menuLanguage) return
    menuLanguage = next
    createMenu()
  })

  // --- Stage Window ---
  ipcMain.on(IPC.STAGE_OPEN, () => {
    createStageWindow()
  })

  ipcMain.on(IPC.STAGE_CLOSE, () => {
    stageWindow?.close()
  })

  // Main renderer sends state snapshots for stage window
  ipcMain.on(IPC.STAGE_SYNC, (_event, state: unknown) => {
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.webContents.send(IPC.STAGE_SYNC, state)
    }
  })

  // Stage window sends commands to main renderer
  ipcMain.on(IPC.STAGE_COMMAND, (_event, command: unknown) => {
    if (command && typeof command === 'object') sendToMainWindow(IPC.STAGE_COMMAND, command)
  })

  // API: renderer sends state for WebSocket broadcast (each server throttles)
  ipcMain.on(IPC.API_STATE, (_event, state: unknown) => {
    broadcastState(state)
    broadcastToWeb(state)
  })
}

// --- Stage Window ---

function getStageDisplay(): Electron.Display {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  return displays.find(d => d.id !== primary.id) || primary
}

function createStageWindow(): void {
  if (stageWindow) {
    stageWindow.focus()
    return
  }

  const display = getStageDisplay()
  const { x, y, width, height } = display.bounds

  const win = new BrowserWindow({
    x, y, width, height,
    fullscreen: true,
    frame: false,
    backgroundColor: '#0a0a0f',
    title: mt('stageWindowTitle'),
    webPreferences: {
      preload: join(__dirname, '../preload/stage-preload.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  stageWindow = win

  // Load the stage window renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/stage-window/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/stage-window/index.html'))
  }

  // Disable zoom
  win.webContents.setVisualZoomLevelLimits(1, 1)

  win.on('closed', () => {
    if (stageWindow === win) stageWindow = null
    stopStageSync()
  })

  // Start syncing state to stage window
  startStageSync()

  safeLog('log', `[Main] Stage window opened on display: ${display.label || display.id} (${width}x${height})`)
}

function toggleStageWindow(): void {
  if (stageWindow) {
    stageWindow.close()
  } else {
    createStageWindow()
  }
}

function startStageSync(): void {
  if (stageSyncInterval) return

  // 30Hz sync — Pi 5 handles this fine
  stageSyncInterval = setInterval(() => {
    if (!stageWindow) return
    // Request state from main renderer
    sendToMainWindow(IPC.STAGE_REQUEST_STATE)
  }, 33)
}

function stopStageSync(): void {
  if (stageSyncInterval) {
    clearInterval(stageSyncInterval)
    stageSyncInterval = null
  }
}

// --- App Lifecycle ---

/** Stop servers and outputs (once). Called from will-quit, which covers Cmd+Q too. */
async function cleanup(): Promise<void> {
  stopStageSync()
  touchSetup?.dispose()
  piSave?.dispose()
  stopApiServer()
  stopWebServer()
  dmxEngine?.stop()
  removable?.stop()
  if (outputManager) {
    // Never hang the quit on a stuck serial port
    await Promise.race([
      outputManager.destroy().catch((e) => safeLog('error', '[Main] Output shutdown failed:', e)),
      new Promise<void>(resolve => setTimeout(resolve, 2000))
    ])
  }
}

function languageConfigPath(): string {
  return join(app.getPath('userData'), 'config', 'ui.json')
}

let savedLanguage: MenuLanguage | null = null

/**
 * UI language at start-up, before the console UI says which one it uses:
 * the last one it reported, else what the UI picks on 'auto' (French on
 * the Pi kiosk, else the system language).
 */
function startupLanguage(): MenuLanguage {
  const loaded = loadJsonConfig<MenuLanguage>(
    languageConfigPath(),
    (raw) => {
      const lang = (raw as { language?: unknown } | null)?.language
      return lang === 'fr' || lang === 'en' ? { ok: true, value: lang } : { ok: false, error: 'not a language' }
    },
    () => {
      if (process.platform === 'linux' && /^arm/.test(process.arch)) return 'fr'
      return app.getLocale().toLowerCase().startsWith('fr') ? 'fr' : 'en'
    }
  )
  if (loaded.source !== 'default') savedLanguage = loaded.value
  return loaded.value
}

function startApp(): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))

  app.on('second-instance', () => {
    // Someone launched PhotonBoard again (double-click, autostart): focus the running one
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else if (app.isReady()) {
      createWindow()
    }
  })

  app.whenReady().then(() => {
    menuLanguage = startupLanguage()
    setMainLanguage(menuLanguage)
    // First thing on screen: the splash, on the display the console opens on
    if (!splashDisabled()) {
      try {
        splash = openSplash({
          // Not app.getVersion(): run as `electron out/main/index.js` (dev, tests) it is Electron's version
          version: app.isPackaged ? app.getVersion() : String(pkg.version),
          language: menuLanguage,
          display: screen.getPrimaryDisplay().bounds,
          cover: process.platform === 'linux'
        })
      } catch (e) {
        safeLog('warn', '[Main] Splash screen unavailable:', (e as Error).message)
        splash = null
      }
    }
    const userData = app.getPath('userData')
    showManager = new ShowFileManager(userData)
    // The user library (OFL downloads, imports, installed catalog fixtures) survives restarts
    showManager.scanFixtures(join(userData, 'fixtures'))
    oflService = new OFLService()
    fixtureCatalog = new FixtureCatalog(defaultCatalogDirs({
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      appPath: app.getAppPath(),
      mainDir: __dirname
    }))
    void fixtureCatalog.load() // index in the background: the first search is instant
    interchange = createInterchangeHost({ getLibrary: () => showManager.getAllFixtures(), catalog: fixtureCatalog })
    demos = new DemoLibrary(defaultDemoDirs({
      resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
      appPath: app.getAppPath(),
      mainDir: __dirname
    }))
    // A show made on another machine: install the fixture types it uses from the catalog
    showManager.setShowReadHook((show) => installMissingShowFixtures(fixtureCatalog, showManager, show))
    remoteSettings = new RemoteSettingsStore(join(userData, 'config', 'remote.json'))
    piSave = new PiSaveCoordinator((command) => sendToMainWindow(IPC.STAGE_COMMAND, command))
    initDmxEngine()
    registerIpcHandlers()
    startRemovableWatcher()
    setupPermissions()
    createMenu()
    createWindow()
    // Touch panels → screens (saved setup / automatic), and again when input devices change
    if (process.platform === 'linux') touchSetup?.startAutoApply()

    // Remote clients must re-authenticate when the PIN is turned on or changed
    remoteSettings.onChange((next, prev) => {
      if (next.pinEnabled && (!prev.pinEnabled || next.pin !== prev.pin)) {
        disconnectWebClients('PIN changed')
        disconnectApiClients('PIN changed')
      }
    })

    // WebSocket API for Companion / external controllers. Both servers look up
    // the CURRENT main window on every use (it is recreated on macOS activate).
    startApiServer({ getMainWindow, getRemoteSettings: () => remoteSettings.get() })
    // Web server for remote editing from a Mac/tablet
    startWebServer({
      // Same files the console window loads (works in dev, unpacked and asar builds)
      rendererPath: join(__dirname, '../renderer'),
      getRemoteSettings: () => remoteSettings.get(),
      dmxEngine,
      outputManager: outputManager!,
      showManager,
      oflService,
      fixtureCatalog,
      piSave,
      userDataPath: userData,
      getVersion: () => app.getVersion(),
      getRemoteStatus,
      sendToRenderer: (channel, ...args) => { sendToMainWindow(channel, ...args) },
      removable: { list: listRemovable, eject: ejectRemovable },
      interchange
    })

    // Auto-open Stage window on second display if available
    const displays = screen.getAllDisplays()
    if (displays.length > 1) {
      safeLog('log', `[Main] ${displays.length} displays detected — auto-opening Stage window`)
      createStageWindow()
    }
  })

  // macOS: closing the window keeps the app (and DMX output, servers) alive;
  // other platforms quit.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (app.isReady() && !getMainWindow()) createWindow()
  })

  app.on('will-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    cleanup().finally(() => {
      cleanedUp = true
      // app.quit() is not reliably honoured once will-quit was prevented;
      // all windows are closed and resources released at this point.
      app.exit(0)
    })
  })
}

// One PhotonBoard per machine: two instances would fight over the DMX
// adapters and the 9090/9091 ports. (The screenshot harness runs several
// throw-away instances side by side, so it opts out.)
if (process.env.PHOTONBOARD_HEADLESS_TEST !== '1' && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  startApp()
}
