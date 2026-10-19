// ============================================================
// Scene metadata shared by the scene list and the scene editor:
// executor slot (column colour, button mode), MIDI mapping, small
// formatting helpers. Hooks use narrow selectors only.
// ============================================================

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Cuelist, MidiMapping } from '@shared/types'
import { useExecutorStore, type SceneMode } from '@renderer/stores/executor-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { cueKey } from '@renderer/lib/fixture-index'

export const MODE_LABEL: Record<SceneMode, string> = { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' }
export const MODE_HINT: Record<SceneMode, string> = {
  toggle: 'Tap = GO / Stop',
  trigger: 'Plays while held',
  flash: 'Full level while held'
}

export interface ExecutorSlot {
  col: number
  row: number
  color: string
  title: string
  mode: SceneMode
}

/** Executor slot of every placed scene (one pass over the 8×4 grid) */
export function useExecutorSlots(): Map<string, ExecutorSlot> {
  const { grid, columns, modes } = useExecutorStore(useShallow((s) => ({ grid: s.grid, columns: s.columns, modes: s.modes })))
  return useMemo(() => {
    const map = new Map<string, ExecutorSlot>()
    grid.forEach((cells, col) => cells.forEach((id, row) => {
      if (id) map.set(id, { col, row, color: columns[col]?.color ?? '#888888', title: columns[col]?.title ?? '', mode: modes[col]?.[row] ?? 'toggle' })
    }))
    return map
  }, [grid, columns, modes])
}

/** "3.2" = executor column 3, row 2 */
export function formatSlot(slot: ExecutorSlot): string {
  return `${slot.col + 1}.${slot.row + 1}`
}

/** Change a cell's button mode (and keep its MIDI mapping's behaviour in step, like the executor bar) */
export function setSceneMode(cuelistId: string, slot: ExecutorSlot, mode: SceneMode): void {
  useExecutorStore.getState().setMode(slot.col, slot.row, mode)
  const mapping = useMidiStore.getState().mappings.find((m) => m.target.type === 'cuelist_go' && m.target.id === cuelistId)
  if (mapping) useMidiStore.getState().updateMapping(mapping.id, { options: { ...mapping.options, behavior: mode } })
}

/** GO mappings by scene id */
export function useSceneMidi(): Map<string, MidiMapping> {
  const mappings = useMidiStore((s) => s.mappings)
  return useMemo(() => {
    const map = new Map<string, MidiMapping>()
    for (const m of mappings) if (m.target.type === 'cuelist_go' && m.target.id && !map.has(m.target.id)) map.set(m.target.id, m)
    return map
  }, [mappings])
}

/** Scene id whose GO is being MIDI-learned (or null) */
export function useLearningSceneId(): string | null {
  return useMidiStore((s) => (s.isLearning && s.learnTarget?.type === 'cuelist_go' ? s.learnTarget.id ?? null : null))
}

/** "N36" / "CC12" / "PC3" */
export function formatMidiSource(m: MidiMapping): string {
  const prefix = m.source.type === 'note' ? 'N' : m.source.type === 'cc' ? 'CC' : 'PC'
  return `${prefix}${m.source.number}`
}

export function describeMidiSource(m: MidiMapping): string {
  const kind = m.source.type === 'note' ? 'Note' : m.source.type === 'cc' ? 'CC' : 'Program'
  return `${kind} ${m.source.number} · channel ${m.source.channel}${m.source.deviceName ? ` · ${m.source.deviceName}` : ''}`
}

/** MIDI-learn a scene's GO, then give the new mapping the cell's button mode */
export function startSceneLearn(cl: Cuelist, mode: SceneMode): void {
  const midi = useMidiStore.getState()
  midi.startLearn({ type: 'cuelist_go', id: cl.id, label: cl.name })
  const unsubscribe = useMidiStore.subscribe((s) => {
    if (s.isLearning) return
    unsubscribe()
    const mapping = s.mappings.find((m) => m.target.type === 'cuelist_go' && m.target.id === cl.id)
    if (mapping && mapping.options.behavior !== mode) {
      setTimeout(() => useMidiStore.getState().updateMapping(mapping.id, { options: { ...mapping.options, behavior: mode } }), 0)
    }
  })
}

/** Channels each cue outputs once tracking is applied (cue i = cues 0..i, later values win) */
export function trackedCounts(cues: Cuelist['cues']): number[] {
  const keys = new Set<string>()
  return cues.map((cue) => {
    for (const v of cue.values) keys.add(cueKey(v.fixtureId, v.channelName))
    return keys.size
  })
}
