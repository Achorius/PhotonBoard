import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/types'
import type { PhotonBoardAPI, RemoteConnectionState } from '../shared/photonboard-api'

export type { PhotonBoardAPI } from '../shared/photonboard-api'

// Single callback registry — guarantees ONE handler per menu channel
const menuHandlers: Record<string, () => void> = {}

// Register IPC listeners ONCE in preload, route to current handler
for (const channel of ['menu:new', 'menu:save', 'menu:save-as', 'menu:load', 'menu:undo', 'menu:redo']) {
  ipcRenderer.on(channel, () => {
    const handler = menuHandlers[channel]
    if (handler) handler()
  })
}

/** Subscribe to a main → renderer channel; returns the unsubscribe function */
function subscribe<A extends unknown[]>(channel: string, callback: (...args: A) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

const notRemote = (): never => {
  throw new Error('Only available in the remote web UI')
}

const api: PhotonBoardAPI = {
  // --- DMX ---
  dmx: {
    setChannel: (universe, channel, value) =>
      ipcRenderer.send(IPC.DMX_SET_CHANNEL, universe, channel, value),
    setChannels: (universe, channels) =>
      ipcRenderer.send(IPC.DMX_SET_CHANNELS, universe, channels),
    getValues: (universe) =>
      ipcRenderer.invoke(IPC.DMX_GET_VALUES, universe),
    blackout: () =>
      ipcRenderer.send(IPC.DMX_BLACKOUT),
    setStrobeChop: (chop) =>
      ipcRenderer.send(IPC.DMX_STROBE_CHOP, chop)
  },

  // --- ArtNet (legacy: replaces only the Art-Net part of the machine config) ---
  artnet: {
    configure: (configs) =>
      ipcRenderer.invoke(IPC.ARTNET_CONFIGURE, configs),
    getStatus: () =>
      ipcRenderer.invoke(IPC.ARTNET_GET_STATUS)
  },

  // --- DMX Outputs (machine config, owned by main) ---
  dmxOutputs: {
    getConfig: () =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_GET_CONFIG),
    configure: (config) =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_CONFIGURE, config),
    getStatus: () =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_GET_STATUS),
    scanUsb: () =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_SCAN_USB)
  },

  // --- Show ---
  // Shows cross IPC as JSON text (structured clone has dropped fields of large shows before)
  show: {
    new: () =>
      ipcRenderer.invoke(IPC.SHOW_NEW),
    save: (show, opts) =>
      ipcRenderer.invoke(IPC.SHOW_SAVE, JSON.stringify(show), opts ?? {}),
    saveAs: (show, opts) =>
      ipcRenderer.invoke(IPC.SHOW_SAVE_AS, JSON.stringify(show), opts ?? {}),
    load: () =>
      ipcRenderer.invoke(IPC.SHOW_LOAD),
    list: () =>
      ipcRenderer.invoke(IPC.SHOW_LIST),
    loadByName: (name) =>
      ipcRenderer.invoke(IPC.SHOW_LOAD_BY_NAME, name),
    getRecent: () =>
      ipcRenderer.invoke(IPC.SHOW_GET_RECENT),
    loadLast: () =>
      ipcRenderer.invoke(IPC.SHOW_LOAD_LAST),
    getPath: () =>
      ipcRenderer.invoke(IPC.SHOW_GET_PATH),
    reveal: () =>
      ipcRenderer.invoke(IPC.SHOW_REVEAL),
    upload: async () => {
      // In Electron desktop mode, use File > Open instead
      return { success: false, error: 'Use File > Open in desktop mode' }
    },
    // The console IS the current show
    getCurrent: async () => ({ success: false, error: 'Only available in the remote web UI' })
  },

  // --- Fixtures ---
  fixtures: {
    scan: () =>
      ipcRenderer.invoke(IPC.FIXTURES_SCAN),
    getAll: async () => {
      const json = await ipcRenderer.invoke(IPC.FIXTURES_GET_ALL)
      return JSON.parse(json)
    },
    import: () =>
      ipcRenderer.invoke(IPC.FIXTURES_IMPORT),
    oflSearch: (query) =>
      ipcRenderer.invoke(IPC.FIXTURES_OFL_SEARCH, query),
    oflDownload: (manufacturerKey, fixtureKey) =>
      ipcRenderer.invoke(IPC.FIXTURES_OFL_DOWNLOAD, manufacturerKey, fixtureKey),
    save: (fixture) =>
      ipcRenderer.invoke(IPC.FIXTURES_SAVE, JSON.stringify(fixture)),
    delete: (fixtureId) =>
      ipcRenderer.invoke(IPC.FIXTURES_DELETE, fixtureId),
    catalogInfo: () =>
      ipcRenderer.invoke(IPC.FIXTURES_CATALOG_INFO),
    catalogSearch: (query) =>
      ipcRenderer.invoke(IPC.FIXTURES_CATALOG_SEARCH, query),
    // Definitions travel as JSON text (like getAll): structured clone has dropped multi-cell fixtures
    catalogGet: async (id) => {
      const json = await ipcRenderer.invoke(IPC.FIXTURES_CATALOG_GET, id)
      return json ? JSON.parse(json) : null
    },
    catalogInstall: async (id) =>
      JSON.parse(await ipcRenderer.invoke(IPC.FIXTURES_CATALOG_INSTALL, id))
  },

  // --- Menu event listeners (replaces handler, guarantees single callback) ---
  onMenuEvent: (channel, callback) => {
    menuHandlers[channel] = callback
    return () => {
      // Only remove if a newer handler has not replaced this one
      if (menuHandlers[channel] === callback) delete menuHandlers[channel]
    }
  },

  // --- App ---
  app: {
    getVersion: () =>
      ipcRenderer.invoke(IPC.APP_GET_VERSION),
    quit: () =>
      ipcRenderer.send(IPC.APP_QUIT),
    setLanguage: (locale) =>
      ipcRenderer.send(IPC.APP_SET_LANGUAGE, locale),
    gameControllers: () =>
      ipcRenderer.invoke(IPC.APP_GAME_CONTROLLERS)
  },

  // --- USB sticks ---
  removable: {
    list: (refresh) =>
      ipcRenderer.invoke(IPC.REMOVABLE_LIST, !!refresh),
    onChange: (callback) =>
      subscribe(IPC.REMOVABLE_CHANGED, callback),
    importShow: (path, opts) =>
      ipcRenderer.invoke(IPC.REMOVABLE_IMPORT_SHOW, path, opts ?? {}),
    browse: (drivePath) =>
      ipcRenderer.invoke(IPC.REMOVABLE_BROWSE, drivePath),
    saveCopy: (drivePath, show, opts) =>
      ipcRenderer.invoke(IPC.REMOVABLE_SAVE_COPY, drivePath, JSON.stringify(show), opts ?? {}),
    eject: (drivePath) =>
      ipcRenderer.invoke(IPC.REMOVABLE_EJECT, drivePath)
  },

  // --- Stage Window ---
  stage: {
    open: () => ipcRenderer.send(IPC.STAGE_OPEN),
    close: () => ipcRenderer.send(IPC.STAGE_CLOSE),
    sendState: (state) => ipcRenderer.send(IPC.STAGE_SYNC, state),
    onCommand: (callback) => subscribe(IPC.STAGE_COMMAND, callback),
    onRequestState: (callback) => subscribe(IPC.STAGE_REQUEST_STATE, () => callback())
  },

  // --- API (WebSocket servers for Companion / web remote) ---
  api: {
    sendState: (state) => ipcRenderer.send(IPC.API_STATE, state),
    onRequestState: (callback) => subscribe(IPC.API_REQUEST_STATE, () => callback())
  },

  // --- Remote access ---
  // In Electron this IS the console: settings are editable here (and only here);
  // the browser-only methods are inert.
  remote: {
    isRemote: false,
    getSettings: () =>
      ipcRenderer.invoke(IPC.REMOTE_GET_SETTINGS),
    setSettings: (settings) =>
      ipcRenderer.invoke(IPC.REMOTE_SET_SETTINGS, settings),
    getStatus: () =>
      ipcRenderer.invoke(IPC.REMOTE_GET_STATUS),
    sendCommand: () => { /* only meaningful in the remote web UI */ },
    onState: () => () => {},
    authenticate: async () => notRemote(),
    onConnectionChange: (callback: (state: RemoteConnectionState) => void) => {
      callback('open')
      return () => {}
    },
    getConnectionState: () => 'open',
    // Large shows cross IPC as JSON text (see show.save)
    replyToMain: (requestId, data) => ipcRenderer.send(IPC.CONSOLE_REPLY, requestId, JSON.stringify(data ?? null))
  }
}

contextBridge.exposeInMainWorld('photonboard', api)
