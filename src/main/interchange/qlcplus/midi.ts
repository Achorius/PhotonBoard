// ============================================================
// PhotonBoard — QLC+ MIDI input channel numbering
// (plugins/midi/src/common/midiprotocol.{h,cpp}):
//   CC 0-127 → 0-127 · Note 0-127 → 128-255 · Note aftertouch → 256-383
//   Program change → 384-511 · Channel aftertouch 512 · Pitch wheel 513
//   MIDI beat clock 529-531
// The MIDI channel is a per-line plugin parameter "midichannel"
// (0-15; 16 = OMNI). In OMNI mode the channel (0-15) is stored in
// bits 12-15 of the input channel. VC widgets in multipage frames
// keep the page in bits 16+.
// Pure module.
// ============================================================

import type { MidiSourceType } from '../../../shared/types'

export const MIDI_OMNI = 16

export interface MidiSource {
  type: MidiSourceType
  /** 1-16 */
  channel: number
  /** CC / note / program number 0-127 */
  number: number
}

/**
 * QLC+ input channel → MIDI message. `lineChannel` = the line's "midichannel"
 * parameter (0-15, 16 = OMNI; undefined = 0). Returns null for messages
 * PhotonBoard cannot map (aftertouch, pitch wheel, clock).
 */
export function qlcChannelToMidi(qlcChannel: number, lineChannel: number | undefined): MidiSource | null {
  const raw = qlcChannel & 0xffff
  const omni = lineChannel === MIDI_OMNI
  const ch = omni ? (raw >> 12) & 0x0f : Math.max(0, Math.min(15, lineChannel ?? 0))
  const n = omni ? raw & 0x0fff : raw
  if (n <= 127) return { type: 'cc', channel: ch + 1, number: n }
  if (n >= 128 && n <= 255) return { type: 'note', channel: ch + 1, number: n - 128 }
  if (n >= 384 && n <= 511) return { type: 'program', channel: ch + 1, number: n - 384 }
  return null
}

/** MIDI message → QLC+ input channel for a line set to `lineChannel` (0-15 or OMNI) */
export function midiToQlcChannel(src: MidiSource, lineChannel: number): number {
  const base = src.type === 'cc' ? 0 : src.type === 'note' ? 128 : 384
  const n = base + Math.max(0, Math.min(127, Math.round(src.number)))
  if (lineChannel === MIDI_OMNI) return ((Math.max(1, Math.min(16, src.channel)) - 1) << 12) | n
  return n
}
