// ============================================================
// PhotonBoard — Pickup "ghost" ticks for on-screen faders.
//
// While a MIDI controller fader has not picked up its value yet (soft
// takeover, lib/midi/controller-runtime), the on-screen fader draws a
// tick where the PHYSICAL fader is. The controller layer publishes
// them (≤ 10 Hz) in stores/controller-store `ghosts`, keyed
// ghostKey(page, col) for column faders and GM_GHOST_KEY for the Grand
// Master. Console only: elsewhere (Stage window, remote browsers) the
// store stays empty and no tick is drawn.
// ============================================================

import { GM_GHOST_KEY, ghostKey, useControllerStore } from '@renderer/stores/controller-store'

/** Ghost value (0-255) under `key`, or null when picked up / unknown */
export function readGhost(ghosts: Readonly<Record<string, unknown>> | undefined, key: string): number | null {
  const raw = ghosts?.[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.max(0, Math.min(255, Math.round(raw)))
}

/** Ghost of the column fader `col` of executor page `page` (re-renders only when it changes) */
export function useColumnGhost(page: number, col: number): number | null {
  return useControllerStore((s) => readGhost(s.ghosts, ghostKey(page, col)))
}

/** Ghost of the Grand Master fader */
export function useGrandMasterGhost(): number | null {
  return useControllerStore((s) => readGhost(s.ghosts, GM_GHOST_KEY))
}
