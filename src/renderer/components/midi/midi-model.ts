// MIDI view model: readable labels for mapping sources and targets, the
// catalogue of learnable targets, and a name index of the show's objects.

import { useMemo } from 'react'
import type { IconType } from 'react-icons'
import {
  LuActivity, LuClapperboard, LuCrosshair, LuFlag, LuGauge, LuPower, LuRefreshCw, LuRepeat, LuSkipBack,
  LuSlidersVertical, LuSparkles, LuSquare, LuSquareDashed, LuSun, LuZap, LuPlay, LuTimer
} from 'react-icons/lu'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import type { MidiMapping, MidiSourceType, MidiTargetType } from '@shared/types'

export type TargetCategory = 'masters' | 'playback' | 'fixtures' | 'timeline'

export type TargetRef = 'cuelist' | 'chase' | 'effect' | 'fixture' | 'marker' | 'zone'

export interface TargetMeta {
  label: string
  category: TargetCategory
  icon: IconType
  /** What `target.id` points to */
  ref?: TargetRef
  /** Continuous control (uses min/max/encoding) */
  continuous?: boolean
  description: string
}

export const TARGETS: Record<MidiTargetType, TargetMeta> = {
  master: { label: 'Grand Master', category: 'masters', icon: LuGauge, continuous: true, description: 'Overall output level' },
  blackout: { label: 'Blackout', category: 'masters', icon: LuPower, description: 'Toggles blackout on each press' },
  blinder: { label: 'Blinder', category: 'masters', icon: LuSun, description: 'Full white while held' },
  strobe: { label: 'Strobe', category: 'masters', icon: LuZap, description: 'Strobe while held' },
  reset: { label: 'Reset all', category: 'masters', icon: LuRefreshCw, description: 'Clears the programmer and releases playback' },
  tap_tempo: { label: 'Tap tempo', category: 'masters', icon: LuActivity, ref: 'chase', description: 'Tap to set the tempo (the chase, or every playing chase)' },
  cuelist_go: { label: 'Scene GO', category: 'playback', icon: LuClapperboard, ref: 'cuelist', description: 'Start / stop or step a scene' },
  cuelist_fader: { label: 'Scene fader', category: 'playback', icon: LuSlidersVertical, ref: 'cuelist', continuous: true, description: 'Scene playback level' },
  flash: { label: 'Scene flash', category: 'playback', icon: LuZap, ref: 'cuelist', description: 'Scene at full while held' },
  chase_toggle: { label: 'Chase on / off', category: 'playback', icon: LuRepeat, ref: 'chase', description: 'Starts or stops a chase' },
  chase_bpm: { label: 'Chase tempo', category: 'playback', icon: LuTimer, ref: 'chase', continuous: true, description: 'Chase speed (30–300 BPM)' },
  effect_toggle: { label: 'Effect on / off', category: 'playback', icon: LuSparkles, ref: 'effect', description: 'Starts or stops an effect (trigger / flash: while held)' },
  channel: { label: 'Fixture channel', category: 'fixtures', icon: LuCrosshair, ref: 'fixture', continuous: true, description: 'One channel of a fixture, in the programmer' },
  timeline_play: { label: 'Timeline play / pause', category: 'timeline', icon: LuPlay, description: 'Toggles timeline playback' },
  timeline_stop: { label: 'Timeline stop', category: 'timeline', icon: LuSquare, description: 'Stops the timeline' },
  timeline_rewind: { label: 'Timeline rewind', category: 'timeline', icon: LuSkipBack, description: 'Back to the start' },
  timeline_goto_marker: { label: 'Go to marker', category: 'timeline', icon: LuFlag, ref: 'marker', description: 'Jumps the timeline to a marker' },
  timeline_goto_zone: { label: 'Go to section', category: 'timeline', icon: LuSquareDashed, ref: 'zone', description: 'Jumps the timeline to a section' }
}

export const CATEGORY_LABEL: Record<TargetCategory, string> = {
  masters: 'Masters',
  playback: 'Playback',
  fixtures: 'Fixtures',
  timeline: 'Timeline'
}

export const BEHAVIORS = [
  { value: 'direct', label: 'Direct', description: 'Follows the control (faders, knobs); GO on press for scenes' },
  { value: 'toggle', label: 'Toggle', description: 'Press = on, press again = off' },
  { value: 'trigger', label: 'Trigger', description: 'On while held, off on release' },
  { value: 'flash', label: 'Flash', description: 'Full while held' }
] as const

export type Behavior = (typeof BEHAVIORS)[number]['value']

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI note number → "C4" (middle C = 60 = C4) */
export function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

export const SOURCE_LABEL: Record<MidiSourceType, string> = { cc: 'CC', note: 'Note', program: 'Program' }

/** "CC 7", "Note 36 · C2", "PC 5" */
export function formatSourceNumber(type: MidiSourceType | string, number: number): string {
  if (type === 'note' || type === 'noteoff') return `Note ${number} · ${noteName(number)}`
  if (type === 'program') return `PC ${number}`
  return `CC ${number}`
}

// ---------------- Name index ----------------

export interface NameIndex {
  cuelists: { id: string; name: string }[]
  chases: { id: string; name: string }[]
  effects: { id: string; name: string }[]
  fixtures: { id: string; name: string }[]
  markers: { id: string; name: string }[]
  zones: { id: string; name: string }[]
  byRef: Record<TargetRef, Map<string, string>>
}

const SEP = '\u0001'
const FIELD = '\u0000'
const key = (items: { id: string; name: string }[]) => items.map((i) => `${i.id}${FIELD}${i.name}`).join(SEP)
const parse = (k: string) => (k ? k.split(SEP).map((s) => { const [id, name] = s.split(FIELD); return { id, name } }) : [])

/** Names of everything a mapping can point to. Re-renders only when ids / names change. */
export function useNameIndex(): NameIndex {
  const cl = usePlaybackStore((s) => key(s.cuelists))
  const ch = usePlaybackStore((s) => key(s.chases))
  const mk = usePlaybackStore((s) => key(s.timelineMarkers))
  const zn = usePlaybackStore((s) => key([...s.timelineZones].sort((a, b) => a.order - b.order)))
  const fx = useEffectsStore((s) => key(s.effects))
  const fi = usePatchStore((s) => key(s.patch))
  return useMemo(() => {
    const idx = { cuelists: parse(cl), chases: parse(ch), effects: parse(fx), fixtures: parse(fi), markers: parse(mk), zones: parse(zn) }
    const map = (a: { id: string; name: string }[]) => new Map(a.map((x) => [x.id, x.name]))
    return {
      ...idx,
      byRef: {
        cuelist: map(idx.cuelists), chase: map(idx.chases), effect: map(idx.effects),
        fixture: map(idx.fixtures), marker: map(idx.markers), zone: map(idx.zones)
      }
    }
  }, [cl, ch, mk, zn, fx, fi])
}

export function refItems(index: NameIndex, ref: TargetRef): { id: string; name: string }[] {
  switch (ref) {
    case 'cuelist': return index.cuelists
    case 'chase': return index.chases
    case 'effect': return index.effects
    case 'fixture': return index.fixtures
    case 'marker': return index.markers
    case 'zone': return index.zones
  }
}

export interface TargetDescription {
  title: string
  detail?: string
  missing: boolean
  meta: TargetMeta
}

export function describeTarget(m: MidiMapping, index: NameIndex): TargetDescription {
  const meta = TARGETS[m.target.type] ?? { label: m.target.type, category: 'masters', icon: LuGauge, description: '' }
  if (!meta.ref) return { title: meta.label, missing: false, meta }
  if (!m.target.id) {
    return { title: meta.label, detail: meta.ref === 'chase' && m.target.type === 'tap_tempo' ? 'Playing chases' : 'Not set', missing: m.target.type !== 'tap_tempo', meta }
  }
  const name = index.byRef[meta.ref].get(m.target.id)
  const detail = name === undefined ? 'Missing' : m.target.type === 'channel' && m.target.parameter ? `${name} · ${m.target.parameter}` : name
  return { title: meta.label, detail, missing: name === undefined, meta }
}
