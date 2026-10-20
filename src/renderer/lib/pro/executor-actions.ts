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
  crossfadeFader, noteFiredFrom, pauseChase, pauseCuelist, setColumnLevel, setRuntimeRate, setSwapHold
} from '@renderer/lib/playback-controller'
import { rateFaderToRate, speedFaderToBpm, tapSpeedMaster } from './speed-masters'
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

/** Move a column fader (level 0-255) of a page */
export function columnFader(page: number, col: number, level: number): void {
  const p = useExecutorStore.getState().pages[page]
  const column = p?.columns[col]
  if (!p || !column) return
  const v = Math.max(0, Math.min(255, Math.round(Number.isFinite(level) ? level : 0)))
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
