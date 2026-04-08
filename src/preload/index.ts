import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { ArtNetConfig, DmxOutputConfig, ShowFile } from '../shared/types'

// Single callback registry — guarantees ONE handler per menu channel
const menuHandlers: Record<string, () => void> = {}

// Register IPC listeners ONCE in preload, route to current handler
for (const channel of ['menu:new', 'menu:save', 'menu:save-as', 'menu:load']) {
  ipcRenderer.on(channel, () => {
    const handler = menuHandlers[channel]
    if (handler) handler()
  })
}

const api = {
  // --- DMX ---
  dmx: {
    setChannel: (universe: number, channel: number, value: number) =>
      ipcRenderer.send(IPC.DMX_SET_CHANNEL, universe, channel, value),
    setChannels: (universe: number, channels: Record<number, number>) =>
      ipcRenderer.send(IPC.DMX_SET_CHANNELS, universe, channels),
    getValues: (universe: number): Promise<number[]> =>
      ipcRenderer.invoke(IPC.DMX_GET_VALUES, universe),
    blackout: () =>
      ipcRenderer.send(IPC.DMX_BLACKOUT)
  },

  // --- ArtNet ---
  artnet: {
    configure: (configs: ArtNetConfig[]): Promise<boolean> =>
      ipcRenderer.invoke(IPC.ARTNET_CONFIGURE, configs),
    getStatus: (): Promise<{ connected: boolean; senders: { universe: number; host: string }[] }> =>
      ipcRenderer.invoke(IPC.ARTNET_GET_STATUS)
  },

  // --- DMX Outputs (multi-output system) ---
  dmxOutputs: {
    configure: (configs: DmxOutputConfig[]): Promise<boolean> =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_CONFIGURE, configs),
    getStatus: (): Promise<any> =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_GET_STATUS),
    scanUsb: (): Promise<any[]> =>
      ipcRenderer.invoke(IPC.DMX_OUTPUTS_SCAN_USB)
  },

  // --- Show ---
  show: {
    new: (): Promise<ShowFile> =>
      ipcRenderer.invoke(IPC.SHOW_NEW),
    save: (show: ShowFile): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.SHOW_SAVE, JSON.stringify(show)),
    load: (): Promise<{ success: boolean; show?: ShowFile; error?: string } | null> =>
      ipcRenderer.invoke(IPC.SHOW_LOAD),
    saveAs: (show: ShowFile): Promise<{ success: boolean; path?: string; error?: string } | null> =>
      ipcRenderer.invoke(IPC.SHOW_SAVE_AS, JSON.stringify(show)),
    getRecent: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.SHOW_GET_RECENT),
    loadLast: (): Promise<{ success: boolean; show?: any; path?: string }> =>
      ipcRenderer.invoke(IPC.SHOW_LOAD_LAST),
    getPath: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SHOW_GET_PATH),
    reveal: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SHOW_REVEAL)
  },

  // --- Fixtures ---
  fixtures: {
    scan: (): Promise<any[]> =>
      ipcRenderer.invoke(IPC.FIXTURES_SCAN),
    getAll: async (): Promise<any[]> => {
      const json = await ipcRenderer.invoke(IPC.FIXTURES_GET_ALL)
      return JSON.parse(json)
    },
    import: (): Promise<any[] | null> =>
      ipcRenderer.invoke(IPC.FIXTURES_IMPORT)
  },

  // --- Menu event listeners (replaces handler, guarantees single callback) ---
  onMenuEvent: (channel: string, callback: () => void) => {
    menuHandlers[channel] = callback
    return () => { delete menuHandlers[channel] }
  },

  // --- App ---
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC.APP_GET_VERSION)
  }
}

contextBridge.exposeInMainWorld('photonboard', api)

export type PhotonBoardAPI = typeof api
