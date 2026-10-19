import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { Cue, Cuelist, Chase, ChaseStep, CueChannelValue, Preset, PresetType, TimelineClip, TimelineMarker, TimelineZone } from '@shared/types'
import { isRemoteMode, markLocalChange, sendRemoteCommand, sendRemoteCommandThrottled, toDmx } from '@renderer/lib/runtime'

/** Default cue times (seconds) for new cues and for cues missing them in old shows */
export const DEFAULT_CUE_FADE_IN = 2
export const DEFAULT_CUE_FADE_OUT = 2

/** Cuelists started by a flash button (released when the button is released) */
const flashStarted = new Set<string>()

/** True when the cuelist was started by its flash button (the controller snaps it in). */
export function isFlashStarted(id: string): boolean {
  return flashStarted.has(id)
}

type CuelistSettings = Partial<Pick<Cuelist, 'name' | 'isLooping' | 'priority' | 'faderLevel' | 'effectSnapshots'>>
type ChaseSettings = Partial<Pick<Chase, 'name' | 'isLooping' | 'bpm' | 'fadePercent' | 'direction' | 'faderLevel' | 'priority'>>

interface PlaybackState {
  cuelists: Cuelist[]
  chases: Chase[]
  presets: Preset[]

  // Cuelist actions
  addCuelist: (name: string) => string
  removeCuelist: (id: string) => void
  renameCuelist: (id: string, name: string) => void
  addCue: (cuelistId: string, name: string, values: CueChannelValue[], fadeIn?: number, fadeOut?: number) => void
  updateCue: (cuelistId: string, cueId: string, updates: Partial<Cue>) => void
  removeCue: (cuelistId: string, cueId: string) => void
  goCuelist: (id: string) => void
  stopCuelist: (id: string) => void
  goBackCuelist: (id: string) => void
  setCuelistFader: (id: string, level: number) => void
  /** Flash: fader full while held; a stopped cuelist is started (snapped in) and stopped on release */
  flashCuelist: (id: string, on: boolean) => void
  setCuelistPriority: (id: string, priority: number) => void
  setCuelistLooping: (id: string, looping: boolean) => void
  updateCuelist: (id: string, updates: CuelistSettings) => void
  /** Stop every cuelist and chase */
  releaseAll: () => void

  // Chase actions
  addChase: (name: string) => string
  removeChase: (id: string) => void
  addChaseStep: (chaseId: string, values: CueChannelValue[]) => void
  removeChaseStep: (chaseId: string, stepId: string) => void
  /** Toggle, or force with `on` */
  toggleChase: (id: string, on?: boolean) => void
  updateChase: (id: string, updates: ChaseSettings) => void
  updateChaseStep: (chaseId: string, stepId: string, updates: Partial<Omit<ChaseStep, 'id'>>) => void
  setChaseBpm: (id: string, bpm: number) => void
  setChaseFader: (id: string, level: number) => void
  setChaseStep: (id: string, stepIndex: number) => void

  // Preset actions
  addPreset: (name: string, type: PresetType, values: Record<string, Record<string, number>>) => void
  removePreset: (id: string) => void

  // Timeline
  timelineClips: TimelineClip[]
  timelineMarkers: TimelineMarker[]
  timelineTrackCount: number
  /** Track names by index ('' = default "Track n") — saved with the show */
  timelineTrackNames: string[]
  setTimelineTrackName: (index: number, name: string) => void
  setTimelineTrackNames: (names: string[]) => void
  addTimelineClip: (clip: Omit<TimelineClip, 'id'>) => string
  removeTimelineClip: (id: string) => void
  updateTimelineClip: (id: string, updates: Partial<TimelineClip>) => void
  setTimelineClips: (clips: TimelineClip[]) => void
  addTimelineMarker: (marker: Omit<TimelineMarker, 'id'>) => string
  removeTimelineMarker: (id: string) => void
  updateTimelineMarker: (id: string, updates: Partial<TimelineMarker>) => void
  setTimelineMarkers: (markers: TimelineMarker[]) => void
  setTimelineTrackCount: (count: number) => void

  // Timeline zones
  timelineZones: TimelineZone[]
  addTimelineZone: (zone: Omit<TimelineZone, 'id'>) => string
  removeTimelineZone: (id: string) => void
  updateTimelineZone: (id: string, updates: Partial<TimelineZone>) => void
  setTimelineZones: (zones: TimelineZone[]) => void
  reorderTimelineZones: (orderedIds: string[]) => void

  // Import
  setCuelists: (cuelists: Cuelist[]) => void
  setChases: (chases: Chase[]) => void
  setPresets: (presets: Preset[]) => void
}

function clampLevel(level: number): number {
  return toDmx(level)
}

function mapCuelist(id: string, fn: (cl: Cuelist) => Cuelist) {
  return (state: PlaybackState) => ({
    cuelists: state.cuelists.map((cl) => (cl.id === id ? fn(cl) : cl))
  })
}

function mapChase(id: string, fn: (ch: Chase) => Chase) {
  return (state: PlaybackState) => ({
    chases: state.chases.map((ch) => (ch.id === id ? fn(ch) : ch))
  })
}

export const usePlaybackStore = create<PlaybackState>()(subscribeWithSelector((set, get) => ({
  cuelists: [],
  chases: [],
  presets: [],

  // --- Cuelists ---
  addCuelist: (name) => {
    const id = uuidv4()
    set((state) => ({
      cuelists: [...state.cuelists, {
        id,
        name,
        cues: [],
        currentCueIndex: -1,
        isPlaying: false,
        isLooping: false,
        priority: 50,
        faderLevel: 255,
        flash: false
      }]
    }))
    return id
  },

  removeCuelist: (id) => {
    flashStarted.delete(id)
    // The playback controller sees the cuelist disappear and releases its output
    set((state) => ({
      cuelists: state.cuelists.filter((c) => c.id !== id),
      timelineClips: state.timelineClips.filter((c) => c.cuelistId !== id)
    }))
  },

  renameCuelist: (id, name) => {
    set((state) => ({
      cuelists: state.cuelists.map((c) => c.id === id ? { ...c, name } : c)
    }))
  },

  addCue: (cuelistId, name, values, fadeIn = DEFAULT_CUE_FADE_IN, fadeOut = DEFAULT_CUE_FADE_OUT) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) => {
        if (cl.id !== cuelistId) return cl
        const lastNumber = cl.cues.length > 0 ? cl.cues[cl.cues.length - 1].number : 0
        const newCue: Cue = {
          id: uuidv4(),
          name,
          number: lastNumber + 1,
          values,
          fadeIn,
          fadeOut,
          delay: 0,
          followTime: null
        }
        return { ...cl, cues: [...cl.cues, newCue] }
      })
    }))
  },

  updateCue: (cuelistId, cueId, updates) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) => {
        if (cl.id !== cuelistId) return cl
        return {
          ...cl,
          cues: cl.cues.map((cue) => cue.id === cueId ? { ...cue, ...updates } : cue)
        }
      })
    }))
  },

  removeCue: (cuelistId, cueId) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) => {
        if (cl.id !== cuelistId) return cl
        return { ...cl, cues: cl.cues.filter((cue) => cue.id !== cueId) }
      })
    }))
  },

  goCuelist: (id) => {
    if (isRemoteMode()) {
      sendRemoteCommand('go-cuelist', id)
      return
    }
    set(mapCuelist(id, (cl) => {
      if (cl.cues.length === 0) return cl
      // GO on the last cue wraps to the first one
      const nextIndex = cl.currentCueIndex + 1 >= cl.cues.length ? 0 : cl.currentCueIndex + 1
      // Bump goGeneration to force re-trigger even if same index
      return { ...cl, currentCueIndex: nextIndex, isPlaying: true, goGeneration: (cl.goGeneration ?? 0) + 1 }
    }))
  },

  stopCuelist: (id) => {
    if (isRemoteMode()) {
      sendRemoteCommand('stop-cuelist', id)
      return
    }
    flashStarted.delete(id)
    set(mapCuelist(id, (cl) => ({ ...cl, isPlaying: false, currentCueIndex: -1, flash: false })))
  },

  goBackCuelist: (id) => {
    if (isRemoteMode()) {
      sendRemoteCommand('go-back-cuelist', id)
      return
    }
    set(mapCuelist(id, (cl) => {
      if (cl.cues.length === 0) return cl
      let prevIndex = cl.currentCueIndex - 1
      if (prevIndex < 0) prevIndex = cl.cues.length - 1
      return { ...cl, currentCueIndex: prevIndex, isPlaying: true, goGeneration: (cl.goGeneration ?? 0) + 1 }
    }))
  },

  setCuelistFader: (id, level) => {
    const faderLevel = clampLevel(level)
    markLocalChange(`fader:${id}`)
    sendRemoteCommandThrottled(`fader:${id}`, 'set-cuelist-fader', { id, level: faderLevel })
    if (get().cuelists.find(c => c.id === id)?.faderLevel === faderLevel) return
    set(mapCuelist(id, (cl) => ({ ...cl, faderLevel })))
  },

  flashCuelist: (id, on) => {
    if (isRemoteMode()) {
      sendRemoteCommand('flash-cuelist', { id, on })
      return
    }
    const cl = get().cuelists.find(c => c.id === id)
    if (!cl) return
    if (on) {
      if (!cl.isPlaying && cl.cues.length > 0) {
        flashStarted.add(id)
        set(mapCuelist(id, (c) => ({
          ...c,
          flash: true,
          isPlaying: true,
          currentCueIndex: Math.max(0, Math.min(c.currentCueIndex, c.cues.length - 1)),
          goGeneration: (c.goGeneration ?? 0) + 1
        })))
      } else if (!cl.flash) {
        set(mapCuelist(id, (c) => ({ ...c, flash: true })))
      }
      return
    }
    if (flashStarted.delete(id)) {
      set(mapCuelist(id, (c) => ({ ...c, flash: false, isPlaying: false, currentCueIndex: -1 })))
    } else if (cl.flash) {
      set(mapCuelist(id, (c) => ({ ...c, flash: false })))
    }
  },

  setCuelistPriority: (id, priority) => {
    const p = Number.isFinite(priority) ? Math.max(0, Math.min(100, Math.round(priority))) : 50
    set(mapCuelist(id, (cl) => ({ ...cl, priority: p })))
  },

  setCuelistLooping: (id, looping) => {
    set(mapCuelist(id, (cl) => ({ ...cl, isLooping: !!looping })))
  },

  updateCuelist: (id, updates) => {
    set(mapCuelist(id, (cl) => ({ ...cl, ...updates })))
  },

  releaseAll: () => {
    if (isRemoteMode()) {
      sendRemoteCommand('release-all')
      return
    }
    flashStarted.clear()
    set((state) => ({
      cuelists: state.cuelists.map((cl) =>
        cl.isPlaying || cl.flash ? { ...cl, isPlaying: false, currentCueIndex: -1, flash: false } : cl
      ),
      chases: state.chases.map((ch) => (ch.isPlaying ? { ...ch, isPlaying: false } : ch))
    }))
  },

  // --- Chases ---
  addChase: (name) => {
    const id = uuidv4()
    set((state) => ({
      chases: [...state.chases, {
        id,
        name,
        steps: [],
        currentStepIndex: 0,
        isPlaying: false,
        isLooping: true,
        bpm: 120,
        fadePercent: 0,
        direction: 'forward' as const,
        faderLevel: 255
      }]
    }))
    return id
  },

  removeChase: (id) => {
    // The playback controller sees the chase disappear and releases its output
    set((state) => ({ chases: state.chases.filter((c) => c.id !== id) }))
  },

  addChaseStep: (chaseId, values) => {
    set((state) => ({
      chases: state.chases.map((ch) => {
        if (ch.id !== chaseId) return ch
        const step: ChaseStep = { id: uuidv4(), values }
        return { ...ch, steps: [...ch.steps, step] }
      })
    }))
  },

  removeChaseStep: (chaseId, stepId) => {
    set((state) => ({
      chases: state.chases.map((ch) => {
        if (ch.id !== chaseId) return ch
        return { ...ch, steps: ch.steps.filter((s) => s.id !== stepId) }
      })
    }))
  },

  toggleChase: (id, on) => {
    const chase = get().chases.find(c => c.id === id)
    if (!chase) return
    const isPlaying = on !== undefined ? !!on : !chase.isPlaying
    if (isRemoteMode()) {
      sendRemoteCommand('toggle-chase', { id, on: isPlaying })
      return
    }
    if (isPlaying === chase.isPlaying) return
    set(mapChase(id, (ch) => ({ ...ch, isPlaying })))
  },

  setChaseBpm: (id, bpm) => {
    const value = Number.isFinite(bpm) ? Math.max(1, Math.min(999, bpm)) : 120
    markLocalChange(`chaseBpm:${id}`)
    sendRemoteCommandThrottled(`chaseBpm:${id}`, 'set-chase-bpm', { id, bpm: value })
    set(mapChase(id, (ch) => ({ ...ch, bpm: value })))
  },

  setChaseFader: (id, level) => {
    const faderLevel = clampLevel(level)
    markLocalChange(`chaseFader:${id}`)
    sendRemoteCommandThrottled(`chaseFader:${id}`, 'set-chase-fader', { id, level: faderLevel })
    set(mapChase(id, (ch) => ({ ...ch, faderLevel })))
  },

  updateChase: (id, updates) => {
    set(mapChase(id, (ch) => ({ ...ch, ...updates })))
  },

  updateChaseStep: (chaseId, stepId, updates) => {
    set(mapChase(chaseId, (ch) => ({
      ...ch,
      steps: ch.steps.map((st) => (st.id === stepId ? { ...st, ...updates } : st))
    })))
  },

  setChaseStep: (id, stepIndex) => {
    if (get().chases.find(c => c.id === id)?.currentStepIndex === stepIndex) return
    set(mapChase(id, (ch) => ({ ...ch, currentStepIndex: stepIndex })))
  },

  // --- Presets ---
  addPreset: (name, type, values) => {
    set((state) => ({
      presets: [...state.presets, { id: uuidv4(), name, type, values }]
    }))
  },

  removePreset: (id) => {
    set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }))
  },

  // --- Timeline ---
  timelineClips: [],
  timelineMarkers: [],
  timelineTrackCount: 3,
  timelineTrackNames: [],

  setTimelineTrackName: (index, name) => {
    if (!Number.isInteger(index) || index < 0) return
    set((state) => {
      const names = [...state.timelineTrackNames]
      while (names.length <= index) names.push('')
      names[index] = name.trim()
      return { timelineTrackNames: names }
    })
  },

  setTimelineTrackNames: (names) => set({ timelineTrackNames: names.map((n) => (typeof n === 'string' ? n : '')) }),

  addTimelineClip: (clip) => {
    const id = uuidv4()
    set((state) => ({
      timelineClips: [...state.timelineClips, { ...clip, id }]
    }))
    return id
  },

  removeTimelineClip: (id) => {
    set((state) => ({
      timelineClips: state.timelineClips.filter(c => c.id !== id)
    }))
  },

  updateTimelineClip: (id, updates) => {
    set((state) => ({
      timelineClips: state.timelineClips.map(c =>
        c.id === id ? { ...c, ...updates } : c
      )
    }))
  },

  setTimelineClips: (clips) => set({ timelineClips: clips }),

  addTimelineMarker: (marker) => {
    const id = uuidv4()
    set((state) => ({
      timelineMarkers: [...state.timelineMarkers, { ...marker, id }].sort((a, b) => a.time - b.time)
    }))
    return id
  },

  removeTimelineMarker: (id) => {
    set((state) => ({
      timelineMarkers: state.timelineMarkers.filter(m => m.id !== id)
    }))
  },

  updateTimelineMarker: (id, updates) => {
    set((state) => ({
      timelineMarkers: state.timelineMarkers.map(m =>
        m.id === id ? { ...m, ...updates } : m
      ).sort((a, b) => a.time - b.time)
    }))
  },

  setTimelineMarkers: (markers) => set({ timelineMarkers: markers }),

  setTimelineTrackCount: (count) => set({ timelineTrackCount: Math.max(1, count) }),

  // --- Timeline Zones ---
  timelineZones: [],

  addTimelineZone: (zone) => {
    const id = uuidv4()
    set((state) => ({
      timelineZones: [...state.timelineZones, { ...zone, id }].sort((a, b) => a.order - b.order)
    }))
    return id
  },

  removeTimelineZone: (id) => {
    set((state) => ({
      timelineZones: state.timelineZones.filter(z => z.id !== id)
    }))
  },

  updateTimelineZone: (id, updates) => {
    set((state) => ({
      timelineZones: state.timelineZones.map(z =>
        z.id === id ? { ...z, ...updates } : z
      ).sort((a, b) => a.order - b.order)
    }))
  },

  setTimelineZones: (zones) => set({ timelineZones: zones }),

  reorderTimelineZones: (orderedIds) => {
    set((state) => {
      const zonesMap = new Map(state.timelineZones.map(z => [z.id, z]))
      return {
        timelineZones: orderedIds
          .map((id, i) => {
            const z = zonesMap.get(id)
            return z ? { ...z, order: i } : null
          })
          .filter(Boolean) as TimelineZone[]
      }
    })
  },

  setCuelists: (cuelists) => {
    flashStarted.clear()
    set({ cuelists })
  },
  setChases: (chases) => set({ chases }),
  setPresets: (presets) => set({ presets })
})))
