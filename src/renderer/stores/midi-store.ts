import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { MidiMapping, MidiDevice, MidiSourceType, MidiTargetType } from '@shared/types'
import { detectCcEncoding } from '@renderer/lib/midi-learn'

/** How long MIDI learn keeps listening after the first CC to tell faders from encoders */
export const LEARN_CAPTURE_MS = 450

interface LearnSource {
  type: MidiSourceType
  channel: number
  number: number
  value?: number
  deviceName?: string
}

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
  /**
   * Feed a message while learning. Notes / program changes complete at once;
   * a CC completes after LEARN_CAPTURE_MS so its encoding can be detected from
   * the following messages (absolute unless they clearly come from an encoder).
   */
  completeLearn: (source: LearnSource) => void
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
          if (!event.data || event.data.length < 1) return
          const [status, data1, data2] = event.data
          const deviceName = input.name || undefined

          // Route system messages (MTC quarter frame 0xF1) to timecode engine
          if (status >= 0xf0) {
            if (timecodeProcessor) timecodeProcessor(status, data1 || 0, data2 || 0)
            return
          }

          if (event.data.length < 2) return
          const type = status & 0xf0
          const channel = (status & 0x0f) + 1

          if (type === 0xb0) {
            // Control Change
            const value = data2 || 0
            get().setLastMessage({ type: 'cc', channel, number: data1, value })
            if (get().isLearning) get().completeLearn({ type: 'cc', channel, number: data1, value, deviceName })
            handleMidiInput('cc', channel, data1, value, deviceName)
          } else if (type === 0x90 && data2 > 0) {
            // Note On
            get().setLastMessage({ type: 'note', channel, number: data1, value: data2 })
            if (get().isLearning) get().completeLearn({ type: 'note', channel, number: data1, deviceName })
            handleMidiInput('note', channel, data1, data2, deviceName)
          } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
            // Note Off
            handleMidiInput('note', channel, data1, 0, deviceName)
          } else if (type === 0xc0) {
            // Program Change: momentary trigger (no release message exists)
            get().setLastMessage({ type: 'program', channel, number: data1, value: 127 })
            if (get().isLearning) get().completeLearn({ type: 'program', channel, number: data1, deviceName })
            handleMidiInput('program', channel, data1, 127, deviceName)
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
    cancelLearnCapture()
    set({ isLearning: true, learnTarget: target })
  },

  cancelLearn: () => {
    cancelLearnCapture()
    set({ isLearning: false, learnTarget: null })
  },

  completeLearn: (source) => {
    const { learnTarget } = get()
    if (!learnTarget) return

    if (source.type === 'cc') {
      if (learnCapture) {
        const c = learnCapture.source
        if (c.type === 'cc' && c.channel === source.channel && c.number === source.number && c.deviceName === source.deviceName) {
          if (source.value !== undefined) learnCapture.values.push(source.value)
        }
        return
      }
      learnCapture = {
        source,
        values: source.value !== undefined ? [source.value] : [],
        timer: setTimeout(() => {
          const capture = learnCapture
          learnCapture = null
          if (capture) finishLearn(capture.source, detectCcEncoding(capture.values))
        }, LEARN_CAPTURE_MS)
      }
      return
    }
    if (learnCapture) return // a CC is being captured; ignore other messages
    finishLearn(source, 'absolute')
  },

  addMapping: (mapping) => {
    set((state) => ({
      mappings: [...state.mappings, { ...mapping, id: uuidv4() }]
    }))
  },

  removeMapping: (id) => {
    const mapping = get().mappings.find(m => m.id === id)
    if (mapping) {
      // Reset the target value to 0 when removing a mapping
      resetMappingTarget(mapping)
      // Clean up module-level state
      cleanupMappingState(mapping.id)
    }
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

// ---- MIDI learn capture ----

let learnCapture: { source: LearnSource; values: number[]; timer: ReturnType<typeof setTimeout> } | null = null

function cancelLearnCapture(): void {
  if (learnCapture) clearTimeout(learnCapture.timer)
  learnCapture = null
}

function finishLearn(source: LearnSource, encoding: 'absolute' | 'relative'): void {
  const { learnTarget } = useMidiStore.getState()
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
      inverted: false,
      encoding,
      behavior: source.type === 'cc' ? 'direct' : 'toggle'
    }
  }
  useMidiStore.setState((state) => ({
    mappings: [...state.mappings, mapping],
    isLearning: false,
    learnTarget: null
  }))
}

// Module-level debounce for device state changes (must persist across initMidi calls)
let reinitTimeout: ReturnType<typeof setTimeout> | null = null
// Track the current MIDIAccess to avoid re-registering listeners
let currentMidiAccess: MIDIAccess | null = null

// External MIDI routing function — will be connected to the cue/chase/dmx engines
export type MidiRouter = (type: MidiSourceType, channel: number, number: number, value: number, deviceName?: string) => void
let midiRouter: MidiRouter | null = null

// Timecode processor — routes system messages (0xF1 quarter frame) to timecode engine
let timecodeProcessor: ((status: number, data1: number, data2: number) => void) | null = null

// Callback to reset a mapping's target when it's removed
let mappingResetFn: ((mapping: MidiMapping) => void) | null = null
// Callback to clean up module-level state (toggleStates, relativeValues) when mapping removed
let mappingCleanupFn: ((mappingId: string) => void) | null = null

export function setMidiRouter(fn: MidiRouter): void {
  midiRouter = fn
}

export function setTimecodeProcessor(fn: (status: number, data1: number, data2: number) => void): void {
  timecodeProcessor = fn
}

export function setMappingResetFn(fn: (mapping: MidiMapping) => void): void {
  mappingResetFn = fn
}

export function setMappingCleanupFn(fn: (mappingId: string) => void): void {
  mappingCleanupFn = fn
}

function handleMidiInput(type: MidiSourceType, channel: number, number: number, value: number, deviceName?: string): void {
  if (!midiRouter) return
  try {
    midiRouter(type, channel, number, value, deviceName)
  } catch (e) {
    console.error('[MIDI] routing failed:', e)
  }
}

function resetMappingTarget(mapping: MidiMapping): void {
  if (mappingResetFn) mappingResetFn(mapping)
}

function cleanupMappingState(mappingId: string): void {
  if (mappingCleanupFn) mappingCleanupFn(mappingId)
}
