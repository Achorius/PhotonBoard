// ============================================================
// PhotonBoard — Command handler
// Executes the commands sent by the Stage window, remote browsers,
// Companion (REMOTE_COMMANDS) and main (INTERNAL_COMMANDS) in the
// console renderer. Every payload is validated: a malformed command
// is ignored with a warning, never thrown.
// ============================================================

import type { Effect } from '@shared/types'
import { normalizeEffect } from '@shared/show-format'
import type { SaveShowCommandPayload } from '@shared/remote-commands'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useExecutorStore } from '@renderer/stores/executor-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import {
  toggleTimeline,
  startTimeline,
  stopTimeline,
  rewindTimeline,
  setTimelineTime
} from './timeline-engine'
import { clearProgrammer, setProgrammerChannel, releaseProgrammerChannels } from './dmx-mixer'
import { handleTapTempo } from './midi-manager'
import { saveShow, adoptRemoteShow } from './show-io'

export interface Command {
  type: string
  payload?: unknown
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function optBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function isCell(v: unknown): v is { col: number; row: number } {
  return isObj(v) && Number.isInteger(v.col) && Number.isInteger(v.row)
}

/** Upsert an effect coming from a remote into the store and run it (phase kept when running). */
function startRemoteEffect(payload: unknown): void {
  const effect = normalizeEffect(payload)
  if (!effect || !isId((payload as Obj).id)) return
  const store = useEffectsStore.getState()
  const existing = store.effects.find(e => e.id === effect.id)
  const running: Effect = { ...effect, isRunning: true }
  if (existing) {
    store.updateEffect(effect.id, running)
  } else {
    useEffectsStore.setState({ effects: [...store.effects, { ...effect, isRunning: false }] })
    useEffectsStore.getState().setEffectRunning(effect.id, true)
  }
}

function setProgrammerFromPayload(payload: unknown): void {
  if (!isObj(payload)) return
  for (const [u, channels] of Object.entries(payload)) {
    const universe = Number(u)
    if (!Number.isInteger(universe) || !isObj(channels)) continue
    for (const [ch, value] of Object.entries(channels)) {
      const channel = Number(ch)
      const v = finite(value)
      if (Number.isInteger(channel) && v !== undefined) setProgrammerChannel(universe, channel, v)
    }
  }
}

function releaseProgrammerFromPayload(payload: unknown): void {
  if (!isObj(payload)) return
  const clean: Record<number, number[]> = {}
  for (const [u, channels] of Object.entries(payload)) {
    const universe = Number(u)
    if (!Number.isInteger(universe) || !Array.isArray(channels)) continue
    clean[universe] = channels.filter((c): c is number => Number.isInteger(c))
  }
  releaseProgrammerChannels(clean)
}

/** Execute one command. Unknown or malformed commands are ignored. */
export function handleCommand(cmd: Command): void {
  if (!cmd || typeof cmd.type !== 'string') return
  const p = cmd.payload
  const dmx = useDmxStore.getState()
  const playback = usePlaybackStore.getState()

  switch (cmd.type) {
    // ---- Masters ----
    case 'set-grand-master': {
      const v = finite(p)
      if (v !== undefined) dmx.setGrandMaster(v)
      break
    }
    case 'toggle-blackout':
      dmx.toggleBlackout()
      break
    case 'set-blackout':
      if (typeof p === 'boolean') dmx.setBlackout(p)
      break
    case 'toggle-blinder':
      dmx.toggleBlinder(optBool(p))
      break
    case 'toggle-strobe':
      dmx.toggleStrobe(optBool(p))
      break
    case 'set-strobe-rate': {
      const v = finite(p)
      if (v !== undefined) dmx.setStrobeRate(v)
      break
    }
    case 'reset-all':
      dmx.resetAll()
      break

    // ---- Timeline ----
    case 'toggle-timeline':
      toggleTimeline()
      break
    case 'start-timeline':
      startTimeline()
      break
    case 'stop-timeline':
      stopTimeline()
      break
    case 'rewind-timeline':
      rewindTimeline()
      break
    case 'set-timeline-time': {
      const t = finite(p)
      if (t !== undefined) setTimelineTime(t)
      break
    }

    // ---- Scenes ----
    case 'go-cuelist':
      if (isId(p)) playback.goCuelist(p)
      break
    case 'go-back-cuelist':
      if (isId(p)) playback.goBackCuelist(p)
      break
    case 'stop-cuelist':
      if (isId(p)) playback.stopCuelist(p)
      break
    case 'set-cuelist-fader': {
      const level = isObj(p) ? finite(p.level) : undefined
      if (isObj(p) && isId(p.id) && level !== undefined) playback.setCuelistFader(p.id, level)
      break
    }
    case 'flash-cuelist':
      if (isObj(p) && isId(p.id) && typeof p.on === 'boolean') playback.flashCuelist(p.id, p.on)
      break
    case 'release-all':
      playback.releaseAll()
      break

    // ---- Chases ----
    case 'toggle-chase':
      if (isId(p)) playback.toggleChase(p)
      else if (isObj(p) && isId(p.id)) playback.toggleChase(p.id, optBool(p.on))
      break
    case 'set-chase-bpm': {
      const bpm = isObj(p) ? finite(p.bpm) : undefined
      if (isObj(p) && isId(p.id) && bpm !== undefined) playback.setChaseBpm(p.id, bpm)
      break
    }
    case 'set-chase-fader': {
      const level = isObj(p) ? finite(p.level) : undefined
      if (isObj(p) && isId(p.id) && level !== undefined) playback.setChaseFader(p.id, level)
      break
    }
    case 'tap-tempo':
      handleTapTempo(isId(p) ? p : undefined)
      break

    // ---- Effects ----
    case 'start-effect':
      startRemoteEffect(p)
      break
    case 'stop-effect':
      if (isId(p)) useEffectsStore.getState().setEffectRunning(p, false)
      break
    case 'stop-all-effects':
      useEffectsStore.getState().stopAllEffects()
      break

    // ---- Selection / programmer ----
    case 'select-group': {
      const group = usePatchStore.getState().groups.find(g => g.id === p)
      if (group) usePatchStore.setState({ selectedFixtureIds: [...group.fixtureIds] })
      break
    }
    case 'select-all':
      usePatchStore.getState().selectAll()
      break
    case 'clear-selection':
      usePatchStore.getState().clearSelection()
      break
    case 'clear-programmer':
      clearProgrammer()
      break
    case 'set-programmer-channels':
      setProgrammerFromPayload(p)
      break
    case 'release-programmer-channels':
      releaseProgrammerFromPayload(p)
      break

    // ---- Executor layout ----
    case 'swap-cells':
      if (isObj(p) && isCell(p.from) && isCell(p.to)) useExecutorStore.getState().swapCells(p.from, p.to)
      break
    case 'set-executor-layout':
      if (isObj(p)) {
        useExecutorStore.getState().applyRemote({
          grid: Array.isArray(p.grid) ? p.grid : undefined,
          columns: Array.isArray(p.columns) ? p.columns : undefined,
          modes: Array.isArray(p.modes) ? p.modes : undefined
        })
      }
      break

    // ---- Internal (main → renderer) ----
    case 'apply-show':
      if (p) void adoptRemoteShow(p)
      break
    case 'save-show': {
      const requestId = isObj(p) && isId(p.requestId) ? (p as unknown as SaveShowCommandPayload).requestId : undefined
      void saveShow({ requestId }).then((result) => {
        // Another show operation was running: answer the remote once it is done
        if (result.status === 'busy') setTimeout(() => void saveShow({ requestId }), 750)
      })
      break
    }

    default:
      console.warn('[Command] Unknown command:', cmd.type)
  }
}
