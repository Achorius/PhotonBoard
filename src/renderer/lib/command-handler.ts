// ============================================================
// PhotonBoard — Command handler
// Executes the commands sent by the Stage window, remote browsers
// (REMOTE_COMMANDS + WEB_REMOTE_COMMANDS: content sync, record),
// Companion (REMOTE_COMMANDS) and main (INTERNAL_COMMANDS) in the
// console renderer. Commands relayed by the web server carry the
// connection's clientId: momentary holds (flash, TRIG, blinder,
// strobe) are released when that client disconnects. Every payload is validated: a malformed command
// is ignored with a warning, never thrown.
// ============================================================

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
import { applyContentFromRemote, collectCurrentContent, withContentBump } from './content-sync'
import { ClientHolds } from './client-holds'
import { t } from '@renderer/i18n'
import { getBridge } from './runtime'
import { performRecord } from '@renderer/components/playback/record'
import { columnFader, defaultButtonFn, executorCellAt, executorPress } from './pro/executor-actions'
import { tapSpeedMaster } from './pro/speed-masters'
import { usePoolStore } from '@renderer/stores/pool-store'
import { runCommandLine, runMacro } from './cli'

export interface Command {
  type: string
  payload?: unknown
  /** Web remote connection that sent it (set by main, never by the client) */
  clientId?: string
}

/** What each web remote client is holding down (released when it disconnects) */
const holds = new ClientHolds()

/** Executor mode of a scene's cell, current page first (TRIG = held while pressed) */
function executorMode(cuelistId: string): string | undefined {
  return useExecutorStore.getState().findCell('cuelist', cuelistId)?.cell.mode
}

/** A remote client went away: nothing it was holding may stay on */
function releaseClient(clientId: string): void {
  const r = holds.release(clientId)
  const playback = usePlaybackStore.getState()
  for (const id of r.flash) playback.flashCuelist(id, false)
  for (const id of r.trigger) {
    if (usePlaybackStore.getState().cuelists.some(c => c.id === id && c.isPlaying)) playback.stopCuelist(id)
  }
  const dmx = useDmxStore.getState()
  if (r.blinder && dmx.blinder) dmx.toggleBlinder(false)
  if (r.strobe && dmx.strobe) dmx.toggleStrobe(false)
  if (r.flash.length || r.trigger.length || r.blinder || r.strobe) {
    console.log(`[Command] remote ${clientId} disconnected — released ${r.flash.length + r.trigger.length} scene(s)${r.blinder ? ', blinder' : ''}${r.strobe ? ', strobe' : ''}`)
  }
}

const SAVE_BUSY_WAIT_MS = 12_000
const SAVE_RETRY_MS = 250

/**
 * A remote pressed Save. If another show operation is running, wait for it
 * (main waits up to 15 s); past that, answer the remote with a clear error
 * instead of letting it time out.
 */
async function saveForRemote(requestId: string | undefined): Promise<void> {
  const deadline = Date.now() + SAVE_BUSY_WAIT_MS
  for (;;) {
    const result = await saveShow({ requestId })
    if (!requestId) return
    if (result.status === 'error') {
      // When the save never reached main, main is still waiting: answer it (ignored otherwise)
      getBridge()?.remote.replyToMain(requestId, { error: result.error || t('errors.consoleSaveFailed') })
      return
    }
    if (result.status !== 'busy') return
    if (Date.now() >= deadline) {
      getBridge()?.remote.replyToMain(requestId, { error: t('errors.consoleBusy') })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, SAVE_RETRY_MS))
  }
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

/**
 * Start an effect by id (a running one keeps its phase). Legacy payload: a
 * whole Effect — only used to CREATE an unknown effect, never to overwrite
 * the console's definition (remote edits travel with the content sync).
 */
function startRemoteEffect(payload: unknown): void {
  const store = useEffectsStore.getState()
  const id = isId(payload) ? payload : isObj(payload) && isId(payload.id) ? payload.id : undefined
  if (!id) return
  const existing = store.effects.find(e => e.id === id)
  if (existing) {
    if (!existing.isRunning) store.setEffectRunning(id, true)
    return
  }
  if (!isObj(payload)) return
  const effect = normalizeEffect(payload)
  if (!effect) return
  useEffectsStore.setState({ effects: [...store.effects, { ...effect, isRunning: false }] })
  useEffectsStore.getState().setEffectRunning(effect.id, true)
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

/** Longest command line accepted from a remote */
const MAX_CLI_LENGTH = 1000

/**
 * 'executor' { page, col, row, phase }: press / release a cell. Held scene
 * cells (TRIG / FLASH) are remembered per client and released when it
 * disconnects, like 'go-cuelist' / 'flash-cuelist'.
 */
function pressExecutorFromPayload(p: unknown, clientId: string | undefined): void {
  if (!isObj(p) || !Number.isInteger(p.col) || !Number.isInteger(p.row)) return
  const phase = p.phase === 'up' ? 'up' : p.phase === 'down' ? 'down' : null
  if (!phase) return
  const ex = useExecutorStore.getState()
  const page = p.page === 'current' || p.page === undefined ? ex.currentPage : Number.isInteger(p.page) ? (p.page as number) : -1
  if (page < 0 || page >= ex.pages.length) return
  const ref = { page, col: p.col as number, row: p.row as number }
  const cell = executorCellAt(ref)
  if (!cell) return
  if (clientId && cell.kind === 'cuelist') {
    const fn = cell.button ?? defaultButtonFn(cell.mode)
    if (fn === 'temp') holds.trigger(clientId, cell.id, phase === 'down')
    else if (fn === 'flash' || fn === 'swap') holds.flash(clientId, cell.id, phase === 'down')
  }
  executorPress(ref, phase, { clientId })
}

function setExecutorPageFromPayload(p: unknown): void {
  const ex = useExecutorStore.getState()
  if (Number.isInteger(p)) ex.setPage(p as number)
  else if (isObj(p) && Number.isInteger(p.page)) ex.setPage(p.page as number)
  else if (isObj(p) && (p.delta === 1 || p.delta === -1)) ex.setPage(ex.currentPage + (p.delta as number))
}

/** 'column-fader' { page, col, level }: the column's fader function, like the console's own fader */
function columnFaderFromPayload(p: unknown): void {
  if (!isObj(p) || !Number.isInteger(p.col)) return
  const level = finite(p.level)
  if (level === undefined) return
  const ex = useExecutorStore.getState()
  const page = p.page === 'current' || p.page === undefined ? ex.currentPage : Number.isInteger(p.page) ? (p.page as number) : -1
  if (page < 0 || page >= ex.pages.length) return
  columnFader(page, p.col as number, level)
}

function runMacroFromPayload(p: unknown): void {
  if (isId(p)) runMacro(p)
  else if (isObj(p) && isId(p.id)) runMacro(p.id)
  else if (isObj(p) && Number.isInteger(p.number)) runMacro(p.number as number)
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
    case 'toggle-blinder': {
      const on = optBool(p)
      if (cmd.clientId && on !== undefined) holds.blinder(cmd.clientId, on)
      dmx.toggleBlinder(on)
      break
    }
    case 'toggle-strobe': {
      const on = optBool(p)
      if (cmd.clientId && on !== undefined) holds.strobe(cmd.clientId, on)
      dmx.toggleStrobe(on)
      break
    }
    case 'set-strobe-rate': {
      const v = finite(p)
      if (v !== undefined) dmx.setStrobeRate(v)
      break
    }
    case 'set-strobe-mode':
      if (p === 'white' || p === 'look') dmx.setStrobeMode(p)
      break
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
      if (isId(p)) {
        // A TRIG executor plays while pressed: remember who holds it
        if (cmd.clientId && executorMode(p) === 'trigger') holds.trigger(cmd.clientId, p, true)
        playback.goCuelist(p)
      }
      break
    case 'go-back-cuelist':
      if (isId(p)) playback.goBackCuelist(p)
      break
    case 'stop-cuelist':
      if (isId(p)) {
        if (cmd.clientId) holds.trigger(cmd.clientId, p, false)
        playback.stopCuelist(p)
      }
      break
    case 'set-cuelist-fader': {
      const level = isObj(p) ? finite(p.level) : undefined
      if (isObj(p) && isId(p.id) && level !== undefined) playback.setCuelistFader(p.id, level)
      break
    }
    case 'flash-cuelist':
      if (isObj(p) && isId(p.id) && typeof p.on === 'boolean') {
        if (cmd.clientId) holds.flash(cmd.clientId, p.id, p.on)
        playback.flashCuelist(p.id, p.on)
      }
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
    case 'set-executor-page':
      setExecutorPageFromPayload(p)
      break
    case 'executor':
      pressExecutorFromPayload(p, cmd.clientId)
      break
    case 'column-fader':
      columnFaderFromPayload(p)
      break

    // ---- Pro: group / speed masters ----
    case 'set-group-master': {
      const level = isObj(p) ? finite(p.level) : undefined
      if (isObj(p) && isId(p.id) && level !== undefined && usePatchStore.getState().groups.some(g => g.id === p.id)) {
        usePoolStore.getState().setGroupMaster(p.id, level)
      }
      break
    }
    case 'tap-speed-master': {
      const id = isId(p) ? p : isObj(p) && isId(p.id) ? p.id : undefined
      if (id && usePoolStore.getState().speedMasters.some(m => m.id === id)) tapSpeedMaster(id)
      break
    }
    case 'set-speed-master-bpm': {
      const bpm = isObj(p) ? finite(p.bpm) : undefined
      if (isObj(p) && isId(p.id) && bpm !== undefined && bpm > 0) usePoolStore.getState().setSpeedMasterBpm(p.id, bpm)
      break
    }

    // ---- Pro: macros, command line ----
    case 'run-macro':
      runMacroFromPayload(p)
      break
    case 'cli':
      if (isObj(p) && typeof p.text === 'string' && p.text.length <= MAX_CLI_LENGTH) {
        const origin = typeof p.origin === 'string' && p.origin.length <= 64 ? p.origin : cmd.clientId
        runCommandLine(p.text, origin)
      }
      break

    // ---- Web remote: content edits and recording ----
    case 'apply-show-content':
      if (!applyContentFromRemote(p)) console.warn('[Command] malformed apply-show-content ignored')
      break
    case 'record': {
      // Recorded with the CONSOLE's programmer; the section is bumped even when
      // nothing was recorded so the remote drops its provisional copy
      const action = isObj(p) ? p.action : undefined
      const section = action === 'new-chase' || action === 'add-step' || action === 'update-step' ? 'chases' : 'cuelists'
      withContentBump([section], () => { performRecord(p) })
      break
    }

    // ---- Internal (main → renderer) ----
    case 'apply-show':
      if (p) void adoptRemoteShow(p)
      break
    case 'save-show': {
      const requestId = isObj(p) && isId(p.requestId) ? (p as unknown as SaveShowCommandPayload).requestId : undefined
      void saveForRemote(requestId)
      break
    }
    case 'collect-show-content': {
      if (!isObj(p) || !isId(p.requestId)) break
      const origin = typeof p.origin === 'string' ? p.origin : undefined
      const sections = Array.isArray(p.sections) ? p.sections.filter((x): x is string => typeof x === 'string') : undefined
      let answer: unknown
      try {
        answer = collectCurrentContent(origin, sections)
      } catch (e) {
        answer = { success: false, error: e instanceof Error ? e.message : t('errors.consoleCollectFailed') }
      }
      getBridge()?.remote.replyToMain(p.requestId, answer)
      break
    }
    case 'client-disconnected':
      if (isObj(p) && isId(p.clientId)) releaseClient(p.clientId)
      break

    default:
      console.warn('[Command] Unknown command:', cmd.type)
  }
}
