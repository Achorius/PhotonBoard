// ============================================================
// PhotonBoard — Generic controller profiles (P2)
//   Akai APC40 mkII · Novation Launchpad Mini mk3 / Launchpad X ·
//   Behringer X-Touch Mini · Korg nanoKONTROL2
//
// Constants written from the manufacturers' published MIDI
// implementation charts as remembered. EVERY number here is marked
// VERIFY: they could not be checked against the hardware. Each block
// is self-contained so a wrong note / CC is a one-line fix.
//
// Control ids follow the layout roles (layouts.ts): pad:col:row,
// track:i (page select), scene:i (GO, Back, Release all, Blackout,
// Blinder, Strobe, Tap, Clear), fader:0-7 (columns), fader:8 (Grand
// Master), encoder:i, page:- / page:+, shift. Controls without a role
// (knobs, crossfader…) are listed so the monitor and mini-map show
// them, but no layout binds them.
// ============================================================

import type { ControlDef, ControlId, ControllerProfile, LedState } from '../controller-types'
import { abletonPalette, scaleColor } from '../palette'
import { controlIndex, padId } from './akai-apc-mini'

/** Palette index for an LED state's colour (dim = darker shade of the palette) */
function paletteIndex(state: LedState, dimFactor = 0.3): number {
  const color = state.mode === 'dim' ? scaleColor(state.color, dimFactor) : state.color
  const i = abletonPalette.nearest(color)
  return i === 0 ? 1 : i
}

function singleColour(state: LedState, on = 1, blink = 2): number {
  return state.mode === 'off' ? 0 : state.mode === 'blink' || state.mode === 'pulse' ? blink : on
}

// ============================================================
// Akai APC40 mkII
// ============================================================

export const APC40_MK2 = {
  PORT: /APC40 mkII|APC40 mk2/i,
  /** Alternate Ableton Live mode (0x42): every button momentary, LEDs driven by the host — VERIFY */
  INIT: [0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, 0x42, 0x00, 0x00, 0x00, 0xf7],
  /** Clip launch grid 8 × 5, notes 0-39 on channel 1, note 0 bottom-left — VERIFY */
  PAD_ROWS: 5,
  /** Scene launch 1-5 (green LEDs): notes 82-86 ch1 — VERIFY */
  SCENE_FIRST_NOTE: 82,
  STOP_ALL_NOTE: 81,
  TAP_NOTE: 99,
  SHIFT_NOTE: 98,
  /** Track select: note 51 on channels 1-8 — VERIFY */
  TRACK_SELECT_NOTE: 51,
  /** Track faders CC 7 on channels 1-8, master CC 14, crossfader CC 15 (ch1) — VERIFY */
  FADER_CC: 7,
  MASTER_CC: 14,
  CROSSFADER_CC: 15,
  /** Track knobs CC 48-55 ch1 (LED rings) */
  KNOB_FIRST_CC: 48,
  /** RGB pad behaviour channel (1-based): 1 solid · 9 pulse 1/8 · 15 blink 1/4 — VERIFY */
  PAD_CHANNEL: { ON: 1, PULSE: 9, BLINK: 15 }
} as const

function apc40Controls(): ControlDef[] {
  const C = APC40_MK2
  const out: ControlDef[] = []
  for (let row = 0; row < C.PAD_ROWS; row++) {
    for (let col = 0; col < 8; col++) {
      out.push({ id: padId(col, row), kind: 'pad', type: 'note', channel: 1, number: (C.PAD_ROWS - 1 - row) * 8 + col })
    }
  }
  for (let i = 0; i < 8; i++) out.push({ id: `track:${i}`, kind: 'button', type: 'note', channel: i + 1, number: C.TRACK_SELECT_NOTE })
  for (let i = 0; i < 5; i++) out.push({ id: `scene:${i}`, kind: 'button', type: 'note', channel: 1, number: C.SCENE_FIRST_NOTE + i })
  out.push({ id: 'scene:5', kind: 'button', type: 'note', channel: 1, number: C.STOP_ALL_NOTE })
  out.push({ id: 'scene:6', kind: 'button', type: 'note', channel: 1, number: C.TAP_NOTE })
  out.push({ id: 'shift', kind: 'button', type: 'note', channel: 1, number: C.SHIFT_NOTE })
  for (let i = 0; i < 8; i++) out.push({ id: `fader:${i}`, kind: 'fader', type: 'cc', channel: i + 1, number: C.FADER_CC })
  out.push({ id: 'fader:8', kind: 'fader', type: 'cc', channel: 1, number: C.MASTER_CC })
  out.push({ id: 'xfade', kind: 'fader', type: 'cc', channel: 1, number: C.CROSSFADER_CC })
  for (let i = 0; i < 8; i++) out.push({ id: `knob:${i}`, kind: 'encoder', type: 'cc', channel: 1, number: C.KNOB_FIRST_CC + i })
  return out
}

const apc40List = apc40Controls()
const apc40Index = controlIndex(apc40List)

export const apc40Mk2: ControllerProfile = {
  id: 'akai-apc40-mk2',
  name: 'Akai APC40 mkII',
  vendor: 'Akai',
  matchInput: APC40_MK2.PORT,
  needsSysex: true,
  init: [[...APC40_MK2.INIT]],
  controls: apc40List,
  grid: { cols: 8, rows: APC40_MK2.PAD_ROWS, pad: padId },
  encodeLeds(changes) {
    const out: number[][] = []
    const P = APC40_MK2.PAD_CHANNEL
    for (const [id, state] of changes) {
      const c = apc40Index.get(id)
      if (!c || c.type !== 'note' || id === 'shift') continue
      if (c.kind === 'pad') {
        if (state.mode === 'off') { out.push([0x90, c.number, 0]); continue }
        const ch = state.mode === 'pulse' ? P.PULSE : state.mode === 'blink' ? P.BLINK : P.ON
        out.push([0x90 | (ch - 1), c.number, paletteIndex(state)])
      } else {
        out.push([0x90 | (c.channel - 1), c.number, singleColour(state)])
      }
    }
    return out
  },
  defaultLayouts: ['executors-2pages', 'executors-busk']
}

// ============================================================
// Novation Launchpad Mini mk3 / Launchpad X (programmer mode)
// ============================================================

export const LAUNCHPAD = {
  MINI_MK3_PORT: /LPMiniMK3|Launchpad Mini MK3/i,
  X_PORT: /LPX|Launchpad X/i,
  /** Second port pair (DAW) and Windows' MIDIIN2/MIDIOUT2 aliases of it */
  IGNORE_PORT: /DAW|MIDIIN2|MIDIOUT2/i,
  /** Select programmer mode: F0 00 20 29 02 <device> 0E 01 F7 (Mini mk3 = 0D, X = 0C) — VERIFY */
  MINI_MK3_INIT: [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7],
  X_INIT: [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7],
  /** Pads: note 10 * row + col, row 1 = bottom, col 1 = left (11…88) */
  /** Top row CC 91-98 (arrows, Session, Drums/Note, Keys/Custom, User) */
  TOP_FIRST_CC: 91,
  /** Right column CC 89, 79 … 19 (top → bottom) */
  SIDE_TOP_CC: 89,
  /** LED channel (1-based): 1 static, 2 flash (alternates with the static colour), 3 pulse */
  LED_CHANNEL: { STATIC: 1, FLASH: 2, PULSE: 3 }
} as const

export function launchpadPadNote(col: number, rowFromTop: number): number {
  return (8 - rowFromTop) * 10 + col + 1
}

function launchpadControls(): ControlDef[] {
  const out: ControlDef[] = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) out.push({ id: padId(col, row), kind: 'pad', type: 'note', channel: 1, number: launchpadPadNote(col, row) })
  }
  for (let i = 0; i < 8; i++) out.push({ id: `track:${i}`, kind: 'button', type: 'cc', channel: 1, number: LAUNCHPAD.TOP_FIRST_CC + i })
  for (let i = 0; i < 8; i++) out.push({ id: `scene:${i}`, kind: 'button', type: 'cc', channel: 1, number: LAUNCHPAD.SIDE_TOP_CC - i * 10 })
  return out
}

/** Launchpad LED messages: RGB palette everywhere, static / flash / pulse by channel */
export function launchpadLedMessages(c: ControlDef, state: LedState): number[][] {
  const base = c.type === 'note' ? 0x90 : 0xb0
  const L = LAUNCHPAD.LED_CHANNEL
  if (state.mode === 'off') return [[base | (L.STATIC - 1), c.number, 0]]
  const index = paletteIndex(state)
  if (state.mode === 'blink') return [[base | (L.STATIC - 1), c.number, 0], [base | (L.FLASH - 1), c.number, index]]
  if (state.mode === 'pulse') return [[base | (L.PULSE - 1), c.number, index]]
  return [[base | (L.STATIC - 1), c.number, index]]
}

function makeLaunchpad(id: string, name: string, port: RegExp, init: readonly number[]): ControllerProfile {
  const list = launchpadControls()
  const index = controlIndex(list)
  return {
    id,
    name,
    vendor: 'Novation',
    matchInput: port,
    ignorePorts: LAUNCHPAD.IGNORE_PORT,
    needsSysex: true,
    init: [[...init]],
    controls: list,
    grid: { cols: 8, rows: 8, pad: padId },
    encodeLeds(changes) {
      const out: number[][] = []
      for (const [cid, state] of changes) {
        const c = index.get(cid)
        if (c) for (const m of launchpadLedMessages(c, state)) out.push(m)
      }
      return out
    },
    defaultLayouts: ['executors-2pages', 'executors-busk']
  }
}

export const launchpadMiniMk3 = makeLaunchpad('novation-launchpad-mini-mk3', 'Novation Launchpad Mini mk3', LAUNCHPAD.MINI_MK3_PORT, LAUNCHPAD.MINI_MK3_INIT)
export const launchpadX = makeLaunchpad('novation-launchpad-x', 'Novation Launchpad X', LAUNCHPAD.X_PORT, LAUNCHPAD.X_INIT)

// ============================================================
// Behringer X-Touch Mini (standard mode, layer A)
// ============================================================

export const X_TOUCH_MINI = {
  PORT: /X-TOUCH MINI/i,
  /** Standard mode sends layer A on channel 11 — VERIFY (global channel can be changed in X-Touch Editor) */
  CHANNEL: 11,
  /** 8 encoders CC 1-8 (absolute, LED ring follows the CC we send back) */
  ENCODER_FIRST_CC: 1,
  /** Encoder push: notes 0-7 */
  PUSH_FIRST_NOTE: 0,
  /** Buttons: top row notes 8-15, bottom row 16-23 */
  BUTTON_FIRST_NOTE: 8,
  /** Fader CC 9 */
  FADER_CC: 9,
  /** Button LED velocity: 0 off · 1 on · 2 blink — VERIFY */
  BUTTON_LED: { OFF: 0, ON: 1, BLINK: 2 }
} as const

function xTouchControls(): ControlDef[] {
  const X = X_TOUCH_MINI
  const out: ControlDef[] = []
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 8; col++) out.push({ id: padId(col, row), kind: 'pad', type: 'note', channel: X.CHANNEL, number: X.BUTTON_FIRST_NOTE + row * 8 + col })
  }
  for (let i = 0; i < 8; i++) out.push({ id: `encoder:${i}`, kind: 'encoder', type: 'cc', channel: X.CHANNEL, number: X.ENCODER_FIRST_CC + i })
  for (let i = 0; i < 8; i++) out.push({ id: `push:${i}`, kind: 'button', type: 'note', channel: X.CHANNEL, number: X.PUSH_FIRST_NOTE + i })
  out.push({ id: 'fader:8', kind: 'fader', type: 'cc', channel: X.CHANNEL, number: X.FADER_CC })
  return out
}

const xTouchList = xTouchControls()
const xTouchIndex = controlIndex(xTouchList)

export const xTouchMini: ControllerProfile = {
  id: 'behringer-x-touch-mini',
  name: 'Behringer X-Touch Mini',
  vendor: 'Behringer',
  matchInput: X_TOUCH_MINI.PORT,
  controls: xTouchList,
  grid: { cols: 8, rows: 2, pad: padId },
  encodeLeds(changes) {
    const out: number[][] = []
    const B = X_TOUCH_MINI.BUTTON_LED
    for (const [id, state] of changes) {
      const c = xTouchIndex.get(id)
      if (!c || c.type !== 'note' || c.kind !== 'pad') continue
      out.push([0x90 | (c.channel - 1), c.number, singleColour(state, B.ON, B.BLINK)])
    }
    return out
  },
  defaultLayouts: ['executors-2pages', 'executors-busk']
}

// ============================================================
// Korg nanoKONTROL2 (CC mode, LED mode "External" set in Korg Kontrol Editor)
// ============================================================

export const NANO_KONTROL2 = {
  PORT: /nanoKONTROL2/i,
  CHANNEL: 1,
  FADER_FIRST_CC: 0,
  KNOB_FIRST_CC: 16,
  /** S / M / R buttons per channel strip → pad rows 0 / 1 / 2 */
  SOLO_FIRST_CC: 32,
  MUTE_FIRST_CC: 48,
  REC_FIRST_CC: 64,
  /** Transport → scene roles: play GO · rewind Back · stop Release all · record Blackout · forward Blinder · marker ◀ Strobe · cycle Tap · marker set Clear */
  TRANSPORT: { PLAY: 41, REWIND: 43, STOP: 42, RECORD: 45, FORWARD: 44, MARKER_PREV: 61, CYCLE: 46, MARKER_SET: 60, MARKER_NEXT: 62 },
  /** Track ◀ / ▶ → page − / + */
  TRACK_PREV: 58,
  TRACK_NEXT: 59
} as const

function nanoControls(): ControlDef[] {
  const N = NANO_KONTROL2
  const ch = N.CHANNEL
  const out: ControlDef[] = []
  const rows = [N.SOLO_FIRST_CC, N.MUTE_FIRST_CC, N.REC_FIRST_CC]
  rows.forEach((first, row) => {
    for (let col = 0; col < 8; col++) out.push({ id: padId(col, row), kind: 'pad', type: 'cc', channel: ch, number: first + col })
  })
  for (let i = 0; i < 8; i++) out.push({ id: `fader:${i}`, kind: 'fader', type: 'cc', channel: ch, number: N.FADER_FIRST_CC + i })
  for (let i = 0; i < 8; i++) out.push({ id: `knob:${i}`, kind: 'fader', type: 'cc', channel: ch, number: N.KNOB_FIRST_CC + i })
  const T = N.TRANSPORT
  const scenes = [T.PLAY, T.REWIND, T.STOP, T.RECORD, T.FORWARD, T.MARKER_PREV, T.CYCLE, T.MARKER_SET]
  scenes.forEach((cc, i) => out.push({ id: `scene:${i}`, kind: 'button', type: 'cc', channel: ch, number: cc }))
  out.push({ id: 'marker-next', kind: 'button', type: 'cc', channel: ch, number: T.MARKER_NEXT })
  out.push({ id: 'page:-', kind: 'button', type: 'cc', channel: ch, number: N.TRACK_PREV })
  out.push({ id: 'page:+', kind: 'button', type: 'cc', channel: ch, number: N.TRACK_NEXT })
  return out
}

const nanoList = nanoControls()
const nanoIndex = controlIndex(nanoList)

/** Buttons with an LED on the nanoKONTROL2 (S/M/R, transport); track / marker buttons have none */
function nanoHasLed(id: ControlId): boolean {
  return id.startsWith('pad:') || (id.startsWith('scene:') && id !== 'scene:5' && id !== 'scene:7')
}

export const nanoKontrol2: ControllerProfile = {
  id: 'korg-nanokontrol2',
  name: 'Korg nanoKONTROL2',
  vendor: 'Korg',
  matchInput: NANO_KONTROL2.PORT,
  // LEDs are on/off only: the feedback engine blinks them itself
  softBlink: true,
  controls: nanoList,
  grid: { cols: 8, rows: 3, pad: padId },
  encodeLeds(changes) {
    const out: number[][] = []
    for (const [id, state] of changes) {
      const c = nanoIndex.get(id)
      if (!c || !nanoHasLed(id)) continue
      out.push([0xb0 | (c.channel - 1), c.number, state.mode === 'off' ? 0 : 127])
    }
    return out
  },
  defaultLayouts: ['executors-2pages', 'executors-busk']
}
