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
  /** Executor layout of the console's CURRENT page (legacy view: scene cells only) */
  executorGrid: (string | null)[][]
  executorColumns: { title: string; color: string }[]
  executorModes: string[][]
  // --- v3 (pro programming) ---
  /** Executor page shown on the console (0-based) */
  executorPage?: number
  /** Executor pages ('' name = default "Page n") */
  pages?: { id: string; name: string }[]
  blind?: boolean
  highlight?: boolean
  speedMasters?: { id: string; number: number; name: string; bpm: number }[]
  /** Group master levels (0-255; missing = 255) */
  groupMasters?: Record<string, number>
  /** What each column fader shows, "page:col" → 0-255 */
  columnFaders?: Record<string, number>
  /** Last command lines run on the console, oldest first */
  cliLog?: { id: number; time: number; text: string; ok: boolean; message: string; level: 'info' | 'warning' | 'error'; origin?: string }[]
}

/**
 * Touch surface data (every executor page with its cells, stage pages,
 * pools), sent on the same channel when it changes:
 * `{ __stageSurface: SurfaceData }` (renderer/components/stage/pages/surface-data.ts)
 */
export interface StageSurfaceMessage {
  __stageSurface: unknown
}

export type StageSyncMessage = StageState | StageSurfaceMessage

const api = {
  // Receive state sync (snapshots and surface messages) from main window. Returns the unsubscribe function.
  onStateSync: (callback: (state: StageSyncMessage) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: StageSyncMessage) => callback(state)
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
