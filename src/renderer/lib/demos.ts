// ============================================================
// Demo content shipped with the app (resources/demos, main
// src/main/demos.ts): the list for File › Open a demo… and for the
// import wizard's example files. Console only (bridge.demos is absent
// on the web remote).
// ============================================================

import { create } from 'zustand'
import type { DemoList } from '@shared/demos'
import { getBridge } from '@renderer/lib/runtime'

interface DemoState {
  list: DemoList | null
  error: string | null
  /** File › Open a demo… dialog */
  dialogOpen: boolean
}

export const useDemoStore = create<DemoState>(() => ({ list: null, error: null, dialogOpen: false }))

export function demosAvailable(): boolean {
  return !!getBridge()?.demos
}

/** The demo list (read once from main; it never changes while the app runs) */
export async function loadDemos(): Promise<DemoList> {
  const cached = useDemoStore.getState().list
  if (cached) return cached
  const api = getBridge()?.demos
  if (!api) return { shows: [], formats: [] }
  try {
    const list = await api.list()
    const safe: DemoList = { shows: Array.isArray(list?.shows) ? list.shows : [], formats: Array.isArray(list?.formats) ? list.formats : [] }
    useDemoStore.setState({ list: safe, error: null })
    return safe
  } catch (e) {
    useDemoStore.setState({ error: (e as Error).message })
    return { shows: [], formats: [] }
  }
}

export function openDemoDialog(): void {
  useDemoStore.setState({ dialogOpen: true })
  void loadDemos()
}

export function closeDemoDialog(): void {
  useDemoStore.setState({ dialogOpen: false })
}
