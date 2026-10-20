// ============================================================
// PhotonBoard — MIDI controllers (profiles) store
//
// settings  machine settings per controller (keyed by input port
//           name), persisted in localStorage 'photonboard.controllers'
//           — never in the show, never undone
// detected  recognised controllers (runtime)
// ghosts    physical positions of faders that have not picked up their
//           value yet (soft takeover), published ≤ 10 Hz. Key:
//           ghostKey(page, col) for a column fader, GM_GHOST_KEY for the
//           Grand Master; value 0-255. The executor bar / stage pages
//           draw a ghost tick there.
// testing   input port whose LEDs are being tested
// ============================================================

import { create } from 'zustand'
import type { ControllerLayoutId, ControllerSettings } from '@renderer/lib/midi/controller-types'

export const CONTROLLERS_STORAGE_KEY = 'photonboard.controllers'

export interface DetectedController {
  /** Input port name */
  port: string
  profileId: string
  /** Output port lighting its LEDs (null = none found) */
  outputPort: string | null
  connected: boolean
}

/** Ghost key of a column fader (page 0-based) */
export function ghostKey(page: number, col: number): string {
  return `${page}:${col}`
}

export const GM_GHOST_KEY = 'gm'

const LAYOUTS: readonly ControllerLayoutId[] = ['executors-2pages', 'executors-busk']

function cleanSettings(raw: unknown): ControllerSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.port !== 'string' || !o.port || typeof o.profileId !== 'string' || !o.profileId) return null
  const s: ControllerSettings = {
    profileId: o.profileId,
    port: o.port,
    layout: LAYOUTS.includes(o.layout as ControllerLayoutId) ? (o.layout as ControllerLayoutId) : 'executors-2pages',
    takeover: o.takeover === 'jump' ? 'jump' : 'pickup',
    enabled: o.enabled !== false
  }
  if (o.rgbLeds === true) s.rgbLeds = true
  return s
}

export function loadControllerSettings(): ControllerSettings[] {
  try {
    const raw = globalThis.localStorage?.getItem(CONTROLLERS_STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    const out: ControllerSettings[] = []
    for (const item of list) {
      const s = cleanSettings(item)
      if (s && !out.some((o) => o.port === s.port)) out.push(s)
    }
    return out
  } catch {
    return []
  }
}

function saveControllerSettings(list: ControllerSettings[]): void {
  try {
    globalThis.localStorage?.setItem(CONTROLLERS_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // private mode / quota: settings stay for this session
  }
}

interface ControllerState {
  settings: ControllerSettings[]
  detected: DetectedController[]
  ghosts: Record<string, number>
  testing: string | null

  /** Settings of a port, created with the profile defaults when missing */
  ensureSettings: (port: string, defaults: Omit<ControllerSettings, 'port'>) => ControllerSettings
  updateSettings: (port: string, patch: Partial<Omit<ControllerSettings, 'port'>>) => void
  /** Forget a controller's settings */
  forgetSettings: (port: string) => void
  setDetected: (list: DetectedController[]) => void
  setGhosts: (ghosts: Record<string, number>) => void
  setTesting: (port: string | null) => void
}

const EMPTY_GHOSTS: Record<string, number> = {}

function sameGhosts(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}

export const useControllerStore = create<ControllerState>((set, get) => ({
  settings: loadControllerSettings(),
  detected: [],
  ghosts: EMPTY_GHOSTS,
  testing: null,

  ensureSettings: (port, defaults) => {
    const existing = get().settings.find((s) => s.port === port)
    if (existing && existing.profileId === defaults.profileId) return existing
    const created: ControllerSettings = { ...defaults, port }
    const settings = [...get().settings.filter((s) => s.port !== port), created]
    saveControllerSettings(settings)
    set({ settings })
    return created
  },

  updateSettings: (port, patch) => {
    let changed = false
    const settings = get().settings.map((s) => {
      if (s.port !== port) return s
      const next = { ...s, ...patch, port }
      if (!next.rgbLeds) delete next.rgbLeds
      changed = JSON.stringify(next) !== JSON.stringify(s)
      return next
    })
    if (!changed) return
    saveControllerSettings(settings)
    set({ settings })
  },

  forgetSettings: (port) => {
    const settings = get().settings.filter((s) => s.port !== port)
    if (settings.length === get().settings.length) return
    saveControllerSettings(settings)
    set({ settings })
  },

  setDetected: (list) => {
    if (JSON.stringify(list) === JSON.stringify(get().detected)) return
    set({ detected: list })
  },

  setGhosts: (ghosts) => {
    if (sameGhosts(ghosts, get().ghosts)) return
    set({ ghosts: Object.keys(ghosts).length === 0 ? EMPTY_GHOSTS : ghosts })
  },

  setTesting: (port) => {
    if (port !== get().testing) set({ testing: port })
  }
}))

/** Ghost position (0-255) of a column fader, undefined when it is picked up */
export function useFaderGhost(key: string): number | undefined {
  return useControllerStore((s) => s.ghosts[key])
}
