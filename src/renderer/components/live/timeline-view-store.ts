// ============================================================
// Timeline UI state (per viewer, not saved in the show): zoom,
// snapping, grid tempo, selection, time display, panels — plus
// the engine clock bridge (playhead time / play state).
// ============================================================

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import {
  getTimelineState, onTimelinePlayStateChange, setTimelineLooping, setTimelineTotalDuration, setTimelineUpdateCallback
} from '@renderer/lib/timeline-engine'
import { DEFAULT_ZOOM, clampZoom, type SnapMode, type TimeDisplay } from './timeline-model'

export type TimelineSelection =
  | { kind: 'clip'; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'track'; index: number }
  | null

export type LibraryTab = 'scenes' | 'markers' | 'zones'

interface TimelineViewState {
  zoom: number
  snap: SnapMode
  bpm: number
  timeDisplay: TimeDisplay
  followPlayhead: boolean
  libraryOpen: boolean
  libraryTab: LibraryTab
  selection: TimelineSelection
  /** Timeline length in seconds (engine; playback stops / loops here) */
  length: number
  looping: boolean
  /** Scene being dragged from the library (ghost position, client coords) */
  libraryDrag: { cuelistId: string; x: number; y: number; over: boolean } | null

  setZoom: (zoom: number) => void
  setSnap: (snap: SnapMode) => void
  setBpm: (bpm: number) => void
  setTimeDisplay: (d: TimeDisplay) => void
  setFollowPlayhead: (on: boolean) => void
  setLibraryOpen: (open: boolean) => void
  setLibraryTab: (tab: LibraryTab) => void
  select: (sel: TimelineSelection) => void
  setLength: (seconds: number) => void
  setLooping: (on: boolean) => void
  setLibraryDrag: (drag: TimelineViewState['libraryDrag']) => void
}

const PREFIX = 'photonboard.timeline.'
function read<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const v = JSON.parse(raw)
    return valid(v) ? (v as T) : fallback
  } catch { return fallback }
}
function write(key: string, value: unknown): void {
  try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)) } catch { /* ignore */ }
}

/** False until the viewer zooms once: the canvas then fits the show on first open */
export let zoomChosen = (() => { try { return window.localStorage.getItem(PREFIX + 'zoom') !== null } catch { return false } })()

const SNAPS: SnapMode[] = ['off', '0.25', '0.5', '1', 'beat', 'bar']
const DISPLAYS: TimeDisplay[] = ['time', 'timecode', 'bars']

export const useTimelineView = create<TimelineViewState>((set) => ({
  zoom: read('zoom', DEFAULT_ZOOM, (v) => typeof v === 'number' && Number.isFinite(v)),
  snap: read('snap', '0.25' as SnapMode, (v) => SNAPS.includes(v as SnapMode)),
  bpm: read('bpm', 120, (v) => typeof v === 'number' && v >= 20 && v <= 400),
  timeDisplay: read('display', 'time' as TimeDisplay, (v) => DISPLAYS.includes(v as TimeDisplay)),
  followPlayhead: read('follow', true, (v) => typeof v === 'boolean'),
  libraryOpen: read('library', true, (v) => typeof v === 'boolean'),
  libraryTab: 'scenes',
  selection: null,
  length: getTimelineState().totalDuration,
  looping: getTimelineState().isLooping,
  libraryDrag: null,

  setZoom: (zoom) => { const z = clampZoom(zoom); zoomChosen = true; write('zoom', z); set({ zoom: z }) },
  setSnap: (snap) => { write('snap', snap); set({ snap }) },
  setBpm: (bpm) => {
    const b = Math.max(20, Math.min(400, Number.isFinite(bpm) ? bpm : 120))
    write('bpm', b)
    set({ bpm: b })
  },
  setTimeDisplay: (timeDisplay) => { write('display', timeDisplay); set({ timeDisplay }) },
  setFollowPlayhead: (followPlayhead) => { write('follow', followPlayhead); set({ followPlayhead }) },
  setLibraryOpen: (libraryOpen) => { write('library', libraryOpen); set({ libraryOpen }) },
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  select: (selection) => set({ selection }),
  setLength: (seconds) => {
    setTimelineTotalDuration(seconds)
    set({ length: getTimelineState().totalDuration })
  },
  setLooping: (looping) => {
    setTimelineLooping(looping)
    set({ looping })
  },
  setLibraryDrag: (libraryDrag) => set({ libraryDrag })
}))

// ---------------- Canvas API (zoom / scroll / drop) ----------------

export interface CanvasApi {
  /** Zoom keeping `anchorTime` (default: playhead or view centre) in place */
  zoomTo: (zoom: number, anchorTime?: number) => void
  fit: () => void
  reveal: (t: number) => void
  /** Library drag: where would a drop at this point land? */
  dropTarget: (clientX: number, clientY: number) => { time: number; track: number } | null
}

let canvasApi: CanvasApi | null = null
export function registerCanvasApi(api: CanvasApi | null): void { canvasApi = api }
export function getCanvasApi(): CanvasApi | null { return canvasApi }

// ---------------- Engine clock ----------------

type Listener = () => void
let clockTime = getTimelineState().currentTime
let clockPlaying = getTimelineState().isPlaying
const timeListeners = new Set<(t: number) => void>()
const playListeners = new Set<Listener>()

setTimelineUpdateCallback((time, playing) => {
  clockTime = time
  for (const l of timeListeners) l(time)
  if (playing !== clockPlaying) {
    clockPlaying = playing
    for (const l of playListeners) l()
  }
})
onTimelinePlayStateChange((playing) => {
  if (playing === clockPlaying) return
  clockPlaying = playing
  for (const l of playListeners) l()
})

/** Playhead time listener (frame rate) — update the DOM directly, no React state. */
export function subscribeTimelineTime(fn: (t: number) => void): () => void {
  timeListeners.add(fn)
  return () => { timeListeners.delete(fn) }
}

export function getClockTime(): number {
  return clockTime
}

function subscribePlaying(fn: Listener): () => void {
  playListeners.add(fn)
  return () => { playListeners.delete(fn) }
}

export function useTimelinePlaying(): boolean {
  return useSyncExternalStore(subscribePlaying, () => clockPlaying)
}
