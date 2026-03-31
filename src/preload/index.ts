import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { ArtNetConfig, ShowFile } from '../shared/types'

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

  // --- Show ---
  show: {
    new: (): Promise<ShowFile> =>
      ipcRenderer.invoke(IPC.SHOW_NEW),
    save: (show: ShowFile): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.SHOW_SAVE, show),
    load: (): Promise<{ success: boolean; show?: ShowFile; error?: string } | null> =>
      ipcRenderer.invoke(IPC.SHOW_LOAD),
    saveAs: (show: ShowFile): Promise<{ success: boolean; path?: string; error?: string } | null> =>
      ipcRenderer.invoke(IPC.SHOW_SAVE_AS, show),
    getRecent: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.SHOW_GET_RECENT)
  },

  // --- Fixtures ---
  fixtures: {
    scan: (): Promise<any[]> =>
      ipcRenderer.invoke(IPC.FIXTURES_SCAN),
    getAll: (): Promise<any[]> =>
      ipcRenderer.invoke(IPC.FIXTURES_GET_ALL)
  },

  // --- App ---
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC.APP_GET_VERSION)
  }
}

contextBridge.exposeInMainWorld('photonboard', api)

export type PhotonBoardAPI = typeof api
