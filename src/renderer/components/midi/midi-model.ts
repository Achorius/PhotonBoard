// MIDI view model: readable (translated) labels for mapping sources and targets, the
// catalogue of learnable targets, and a name index of the show's objects.

import { useMemo } from 'react'
import type { IconType } from 'react-icons'
import {
  LuActivity, LuClapperboard, LuCrosshair, LuFlag, LuGauge, LuPower, LuRefreshCw, LuRepeat, LuSkipBack,
  LuSlidersVertical, LuSparkles, LuSquare, LuSquareDashed, LuSun, LuZap, LuPlay, LuTimer
} from 'react-icons/lu'
import { t } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import type { MidiMapping, MidiSourceType, MidiTargetType } from '@shared/types'

export type TargetCategory = 'masters' | 'playback' | 'fixtures' | 'timeline'

export type TargetRef = 'cuelist' | 'chase' | 'effect' | 'fixture' | 'marker' | 'zone'

export interface TargetMeta {
  category: TargetCategory
  icon: IconType
  /** What `target.id` points to */
  ref?: TargetRef
  /** Continuous control (uses min/max/encoding) */
  continuous?: boolean
}

export const TARGETS: Record<MidiTargetType, TargetMeta> = {
  master: { category: 'masters', icon: LuGauge, continuous: true },
  blackout: { category: 'masters', icon: LuPower },
  blinder: { category: 'masters', icon: LuSun },
  strobe: { category: 'masters', icon: LuZap },
  strobe_rate: { category: 'masters', icon: LuZap },
  reset: { category: 'masters', icon: LuRefreshCw },
  tap_tempo: { category: 'masters', icon: LuActivity, ref: 'chase' },
  cuelist_go: { category: 'playback', icon: LuClapperboard, ref: 'cuelist' },
  cuelist_fader: { category: 'playback', icon: LuSlidersVertical, ref: 'cuelist', continuous: true },
  flash: { category: 'playback', icon: LuZap, ref: 'cuelist' },
  chase_toggle: { category: 'playback', icon: LuRepeat, ref: 'chase' },
  chase_bpm: { category: 'playback', icon: LuTimer, ref: 'chase', continuous: true },
  effect_toggle: { category: 'playback', icon: LuSparkles, ref: 'effect' },
  channel: { category: 'fixtures', icon: LuCrosshair, ref: 'fixture', continuous: true },
  timeline_play: { category: 'timeline', icon: LuPlay },
  timeline_stop: { category: 'timeline', icon: LuSquare },
  timeline_rewind: { category: 'timeline', icon: LuSkipBack },
  timeline_goto_marker: { category: 'timeline', icon: LuFlag, ref: 'marker' },
  timeline_goto_zone: { category: 'timeline', icon: LuSquareDashed, ref: 'zone' }
}

/** Translated name of a target ("Scene fader"); unknown types (newer shows) show their raw type */
export function targetLabel(type: MidiTargetType): string {
  return type in TARGETS ? t(`midi.targets.${type}.label`) : type
}

export function targetDescription(type: MidiTargetType): string {
  return type in TARGETS ? t(`midi.targets.${type}.description`) : ''
}

export function categoryLabel(category: TargetCategory): string {
  return t(`midi.categories.${category}`)
}

export const BEHAVIORS = ['direct', 'toggle', 'trigger', 'flash'] as const

export type Behavior = (typeof BEHAVIORS)[number]

export const behaviorLabel = (b: Behavior): string => t(`midi.behaviors.${b}.label`)
export const behaviorDescription = (b: Behavior): string => t(`midi.behaviors.${b}.description`)

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI note number → "C4" (middle C = 60 = C4) */
export function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

export const sourceLabel = (type: MidiSourceType): string => t(`midi.source.${type}`)

/** "ch 3" / "can. 3" */
export const channelShort = (channel: number): string => t('midi.source.channelShort', { channel })

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
  const meta = TARGETS[m.target.type] ?? { category: 'masters', icon: LuGauge }
  const title = targetLabel(m.target.type)
  if (!meta.ref) return { title, missing: false, meta }
  if (!m.target.id) {
    return { title, detail: meta.ref === 'chase' && m.target.type === 'tap_tempo' ? t('midi.target.playingChases') : t('midi.target.notSet'), missing: m.target.type !== 'tap_tempo', meta }
  }
  const name = index.byRef[meta.ref].get(m.target.id)
  const detail = name === undefined ? t('midi.target.missing') : m.target.type === 'channel' && m.target.parameter ? `${name} · ${m.target.parameter}` : name
  return { title, detail, missing: name === undefined, meta }
}
