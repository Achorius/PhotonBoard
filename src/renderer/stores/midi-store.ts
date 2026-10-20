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

export type MidiBehavior = MidiMapping['options']['behavior']
type MidiTarget = MidiMapping['target']

interface MidiLearnTarget {
  type: MidiTargetType
  id?: string
  parameter?: string
  label: string
  /** Button behaviour of the learned mapping (e.g. the executor cell's mode) */
  behavior?: MidiBehavior
}

/** Same target (type + id + parameter)? */
export function sameMidiTarget(a: MidiTarget, b: MidiTarget): boolean {
  return a.type === b.type && (a.id ?? undefined) === (b.id ?? undefined) && (a.parameter ?? undefined) === (b.parameter ?? undefined)
}

function sameMidiSource(a: MidiMapping['source'], b: MidiMapping['source']): boolean {
  return a.type === b.type && a.channel === b.channel && a.number === b.number && (a.deviceName ?? '') === (b.deviceName ?? '')
}

/** Mappings that drive a target (oldest first) */
export function mappingsForTarget(mappings: MidiMapping[], target: MidiTarget): MidiMapping[] {
  return mappings.filter((m) => sameMidiTarget(m.target, target))
}

/**
 * Put a learned mapping in the list: it REPLACES every mapping of the same
 * target (re-learn never leaves the old pad mapped too — two mappings on one
 * pad would toggle twice per press). It takes the place of the first one.
 */
export function insertLearnedMapping(mappings: MidiMapping[], mapping: MidiMapping): { mappings: MidiMapping[]; replaced: MidiMapping[] } {
  const replaced: MidiMapping[] = []
  const next: MidiMapping[] = []
  let placed = false
  for (const m of mappings) {
    if (sameMidiTarget(m.target, mapping.target)) {
      replaced.push(m)
      if (!placed) { next.push(mapping); placed = true }
      continue
    }
    next.push(m)
  }
  if (!placed) next.push(mapping)
  return { mappings: next, replaced }
}

/** Drop exact duplicates (same source AND same target): they fire twice per message. */
export function dedupeMappings(mappings: MidiMapping[]): MidiMapping[] {
  const out: MidiMapping[] = []
  for (const m of mappings) {
    if (out.some((o) => sameMidiTarget(o.target, m.target) && sameMidiSource(o.source, m.source))) continue
    out.push(m)
  }
  return out.length === mappings.length ? mappings : out
}

type MidiApiStatus = 'pending' | 'available' | 'unavailable' | 'error'

/** An incoming MIDI message as shown by the monitor ('noteoff' = note released) */
export interface MidiMessageInfo {
  type: string
  channel: number
  number: number
  value: number
  deviceName?: string
  /** performance.now() when received */
  ts?: number
}

/** Messages kept for the MIDI monitor */
export const MIDI_LOG_SIZE = 64

interface MidiState {
  devices: MidiDevice[]
  mappings: MidiMapping[]
  isLearning: boolean
  learnTarget: MidiLearnTarget | null
  lastMessage: MidiMessageInfo | null
  /** Most recent incoming messages, newest first (MIDI monitor) */
  messageLog: MidiMessageInfo[]
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
  /** Set the button behaviour of EVERY mapping of a target (e.g. a scene's GO) */
  setTargetBehavior: (target: MidiTarget, behavior: MidiBehavior) => void
  /** Records an incoming message: lastMessage + monitor log */
  setLastMessage: (msg: MidiMessageInfo) => void
  /** Log a message for the monitor only (note-offs) */
  logMessage: (msg: MidiMessageInfo) => void
  clearMessageLog: () => void

  // Import
  setMappings: (mappings: MidiMapping[]) => void
}

export const useMidiStore = create<MidiState>((set, get) => ({
  devices: [],
  mappings: [],
  isLearning: false,
  learnTarget: null,
  lastMessage: null,
  messageLog: [],
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
        access = currentMidiAccess
      } else {
        access = await navigator.requestMIDIAccess({ sysex: false })
        currentMidiAccess = access
      }

      const devices: MidiDevice[] = []

      access.inputs.forEach((input) => {
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
            get().setLastMessage({ type: 'cc', channel, number: data1, value, deviceName })
            if (get().isLearning) get().completeLearn({ type: 'cc', channel, number: data1, value, deviceName })
            handleMidiInput('cc', channel, data1, value, deviceName)
          } else if (type === 0x90 && data2 > 0) {
            // Note On
            get().setLastMessage({ type: 'note', channel, number: data1, value: data2, deviceName })
            if (get().isLearning) get().completeLearn({ type: 'note', channel, number: data1, deviceName })
            handleMidiInput('note', channel, data1, data2, deviceName)
          } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
            // Note Off
            get().logMessage({ type: 'noteoff', channel, number: data1, value: 0, deviceName })
            handleMidiInput('note', channel, data1, 0, deviceName)
          } else if (type === 0xc0) {
            // Program Change: momentary trigger (no release message exists)
            get().setLastMessage({ type: 'program', channel, number: data1, value: 127, deviceName })
            if (get().isLearning) get().completeLearn({ type: 'program', channel, number: data1, deviceName })
            handleMidiInput('program', channel, data1, 127, deviceName)
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

      // Listen for device changes — use module-level debounce to prevent reinit loop
      access.onstatechange = () => {
        // Don't reinit while learning
        if (get().isLearning) return
        if (reinitTimeout) clearTimeout(reinitTimeout)
        reinitTimeout = setTimeout(() => { get().initMidi() }, 2000)
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

  setTargetBehavior: (target, behavior) => {
    const { mappings } = get()
    if (!mappings.some((m) => sameMidiTarget(m.target, target) && m.options.behavior !== behavior)) return
    for (const m of mappings) if (sameMidiTarget(m.target, target)) cleanupMappingState(m.id)
    set({
      mappings: mappings.map((m) => sameMidiTarget(m.target, target) && m.options.behavior !== behavior
        ? { ...m, options: { ...m.options, behavior } }
        : m)
    })
  },

  setLastMessage: (msg) => {
    const entry = { ...msg, ts: msg.ts ?? performance.now() }
    set((state) => ({ lastMessage: entry, messageLog: [entry, ...state.messageLog].slice(0, MIDI_LOG_SIZE) }))
  },

  logMessage: (msg) => {
    const entry = { ...msg, ts: msg.ts ?? performance.now() }
    set((state) => ({ messageLog: [entry, ...state.messageLog].slice(0, MIDI_LOG_SIZE) }))
  },

  clearMessageLog: () => set({ messageLog: [] }),

  setMappings: (mappings) => set({ mappings: dedupeMappings(mappings) })
}))

// ---- MIDI learn capture ----

let learnCapture: { source: LearnSource; values: number[]; timer: ReturnType<typeof setTimeout> } | null = null

function cancelLearnCapture(): void {
  if (learnCapture) clearTimeout(learnCapture.timer)
  learnCapture = null
}

function finishLearn(source: LearnSource, encoding: 'absolute' | 'relative'): void {
  const { learnTarget, mappings } = useMidiStore.getState()
  if (!learnTarget) return
  const target: MidiTarget = { type: learnTarget.type, id: learnTarget.id, parameter: learnTarget.parameter }
  // Re-learn keeps the user's range / behaviour when the control kind is the same
  const previous = mappingsForTarget(mappings, target).find((m) => m.source.type === source.type)
  const options: MidiMapping['options'] = previous
    ? { ...previous.options, encoding }
    : { min: 0, max: 255, inverted: false, encoding, behavior: source.type === 'cc' ? 'direct' : 'toggle' }
  if (learnTarget.behavior) options.behavior = learnTarget.behavior
  const mapping: MidiMapping = {
    id: uuidv4(),
    name: learnTarget.label,
    source: {
      deviceName: source.deviceName,
      type: source.type,
      channel: source.channel,
      number: source.number
    },
    target,
    options
  }
  const result = insertLearnedMapping(mappings, mapping)
  // Replaced mappings: forget their toggle state, but never reset their target
  for (const m of result.replaced) cleanupMappingState(m.id)
  useMidiStore.setState({
    mappings: result.mappings,
    isLearning: false,
    learnTarget: null
  })
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
