// ============================================================
// PhotonBoard — Akai APC mini (mk1) and APC mini mk2 profiles
//
// Every protocol number lives in the two constant blocks below.
// They were written from the Akai "APC mini Communication Protocol"
// (mk1) and "APC mini mk2 Communication Protocol v1.0" documents as
// remembered — entries marked VERIFY could not be checked against
// the hardware. If a button or LED misbehaves, fix the constant here:
// the controls, the LED encoder and the tests all read them.
//
// Common to both: pads = notes 0-63 on channel 1, note 0 bottom-left
// (note = (7 - rowFromTop) * 8 + col); 8 track buttons under the grid,
// 8 scene buttons on the right (top → bottom), Shift, 9 faders
// (CC 48-56, the 9th is the master). Buttons send note-on 127 / note
// -off; faders send absolute CC 0-127.
// ============================================================

import type { ControlDef, ControlId, ControllerProfile, ControllerProfileOptions, LedState } from '../controller-types'
import { LED_HELD, LED_LEARN } from '../led-colors'
import { abletonPalette, parseHex, scaleColor } from '../palette'

// ---------------- APC mini (mk1) ----------------

export const APC_MINI_MK1 = {
  /** Input / output port name. Windows/macOS: "APC MINI"; Linux ALSA: "APC MINI MIDI 1"; Windows, a second unit: "2- APC MINI" */
  PORT: /APC MINI(?!.*mk2)/i,
  CHANNEL: 1,
  PAD_FIRST_NOTE: 0,
  /** Track buttons (under the grid), left → right */
  TRACK_FIRST_NOTE: 64,
  /** Scene launch buttons (right column), top → bottom */
  SCENE_FIRST_NOTE: 82,
  SHIFT_NOTE: 98,
  /** Faders 1-8 + master (CC 56) */
  FADER_FIRST_CC: 48,
  FADER_COUNT: 9,
  /** Pad LED velocities (tri-colour LEDs). 7-127 = green. */
  PAD_LED: { OFF: 0, GREEN: 1, GREEN_BLINK: 2, RED: 3, RED_BLINK: 4, YELLOW: 5, YELLOW_BLINK: 6 },
  /** Track (red) and scene (green) button LED velocities */
  BUTTON_LED: { OFF: 0, ON: 1, BLINK: 2 }
} as const

// ---------------- APC mini mk2 ----------------

export const APC_MINI_MK2 = {
  /** Ports "APC mini mk2 Control" (ours) and "APC mini mk2 Notes" (keyboard modes, ignored) */
  PORT: /APC mini mk2/i,
  IGNORE_PORT: /Notes/i,
  CHANNEL: 1,
  PAD_FIRST_NOTE: 0,
  /** Track buttons (red LEDs), left → right */
  TRACK_FIRST_NOTE: 100,
  /** Scene launch buttons (green LEDs), top → bottom */
  SCENE_FIRST_NOTE: 112,
  SHIFT_NOTE: 122,
  FADER_FIRST_CC: 48,
  FADER_COUNT: 9,
  /**
   * Pad LED behaviour = MIDI channel of the note-on (1-based), velocity =
   * palette colour. ch1-7: brightness 10/25/50/65/75/90/100 %; ch8-11: pulse
   * 1/16, 1/8, 1/4, 1/2; ch12-16: blink 1/24, 1/16, 1/8, 1/4, 1/2.
   */
  PAD_CHANNEL: { DIM: 2 /* 25 % */, ON: 7 /* 100 % */, PULSE: 9 /* pulse 1/8 */, BLINK: 15 /* blink 1/4 */ },
  BUTTON_LED: { OFF: 0, ON: 1, BLINK: 2 },
  /** RGB SysEx: F0 47 7F 4F 24 <lenMSB> <lenLSB> {<start> <end> <Rh> <Rl> <Gh> <Gl> <Bh> <Bl>}… F7 — VERIFY */
  SYSEX_RGB: [0xf0, 0x47, 0x7f, 0x4f, 0x24],
  /** Introduction message; the device answers with its 9 fader positions — VERIFY */
  SYSEX_INTRO: [0xf0, 0x47, 0x7f, 0x4f, 0x60, 0x00, 0x04, 0x00, 0x01, 0x00, 0x00, 0xf7],
  /** Reply: F0 47 7F 4F 61 00 09 <fader 1…9> F7 — VERIFY */
  SYSEX_INTRO_REPLY: [0xf0, 0x47, 0x7f, 0x4f, 0x61],
  /** Dim pads in RGB mode: 25 % like PAD_CHANNEL.DIM */
  RGB_DIM: 0.25
} as const

// ---------------- Shared helpers ----------------

/** 'pad:col:rowFromTop' */
export function padId(col: number, rowFromTop: number): ControlId {
  return `pad:${col}:${rowFromTop}`
}

/** Note of a pad on an 8×8 grid whose note 0 is bottom-left */
export function apcPadNote(col: number, rowFromTop: number): number {
  return (7 - rowFromTop) * 8 + col
}

function apcControls(c: typeof APC_MINI_MK1 | typeof APC_MINI_MK2): ControlDef[] {
  const ch = c.CHANNEL
  const out: ControlDef[] = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      out.push({ id: padId(col, row), kind: 'pad', type: 'note', channel: ch, number: c.PAD_FIRST_NOTE + apcPadNote(col, row) })
    }
  }
  for (let i = 0; i < 8; i++) out.push({ id: `track:${i}`, kind: 'button', type: 'note', channel: ch, number: c.TRACK_FIRST_NOTE + i })
  for (let i = 0; i < 8; i++) out.push({ id: `scene:${i}`, kind: 'button', type: 'note', channel: ch, number: c.SCENE_FIRST_NOTE + i })
  out.push({ id: 'shift', kind: 'button', type: 'note', channel: ch, number: c.SHIFT_NOTE })
  for (let i = 0; i < c.FADER_COUNT; i++) out.push({ id: `fader:${i}`, kind: 'fader', type: 'cc', channel: ch, number: c.FADER_FIRST_CC + i })
  return out
}

/** Id → control lookup for an encoder */
export function controlIndex(controls: readonly ControlDef[]): Map<ControlId, ControlDef> {
  const m = new Map<ControlId, ControlDef>()
  for (const c of controls) m.set(c.id, c)
  return m
}

/** Single-colour button LED: off / on / blink */
function buttonVelocity(state: LedState, led: { OFF: number; ON: number; BLINK: number }): number {
  switch (state.mode) {
    case 'off': return led.OFF
    case 'blink':
    case 'pulse': return led.BLINK
    default: return led.ON
  }
}

// ---------------- mk1 LED encoding ----------------

/**
 * mk1 pads are green / red / yellow. Meaning (spec §3.2):
 * stopped = yellow, playing = green, fading = green blink,
 * held = red, selected = red blink, MIDI learn = yellow blink.
 */
export function mk1PadVelocity(state: LedState): number {
  const L = APC_MINI_MK1.PAD_LED
  const color = state.color.toLowerCase()
  switch (state.mode) {
    case 'off': return L.OFF
    case 'dim': return L.YELLOW
    case 'on': return color === LED_HELD ? L.RED : L.GREEN
    case 'pulse': return L.GREEN_BLINK
    case 'blink': return color === LED_LEARN ? L.YELLOW_BLINK : L.RED_BLINK
  }
}

function encodeMk1(controls: Map<ControlId, ControlDef>, changes: [ControlId, LedState][]): number[][] {
  const out: number[][] = []
  for (const [id, state] of changes) {
    const c = controls.get(id)
    if (!c || c.type !== 'note' || c.kind === 'fader') continue
    if (id === 'shift') continue // no LED
    const vel = c.kind === 'pad' ? mk1PadVelocity(state) : buttonVelocity(state, APC_MINI_MK1.BUTTON_LED)
    out.push([0x90 | (c.channel - 1), c.number, vel])
  }
  return out
}

// ---------------- mk2 LED encoding ----------------

/** [status, note, velocity] of an mk2 pad in palette mode */
export function mk2PadMessage(note: number, state: LedState): number[] {
  const C = APC_MINI_MK2.PAD_CHANNEL
  if (state.mode === 'off') return [0x90, note, 0]
  const ch = state.mode === 'dim' ? C.DIM : state.mode === 'on' ? C.ON : state.mode === 'pulse' ? C.PULSE : C.BLINK
  const index = abletonPalette.nearest(state.color)
  // A colour that maps to black would switch the pad off: use the dimmest grey
  return [0x90 | (ch - 1), note, index === 0 ? 1 : index]
}

/** RGB SysEx for solid pads, contiguous pads of one colour merged into ranges */
export function mk2RgbSysex(pads: { note: number; color: string }[]): number[] | null {
  if (pads.length === 0) return null
  const sorted = [...pads].sort((a, b) => a.note - b.note)
  const ranges: { start: number; end: number; color: string }[] = []
  for (const p of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && last.end === p.note - 1 && last.color === p.color) last.end = p.note
    else ranges.push({ start: p.note, end: p.note, color: p.color })
  }
  const body: number[] = []
  for (const r of ranges) {
    const [red, green, blue] = parseHex(r.color)
    body.push(r.start, r.end, red >> 7, red & 0x7f, green >> 7, green & 0x7f, blue >> 7, blue & 0x7f)
  }
  return [...APC_MINI_MK2.SYSEX_RGB, (body.length >> 7) & 0x7f, body.length & 0x7f, ...body, 0xf7]
}

function encodeMk2(controls: Map<ControlId, ControlDef>, changes: [ControlId, LedState][], rgb: boolean): number[][] {
  const out: number[][] = []
  const solid: { note: number; color: string }[] = []
  for (const [id, state] of changes) {
    const c = controls.get(id)
    if (!c || c.type !== 'note' || c.kind === 'fader' || id === 'shift') continue
    if (c.kind !== 'pad') {
      out.push([0x90 | (c.channel - 1), c.number, buttonVelocity(state, APC_MINI_MK2.BUTTON_LED)])
      continue
    }
    if (rgb && (state.mode === 'on' || state.mode === 'dim')) {
      solid.push({ note: c.number, color: state.mode === 'dim' ? scaleColor(state.color, APC_MINI_MK2.RGB_DIM) : state.color.toLowerCase() })
      continue
    }
    out.push(mk2PadMessage(c.number, state))
  }
  const sysex = mk2RgbSysex(solid)
  if (sysex) out.push(sysex)
  return out
}

/** Parse the mk2 introduction reply → fader positions */
export function parseMk2FaderReply(data: ArrayLike<number>): [ControlId, number][] | null {
  const head = APC_MINI_MK2.SYSEX_INTRO_REPLY
  if (data.length < head.length + 2 + APC_MINI_MK2.FADER_COUNT) return null
  for (let i = 0; i < head.length; i++) if (data[i] !== head[i]) return null
  const len = ((data[head.length] & 0x7f) << 7) | (data[head.length + 1] & 0x7f)
  const start = head.length + 2
  const count = Math.min(len, APC_MINI_MK2.FADER_COUNT, data.length - start - 1)
  const out: [ControlId, number][] = []
  for (let i = 0; i < count; i++) {
    const v = data[start + i]
    if (v >= 0 && v <= 127) out.push([`fader:${i}`, v])
  }
  return out
}

// ---------------- Profiles ----------------

const mk1Controls = apcControls(APC_MINI_MK1)
const mk1Index = controlIndex(mk1Controls)

export const apcMiniMk1: ControllerProfile = {
  id: 'akai-apc-mini',
  name: 'Akai APC mini',
  vendor: 'Akai',
  matchInput: APC_MINI_MK1.PORT,
  controls: mk1Controls,
  grid: { cols: 8, rows: 8, pad: padId },
  encodeLeds: (changes) => encodeMk1(mk1Index, changes),
  defaultLayouts: ['executors-2pages', 'executors-busk']
}

const mk2Controls = apcControls(APC_MINI_MK2)
const mk2Index = controlIndex(mk2Controls)

function makeMk2(rgb: boolean): ControllerProfile {
  const profile: ControllerProfile = {
    id: 'akai-apc-mini-mk2',
    name: 'Akai APC mini mk2',
    vendor: 'Akai',
    matchInput: APC_MINI_MK2.PORT,
    ignorePorts: APC_MINI_MK2.IGNORE_PORT,
    // SysEx: fader positions on connect (no pickup wait) and the optional exact RGB
    needsSysex: true,
    controls: mk2Controls,
    grid: { cols: 8, rows: 8, pad: padId },
    encodeLeds: (changes) => encodeMk2(mk2Index, changes, rgb),
    requestFaderPositions: [...APC_MINI_MK2.SYSEX_INTRO],
    parseFaderPositions: parseMk2FaderReply,
    rgbCapable: true,
    defaultLayouts: ['executors-2pages', 'executors-busk']
  }
  profile.withOptions = (opts: ControllerProfileOptions) => (!!opts.rgbLeds === rgb ? profile : rgb ? apcMiniMk2 : apcMiniMk2Rgb)
  return profile
}

export const apcMiniMk2: ControllerProfile = makeMk2(false)
const apcMiniMk2Rgb: ControllerProfile = makeMk2(true)
