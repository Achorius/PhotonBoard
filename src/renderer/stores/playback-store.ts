import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Cue, Cuelist, Chase, ChaseStep, CueChannelValue, Preset, PresetType } from '@shared/types'

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
        const nextIndex = cl.currentCueIndex + 1
        if (nextIndex >= cl.cues.length) {
          if (cl.isLooping) {
            return { ...cl, currentCueIndex: 0, isPlaying: true }
          }
          return { ...cl, isPlaying: false }
        }
        return { ...cl, currentCueIndex: nextIndex, isPlaying: true }
      })
    }))
  },

  stopCuelist: (id) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) =>
        cl.id === id ? { ...cl, isPlaying: false } : cl
      )
    }))
  },

  goBackCuelist: (id) => {
    set((state) => ({
      cuelists: state.cuelists.map((cl) => {
        if (cl.id !== id) return cl
        const prevIndex = Math.max(-1, cl.currentCueIndex - 1)
        return { ...cl, currentCueIndex: prevIndex, isPlaying: prevIndex >= 0 }
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

  setCuelists: (cuelists) => set({ cuelists }),
  setChases: (chases) => set({ chases }),
  setPresets: (presets) => set({ presets })
}))
