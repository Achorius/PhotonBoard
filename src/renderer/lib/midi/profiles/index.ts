// ============================================================
// PhotonBoard — Controller profile registry and port matching
// ============================================================

import type { ControllerProfile, ControllerSettings } from '../controller-types'
import { apcMiniMk1, apcMiniMk2 } from './akai-apc-mini'
import { apc40Mk2, launchpadMiniMk3, launchpadX, nanoKontrol2, xTouchMini } from './generic'

/** Every known profile, most specific first */
export const CONTROLLER_PROFILES: readonly ControllerProfile[] = [
  apcMiniMk2,
  apcMiniMk1,
  apc40Mk2,
  launchpadMiniMk3,
  launchpadX,
  xTouchMini,
  nanoKontrol2
]

export function getProfile(id: string): ControllerProfile | undefined {
  return CONTROLLER_PROFILES.find((p) => p.id === id)
}

/**
 * Profile recognising an INPUT port name. A port the profile says to ignore
 * (the APC mini mk2 "Notes" port, the Launchpad DAW port) is not recognised.
 */
export function matchProfile(portName: string, profiles: readonly ControllerProfile[] = CONTROLLER_PROFILES): ControllerProfile | null {
  if (!portName) return null
  for (const p of profiles) {
    if (!p.matchInput.test(portName)) continue
    if (p.ignorePorts?.test(portName)) return null
    return p
  }
  return null
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i].toLowerCase() === b[i].toLowerCase()) i++
  return i
}

/**
 * The output port lighting an input's LEDs: same name first, else the
 * matching port sharing the longest prefix with the input name (two
 * identical controllers: "APC MINI" / "2- APC MINI" on Windows).
 */
export function findOutputPort(profile: ControllerProfile, inputName: string, outputNames: readonly string[], taken: ReadonlySet<string> = new Set()): string | null {
  const re = profile.matchOutput ?? profile.matchInput
  const candidates = outputNames.filter((n) => re.test(n) && !profile.ignorePorts?.test(n) && !taken.has(n))
  if (candidates.length === 0) return null
  const exact = candidates.find((n) => n === inputName)
  if (exact) return exact
  let best = candidates[0]
  let bestScore = -1
  for (const n of candidates) {
    const s = commonPrefix(n, inputName)
    if (s > bestScore) { best = n; bestScore = s }
  }
  return best
}

/** The profile with the machine options of a controller applied (RGB LEDs…) */
export function effectiveProfile(profile: ControllerProfile, settings: Pick<ControllerSettings, 'rgbLeds'> | undefined): ControllerProfile {
  return profile.withOptions ? profile.withOptions({ rgbLeds: !!settings?.rgbLeds }) : profile
}

export { apcMiniMk1, apcMiniMk2 } from './akai-apc-mini'
export { apc40Mk2, launchpadMiniMk3, launchpadX, nanoKontrol2, xTouchMini } from './generic'
