// ============================================================
// PhotonBoard — Pickup "ghost" ticks for on-screen column faders.
//
// While a MIDI controller fader is not picked up yet (soft takeover),
// the on-screen fader draws a tick where the PHYSICAL fader is
// (spec §3.2: `useControllerStore.ghosts`, ≤ 10 Hz, WP4).
//
// TODO(integrator): WP4 creates stores/controller-store.ts in parallel.
// Point `ghostSource` at it once merged, e.g.
//   import { useControllerStore } from '@renderer/stores/controller-store'
//   export const useGhostSource = useControllerStore
// readGhost() already accepts the likely shapes (Record or Map keyed by
// 'fader:<n>' / '<n>', values 0-255 or { value }).
// ============================================================

import { create } from 'zustand'

/** Minimal shape read from the controller store */
export interface GhostSource {
  /** Physical position of controls that are not picked up yet */
  ghosts: Record<string, unknown> | Map<string, unknown>
}

/** Local stand-in until the controller store is merged (always empty) */
export const useGhostSource = create<GhostSource>(() => ({ ghosts: {} }))

/** Ghost (0-255) of column fader `col`, or null when it is picked up / unknown */
export function readGhost(ghosts: GhostSource['ghosts'] | undefined, col: number): number | null {
  if (!ghosts) return null
  const keys = [`fader:${col}`, String(col)]
  for (const k of keys) {
    const raw = ghosts instanceof Map ? ghosts.get(k) : (ghosts as Record<string, unknown>)[k]
    const v = typeof raw === 'number' ? raw
      : raw && typeof raw === 'object' && typeof (raw as { value?: unknown }).value === 'number' ? (raw as { value: number }).value
      : null
    if (v !== null && Number.isFinite(v)) return Math.max(0, Math.min(255, Math.round(v)))
  }
  return null
}

/** Ghost of column `col` (re-renders only when that value changes) */
export function useColumnGhost(col: number): number | null {
  return useGhostSource((s) => readGhost(s.ghosts, col))
}
