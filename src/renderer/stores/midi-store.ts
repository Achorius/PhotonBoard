import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { MidiMapping, MidiDevice, MidiSourceType, MidiTargetType } from '@shared/types'

interface MidiLearnTarget {
  type: MidiTargetType
  id?: string
  parameter?: string
  label: string
}

interface MidiState {
  devices: MidiDevice[]
  mappings: MidiMapping[]
  isLearning: boolean
  learnTarget: MidiLearnTarget | null
  lastMessage: { type: string; channel: number; number: number; value: number } | null

  // Actions
  initMidi: () => Promise<void>
  startLearn: (target: MidiLearnTarget) => void
  cancelLearn: () => void
  completeLearn: (source: { type: MidiSourceType; channel: number; number: number; deviceName?: string }) => void
  addMapping: (mapping: Omit<MidiMapping, 'id'>) => void
  removeMapping: (id: string) => void
  updateMapping: (id: string, updates: Partial<MidiMapping>) => void
  setLastMessage: (msg: { type: string; channel: number; number: number; value: number }) => void

  // Import
  setMappings: (mappings: MidiMapping[]) => void
}

export const useMidiStore = create<MidiState>((set, get) => ({
  devices: [],
  mappings: [],
  isLearning: false,
  learnTarget: null,
  lastMessage: null,

  initMidi: async () => {
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      const devices: MidiDevice[] = []

      access.inputs.forEach((input) => {
        devices.push({
          id: input.id,
          name: input.name || 'Unknown',
          manufacturer: input.manufacturer || 'Unknown',
          type: 'input',
          connected: input.state === 'connected'
        })

        // Listen for MIDI messages
        input.onmidimessage = (event: MIDIMessageEvent) => {
          if (!event.data || event.data.length < 2) return
          const [status, data1, data2] = event.data
          const type = status & 0xf0
          const channel = (status & 0x0f) + 1

          if (type === 0xb0) {
            // Control Change
            const msg = { type: 'cc', channel, number: data1, value: data2 || 0 }
            get().setLastMessage(msg)

            if (get().isLearning) {
              get().completeLearn({ type: 'cc', channel, number: data1, deviceName: input.name || undefined })
            }

            // Route to mappings
            handleMidiInput('cc', channel, data1, data2 || 0)
          } else if (type === 0x90 && data2 > 0) {
            // Note On
            const msg = { type: 'note', channel, number: data1, value: data2 }
            get().setLastMessage(msg)

            if (get().isLearning) {
              get().completeLearn({ type: 'note', channel, number: data1, deviceName: input.name || undefined })
            }

            handleMidiInput('note', channel, data1, data2)
          } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
            // Note Off
            handleMidiInput('note', channel, data1, 0)
          }
        }
      })

      access.outputs.forEach((output) => {
        devices.push({
          id: output.id,
          name: output.name || 'Unknown',
          manufacturer: output.manufacturer || 'Unknown',
          type: 'output',
          connected: output.state === 'connected'
        })
      })

      // Listen for device changes
      access.onstatechange = () => {
        get().initMidi()
      }

      set({ devices })
    } catch (e) {
      console.warn('WebMIDI not available:', e)
    }
  },

  startLearn: (target) => {
    set({ isLearning: true, learnTarget: target })
  },

  cancelLearn: () => {
    set({ isLearning: false, learnTarget: null })
  },

  completeLearn: (source) => {
    const { learnTarget } = get()
    if (!learnTarget) return

    const mapping: MidiMapping = {
      id: uuidv4(),
      name: learnTarget.label,
      source: {
        deviceName: source.deviceName,
        type: source.type,
        channel: source.channel,
        number: source.number
      },
      target: {
        type: learnTarget.type,
        id: learnTarget.id,
        parameter: learnTarget.parameter
      },
      options: {
        min: 0,
        max: 255,
        inverted: false
      }
    }

    set((state) => ({
      mappings: [...state.mappings, mapping],
      isLearning: false,
      learnTarget: null
    }))
  },

  addMapping: (mapping) => {
    set((state) => ({
      mappings: [...state.mappings, { ...mapping, id: uuidv4() }]
    }))
  },

  removeMapping: (id) => {
    set((state) => ({ mappings: state.mappings.filter((m) => m.id !== id) }))
  },

  updateMapping: (id, updates) => {
    set((state) => ({
      mappings: state.mappings.map((m) => m.id === id ? { ...m, ...updates } : m)
    }))
  },

  setLastMessage: (msg) => {
    set({ lastMessage: msg })
  },

  setMappings: (mappings) => set({ mappings })
}))

// External MIDI routing function — will be connected to the cue/chase/dmx engines
let midiRouter: ((type: string, channel: number, number: number, value: number) => void) | null = null

export function setMidiRouter(fn: (type: string, channel: number, number: number, value: number) => void): void {
  midiRouter = fn
}

function handleMidiInput(type: string, channel: number, number: number, value: number): void {
  if (midiRouter) {
    midiRouter(type, channel, number, value)
  }
}
