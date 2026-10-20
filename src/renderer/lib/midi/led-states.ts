// ============================================================
// PhotonBoard — Controller LED states (pure)
//
// From a snapshot of the show state, the LED of every bound control:
//
//   executor   empty                 off
//              assigned, stopped     dim  column colour   (mk1 yellow · mk2 25 %)
//              playing               on   column colour   (mk1 green  · mk2 100 %)
//              fading                pulse column colour  (mk1 green blink · mk2 pulse 1/8)
//              held flash / temp     on   white           (mk1 red)
//              GO / Back target      blink column colour  (mk1 red blink · mk2 blink 1/4)
//              MIDI learn target     blink violet         (mk1 yellow blink)
//   page       current on · something playing on it blink · else off
//   GO / Back  on when there is a target · Release all: on when something plays
//   Blackout   blink when on · Blinder / Strobe on while on · Tap blinks
//   on the beat · Clear on while the programmer holds values
//   busk       group / preset / macro: dim when it exists (its colour),
//              macro on while running
//
// Executor and function controls overridden by a user MIDI mapping are
// left to that mapping (off here).
// ============================================================

import type { Chase, Cuelist, ExecutorCell, ExecutorPage, Group, Macro, Preset } from '@shared/types'
import type { ExecutorRef } from '@renderer/lib/pro/contracts'
import type { ControlId, ControllerAction, ControllerBinding, LedState } from './controller-types'
import {
  LED_BACK, LED_BLACKOUT, LED_BLINDER, LED_GO, LED_HELD, LED_LEARN, LED_NEUTRAL, LED_OFF, LED_PAGE,
  LED_PROGRAMMER, LED_RELEASE, LED_STROBE, LED_TAP, led
} from './led-colors'
import { resolveGroupRef, resolveMacroRef, resolvePresetRef } from './pool-refs'

export interface FeedbackSnapshot {
  pages: readonly ExecutorPage[]
  currentPage: number
  cuelistById: ReadonlyMap<string, Cuelist>
  chaseById: ReadonlyMap<string, Chase>
  /** Running state of effects */
  effectRunning: ReadonlyMap<string, boolean>
  groups: readonly Group[]
  presets: readonly Preset[]
  macros: readonly Macro[]
  /** Executor GO / Back act on */
  selected: ExecutorRef | null
  /** GO / Back have something to act on */
  goTarget: boolean
  blackout: boolean
  blinder: boolean
  strobe: boolean
  /** Object id of the MIDI learn target (null when not learning) */
  learnTargetId: string | null
  programmerActive: boolean
  /** Tap LED lit (beat phase) */
  tapOn: boolean
  /** Per page: something plays on it */
  pagePlaying: readonly boolean[]
  anythingPlaying: boolean
  isFading(cuelistId: string): boolean
  isMacroRunning(macroId: string): boolean
}

/** Per controller: controls held down (momentary) and controls a user mapping overrides */
export interface ControllerLedContext {
  held: ReadonlySet<ControlId> | ReadonlyMap<ControlId, unknown>
  overridden: ReadonlySet<ControlId>
}

/** Page index of an executor action ('current' / 'next' / index); -1 when it does not exist */
export function resolveActionPage(page: 'current' | 'next' | number, currentPage: number, pageCount: number): number {
  const p = page === 'current' ? currentPage : page === 'next' ? currentPage + 1 : page
  return Number.isInteger(p) && p >= 0 && p < pageCount ? p : -1
}

function cellActive(cell: ExecutorCell, s: FeedbackSnapshot): { exists: boolean; active: boolean; flash: boolean; fading: boolean } {
  switch (cell.kind) {
    case 'cuelist': {
      const cl = s.cuelistById.get(cell.id)
      if (!cl) return { exists: false, active: false, flash: false, fading: false }
      return { exists: true, active: cl.isPlaying, flash: cl.flash, fading: cl.isPlaying && s.isFading(cl.id) }
    }
    case 'chase': {
      const ch = s.chaseById.get(cell.id)
      return { exists: !!ch, active: !!ch?.isPlaying, flash: false, fading: false }
    }
    case 'effect': {
      const running = s.effectRunning.get(cell.id)
      return { exists: running !== undefined, active: !!running, flash: false, fading: false }
    }
    case 'macro': {
      const exists = s.macros.some((m) => m.id === cell.id)
      return { exists, active: exists && s.isMacroRunning(cell.id), flash: false, fading: false }
    }
    case 'group':
      return { exists: s.groups.some((g) => g.id === cell.id), active: false, flash: false, fading: false }
    default:
      return { exists: true, active: false, flash: false, fading: false }
  }
}

export function executorLed(s: FeedbackSnapshot, page: number, col: number, row: number, held: boolean): LedState {
  const p = s.pages[page]
  const cell = p?.cells[col]?.[row] ?? null
  if (!p || !cell) return LED_OFF
  const st = cellActive(cell, s)
  if (!st.exists) return LED_OFF
  const color = p.columns[col]?.color || LED_NEUTRAL
  if (s.learnTargetId && cell.id === s.learnTargetId) return led('blink', LED_LEARN)
  if (held || st.flash) return led('on', LED_HELD)
  const sel = s.selected
  if (sel && sel.page === page && sel.col === col && sel.row === row) return led('blink', color)
  if (st.active) return led(st.fading ? 'pulse' : 'on', color)
  return led('dim', color)
}

/** LED of one action (null = the control has no LED meaning: faders) */
export function actionLed(action: ControllerAction, s: FeedbackSnapshot, held: boolean): LedState | null {
  switch (action.type) {
    case 'executor': {
      const page = resolveActionPage(action.page, s.currentPage, s.pages.length)
      return page < 0 ? LED_OFF : executorLed(s, page, action.col, action.row, held)
    }
    case 'select-executor':
      return null
    case 'page': {
      if (action.page === '-') return s.currentPage > 0 ? led('on', LED_PAGE) : LED_OFF
      if (action.page === '+') return s.currentPage < s.pages.length - 1 ? led('on', LED_PAGE) : LED_OFF
      if (action.page >= s.pages.length) return LED_OFF
      if (action.page === s.currentPage) return led('on', LED_PAGE)
      return s.pagePlaying[action.page] ? led('blink', LED_PAGE) : LED_OFF
    }
    case 'go-selected': return s.goTarget ? led('on', LED_GO) : LED_OFF
    case 'back-selected': return s.goTarget ? led('on', LED_BACK) : LED_OFF
    case 'release-all': return s.anythingPlaying ? led('on', LED_RELEASE) : LED_OFF
    case 'clear': return s.programmerActive ? led('on', LED_PROGRAMMER) : LED_OFF
    case 'blackout': return s.blackout ? led('blink', LED_BLACKOUT) : LED_OFF
    case 'blinder': return s.blinder || held ? led('on', LED_BLINDER) : LED_OFF
    case 'strobe': return s.strobe || held ? led('on', LED_STROBE) : LED_OFF
    case 'tap': return s.tapOn ? led('on', LED_TAP) : LED_OFF
    case 'group': {
      const g = resolveGroupRef(s.groups, action.id)
      return g ? led('dim', g.color || LED_NEUTRAL) : LED_OFF
    }
    case 'preset': {
      const p = resolvePresetRef(s.presets, action.id)
      return p ? led('dim', p.color || LED_NEUTRAL) : LED_OFF
    }
    case 'macro': {
      const m = resolveMacroRef(s.macros, action.id)
      if (!m) return LED_OFF
      return led(s.isMacroRunning(m.id) ? 'on' : 'dim', m.color || LED_NEUTRAL)
    }
    case 'column-fader':
    case 'grand-master':
    case 'xfade':
      return null
  }
}

/**
 * LED state of every bound control with an LED, written into `out` (cleared
 * first). Controls overridden by a user mapping are off.
 */
export function computeLeds(bindings: readonly ControllerBinding[], s: FeedbackSnapshot, ctx: ControllerLedContext, out: Map<ControlId, LedState>): Map<ControlId, LedState> {
  out.clear()
  for (const b of bindings) {
    if (ctx.overridden.has(b.control)) {
      out.set(b.control, LED_OFF)
      continue
    }
    const state = actionLed(b.action, s, ctx.held.has(b.control))
    if (state) out.set(b.control, state)
  }
  return out
}

/**
 * Changes between what the device shows (`prev`) and `next`; `prev` is
 * updated. A control that disappeared from `next` is switched off.
 */
export function diffLeds(prev: Map<ControlId, LedState>, next: ReadonlyMap<ControlId, LedState>): [ControlId, LedState][] {
  const changes: [ControlId, LedState][] = []
  for (const [id, state] of next) {
    const before = prev.get(id)
    if (before === state || (before && before.mode === state.mode && (state.mode === 'off' || before.color === state.color))) continue
    prev.set(id, state)
    changes.push([id, state])
  }
  if (prev.size > next.size) {
    for (const [id, state] of prev) {
      if (next.has(id)) continue
      prev.delete(id)
      if (state.mode !== 'off') changes.push([id, LED_OFF])
    }
  }
  return changes
}

/** Per-page "something plays" flags */
export function computePagePlaying(pages: readonly ExecutorPage[], s: Pick<FeedbackSnapshot, 'cuelistById' | 'chaseById' | 'effectRunning'>): boolean[] {
  return pages.map((p) => p.cells.some((column) => column.some((cell) => {
    if (!cell) return false
    if (cell.kind === 'cuelist') return !!s.cuelistById.get(cell.id)?.isPlaying
    if (cell.kind === 'chase') return !!s.chaseById.get(cell.id)?.isPlaying
    if (cell.kind === 'effect') return !!s.effectRunning.get(cell.id)
    return false
  })))
}

/** Hardware without blink: blink / pulse rendered as on / off at ≈ 2 Hz */
export function softBlinkLed(state: LedState, phaseOn: boolean): LedState {
  if (state.mode !== 'blink' && state.mode !== 'pulse') return state
  return phaseOn ? led('on', state.color) : LED_OFF
}

/** "Test LEDs" frame: colour washes, then a diagonal sweep and the buttons chasing */
export const LED_TEST_MS = 3200
export function testPatternLed(id: ControlId, elapsedMs: number): LedState {
  const step = Math.floor(elapsedMs / 100)
  const pad = /^pad:(\d+):(\d+)$/.exec(id)
  if (pad) {
    const col = Number(pad[1])
    const row = Number(pad[2])
    if (elapsedMs < 1600) {
      const wash = [led('on', LED_HELD), led('on', LED_GO), led('dim', LED_BLINDER), led('on', LED_PAGE)]
      return wash[Math.floor(elapsedMs / 400) % wash.length]
    }
    return (col + row) % 15 === step % 15 ? led('on', LED_TAP) : LED_OFF
  }
  const btn = /^(track|scene|page|push|encoder):?(\d+|[+-])?$/.exec(id)
  if (btn) {
    const i = Number(btn[2])
    return Number.isFinite(i) && i === step % 8 ? led('on', LED_GO) : LED_OFF
  }
  return LED_OFF
}
