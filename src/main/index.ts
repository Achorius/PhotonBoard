import { app, BrowserWindow, ipcMain, dialog, session } from 'electron'
import { join } from 'path'
import { DmxEngine } from './dmx-engine'
import { ArtNetOutput } from './artnet-output'
import { ShowFileManager } from './show-file'
import { IPC, type ArtNetConfig, type ShowFile } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let dmxEngine: DmxEngine
let artnetOutput: ArtNetOutput
let showManager: ShowFileManager

function createWindow(): void {
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

  // Grant MIDI permissions automatically
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'midi' || permission === 'midiSysex') {
      callback(true)
    } else {
      callback(true)
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

  ipcMain.handle(IPC.SHOW_SAVE, (_event, show: ShowFile) => {
    return showManager.save(show)
  })

  ipcMain.handle(IPC.SHOW_LOAD, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    return showManager.load(result.filePaths[0])
  })

  ipcMain.handle(IPC.SHOW_SAVE_AS, async (_event, show: ShowFile) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      filters: [{ name: 'PhotonBoard Show', extensions: ['pbshow'] }],
      defaultPath: `${show.name}.pbshow`
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
