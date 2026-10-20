// ============================================================
// PhotonBoard — MIDI controller profiles: contracts (types only)
//
// A profile describes a control surface (APC mini mk1 / mk2, APC40,
// Launchpad…): its controls, how to light its LEDs, and its default
// layouts. Profiles are a layer BESIDE the user's MIDI mappings: a
// user mapping on the same (device, type, channel, number) wins.
// Controller settings are machine settings (localStorage
// 'photonboard.controllers'), never saved in the show.
// ============================================================

/** 'pad:3:5' (col:rowFromTop) · 'fader:0' · 'track:2' · 'scene:7' · 'shift' */
export type ControlId = string

export interface ControlDef {
  id: ControlId
  kind: 'pad' | 'button' | 'fader' | 'encoder'
  type: 'note' | 'cc'
  /** MIDI channel 1-16 */
  channel: number
  /** Note / CC number 0-127 */
  number: number
}

export type LedMode = 'off' | 'dim' | 'on' | 'pulse' | 'blink'

export interface LedState {
  mode: LedMode
  /** #rrggbb */
  color: string
}

export type ControllerLayoutId = 'executors-2pages' | 'executors-busk'

export interface ControllerProfile {
  id: string
  name: string
  /** Input port name */
  matchInput: RegExp
  /** Output port name (LEDs); defaults to matchInput */
  matchOutput?: RegExp
  /** Ports of the device to ignore (e.g. the APC mini mk2 "Notes" port) */
  ignorePorts?: RegExp
  /** Needs requestMIDIAccess({ sysex: true }) (RGB LEDs, init) */
  needsSysex?: boolean
  /** Messages sent on connect (mode switch…) */
  init?: number[][]
  /** Faders are motorised: send positions instead of soft takeover */
  motorFaders?: boolean
  controls: ControlDef[]
  /** Pad grid (executor rows) */
  grid?: { cols: number; rows: number; pad(col: number, rowFromTop: number): ControlId }
  /** MIDI messages lighting these controls */
  encodeLeds(changes: [ControlId, LedState][]): number[][]
  /** Message asking the device for its fader positions (when it supports it) */
  requestFaderPositions?: number[]
  defaultLayouts: ControllerLayoutId[]
}

export type ControllerAction =
  /** Executor cell; page 'current' / 'next' (current + 1) / index (0-based) */
  | { type: 'executor'; page: 'current' | 'next' | number; col: number; row: number }
  | { type: 'column-fader'; col: number }
  | { type: 'grand-master' }
  /** Page index (0-based), or step */
  | { type: 'page'; page: number | '+' | '-' }
  | { type: 'go-selected' | 'back-selected' | 'release-all' | 'clear' }
  | { type: 'blackout' | 'blinder' | 'strobe' | 'tap' }
  | { type: 'macro' | 'group' | 'preset'; id: string }

export interface ControllerBinding {
  control: ControlId
  action: ControllerAction
  /** With Shift held */
  shiftAction?: ControllerAction
}

export interface ControllerSettings {
  profileId: string
  /** Input port name */
  port: string
  layout: ControllerLayoutId
  /** pickup = soft takeover (default) · jump = the fader value applies at once */
  takeover: 'pickup' | 'jump'
  enabled: boolean
}
