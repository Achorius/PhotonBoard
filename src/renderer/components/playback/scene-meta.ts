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
import { t } from '@renderer/i18n'

/** Short button-mode badges: kept as-is in every language (see GLOSSARY.md) */
export const MODE_LABEL: Record<SceneMode, string> = { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' }

/** "Tap = GO / Stop"… (current language) */
export function modeHint(mode: SceneMode): string {
  return t(`scenes.modeHint.${mode}`)
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

/** Change a cell's button mode and keep the scene's MIDI GO mapping behaviour in step (scenes view, executor bar) */
export function setSceneMode(cuelistId: string, slot: Pick<ExecutorSlot, 'col' | 'row'>, mode: SceneMode): void {
  useExecutorStore.getState().setMode(slot.col, slot.row, mode)
  useMidiStore.getState().setTargetBehavior({ type: 'cuelist_go', id: cuelistId }, mode)
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
  const kind = t(`scenes.midiSource.${m.source.type === 'note' ? 'note' : m.source.type === 'cc' ? 'cc' : 'program'}`)
  const params = { kind, number: m.source.number, channel: m.source.channel, device: m.source.deviceName ?? '' }
  return m.source.deviceName ? t('scenes.midiSource.describeDevice', params) : t('scenes.midiSource.describe', params)
}

/** MIDI-learn a scene's GO with the cell's button mode (replaces the scene's previous GO mapping) */
export function startSceneLearn(cl: Cuelist, mode: SceneMode): void {
  useMidiStore.getState().startLearn({ type: 'cuelist_go', id: cl.id, label: cl.name, behavior: mode })
}

/** Channels each cue outputs once tracking is applied (cue i = cues 0..i, later values win) */
export function trackedCounts(cues: Cuelist['cues']): number[] {
  const keys = new Set<string>()
  return cues.map((cue) => {
    for (const v of cue.values) keys.add(cueKey(v.fixtureId, v.channelName))
    return keys.size
  })
}
