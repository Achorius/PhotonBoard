import { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } from 'electron'
import { join } from 'path'
import { DmxEngine } from './dmx-engine'
import { ArtNetOutput } from './artnet-output'
import { ShowFileManager } from './show-file'
import { IPC, type ArtNetConfig, type ShowFile } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let dmxEngine: DmxEngine
let artnetOutput: ArtNetOutput
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

  // Dev or production
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function initDmxEngine(): void {
  dmxEngine = new DmxEngine(3) // 3 universes
  artnetOutput = new ArtNetOutput()

  // Start the DMX output loop at ~40Hz
  dmxEngine.onFrame((universes) => {
    artnetOutput.send(universes)
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

  // --- ArtNet ---
  ipcMain.handle(IPC.ARTNET_CONFIGURE, (_event, configs: ArtNetConfig[]) => {
    artnetOutput.configure(configs)
    return true
  })

  ipcMain.handle(IPC.ARTNET_GET_STATUS, () => {
    return artnetOutput.getStatus()
  })

  // --- Show File ---
  ipcMain.handle(IPC.SHOW_NEW, () => {
    return showManager.newShow()
  })

  ipcMain.handle(IPC.SHOW_SAVE, async (_event, show: ShowFile) => {
    console.log('[Main] SHOW_SAVE called, patch entries:', show?.patch?.length)
    const saveResult = showManager.save(show)
    if (saveResult.needsSaveAs) {
      const defaultDir = showManager.getDefaultShowsDir()
      console.log('[Main] First save, opening dialog in:', defaultDir)
      const result = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
        defaultPath: join(defaultDir, `${show.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pbshow`)
      })
      if (result.canceled || !result.filePath) return null
      const saveAsResult = showManager.saveAs(show, result.filePath)
      console.log('[Main] SaveAs result:', saveAsResult)
      return saveAsResult
    }
    console.log('[Main] Save result:', saveResult)
    return saveResult
  })

  ipcMain.handle(IPC.SHOW_LOAD, async () => {
    const defaultDir = showManager.getDefaultShowsDir()
    console.log('[Main] SHOW_LOAD opening dialog in:', defaultDir)
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
      defaultPath: defaultDir,
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) {
      console.log('[Main] Load cancelled')
      return null
    }
    console.log('[Main] Loading file:', result.filePaths[0])
    const loadResult = showManager.load(result.filePaths[0])
    console.log('[Main] Load result - success:', loadResult.success, 'patch:', loadResult.show?.patch?.length, 'error:', loadResult.error)
    return loadResult
  })

  ipcMain.handle(IPC.SHOW_SAVE_AS, async (_event, show: ShowFile) => {
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
    return showManager.getAllFixtures()
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
  artnetOutput?.destroy()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
