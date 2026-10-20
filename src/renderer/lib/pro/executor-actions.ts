// ============================================================
// PhotonBoard — Executor actions: ONE entry point for the executor
// bar, stage pages, MIDI controller profiles, the command line and
// remote commands ('executor' { page, col, row, phase }).
//
// Button functions (cell.button, default from the cell's mode):
//   toggle  down: GO when stopped, STOP when playing     (TOG mode)
//   temp    down: GO · up: STOP                          (TRIG mode)
//   flash   full while held                              (FLASH mode)
//   go / goBack / off                                    down only
//   select  down: this executor becomes the GO / Back target
//   swap    flash while held + the scene's intensity is swapped
//           (mixer swap flag) — chases / effects: like flash
//   pause   down: pause / resume the running fade (scene), the step
//           (chase) or the phase (effect)
//   learn   down: MIDI learn for this executor (scene GO with the
//           cell's mode, chase / effect toggle)
// Chases, effects, macros, groups and speed masters get the obvious
// equivalents. Pressing a scene / chase remembers the executor it was
// fired from: its column level scales its master.
//
// Column faders (column.fader, default 'column'):
//   column       column level (0-255): scales the master of the scenes /
//                chases fired from (or placed in) the column; group
//                cells of the column get it as their group master
//   cell         the fader of one cell (scene / chase / group master)
//   grandmaster  Grand Master
//   group        group master
//   speed        speed master BPM (lib/pro/speed-masters speedFaderToBpm)
//   rate         runtime rate of the scene / chase in that row
//                (centre = 1×, 0.25×..4×)
//   xfade        manual crossfade of the scene in that row
// ============================================================

import type { ExecutorButtonFn, ExecutorCell, ExecutorSceneMode } from '@shared/types'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { runMacro, stopMacro } from '@renderer/lib/cli'
import { setEffectPaused } from '@renderer/lib/effect-engine'
import {
  crossfadeFader, getColumnLevel, getCrossfadeLevel, getRuntimeRate, noteFiredFrom, pauseChase, pauseCuelist, setColumnLevel,
  setRuntimeRate, setSwapHold
} from '@renderer/lib/playback-controller'
import { isRemoteMode, markLocalChange, sendRemoteCommandThrottled } from '@renderer/lib/runtime'
import { bpmToSpeedFader, rateFaderToRate, rateToFader, speedFaderToBpm, tapSpeedMaster } from './speed-masters'
import type { ExecutorRef } from './contracts'

export type { ExecutorRef } from './contracts'

/** Button function a cell uses when none is set: from its mode */
export function defaultButtonFn(mode: ExecutorSceneMode): ExecutorButtonFn {
  return mode === 'trigger' ? 'temp' : mode === 'flash' ? 'flash' : 'toggle'
}

/** The cell at a reference (null when empty / out of range) */
export function executorCellAt(ref: ExecutorRef): ExecutorCell | null {
  const page = useExecutorStore.getState().pages[ref.page]
  return page?.cells[ref.col]?.[ref.row] ?? null
}

/** Name of the object in a cell (MIDI learn label) */
function cellLabel(cell: ExecutorCell): string {
  switch (cell.kind) {
    case 'cuelist': return usePlaybackStore.getState().cuelists.find(c => c.id === cell.id)?.name ?? ''
    case 'chase': return usePlaybackStore.getState().chases.find(c => c.id === cell.id)?.name ?? ''
    case 'effect': return useEffectsStore.getState().effects.find(e => e.id === cell.id)?.name ?? ''
    default: return ''
  }
}

/** MIDI learn for an executor cell: scenes learn their GO (with the cell's mode), chases / effects their toggle */
export function learnExecutor(ref: ExecutorRef): boolean {
  const cell = executorCellAt(ref)
  if (!cell) return false
  const midi = useMidiStore.getState()
  const label = cellLabel(cell)
  switch (cell.kind) {
    case 'cuelist':
      midi.startLearn({ type: 'cuelist_go', id: cell.id, label, behavior: cell.mode })
      return true
    case 'chase':
      midi.startLearn({ type: 'chase_toggle', id: cell.id, label })
      return true
    case 'effect':
      midi.startLearn({ type: 'effect_toggle', id: cell.id, label })
      return true
    default:
      return false
  }
}

/** Press (`down`) or release (`up`) an executor. `opts.fn` overrides the cell's button function. */
export function executorPress(ref: ExecutorRef, phase: 'down' | 'up', opts: { fn?: ExecutorButtonFn; clientId?: string } = {}): void {
  const cell = executorCellAt(ref)
  if (!cell) return
  const fn = opts.fn ?? cell.button ?? defaultButtonFn(cell.mode)
  const down = phase === 'down'
  if (fn === 'select') {
    if (down) selectExecutor(ref)
    return
  }
  if (fn === 'learn') {
    if (down) learnExecutor(ref)
    return
  }
  switch (cell.kind) {
    case 'cuelist': {
      const pb = usePlaybackStore.getState()
      const cl = pb.cuelists.find((c) => c.id === cell.id)
      if (!cl) return
      if (down && fn !== 'off' && fn !== 'pause') noteFiredFrom('cuelist', cl.id, ref)
      switch (fn) {
        case 'toggle':
          if (down) { if (cl.isPlaying) pb.stopCuelist(cl.id); else pb.goCuelist(cl.id) }
          break
        case 'temp':
          if (down) pb.goCuelist(cl.id)
          else pb.stopCuelist(cl.id)
          break
        case 'flash':
          pb.flashCuelist(cl.id, down)
          break
        case 'swap':
          if (down) {
            setSwapHold(cl.id, true)
            pb.flashCuelist(cl.id, true)
          } else {
            pb.flashCuelist(cl.id, false)
            setSwapHold(cl.id, false)
          }
          break
        case 'go': if (down) pb.goCuelist(cl.id); break
        case 'goBack': if (down) pb.goBackCuelist(cl.id); break
        case 'off': if (down) pb.stopCuelist(cl.id); break
        case 'pause': if (down) pauseCuelist(cl.id); break
        default: break
      }
      return
    }
    case 'chase': {
      const pb = usePlaybackStore.getState()
      const ch = pb.chases.find((c) => c.id === cell.id)
      if (!ch) return
      if (down && fn !== 'off' && fn !== 'pause') noteFiredFrom('chase', ch.id, ref)
      switch (fn) {
        case 'toggle': if (down) pb.toggleChase(ch.id); break
        case 'temp':
        case 'flash':
        case 'swap': pb.toggleChase(ch.id, down); break
        case 'go': if (down) pb.toggleChase(ch.id, true); break
        case 'off': if (down) pb.toggleChase(ch.id, false); break
        case 'pause': if (down) pauseChase(ch.id); break
        default: break
      }
      return
    }
    case 'effect': {
      const fx = useEffectsStore.getState()
      const effect = fx.effects.find((e) => e.id === cell.id)
      if (!effect) return
      switch (fn) {
        case 'toggle': if (down) fx.setEffectRunning(effect.id, !effect.isRunning); break
        case 'temp':
        case 'flash':
        case 'swap': fx.setEffectRunning(effect.id, down); break
        case 'go': if (down) fx.setEffectRunning(effect.id, true); break
        case 'off': if (down) fx.setEffectRunning(effect.id, false); break
        case 'pause': if (down) setEffectPaused(effect.id); break
        default: break
      }
      return
    }
    case 'macro':
      if (!down) return
      if (fn === 'off') stopMacro(cell.id)
      else runMacro(cell.id)
      return
    case 'group':
      if (down) usePatchStore.getState().selectGroup(cell.id)
      return
    case 'speed':
      if (down) tapSpeedMaster(cell.id)
      return
  }
}

/** Key of a column fader in pro-store.columnFaders / controller ghosts ("page:col", 0-based) */
export function columnFaderKey(page: number, col: number): string {
  return `${page}:${col}`
}

/** Move a column fader (level 0-255) of a page. A remote browser sends it to the console ('column-fader'). */
export function columnFader(page: number, col: number, level: number): void {
  const p = useExecutorStore.getState().pages[page]
  const column = p?.columns[col]
  if (!p || !column) return
  const v = Math.max(0, Math.min(255, Math.round(Number.isFinite(level) ? level : 0)))
  if (isRemoteMode()) {
    // The console owns column levels / rates: show the move here at once, hold it until the console echoes it
    const key = columnFaderKey(page, col)
    markLocalChange(`column:${key}`)
    const pro = useProStore.getState()
    if (key in pro.columnFaders) pro.setColumnFaders({ ...pro.columnFaders, [key]: v })
    sendRemoteCommandThrottled(`column:${key}`, 'column-fader', { page, col, level: v })
    return
  }
  const fader = column.fader ?? { kind: 'column' as const }
  const setCellLevel = (cell: ExecutorCell | null) => {
    if (!cell) return
    const pb = usePlaybackStore.getState()
    if (cell.kind === 'cuelist') pb.setCuelistFader(cell.id, v)
    else if (cell.kind === 'chase') pb.setChaseFader(cell.id, v)
    else if (cell.kind === 'group') usePoolStore.getState().setGroupMaster(cell.id, v)
  }
  switch (fader.kind) {
    case 'column':
      setColumnLevel(page, col, v)
      for (const cell of p.cells[col] ?? []) {
        if (cell?.kind === 'group') usePoolStore.getState().setGroupMaster(cell.id, v)
      }
      break
    case 'cell':
      setCellLevel(p.cells[col]?.[fader.row] ?? null)
      break
    case 'grandmaster':
      useDmxStore.getState().setGrandMaster(v)
      break
    case 'group':
      usePoolStore.getState().setGroupMaster(fader.id, v)
      break
    case 'speed':
      usePoolStore.getState().setSpeedMasterBpm(fader.id, speedFaderToBpm(v))
      break
    case 'rate': {
      const cell = p.cells[col]?.[fader.row]
      if (cell?.kind === 'cuelist' || cell?.kind === 'chase') setRuntimeRate(cell.kind, cell.id, rateFaderToRate(v))
      break
    }
    case 'xfade': {
      const cell = p.cells[col]?.[fader.row]
      if (cell?.kind === 'cuelist') {
        noteFiredFrom('cuelist', cell.id, { page, col, row: fader.row })
        crossfadeFader(cell.id, v)
      }
      break
    }
    default:
      break
  }
}

/** Master level of a cell that has one (scene, chase, group) */
function faderCellLevel(cell: ExecutorCell | null | undefined): number | null {
  if (!cell) return null
  const pb = usePlaybackStore.getState()
  if (cell.kind === 'cuelist') return pb.cuelists.find((c) => c.id === cell.id)?.faderLevel ?? null
  if (cell.kind === 'chase') return pb.chases.find((c) => c.id === cell.id)?.faderLevel ?? null
  if (cell.kind === 'group') return usePoolStore.getState().groupMasters[cell.id] ?? 255
  return null
}

/**
 * Level (0-255) a column fader shows / a MIDI fader must pick up, by
 * function: the column level ('column', when the column holds a scene,
 * chase or group), the cell's master, the Grand Master, a group master,
 * a speed master's BPM, a runtime rate (centre = 1×), the X-fade
 * position. null = the fader drives nothing (empty column / cell).
 */
export function columnFaderValue(page: number, col: number): number | null {
  const p = useExecutorStore.getState().pages[page]
  const column = p?.columns[col]
  if (!p || !column) return null
  const fader = column.fader ?? { kind: 'column' as const }
  switch (fader.kind) {
    case 'column':
      return (p.cells[col] ?? []).some((c) => c && (c.kind === 'cuelist' || c.kind === 'chase' || c.kind === 'group'))
        ? getColumnLevel(page, col)
        : null
    case 'cell': return faderCellLevel(p.cells[col]?.[fader.row])
    case 'grandmaster': return useDmxStore.getState().grandMaster
    case 'group': return usePoolStore.getState().groupMasters[fader.id] ?? 255
    case 'speed': {
      const m = usePoolStore.getState().speedMasters.find((x) => x.id === fader.id)
      return m ? bpmToSpeedFader(m.bpm) : null
    }
    case 'rate': {
      const cell = p.cells[col]?.[fader.row]
      return cell?.kind === 'cuelist' || cell?.kind === 'chase' ? rateToFader(getRuntimeRate(cell.kind, cell.id)) : null
    }
    case 'xfade': {
      const cell = p.cells[col]?.[fader.row]
      return cell?.kind === 'cuelist' ? getCrossfadeLevel(cell.id) : null
    }
    default:
      return null
  }
}

/** Every column fader that drives something, all pages: { "page:col": level } */
export function columnFaderValues(): Record<string, number> {
  const out: Record<string, number> = {}
  const pages = useExecutorStore.getState().pages
  for (let page = 0; page < pages.length; page++) {
    const cols = pages[page].columns.length
    for (let col = 0; col < cols; col++) {
      const v = columnFaderValue(page, col)
      if (v !== null) out[columnFaderKey(page, col)] = v
    }
  }
  return out
}

/** Executor GO / Back keys act on (null = the Scenes view selection) */
export function selectedExecutor(): ExecutorRef | null {
  return useProStore.getState().selectedExecutor
}

export function selectExecutor(ref: ExecutorRef | null): void {
  useProStore.getState().selectExecutor(ref)
  if (!ref) return
  const cell = executorCellAt(ref)
  if (cell?.kind === 'cuelist') usePlaybackStore.getState().selectCuelist(cell.id)
}
