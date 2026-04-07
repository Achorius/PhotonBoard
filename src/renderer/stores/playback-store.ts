import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Cue, Cuelist, Chase, ChaseStep, CueChannelValue, Preset, PresetType, TimelineClip, TimelineMarker } from '@shared/types'

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
  flashCuelist: (id: string, on: boolean) => void

  // Chase actions
  addChase: (name: string) => string
  removeChase: (id: string) => void
  addChaseStep: (chaseId: string, values: CueChannelValue[]) => void
  removeChaseStep: (chaseId: string, stepId: string) => void
  toggleChase: (id: string) => void
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
  addTimelineClip: (clip: Omit<TimelineClip, 'id'>) => string
  removeTimelineClip: (id: string) => void
  updateTimelineClip: (id: string, updates: Partial<TimelineClip>) => void
  setTimelineClips: (clips: TimelineClip[]) => void
  addTimelineMarker: (marker: Omit<TimelineMarker, 'id'>) => string
  removeTimelineMarker: (id: string) => void
  updateTimelineMarker: (id: string, updates: Partial<TimelineMarker>) => void
  setTimelineMarkers: (markers: TimelineMarker[]) => void
  setTimelineTrackCount: (count: number) => void

  // Import
  setCuelists: (cuelists: Cuelist[]) => void
  setChases: (chases: Chase[]) => void
  setPresets: (presets: Preset[]) => void
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
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
    set((state) => ({ cuelists: state.cuelists.filter((c) => c.id !== id) }))
  },

  renameCuelist: (id, name) => {
    set((state) => ({
      cuelists: state.cuelists.map((c) => c.id === id ? { ...c, name } : c)
    }))
  },

  addCue: (cuelistId, name, values, fadeIn = 2, fadeOut = 2) => {
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
    set((state) => ({
      cuelists: state.cuelists.map((cl) => {
        if (cl.id !== id) return cl
        if (cl.cues.length === 0) return cl

        let nextIndex = cl.currentCueIndex + 1
        if (nextIndex >= cl.cues.length) {
          // Always wrap back to 0 (loop behavior)
          nextIndex = 0
        }

        // Bump goGeneration to force re-trigger even if same index
        return {
          ...cl,
          currentCueIndex: nextIndex,
          isPlaying: true,
          goGeneration: (cl.goGeneration ?? 0) + 1
        }
      })
    }))
  },

  stopCuelist: (id) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) =>
        cl.id === id ? { ...cl, isPlaying: false, currentCueIndex: -1 } : cl
      )
    }))
  },

  goBackCuelist: (id) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) => {
        if (cl.id !== id || cl.cues.length === 0) return cl
        let prevIndex = cl.currentCueIndex - 1
        if (prevIndex < 0) prevIndex = cl.cues.length - 1
        return {
          ...cl,
          currentCueIndex: prevIndex,
          isPlaying: true,
          goGeneration: (cl.goGeneration ?? 0) + 1
        }
      })
    }))
  },

  setCuelistFader: (id, level) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) =>
        cl.id === id ? { ...cl, faderLevel: Math.max(0, Math.min(255, level)) } : cl
      )
    }))
  },

  flashCuelist: (id, on) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) =>
        cl.id === id ? { ...cl, flash: on } : cl
      )
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

  toggleChase: (id) => {
    set((state) => ({
      chases: state.chases.map((ch) =>
        ch.id === id ? { ...ch, isPlaying: !ch.isPlaying } : ch
      )
    }))
  },

  setChaseBpm: (id, bpm) => {
    set((state) => ({
      chases: state.chases.map((ch) =>
        ch.id === id ? { ...ch, bpm: Math.max(1, Math.min(999, bpm)) } : ch
      )
    }))
  },

  setChaseFader: (id, level) => {
    set((state) => ({
      chases: state.chases.map((ch) =>
        ch.id === id ? { ...ch, faderLevel: Math.max(0, Math.min(255, level)) } : ch
      )
    }))
  },

  setChaseStep: (id, stepIndex) => {
    set((state) => ({
      chases: state.chases.map((ch) =>
        ch.id === id ? { ...ch, currentStepIndex: stepIndex } : ch
      )
    }))
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

  setCuelists: (cuelists) => set({ cuelists }),
  setChases: (chases) => set({ chases }),
  setPresets: (presets) => set({ presets })
}))
