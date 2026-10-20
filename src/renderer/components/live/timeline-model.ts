// ============================================================
// Timeline view model: geometry, snapping, ruler ticks, time
// formatting and the edit operations shared by the canvas, the
// library and the inspector. Pure functions + store helpers.
// ============================================================

import type { Density } from '@renderer/stores/ui-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
// Direct module imports (not the ui index) keep this file usable in unit tests
import { SWATCH_COLORS } from '@renderer/components/ui/tokens'
import { formatClock } from '@renderer/components/ui/format'
import { t as translate, type TFunction } from '@renderer/i18n'
import type { Cuelist, TimelineClip } from '@shared/types'

// ---------------- Geometry ----------------

export interface TimelineGeometry {
  ruler: number
  markerLane: number
  zoneLane: number
  track: number
  header: number
  /** Resize / fade hit zone width at the clip edges */
  edge: number
}

export const GEOMETRY: Record<Density, TimelineGeometry> = {
  compact: { ruler: 30, markerLane: 24, zoneLane: 22, track: 56, header: 176, edge: 7 },
  touch: { ruler: 40, markerLane: 34, zoneLane: 32, track: 76, header: 208, edge: 16 }
}

export const MIN_ZOOM = 2 // px per second
export const MAX_ZOOM = 480
export const DEFAULT_ZOOM = 24
export const MIN_CLIP_DURATION = 0.25

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

// ---------------- Snapping ----------------

export type SnapMode = 'off' | '0.25' | '0.5' | '1' | 'beat' | 'bar'

/** Snap choices for the transport bar (labels in the current language) */
export function snapOptions(t: TFunction): { value: SnapMode; label: string }[] {
  return [
    { value: 'off', label: t('timeline.snap.off') },
    { value: '0.25', label: t('timeline.snap.quarterSecond') },
    { value: '0.5', label: t('timeline.snap.halfSecond') },
    { value: '1', label: t('timeline.snap.oneSecond') },
    { value: 'beat', label: t('timeline.snap.beat') },
    { value: 'bar', label: t('timeline.snap.bar') }
  ]
}

export const BEATS_PER_BAR = 4

export function beatSeconds(bpm: number): number {
  return 60 / Math.max(20, Math.min(400, bpm || 120))
}

/** Grid step in seconds (0 = no grid) */
export function snapStep(mode: SnapMode, bpm: number): number {
  switch (mode) {
    case 'off': return 0
    case 'beat': return beatSeconds(bpm)
    case 'bar': return beatSeconds(bpm) * BEATS_PER_BAR
    default: return Number(mode)
  }
}

export function snapTime(t: number, step: number): number {
  if (!(step > 0)) return Math.max(0, t)
  return Math.max(0, Math.round(t / step) * step)
}

/**
 * Snap `t` to the grid, or to a nearby edge (clip edges, markers, playhead)
 * when it is within `tolerance` seconds — edges win over the grid.
 */
export function snapWithEdges(t: number, step: number, edges: number[], tolerance: number): number {
  let best = t
  let bestDist = tolerance
  for (const e of edges) {
    const d = Math.abs(e - t)
    if (d < bestDist) { best = e; bestDist = d }
  }
  if (best !== t) return Math.max(0, best)
  return snapTime(t, step)
}

// ---------------- Ruler ticks ----------------

export type TimeDisplay = 'time' | 'timecode' | 'bars'

export interface Tick { t: number; major: boolean; label?: string }

const TIME_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200]
const BAR_STEPS = [1, 2, 4, 8, 16, 32, 64, 128]

/** Ticks covering [from, to] seconds at `zoom` px/s; bars mode follows the BPM grid. */
export function rulerTicks(from: number, to: number, zoom: number, display: TimeDisplay, bpm: number): Tick[] {
  const ticks: Tick[] = []
  const minMajorPx = 76
  if (display === 'bars') {
    const beat = beatSeconds(bpm)
    const bar = beat * BEATS_PER_BAR
    const barsPerMajor = BAR_STEPS.find((n) => n * bar * zoom >= minMajorPx) ?? BAR_STEPS[BAR_STEPS.length - 1]
    const minor = beat * zoom >= 10 ? beat : bar * zoom >= 10 ? bar : bar * barsPerMajor
    const start = Math.max(0, Math.floor(from / minor) * minor)
    for (let t = start, i = 0; t <= to && i < 2000; t = start + ++i * minor) {
      const barIndex = Math.round(t / bar)
      const onBar = Math.abs(t - barIndex * bar) < 1e-6
      const major = onBar && barIndex % barsPerMajor === 0
      ticks.push({ t, major, label: major ? String(barIndex + 1) : undefined })
    }
    return ticks
  }
  const majorStep = TIME_STEPS.find((s) => s * zoom >= minMajorPx) ?? TIME_STEPS[TIME_STEPS.length - 1]
  const minorDiv = majorStep * zoom >= 160 ? 10 : majorStep * zoom >= 100 ? 5 : 2
  const minor = majorStep / minorDiv
  const start = Math.max(0, Math.floor(from / minor) * minor)
  for (let t = start, i = 0; t <= to && i < 2000; t = start + ++i * minor) {
    const k = Math.round(t / minor)
    const major = k % minorDiv === 0
    ticks.push({ t, major, label: major ? rulerLabel(t, majorStep) : undefined })
  }
  return ticks
}

function rulerLabel(t: number, step: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  const sec = step < 1 ? s.toFixed(step < 0.25 ? 1 : 2).replace(/0$/, '') : String(Math.round(s))
  const [whole, frac] = sec.split('.')
  return `${m}:${whole.padStart(2, '0')}${frac ? `.${frac}` : ''}`
}

/** "bar.beat" position (1-based) */
export function formatBars(t: number, bpm: number): string {
  const beat = beatSeconds(bpm)
  const beats = Math.floor(Math.max(0, t) / beat + 1e-6)
  const bar = Math.floor(beats / BEATS_PER_BAR) + 1
  const b = (beats % BEATS_PER_BAR) + 1
  const sixteenth = Math.floor(((Math.max(0, t) / beat) % 1) * 4) + 1
  return `${String(bar).padStart(3, '0')}.${b}.${sixteenth}`
}

/** Short time for lists and labels: "0:24", "1:05.5", "1:02:03" */
export function formatShortTime(t: number): string {
  const v = Math.max(0, Math.round(t * 10) / 10)
  if (v >= 3600) return formatClock(v)
  const m = Math.floor(v / 60)
  const s = v - m * 60
  const whole = Math.abs(s - Math.round(s)) < 1e-6
  const sec = whole ? String(Math.round(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

// ---------------- Clips ----------------

export function clipColorFor(cuelists: Cuelist[], cuelistId: string): string {
  const idx = Math.max(0, cuelists.findIndex((c) => c.id === cuelistId))
  return SWATCH_COLORS[idx % SWATCH_COLORS.length]
}

/** Default clip length for a scene: its cue times, at least 8 s */
export function defaultClipDuration(cuelist: Cuelist | undefined): number {
  const sum = cuelist?.cues.reduce((acc, cue) => acc + (cue.fadeIn || 0) + (cue.followTime || 0), 0) ?? 0
  return Math.max(8, Math.round(sum * 4) / 4)
}

export function clipEnd(c: TimelineClip): number {
  return c.startTime + c.duration
}

/** Keep fades inside the clip after a resize */
export function fitFades(c: Pick<TimelineClip, 'duration' | 'fadeIn' | 'fadeOut'>): Partial<TimelineClip> {
  const fi = Math.min(c.fadeIn ?? 0, c.duration)
  const fo = Math.min(c.fadeOut ?? 0, Math.max(0, c.duration - fi))
  const out: Partial<TimelineClip> = {}
  if ((c.fadeIn ?? 0) !== fi) out.fadeIn = fi
  if ((c.fadeOut ?? 0) !== fo) out.fadeOut = fo
  return out
}

/** Add a scene clip; returns its id */
export function addSceneClip(cuelistId: string, trackIndex: number, startTime: number, duration?: number): string {
  const store = usePlaybackStore.getState()
  const cuelist = store.cuelists.find((c) => c.id === cuelistId)
  return store.addTimelineClip({
    cuelistId,
    trackIndex: Math.max(0, Math.min(store.timelineTrackCount - 1, trackIndex)),
    startTime: Math.max(0, startTime),
    duration: Math.max(MIN_CLIP_DURATION, duration ?? defaultClipDuration(cuelist)),
    color: clipColorFor(store.cuelists, cuelistId)
  })
}

export function duplicateClip(id: string, startTime?: number): string | null {
  const store = usePlaybackStore.getState()
  const c = store.timelineClips.find((x) => x.id === id)
  if (!c) return null
  const { id: _omit, ...rest } = c
  return store.addTimelineClip({ ...rest, startTime: startTime ?? clipEnd(c) })
}

/** Split a clip at `t`; returns the new right-hand clip id */
export function splitClip(id: string, t: number): string | null {
  const store = usePlaybackStore.getState()
  const c = store.timelineClips.find((x) => x.id === id)
  if (!c || t <= c.startTime + MIN_CLIP_DURATION || t >= clipEnd(c) - MIN_CLIP_DURATION) return null
  const left = t - c.startTime
  const right = clipEnd(c) - t
  const { id: _omit, ...rest } = c
  store.updateTimelineClip(id, { duration: left, fadeOut: undefined, ...fitFades({ duration: left, fadeIn: c.fadeIn }) })
  return store.addTimelineClip({ ...rest, startTime: t, duration: right, fadeIn: undefined, ...fitFades({ duration: right, fadeOut: c.fadeOut }) })
}

// ---------------- Tracks ----------------

/** Track name: the custom one, else "Track 3" / "Piste 3" */
export function trackName(names: string[], index: number): string {
  return names[index] || translate('timeline.defaults.trackName', { n: index + 1 })
}

export function addTrack(afterIndex?: number): void {
  const store = usePlaybackStore.getState()
  const count = store.timelineTrackCount
  const at = afterIndex === undefined ? count : afterIndex + 1
  // Shift clips and names below the insertion point
  for (const c of store.timelineClips) {
    if (c.trackIndex >= at) store.updateTimelineClip(c.id, { trackIndex: c.trackIndex + 1 })
  }
  const names = [...store.timelineTrackNames]
  while (names.length < count) names.push('')
  names.splice(at, 0, '')
  store.setTimelineTrackNames(names)
  store.setTimelineTrackCount(count + 1)
}

export function removeTrack(index: number): void {
  const store = usePlaybackStore.getState()
  if (store.timelineTrackCount <= 1) return
  for (const c of store.timelineClips) {
    if (c.trackIndex === index) store.removeTimelineClip(c.id)
    else if (c.trackIndex > index) store.updateTimelineClip(c.id, { trackIndex: c.trackIndex - 1 })
  }
  const names = [...store.timelineTrackNames]
  names.splice(index, 1)
  store.setTimelineTrackNames(names)
  store.setTimelineTrackCount(store.timelineTrackCount - 1)
}

/** Swap two tracks (clips + names) */
export function swapTracks(a: number, b: number): void {
  const store = usePlaybackStore.getState()
  if (a === b || a < 0 || b < 0 || a >= store.timelineTrackCount || b >= store.timelineTrackCount) return
  for (const c of store.timelineClips) {
    if (c.trackIndex === a) store.updateTimelineClip(c.id, { trackIndex: b })
    else if (c.trackIndex === b) store.updateTimelineClip(c.id, { trackIndex: a })
  }
  const names = [...store.timelineTrackNames]
  while (names.length <= Math.max(a, b)) names.push('')
  ;[names[a], names[b]] = [names[b], names[a]]
  store.setTimelineTrackNames(names)
}

// ---------------- Zones ----------------

/**
 * Reorder zones like song sections: clips straddling a zone boundary are
 * split, then every zone moves (with its clips and markers) to its new slot.
 */
export function reorderZones(orderedIds: string[]): void {
  const store = usePlaybackStore.getState()
  const zones = store.timelineZones
  const oldOrder = [...zones].sort((a, b) => a.order - b.order)
  const newOrder = orderedIds.map((id) => zones.find((z) => z.id === id)).filter((z): z is NonNullable<typeof z> => !!z)
  if (newOrder.length !== oldOrder.length) return

  // 1. Split clips crossing zone boundaries
  for (const zone of oldOrder) {
    for (const clip of [...usePlaybackStore.getState().timelineClips]) {
      for (const cut of [zone.startTime, zone.endTime]) {
        const cur = usePlaybackStore.getState().timelineClips.find((c) => c.id === clip.id)
        if (cur && cut > cur.startTime && cut < clipEnd(cur)) splitClipExact(cur.id, cut)
      }
    }
  }

  // 2. New zone starts
  const durations = new Map(oldOrder.map((z) => [z.id, z.endTime - z.startTime]))
  let cursor = oldOrder.length > 0 ? Math.min(...oldOrder.map((z) => z.startTime)) : 0
  const newStarts = new Map<string, number>()
  for (const z of newOrder) {
    newStarts.set(z.id, cursor)
    cursor += durations.get(z.id) || 0
  }

  // 3. Move clips that sit inside a zone
  for (const clip of usePlaybackStore.getState().timelineClips) {
    const src = oldOrder.find((z) => clip.startTime >= z.startTime - 1e-6 && clipEnd(clip) <= z.endTime + 0.01)
    const ns = src ? newStarts.get(src.id) : undefined
    if (src && ns !== undefined && ns !== src.startTime) {
      store.updateTimelineClip(clip.id, { startTime: Math.max(0, clip.startTime + ns - src.startTime) })
    }
  }

  // 4. Markers
  for (const m of store.timelineMarkers) {
    const src = oldOrder.find((z) => m.time >= z.startTime && m.time < z.endTime)
    const ns = src ? newStarts.get(src.id) : undefined
    if (src && ns !== undefined && ns !== src.startTime) {
      store.updateTimelineMarker(m.id, { time: Math.max(0, m.time + ns - src.startTime) })
    }
  }

  // 5. Zones
  for (const z of oldOrder) {
    const ns = newStarts.get(z.id)
    if (ns !== undefined) store.updateTimelineZone(z.id, { startTime: ns, endTime: ns + (durations.get(z.id) || 0) })
  }
  store.reorderTimelineZones(orderedIds)
}

/** Split without the minimum-length guard (zone boundaries) */
function splitClipExact(id: string, t: number): void {
  const store = usePlaybackStore.getState()
  const c = store.timelineClips.find((x) => x.id === id)
  if (!c || t <= c.startTime || t >= clipEnd(c)) return
  const { id: _omit, ...rest } = c
  store.updateTimelineClip(id, { duration: t - c.startTime, fadeOut: undefined })
  store.addTimelineClip({ ...rest, startTime: t, duration: clipEnd(c) - t, fadeIn: undefined })
}

/** Default colours for new markers / zones (cycled), taken from the user swatches */
export const MARKER_COLORS: string[] = [3, 0, 1, 4, 7, 9].map((i) => SWATCH_COLORS[i])
export const ZONE_COLORS: string[] = [7, 4, 1, 9, 0, 6, 10, 3].map((i) => SWATCH_COLORS[i])
