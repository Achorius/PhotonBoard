// ============================================================
// PhotonBoard — Selection tools state (runtime, never saved)
// MAtricks, Next / Prev step and fan alignment used by the
// programmer's selection tools and the command line
// (lib/pro/selection-tools.ts does the maths).
// ============================================================

import { create } from 'zustand'
import { applyMatricks, matricksStepCount, type Matricks, type MatricksResult } from '@renderer/lib/pro/selection-tools'
import type { AlignMode } from '@renderer/lib/pro/contracts'
import { usePatchStore } from './patch-store'

interface SelectionToolsState {
  matricks: Matricks
  /** Next / Prev position in the selection; null = all fixtures */
  step: number | null
  /** Fan alignment for "At a Thru b"; null = '<' */
  align: AlignMode | null

  setMatricks: (m: Matricks) => void
  setStep: (step: number | null) => void
  /** Next (+1) / Prev (-1) through `count` fixtures (wraps); from "all" Next = first, Prev = last */
  stepBy: (delta: 1 | -1, count: number) => void
  setAlign: (align: AlignMode | null) => void
  /** Back to all fixtures, no MAtricks */
  reset: () => void
}

export const useSelectionStore = create<SelectionToolsState>((set, get) => ({
  matricks: {},
  step: null,
  align: null,

  setMatricks: (matricks) => set({ matricks: { ...matricks } }),
  setStep: (step) => set({ step: step === null || !Number.isFinite(step) ? null : Math.trunc(step) }),
  stepBy: (delta, count) => {
    if (count <= 0) { set({ step: null }); return }
    const cur = get().step
    const next = cur === null ? (delta > 0 ? 0 : count - 1) : (((cur + delta) % count) + count) % count
    set({ step: next })
  },
  setAlign: (align) => set({ align }),
  reset: () => set({ matricks: {}, step: null, align: null })
}))

// A new fixture selection starts on "all" again (grandMA: Next / Prev restart)
usePatchStore.subscribe((s, p) => {
  if (s.selectedFixtureIds !== p.selectedFixtureIds && useSelectionStore.getState().step !== null) {
    useSelectionStore.getState().setStep(null)
  }
})

/** MAtricks + step applied to the fixture selection (selection order): what "At" applies to, with fan phases */
export function getMatricksResult(selection: string[] = usePatchStore.getState().selectedFixtureIds): MatricksResult {
  const { matricks, step } = useSelectionStore.getState()
  return applyMatricks(selection, matricks, step)
}

/** Fixture ids active after MAtricks / Next / Prev */
export function getActiveSelection(): string[] {
  return getMatricksResult().active
}

/** Next / Prev / All through the selection (blocks of the MAtricks) */
export function stepSelection(direction: 'next' | 'prev' | 'all'): void {
  const s = useSelectionStore.getState()
  if (direction === 'all') { s.setStep(null); return }
  s.stepBy(direction === 'next' ? 1 : -1, matricksStepCount(usePatchStore.getState().selectedFixtureIds, s.matricks))
}
