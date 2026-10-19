import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/types'

export interface StageCommand {
  type: string
  payload?: any
}

export interface StageState {
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  timelinePlaying: boolean
  showName: string
  cuelists: {
    id: string
    name: string
    isPlaying: boolean
    faderLevel: number
    currentCueIndex: number
    cueCount: number
  }[]
  groups: {
    id: string
    name: string
    color: string
    fixtureCount: number
  }[]
  selectedFixtureIds: string[]
  fixtureCount: number
  executorGrid: (string | null)[][]
  executorColumns: { title: string; color: string }[]
  executorModes: string[][]
}

const api = {
  // Receive state sync from main window. Returns the unsubscribe function.
  onStateSync: (callback: (state: StageState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: StageState) => callback(state)
    ipcRenderer.on(IPC.STAGE_SYNC, listener)
    return () => { ipcRenderer.removeListener(IPC.STAGE_SYNC, listener) }
  },

  // Send a command to the main window (see src/shared/remote-commands.ts)
  sendCommand: (command: StageCommand): void => {
    ipcRenderer.send(IPC.STAGE_COMMAND, command)
  },

  // Request close
  close: () => {
    ipcRenderer.send(IPC.STAGE_CLOSE)
  }
}

contextBridge.exposeInMainWorld('stageApi', api)

export type StageAPI = typeof api
