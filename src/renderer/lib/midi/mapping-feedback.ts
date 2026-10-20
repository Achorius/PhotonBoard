// ============================================================
// PhotonBoard — Feedback of user MIDI mappings (pure)
//
// A user mapping may set `options.feedback = 'note' | 'cc'`: the state
// of its target is echoed to the output port of the same device —
// 'note': note-on 127 when active / 0 when not (a pad LED);
// 'cc': the target's value on the mapping's scale (motor fader, LED
// ring, or 127 / 0 for on/off targets).
// Saved with the show (shared/show-format normalizeMidiMapping).
// ============================================================

import type { MidiMapping } from '@shared/types'

export type MidiFeedbackMode = 'note' | 'cc'

export function mappingFeedbackMode(m: MidiMapping): MidiFeedbackMode | undefined {
  const f: unknown = m.options.feedback
  return f === 'note' || f === 'cc' ? f : undefined
}

/** What the state lookup needs (the engine reads the stores) */
export interface MappingFeedbackContext {
  cuelist(id: string): { isPlaying: boolean; flash: boolean; faderLevel: number } | undefined
  chase(id: string): { isPlaying: boolean; bpm: number } | undefined
  effectRunning(id: string): boolean | undefined
  grandMaster: number
  blackout: boolean
  blinder: boolean
  strobe: boolean
  timelinePlaying: boolean
  /** Current value of a fixture channel target (undefined = unknown) */
  channelValue(m: MidiMapping): number | undefined
}

/** Inverse of resolveValue (midi-manager): a target value → raw 0-127 on the mapping's range */
export function valueToRaw(m: MidiMapping, value: number): number {
  const min = Number.isFinite(m.options?.min) ? m.options.min : 0
  const max = Number.isFinite(m.options?.max) ? m.options.max : 255
  if (max === min) return value >= max ? 127 : 0
  let r = ((value - min) / (max - min)) * 127
  if (m.options?.inverted) r = 127 - r
  return Math.max(0, Math.min(127, Math.round(r)))
}

const onOff = (b: boolean | undefined): number => (b ? 127 : 0)

/** Raw 0-127 the device should show for this mapping (null = no feedback for this target) */
export function mappingFeedbackValue(m: MidiMapping, ctx: MappingFeedbackContext): number | null {
  const id = m.target.id ?? ''
  switch (m.target.type) {
    case 'cuelist_go': return onOff(ctx.cuelist(id)?.isPlaying)
    case 'flash': return onOff(ctx.cuelist(id)?.flash)
    case 'cuelist_fader': {
      const cl = ctx.cuelist(id)
      return cl ? valueToRaw(m, cl.faderLevel) : null
    }
    case 'chase_toggle': return onOff(ctx.chase(id)?.isPlaying)
    case 'chase_bpm': {
      const ch = ctx.chase(id)
      return ch ? Math.max(0, Math.min(127, Math.round(((ch.bpm - 30) / 270) * 127))) : null
    }
    case 'effect_toggle': return onOff(ctx.effectRunning(id))
    case 'master': return valueToRaw(m, ctx.grandMaster)
    case 'blackout': return onOff(ctx.blackout)
    case 'blinder': return onOff(ctx.blinder)
    case 'strobe': return onOff(ctx.strobe)
    case 'timeline_play': return onOff(ctx.timelinePlaying)
    case 'channel': {
      const v = ctx.channelValue(m)
      return v === undefined ? null : valueToRaw(m, v)
    }
    default: return null
  }
}

/** The MIDI message echoing a mapping's state */
export function mappingFeedbackMessage(m: MidiMapping, mode: MidiFeedbackMode, raw: number): number[] {
  const ch = Math.max(1, Math.min(16, m.source.channel)) - 1
  if (mode === 'cc') return [0xb0 | ch, m.source.number & 0x7f, raw & 0x7f]
  return [0x90 | ch, m.source.number & 0x7f, raw > 0 ? 127 : 0]
}
