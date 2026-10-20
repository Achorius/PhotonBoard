// ============================================================
// PhotonBoard — Controller actions → the app
//
// Executors go through lib/pro/executor-actions (the ONE entry point
// shared with the executor bar, stage pages, CLI and remotes); masters,
// release, clear and tap through the existing store actions.
// performButton() returns the release to run when the button comes
// up (or when the device disconnects): flash / temp executors,
// blinder, strobe — nothing stays stuck.
// ============================================================

import type { ExecutorButtonFn } from '@shared/types'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore, selectGoTargetCuelistId } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { columnFader, defaultButtonFn, executorCellAt, executorPress, selectExecutor, selectedExecutor } from '@renderer/lib/pro/executor-actions'
import { applyPreset, clearProgrammerMeta } from '@renderer/lib/pro/programmer-engine'
import { clearProgrammerAll } from '@renderer/lib/programmer-utils'
import { isMacroRunning, runMacro, stopMacro } from '@renderer/lib/cli'
import { handleTapTempo } from '@renderer/lib/midi-manager'
import type { ExecutorRef } from '@renderer/lib/pro/contracts'
import type { ControllerAction } from './controller-types'
import { resolveActionPage } from './led-states'
import { resolveGroupRef, resolveMacroRef, resolvePresetRef } from './pool-refs'

/** Button functions that last while held: the release matters */
const MOMENTARY: ReadonlySet<ExecutorButtonFn> = new Set(['temp', 'flash', 'swap'])

/** An executor action's cell reference on the CURRENT page layout (null when the page does not exist) */
export function resolveExecutorRef(page: 'current' | 'next' | number, col: number, row: number): ExecutorRef | null {
  const ex = useExecutorStore.getState()
  const p = resolveActionPage(page, ex.currentPage, ex.pages.length)
  return p < 0 ? null : { page: p, col, row }
}

/** Last tap (for the Tap LED): epoch-ish ms of the clock used by handleTapTempo */
let lastTap = { at: 0, bpm: 0 }

export function getLastTap(): { at: number; bpm: number } {
  return lastTap
}

export function goSelected(back: boolean, clientId?: string): void {
  const ref = selectedExecutor()
  if (ref && executorCellAt(ref)) {
    executorPress(ref, 'down', { fn: back ? 'goBack' : 'go', clientId })
    return
  }
  const pb = usePlaybackStore.getState()
  const id = selectGoTargetCuelistId(pb)
  if (!id) return
  if (back) pb.goBackCuelist(id)
  else pb.goCuelist(id)
}

/** Is there anything GO / Back would act on? */
export function hasGoTarget(): boolean {
  const ref = useProStore.getState().selectedExecutor
  if (ref && executorCellAt(ref)) return true
  return usePlaybackStore.getState().cuelists.length > 0
}

function changePage(page: number | '+' | '-'): void {
  const ex = useExecutorStore.getState()
  const next = page === '+' ? ex.currentPage + 1 : page === '-' ? ex.currentPage - 1 : page
  if (next < 0 || next >= ex.pages.length || next === ex.currentPage) return
  ex.setPage(next)
}

/**
 * A button pressed. Returns what to do on release (null = nothing).
 * `clientId` tags executor presses ('midi:<port>').
 */
export function performButton(action: ControllerAction, clientId: string): (() => void) | null {
  switch (action.type) {
    case 'executor': {
      const ref = resolveExecutorRef(action.page, action.col, action.row)
      const cell = ref ? executorCellAt(ref) : null
      if (!ref || !cell) return null
      executorPress(ref, 'down', { clientId })
      const fn = cell.button ?? defaultButtonFn(cell.mode)
      return MOMENTARY.has(fn) ? () => executorPress(ref, 'up', { clientId }) : null
    }
    case 'select-executor': {
      const ref = resolveExecutorRef(action.page, action.col, action.row)
      if (ref && executorCellAt(ref)) selectExecutor(ref)
      return null
    }
    case 'page': changePage(action.page); return null
    case 'go-selected': goSelected(false, clientId); return null
    case 'back-selected': goSelected(true, clientId); return null
    case 'release-all': usePlaybackStore.getState().releaseAll(); return null
    case 'clear':
      clearProgrammerAll()
      clearProgrammerMeta()
      return null
    case 'blackout': useDmxStore.getState().toggleBlackout(); return null
    case 'blinder':
      useDmxStore.getState().toggleBlinder(true)
      return () => useDmxStore.getState().toggleBlinder(false)
    case 'strobe':
      useDmxStore.getState().toggleStrobe(true)
      return () => useDmxStore.getState().toggleStrobe(false)
    case 'tap': {
      const bpm = handleTapTempo()
      lastTap = { at: Date.now(), bpm: bpm ?? lastTap.bpm }
      return null
    }
    case 'macro': {
      const m = resolveMacroRef(usePoolStore.getState().macros, action.id)
      if (!m) return null
      if (isMacroRunning(m.id)) stopMacro(m.id)
      else runMacro(m.id)
      return null
    }
    case 'group': {
      const g = resolveGroupRef(usePatchStore.getState().groups, action.id)
      if (g) usePatchStore.getState().selectGroup(g.id)
      return null
    }
    case 'preset': {
      const p = resolvePresetRef(usePlaybackStore.getState().presets, action.id)
      const ids = usePatchStore.getState().selectedFixtureIds
      if (p && ids.length > 0) applyPreset(p.id, ids, useProStore.getState().progTime ?? undefined)
      return null
    }
    case 'column-fader':
    case 'grand-master':
      return null
  }
}

/** Current level (0-255) a fader action drives; null = nothing to pick up */
export function faderLogicalLevel(action: ControllerAction): number | null {
  if (action.type === 'grand-master') return useDmxStore.getState().grandMaster
  if (action.type !== 'column-fader') return null
  const ex = useExecutorStore.getState()
  const page = ex.pages[ex.currentPage]
  const column = page?.columns[action.col]
  if (!page || !column) return null
  const fader = column.fader ?? { kind: 'column' as const }
  const cellLevel = (row: number): number | null => {
    const cell = page.cells[action.col]?.[row]
    if (!cell) return null
    const pb = usePlaybackStore.getState()
    if (cell.kind === 'cuelist') return pb.cuelists.find((c) => c.id === cell.id)?.faderLevel ?? null
    if (cell.kind === 'chase') return pb.chases.find((c) => c.id === cell.id)?.faderLevel ?? null
    if (cell.kind === 'group') return usePoolStore.getState().groupMasters[cell.id] ?? 255
    return null
  }
  switch (fader.kind) {
    case 'column': {
      const rows = page.cells[action.col]?.length ?? 0
      for (let r = 0; r < rows; r++) {
        const v = cellLevel(r)
        if (v !== null) return v
      }
      return null
    }
    case 'cell': return cellLevel(fader.row)
    case 'grandmaster': return useDmxStore.getState().grandMaster
    case 'group': return usePoolStore.getState().groupMasters[fader.id] ?? 255
    default: return null
  }
}

/** Move a fader action to a level (0-255) */
export function performFader(action: ControllerAction, level: number): void {
  if (action.type === 'grand-master') useDmxStore.getState().setGrandMaster(level)
  else if (action.type === 'column-fader') columnFader(useExecutorStore.getState().currentPage, action.col, level)
}
