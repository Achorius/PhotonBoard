import { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } from 'electron'
import { join } from 'path'
import { DmxEngine } from './dmx-engine'
import { DmxOutputManager } from './dmx-output-manager'
import { ShowFileManager } from './show-file'
import { IPC, type ArtNetConfig, type DmxOutputConfig, type ShowFile } from '../shared/types'

// Prevent EPIPE crashes when stdout pipe is closed (e.g. terminal closed during dev)
process.on('uncaughtException', (err) => {
  if (err.message === 'write EPIPE') return // silently ignore
  console.error('[Main] Uncaught exception:', err)
})
process.stdout?.on('error', () => { /* ignore EPIPE */ })
process.stderr?.on('error', () => { /* ignore EPIPE */ })

let mainWindow: BrowserWindow | null = null
let dmxEngine: DmxEngine
let outputManager: DmxOutputManager
let showManager: ShowFileManager

function createMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Show',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new')
        },
        { type: 'separator' },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:load')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:save-as')
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    }
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow(): void {
  // Grant MIDI permissions BEFORE creating the window (required for Web MIDI in Electron 33+)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(true) // Grant all permissions (midi, midiSysex, etc.)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Disable Electron's built-in scroll-to-zoom (we handle zoom ourselves in canvas)
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomLevel(0)
    mainWindow?.webContents.setZoomFactor(1)
  })

  // Dev or production
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Forward renderer console to main stdout for debugging (safe against EPIPE)
  const safelog = (...args: any[]) => {
    try { console.log(...args) } catch (_) { /* pipe closed */ }
  }
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      safelog('[Renderer:ERR]', message)
    } else if (message.includes('[PhotonBoard]') || message.includes('[MIDI]') || message.includes('patch') || message.includes('Patch')) {
      safelog('[Renderer]', message)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function initDmxEngine(): void {
  dmxEngine = new DmxEngine(3) // 3 universes
  outputManager = new DmxOutputManager()

  // Start the DMX output loop at ~40Hz — sends to all active outputs (ArtNet + USB)
  dmxEngine.onFrame((universes) => {
    outputManager.send(universes)
  })
  dmxEngine.start()
}

function registerIpcHandlers(): void {
  // --- DMX ---
  ipcMain.on(IPC.DMX_SET_CHANNEL, (_event, universe: number, channel: number, value: number) => {
    dmxEngine.setChannel(universe, channel, value)
  })

  ipcMain.on(IPC.DMX_SET_CHANNELS, (_event, universe: number, channels: Record<number, number>) => {
    for (const [ch, val] of Object.entries(channels)) {
      dmxEngine.setChannel(universe, parseInt(ch), val)
    }
  })

  ipcMain.handle(IPC.DMX_GET_VALUES, (_event, universe: number) => {
    return Array.from(dmxEngine.getUniverse(universe))
  })

  ipcMain.on(IPC.DMX_BLACKOUT, () => {
    dmxEngine.blackout()
  })

  // --- ArtNet (legacy compat) ---
  ipcMain.handle(IPC.ARTNET_CONFIGURE, (_event, configs: ArtNetConfig[]) => {
    outputManager.configureArtnet(configs)
    return true
  })

  ipcMain.handle(IPC.ARTNET_GET_STATUS, () => {
    return outputManager.getArtnetStatus()
  })

  // --- DMX Outputs (multi-output system) ---
  ipcMain.handle(IPC.DMX_OUTPUTS_CONFIGURE, async (_event, configs: DmxOutputConfig[]) => {
    await outputManager.configure(configs)
    return true
  })

  ipcMain.handle(IPC.DMX_OUTPUTS_GET_STATUS, () => {
    return outputManager.getStatus()
  })

  ipcMain.handle(IPC.DMX_OUTPUTS_SCAN_USB, async () => {
    return outputManager.scanUsbPorts()
  })

  // --- Show File ---
  ipcMain.handle(IPC.SHOW_NEW, () => {
    return showManager.newShow()
  })

  ipcMain.handle(IPC.SHOW_SAVE, async (_event, showJson: string) => {
    const show: ShowFile = JSON.parse(showJson)
    const saveResult = showManager.save(show)
    if (saveResult.needsSaveAs) {
      const defaultDir = showManager.getDefaultShowsDir()
      const result = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
        defaultPath: join(defaultDir, `${show.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`)
      })
      if (result.canceled || !result.filePath) return null
      return showManager.saveAs(show, result.filePath)
    }
    return saveResult
  })

  ipcMain.handle(IPC.SHOW_LOAD, async () => {
    const defaultDir = showManager.getDefaultShowsDir()
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
      defaultPath: defaultDir,
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    const loadResult = showManager.load(result.filePaths[0])
    return { ...loadResult, path: result.filePaths[0] }
  })

  ipcMain.handle(IPC.SHOW_SAVE_AS, async (_event, showJson: string) => {
    const show: ShowFile = JSON.parse(showJson)
    const defaultDir = showManager.getDefaultShowsDir()
    const currentPath = showManager.getCurrentPath()
    const result = await dialog.showSaveDialog(mainWindow!, {
      filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
      defaultPath: currentPath || join(defaultDir, `${show.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`)
    })
    if (result.canceled || !result.filePath) return null
    return showManager.saveAs(show, result.filePath)
  })

  ipcMain.handle(IPC.SHOW_GET_RECENT, () => {
    return showManager.getRecent()
  })

  // --- Fixtures ---
  ipcMain.handle(IPC.FIXTURES_SCAN, () => {
    const fixturesDir = join(app.getPath('userData'), 'fixtures')
    return showManager.scanFixtures(fixturesDir)
  })

  ipcMain.handle(IPC.FIXTURES_GET_ALL, () => {
    // Return as JSON string to avoid Electron structured clone dropping multi-cell fixtures
    const fixtures = showManager.getAllFixtures()
    const result: any[] = []
    for (const f of fixtures) {
      try {
        JSON.stringify(f) // test if this fixture serializes
        result.push(f)
      } catch (e) {
        console.error('[Main] Failed to serialize fixture:', f.id, f.name, (e as Error).message)
      }
    }
    return JSON.stringify(result)
  })

  ipcMain.handle(IPC.FIXTURES_IMPORT, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        { name: 'Fixture Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || !result.filePaths.length) return null
    const results: any[] = []
    for (const filePath of result.filePaths) {
      results.push(showManager.importFixtureFile(filePath))
    }
    return results
  })

  // --- Show helpers ---
  ipcMain.handle(IPC.SHOW_GET_PATH, () => {
    return showManager.getCurrentPath()
  })

  ipcMain.handle(IPC.SHOW_LOAD_LAST, () => {
    return showManager.loadLastShow()
  })

  ipcMain.handle(IPC.SHOW_REVEAL, () => {
    const path = showManager.getCurrentPath()
    if (path) {
      shell.showItemInFolder(path)
      return true
    }
    // Fallback: open shows directory
    const showsDir = join(app.getPath('userData'), 'shows')
    shell.openPath(showsDir)
    return true
  })

  // --- App ---
  ipcMain.handle(IPC.APP_GET_VERSION, () => {
    return app.getVersion()
  })
}

// --- App Lifecycle ---
app.whenReady().then(() => {
  showManager = new ShowFileManager(app.getPath('userData'))
  initDmxEngine()
  registerIpcHandlers()
  createMenu()
  createWindow()
})

app.on('window-all-closed', () => {
  dmxEngine?.stop()
  outputManager?.destroy()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
