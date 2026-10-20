// ============================================================
// PhotonBoard — Executor actions: ONE entry point for the executor
// bar, stage pages, MIDI controller profiles, the command line and
// remote commands ('executor' { page, col, row, phase }).
//
// WP0 basic implementation (WP3 completes it): every button function
// maps onto the existing playback actions — exactly what the
// ExecutorBar does today for TOG / TRIG / FLASH scene cells:
//   toggle  down: GO when stopped, STOP when playing
//   temp    down: GO · up: STOP           (TRIG mode)
//   flash   full while held               (FLASH mode)
//   go / goBack / off                     down only
//   select  down: this executor becomes the GO / Back target
//   swap    flash for now · pause, learn: no-op (WP3 / WP4)
// Chases, effects, macros, groups and speed masters get the obvious
// equivalents. Column faders: 'column' sets the fader of every scene /
// chase of the column, 'cell' one cell, 'grandmaster', 'group' (group
// master); 'speed', 'rate', 'xfade' are WP3.
// ============================================================

import type { ExecutorButtonFn, ExecutorCell, ExecutorSceneMode } from '@shared/types'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { runMacro, stopMacro } from '@renderer/lib/cli'
import { tapSpeedMaster } from './speed-masters'
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
  switch (cell.kind) {
    case 'cuelist': {
      const pb = usePlaybackStore.getState()
      const cl = pb.cuelists.find((c) => c.id === cell.id)
      if (!cl) return
      switch (fn) {
        case 'toggle':
          if (down) { if (cl.isPlaying) pb.stopCuelist(cl.id); else pb.goCuelist(cl.id) }
          break
        case 'temp':
          if (down) pb.goCuelist(cl.id)
          else pb.stopCuelist(cl.id)
          break
        case 'flash':
        case 'swap':
          pb.flashCuelist(cl.id, down)
          break
        case 'go': if (down) pb.goCuelist(cl.id); break
        case 'goBack': if (down) pb.goBackCuelist(cl.id); break
        case 'off': if (down) pb.stopCuelist(cl.id); break
        default: break // pause, learn: WP3 / WP4
      }
      return
    }
    case 'chase': {
      const pb = usePlaybackStore.getState()
      const ch = pb.chases.find((c) => c.id === cell.id)
      if (!ch) return
      switch (fn) {
        case 'toggle': if (down) pb.toggleChase(ch.id); break
        case 'temp':
        case 'flash':
        case 'swap': pb.toggleChase(ch.id, down); break
        case 'go': if (down) pb.toggleChase(ch.id, true); break
        case 'off': if (down) pb.toggleChase(ch.id, false); break
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
      for (const cell of p.cells[col] ?? []) setCellLevel(cell)
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
    default:
      break // speed, rate, xfade: WP3
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
