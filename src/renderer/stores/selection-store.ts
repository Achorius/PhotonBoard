// ============================================================
// PhotonBoard — Selection tools state (runtime, never saved)
// MAtricks, Next / Prev step and fan alignment used by the
// programmer's selection tools and the command line
// (lib/pro/selection-tools.ts does the maths).
// ============================================================

import { create } from 'zustand'
import type { Matricks } from '@renderer/lib/pro/selection-tools'
import type { AlignMode } from '@renderer/lib/pro/contracts'

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
