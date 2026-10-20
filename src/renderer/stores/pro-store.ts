// ============================================================
// PhotonBoard — Pro programming runtime state (per machine, never
// saved, never undone): Blind, Highlight, programmer time, the
// command-line log and the selected executor (GO / Back target).
// Published in the state snapshot (blind, highlight, cliLog).
// ============================================================

import { create } from 'zustand'
import type { ExecutorRef, ProgTime } from '@renderer/lib/pro/contracts'

/** Lines kept in the command-line log */
export const CLI_LOG_LIMIT = 50

export interface CliLogEntry {
  id: number
  /** Epoch ms */
  time: number
  /** The line as typed */
  text: string
  ok: boolean
  /** Result message (already translated) */
  message: string
  level: 'info' | 'warning' | 'error'
  /** Where it came from: undefined = this console; a remote page id; 'macro' */
  origin?: string
}

interface ProState {
  /** Blind: programmer edits do not reach the output (preview only) */
  blind: boolean
  /** Highlight the selected fixtures */
  highlight: boolean
  /** Programmer fade / delay for new values (null = none) */
  progTime: ProgTime | null
  /** Last CLI_LOG_LIMIT command lines, oldest first */
  cliLog: CliLogEntry[]
  /** Executor GO / Back act on (null = the Scenes view selection) */
  selectedExecutor: ExecutorRef | null
  /**
   * What every column fader shows (0-255), key "page:col" (0-based), for
   * the columns whose fader drives something. Computed on the console
   * (lib/pro/column-fader-sync.ts: column levels, cell levels, GM, group
   * and speed masters, rates), mirrored on remotes and the Stage window.
   */
  columnFaders: Record<string, number>

  setBlind: (on?: boolean) => void
  setHighlight: (on?: boolean) => void
  setProgTime: (t: ProgTime | null) => void
  /** Append a line to the log (keeps the last CLI_LOG_LIMIT); returns the entry */
  appendCliLog: (entry: Omit<CliLogEntry, 'id' | 'time'> & { time?: number }) => CliLogEntry
  clearCliLog: () => void
  selectExecutor: (ref: ExecutorRef | null) => void
  setColumnFaders: (values: Record<string, number>) => void
}

let logSeq = 0

function cleanTime(t: ProgTime | null): ProgTime | null {
  if (!t) return null
  const fade = Number.isFinite(t.fade) ? Math.max(0, Math.min(3600, t.fade)) : 0
  const delay = Number.isFinite(t.delay) ? Math.max(0, Math.min(3600, t.delay)) : 0
  return fade === 0 && delay === 0 ? null : { fade, delay }
}

export const useProStore = create<ProState>((set, get) => ({
  blind: false,
  highlight: false,
  progTime: null,
  cliLog: [],
  selectedExecutor: null,
  columnFaders: {},

  setBlind: (on) => {
    const blind = on ?? !get().blind
    if (blind !== get().blind) set({ blind })
  },
  setHighlight: (on) => {
    const highlight = on ?? !get().highlight
    if (highlight !== get().highlight) set({ highlight })
  },
  setProgTime: (t) => set({ progTime: cleanTime(t) }),
  appendCliLog: (entry) => {
    const full: CliLogEntry = { ...entry, id: ++logSeq, time: entry.time ?? Date.now() }
    const log = [...get().cliLog, full]
    set({ cliLog: log.length > CLI_LOG_LIMIT ? log.slice(log.length - CLI_LOG_LIMIT) : log })
    return full
  },
  clearCliLog: () => set({ cliLog: [] }),
  selectExecutor: (ref) => {
    const cur = get().selectedExecutor
    if (cur === ref || (cur && ref && cur.page === ref.page && cur.col === ref.col && cur.row === ref.row)) return
    set({ selectedExecutor: ref ? { page: ref.page, col: ref.col, row: ref.row } : null })
  },
  setColumnFaders: (values) => {
    const cur = get().columnFaders
    const keys = Object.keys(values)
    if (keys.length === Object.keys(cur).length && keys.every((k) => cur[k] === values[k])) return
    set({ columnFaders: values })
  }
}))
