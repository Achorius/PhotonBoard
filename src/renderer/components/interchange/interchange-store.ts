// ============================================================
// Import wizard / export dialog state (components/interchange).
// ============================================================

import { create } from 'zustand'
import type { ImportedShowFragment, MergeOptions, UnsupportedFormatGuidance } from '@shared/interchange'
import type { InterchangeFormatList } from '@shared/photonboard-api'

/** Where the file comes from (kept to re-run the import with a CSV column mapping) */
export type ImportSource =
  | { kind: 'path'; path: string; fileName: string }
  | { kind: 'data'; data: Uint8Array; fileName: string }

export type WizardStep = 'pick' | 'loading' | 'guidance' | 'error' | 'mapping' | 'preview' | 'applying'

export interface WizardError {
  code?: string
  message?: string
  format?: string
  params?: Record<string, string | number>
}

export interface InterchangeState {
  importOpen: boolean
  step: WizardStep
  source: ImportSource | null
  fragment: ImportedShowFragment | null
  options: MergeOptions | null
  guidance: (UnsupportedFormatGuidance & { fileName: string }) | null
  error: WizardError | null
  exportOpen: boolean
  formats: InterchangeFormatList | null
  /** A file is dragged over the window */
  dragging: boolean
}

export const useInterchangeStore = create<InterchangeState>(() => ({
  importOpen: false,
  step: 'pick',
  source: null,
  fragment: null,
  options: null,
  guidance: null,
  error: null,
  exportOpen: false,
  formats: null,
  dragging: false
}))

export function closeImportWizard(): void {
  useInterchangeStore.setState({ importOpen: false, step: 'pick', source: null, fragment: null, options: null, guidance: null, error: null })
}

export function setMergeOptions(patch: Partial<MergeOptions>): void {
  const cur = useInterchangeStore.getState().options
  if (cur) useInterchangeStore.setState({ options: { ...cur, ...patch } })
}
