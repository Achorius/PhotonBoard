import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { MidiMapping, MidiDevice, MidiSourceType, MidiTargetType } from '@shared/types'

interface MidiLearnTarget {
  type: MidiTargetType
  id?: string
  parameter?: string
  label: string
}

type MidiApiStatus = 'pending' | 'available' | 'unavailable' | 'error'

interface MidiState {
  devices: MidiDevice[]
  mappings: MidiMapping[]
  isLearning: boolean
  learnTarget: MidiLearnTarget | null
  lastMessage: { type: string; channel: number; number: number; value: number } | null
  apiStatus: MidiApiStatus
  apiError: string | null

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
  apiStatus: 'pending',
  apiError: null,

  initMidi: async () => {
    if (!navigator.requestMIDIAccess) {
      const msg = 'Web MIDI API is not available in this browser/environment'
      console.error('[MIDI]', msg)
      set({ apiStatus: 'unavailable', apiError: msg, devices: [] })
      return
    }

    try {
      // Reuse existing MIDIAccess if available (avoids reinit loop)
      let access: MIDIAccess
      if (currentMidiAccess) {
        console.log('[MIDI] Reusing existing MIDI access, rescanning devices...')
        access = currentMidiAccess
      } else {
        console.log('[MIDI] Requesting MIDI access...')
        access = await navigator.requestMIDIAccess({ sysex: false })
        currentMidiAccess = access
        console.log('[MIDI] Access granted.')
      }

      const devices: MidiDevice[] = []

      access.inputs.forEach((input) => {
        console.log('[MIDI] Input found:', input.name, '| state:', input.state)
        devices.push({
          id: input.id,
          name: input.name || 'Unknown',
          manufacturer: input.manufacturer || 'Unknown',
          type: 'input',
          connected: input.state === 'connected'
        })

        // Listen for MIDI messages (reassigning is safe, replaces previous handler)
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
        console.log('[MIDI] Output found:', output.name, '| state:', output.state)
        devices.push({
          id: output.id,
          name: output.name || 'Unknown',
          manufacturer: output.manufacturer || 'Unknown',
          type: 'output',
          connected: output.state === 'connected'
        })
      })

      console.log('[MIDI] Total devices:', devices.length, '(inputs:', devices.filter(d => d.type === 'input').length, ', outputs:', devices.filter(d => d.type === 'output').length, ')')

      // Listen for device changes — use module-level debounce to prevent reinit loop
      access.onstatechange = (event) => {
        const port = (event as any).port
        console.log('[MIDI] Device state changed:', port?.name, port?.state)
        // Don't reinit while learning
        if (get().isLearning) {
          console.log('[MIDI] Skipping reinit during learn mode')
          return
        }
        if (reinitTimeout) clearTimeout(reinitTimeout)
        reinitTimeout = setTimeout(() => {
          console.log('[MIDI] Debounced rescan triggered')
          get().initMidi()
        }, 2000)
      }

      set({ devices, apiStatus: 'available', apiError: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[MIDI] Failed to access Web MIDI API:', msg, e)
      set({ apiStatus: 'error', apiError: msg, devices: [] })
    }
  },

  startLearn: (target) => {
    console.log('[MIDI] startLearn:', target.label, target.type)
    set({ isLearning: true, learnTarget: target })
  },

  cancelLearn: () => {
    console.log('[MIDI] cancelLearn')
    set({ isLearning: false, learnTarget: null })
  },

  completeLearn: (source) => {
    const { learnTarget } = get()
    if (!learnTarget) {
      console.log('[MIDI] completeLearn called but no learnTarget')
      return
    }
    console.log('[MIDI] completeLearn:', source.type, 'ch', source.channel, '#', source.number, '→', learnTarget.label)

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

// Module-level debounce for device state changes (must persist across initMidi calls)
let reinitTimeout: ReturnType<typeof setTimeout> | null = null
// Track the current MIDIAccess to avoid re-registering listeners
let currentMidiAccess: MIDIAccess | null = null

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
