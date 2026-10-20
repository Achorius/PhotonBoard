// ============================================================
// PhotonBoard — What a touch surface can DO, whatever runs it:
//   createCommandActions(send)  Stage window: remote commands only
//                               (shared/remote-commands.ts)
// Store-bound actions (console + remote browser) live in
// surface-store.ts so this file stays store-free (Stage window bundle).
// Optional actions (group masters, speed taps) are missing where a
// surface cannot do them: widgets disable the control.
// ============================================================

import { PRESET_FAMILY_NUMBER, type PresetType } from '@shared/types'
import type { ExecutorRef } from '@renderer/lib/pro/contracts'
import { columnFaderCommand } from '../executor-surface'

export interface SurfaceActions {
  /** Press / release an executor cell (button function semantics: lib/pro/executor-actions) */
  executor(ref: ExecutorRef, phase: 'down' | 'up'): void
  /** Column fader of a page, 0-255 */
  columnFader(page: number, col: number, level: number): void
  /** Scene / chase master level, 0-255 */
  level(kind: 'cuelist' | 'chase', id: string, level: number): void
  groupMaster?(id: string, level: number): void
  grandMaster(level: number): void
  blackout(): void
  blinder(on: boolean): void
  strobe(on: boolean): void
  releaseAll(): void
  clear(): void
  macro(id: string): void
  /** Apply a preset to the selected fixtures */
  preset(id: string, type: PresetType, number: number): void
  group(id: string): void
  speedTap?(id: string): void
  go(cuelistId: string): void
  back(cuelistId: string): void
  /** Show another executor page */
  setPage(index: number): void
}

/** Command line that applies a preset to the selection ("At Preset 4.2") */
export function presetCommandLine(type: PresetType, number: number): string {
  return `At Preset ${PRESET_FAMILY_NUMBER[type]}.${number}`
}

export type SendCommand = (type: string, payload?: unknown) => void

/**
 * Actions as remote commands (Stage window). `sendThrottled` (one slot per
 * key, leading + trailing) carries fader moves.
 */
export function createCommandActions(
  send: SendCommand,
  sendThrottled: (key: string, type: string, payload: unknown) => void
): SurfaceActions {
  return {
    executor: (ref, phase) => send('executor', { page: ref.page, col: ref.col, row: ref.row, phase }),
    columnFader: (page, col, level) => {
      const c = columnFaderCommand(page, col, level)
      sendThrottled(`col:${page}:${col}`, c.type, c.payload)
    },
    level: (kind, id, level) => sendThrottled(`level:${id}`, kind === 'cuelist' ? 'set-cuelist-fader' : 'set-chase-fader', { id, level }),
    groupMaster: (id, level) => sendThrottled(`group:${id}`, 'set-group-master', { id, level }),
    speedTap: (id) => send('tap-speed-master', { id }),
    grandMaster: (level) => sendThrottled('gm', 'set-grand-master', level),
    blackout: () => send('toggle-blackout'),
    blinder: (on) => send('toggle-blinder', on),
    strobe: (on) => send('toggle-strobe', on),
    releaseAll: () => send('release-all'),
    clear: () => send('clear-programmer'),
    macro: (id) => send('run-macro', { id }),
    preset: (_id, type, number) => send('cli', { text: presetCommandLine(type, number), origin: 'stage' }),
    group: (id) => send('select-group', id),
    go: (id) => send('go-cuelist', id),
    back: (id) => send('go-back-cuelist', id),
    setPage: (index) => send('set-executor-page', index)
  }
}
