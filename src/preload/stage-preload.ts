import { contextBridge, ipcRenderer } from 'electron'
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
  // Receive state sync from main window
  onStateSync: (callback: (state: StageState) => void) => {
    ipcRenderer.on(IPC.STAGE_SYNC, (_event, state: StageState) => {
      callback(state)
    })
  },

  // Send a command to the main window
  sendCommand: (command: StageCommand) => {
    ipcRenderer.send(IPC.STAGE_COMMAND, command)
  },

  // Request close
  close: () => {
    ipcRenderer.send(IPC.STAGE_CLOSE)
  }
}

contextBridge.exposeInMainWorld('stageApi', api)

export type StageAPI = typeof api
