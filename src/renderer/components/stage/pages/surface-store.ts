// ============================================================
// PhotonBoard — Touch surfaces fed by the stores (console renderer
// and remote browsers): surface data hook + actions.
//
// Console: actions call lib/pro/executor-actions and the stores.
// Remote browser: store actions forward themselves to the console
// (lib/runtime.ts); executor presses go as the 'executor' command so
// the console releases held cells when this browser disconnects;
// macros, presets, group selection and Clear are commands too.
// ============================================================

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ExecutorRef } from '@renderer/lib/pro/contracts'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { columnFader, executorPress } from '@renderer/lib/pro/executor-actions'
import { applyPreset } from '@renderer/lib/pro/programmer-engine'
import { tapSpeedMaster } from '@renderer/lib/pro/speed-masters'
import { runMacro } from '@renderer/lib/cli'
import { clearProgrammer } from '@renderer/lib/dmx-mixer'
import { isRemoteMode, sendRemoteCommand } from '@renderer/lib/runtime'
import {
  activeGroupOf, goTargetOf, surfaceChases, surfaceCuelists, surfaceExecPages, surfaceGroups, type SurfaceData
} from './surface-data'
import { presetCommandLine, type SurfaceActions } from './surface-actions'

/** Press / release an executor cell from this device (one path for every surface) */
export function pressExecutor(ref: ExecutorRef, phase: 'down' | 'up'): void {
  if (isRemoteMode()) sendRemoteCommand('executor', { page: ref.page, col: ref.col, row: ref.row, phase })
  else executorPress(ref, phase)
}

/** Show another executor page (a remote browser forwards it: hooks/useRemoteSync) */
export function setExecutorPage(index: number): void {
  useExecutorStore.getState().setPage(index)
}

let storeActions: SurfaceActions | null = null

/** Actions of a surface fed by the stores (console or remote browser) */
export function getStoreActions(): SurfaceActions {
  if (storeActions) return storeActions
  const pb = () => usePlaybackStore.getState()
  const dmx = () => useDmxStore.getState()
  storeActions = {
    executor: pressExecutor,
    columnFader: (page, col, level) => columnFader(page, col, level),
    level: (kind, id, level) => (kind === 'cuelist' ? pb().setCuelistFader(id, level) : pb().setChaseFader(id, level)),
    groupMaster: (id, level) => usePoolStore.getState().setGroupMaster(id, level),
    grandMaster: (v) => dmx().setGrandMaster(v),
    blackout: () => dmx().toggleBlackout(),
    blinder: (on) => dmx().toggleBlinder(on),
    strobe: (on) => dmx().toggleStrobe(on),
    releaseAll: () => pb().releaseAll(),
    clear: () => (isRemoteMode() ? sendRemoteCommand('clear-programmer') : clearProgrammer()),
    macro: (id) => (isRemoteMode() ? sendRemoteCommand('run-macro', { id }) : void runMacro(id)),
    preset: (id, type, number) => {
      if (isRemoteMode()) sendRemoteCommand('cli', { text: presetCommandLine(type, number) })
      else applyPreset(id, usePatchStore.getState().selectedFixtureIds)
    },
    group: (id) => {
      // Local feedback; the console does the same on 'select-group'
      usePatchStore.getState().selectGroup(id)
      if (isRemoteMode()) sendRemoteCommand('select-group', id)
    },
    speedTap: (id) => { tapSpeedMaster(id) },
    go: (id) => pb().goCuelist(id),
    back: (id) => pb().goBackCuelist(id),
    setPage: setExecutorPage
  }
  return storeActions
}

/** Surface data from the stores; each part is rebuilt only when its source changes */
export function useSurfaceData(): SurfaceData {
  const { pages, currentPage } = useExecutorStore(useShallow((s) => ({ pages: s.pages, currentPage: s.currentPage })))
  const selectedExecutor = useProStore((s) => s.selectedExecutor)
  const columnFaders = useProStore((s) => s.columnFaders)
  const { cuelists, chases, presets, selectedCuelistId } = usePlaybackStore(useShallow((s) => ({
    cuelists: s.cuelists, chases: s.chases, presets: s.presets, selectedCuelistId: s.selectedCuelistId
  })))
  const effectsList = useEffectsStore((s) => s.effects)
  const { macrosList, speedList, stagePages, groupMasters } = usePoolStore(useShallow((s) => ({
    macrosList: s.macros, speedList: s.speedMasters, stagePages: s.stagePages, groupMasters: s.groupMasters
  })))
  const { groupsList, selection } = usePatchStore(useShallow((s) => ({ groupsList: s.groups, selection: s.selectedFixtureIds })))
  const { grandMaster, blackout, blinder, strobe } = useDmxStore(useShallow((s) => ({
    grandMaster: s.grandMaster, blackout: s.blackout, blinder: s.blinder, strobe: s.strobe
  })))

  const executorPages = useMemo(() => surfaceExecPages(pages), [pages])
  const cuelistData = useMemo(() => surfaceCuelists(cuelists), [cuelists])
  const chaseData = useMemo(() => surfaceChases(chases), [chases])
  const effects = useMemo(() => effectsList.map((e) => ({ id: e.id, name: e.name, isRunning: e.isRunning })), [effectsList])
  const macros = useMemo(() => macrosList.map((m) => ({ id: m.id, number: m.number, name: m.name, color: m.color })), [macrosList])
  const presetData = useMemo(() => presets.map((p) => ({ id: p.id, type: p.type, number: p.number ?? 0, name: p.name, color: p.color })), [presets])
  const groups = useMemo(() => surfaceGroups(groupsList, groupMasters), [groupsList, groupMasters])
  const activeGroupId = useMemo(() => activeGroupOf(groupsList, selection), [groupsList, selection])
  const speedMasters = useMemo(() => speedList.map((m) => ({ id: m.id, number: m.number, name: m.name, bpm: m.bpm })), [speedList])
  const goTargetId = useMemo(() => goTargetOf(pages, selectedExecutor, selectedCuelistId, cuelists), [pages, selectedExecutor, selectedCuelistId, cuelists])

  return useMemo<SurfaceData>(() => ({
    executorPages,
    currentPage,
    selectedExecutor,
    goTargetId,
    cuelists: cuelistData,
    chases: chaseData,
    effects,
    macros,
    presets: presetData,
    groups,
    activeGroupId,
    selectionCount: selection.length,
    speedMasters,
    stagePages,
    grandMaster,
    blackout,
    blinder,
    strobe,
    columnFaders
  }), [executorPages, currentPage, selectedExecutor, goTargetId, cuelistData, chaseData, effects, macros, presetData, groups, activeGroupId,
    selection.length, speedMasters, stagePages, grandMaster, blackout, blinder, strobe, columnFaders])
}
