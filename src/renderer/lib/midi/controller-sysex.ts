// ============================================================
// PhotonBoard — Does a controller need Web MIDI SysEx?
// (requestMIDIAccess({ sysex: true }); main already allows it)
// ============================================================

import { useControllerStore } from '@renderer/stores/controller-store'
import { getProfile, matchProfile } from './profiles'

/**
 * True when an enabled, remembered controller — or one of these input
 * ports, unless the user disabled it — has a profile that needs SysEx.
 */
export function controllersWantSysex(inputNames: readonly string[]): boolean {
  const settings = useControllerStore.getState().settings
  if (settings.some((s) => s.enabled && getProfile(s.profileId)?.needsSysex)) return true
  return inputNames.some((name) => {
    const profile = matchProfile(name)
    if (!profile?.needsSysex) return false
    const s = settings.find((x) => x.port === name)
    return !s || s.enabled
  })
}
