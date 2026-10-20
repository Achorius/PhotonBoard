// ============================================================
// PhotonBoard — MIDI controller layer: start-up wiring
//
// startMidiControllers() (called by initMidiRouting):
//   - midi-store hooks: profile routing before user mappings, SysEx,
//     port enumeration → syncControllers, unplug → release holds
//   - the LED feedback engine
//   - store subscriptions: anything an LED shows requests a frame;
//     page change re-arms fader pickup; show load = re-arm + full
//     resend; settings change = resync
// ============================================================

import { setMidiControllerHooks, getMidiAccess, useMidiStore } from '@renderer/stores/midi-store'
import { useControllerStore } from '@renderer/stores/controller-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { useProStore } from '@renderer/stores/pro-store'
import { useProgrammerStore } from '@renderer/lib/programmer-utils'
import { onShowApplied } from '@renderer/lib/show-io'
import { onTimelinePlayStateChange } from '@renderer/lib/timeline-engine'
import {
  controllerPortGone, handleControllerSysex, invalidateController, listControllers, rearmFaders, resyncControllers,
  routeControllerMessage, scheduleGhosts, syncControllers, updateOverrides
} from './controller-runtime'
import { invalidateMappingFeedback, requestFeedbackFrame, startFeedback, stopFeedback } from './midi-feedback'

let stopAll: (() => void) | null = null

export function startMidiControllers(): () => void {
  if (stopAll) return stopAll

  setMidiControllerHooks({
    route: routeControllerMessage,
    sysex: handleControllerSysex,
    access: (access) => syncControllers(access),
    portDisconnected: (name, type) => controllerPortGone(name, type)
  })
  startFeedback()

  const changed = () => { requestFeedbackFrame(); scheduleGhosts() }
  const unsubs: (() => void)[] = []

  unsubs.push(useExecutorStore.subscribe((s, p) => {
    if (s.currentPage !== p.currentPage) rearmFaders(false)
    if (s.currentPage !== p.currentPage || s.pages !== p.pages) changed()
  }))
  unsubs.push(usePlaybackStore.subscribe((s, p) => {
    if (s.cuelists !== p.cuelists || s.chases !== p.chases || s.presets !== p.presets || s.selectedCuelistId !== p.selectedCuelistId) changed()
  }))
  unsubs.push(useEffectsStore.subscribe((s, p) => { if (s.effects !== p.effects) requestFeedbackFrame() }))
  unsubs.push(useDmxStore.subscribe((s, p) => {
    if (s.grandMaster !== p.grandMaster || s.blackout !== p.blackout || s.blinder !== p.blinder || s.strobe !== p.strobe) changed()
  }))
  unsubs.push(usePatchStore.subscribe((s, p) => { if (s.groups !== p.groups) requestFeedbackFrame() }))
  unsubs.push(usePoolStore.subscribe((s, p) => { if (s.macros !== p.macros || s.groupMasters !== p.groupMasters) changed() }))
  unsubs.push(useProStore.subscribe((s, p) => { if (s.selectedExecutor !== p.selectedExecutor) requestFeedbackFrame() }))
  unsubs.push(useProgrammerStore.subscribe(() => requestFeedbackFrame()))
  unsubs.push(useMidiStore.subscribe((s, p) => {
    if (s.mappings !== p.mappings) {
      for (const c of listControllers()) updateOverrides(c)
      changed()
    } else if (s.isLearning !== p.isLearning || s.learnTarget !== p.learnTarget) {
      requestFeedbackFrame()
    }
  }))
  unsubs.push(useControllerStore.subscribe((s, p) => {
    if (s.settings !== p.settings) resyncControllers()
  }))
  unsubs.push(onTimelinePlayStateChange(() => requestFeedbackFrame()))
  unsubs.push(onShowApplied(() => {
    rearmFaders(true)
    for (const c of listControllers()) invalidateController(c)
    invalidateMappingFeedback()
    changed()
  }))

  // initMidi may already have run (App start-up order)
  const access = getMidiAccess()
  if (access) syncControllers(access)

  stopAll = () => {
    for (const u of unsubs) u()
    stopFeedback()
    setMidiControllerHooks({})
    stopAll = null
  }
  return stopAll
}

/** Stop the controller layer (tests) */
export function stopMidiControllers(): void {
  stopAll?.()
}

export { testControllerLeds, syncControllers, routeControllerMessage, getController } from './controller-runtime'
export { CONTROLLER_PROFILES, getProfile, matchProfile } from './profiles'
export { buildBindings, CONTROLLER_LAYOUTS } from './layouts'
