import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { DEFAULT_ROOM_CONFIG, type RoomConfig, type TrussBar } from '@shared/types'
import { getDeviceProfile } from '@renderer/lib/device-detect'

export type VisualizerSubTab = '3d' | 'layout'
/** 3D render quality: frame-rate cap, resolution, real lights, detail */
export type VisualizerQuality = 'low' | 'medium' | 'high'

const PREF_KEY = 'photonboard.visualizer.prefs'

interface VisualizerPrefs {
  quality?: VisualizerQuality
  hazeEnabled?: boolean
  showLabels?: boolean
  shadowsEnabled?: boolean
}

function readPrefs(): VisualizerPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    return raw ? (JSON.parse(raw) as VisualizerPrefs) : {}
  } catch {
    return {}
  }
}

function writePrefs(patch: VisualizerPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...patch }))
  } catch { /* private mode / blocked storage: keep in memory only */ }
}

/** Medium on the Pi and other ARM / mid-range GPUs, low on weak GPUs, high on desktops */
function defaultQuality(): VisualizerQuality {
  try {
    const dev = getDeviceProfile()
    if (dev.isLowEnd) return 'low'
    if (dev.isMidRange || dev.isArm) return 'medium'
    return 'high'
  } catch {
    return 'medium'
  }
}

const prefs = readPrefs()

interface VisualizerState {
  subTab: VisualizerSubTab
  selectedFixtureId: string | null
  selectedTrussId: string | null
  roomConfig: RoomConfig
  showBeams: boolean
  showRoom: boolean
  showGrid: boolean
  shadowsEnabled: boolean
  /** Atmosphere: beams strongly visible (haze) or faint (clean air) */
  hazeEnabled: boolean
  /** Fixture number labels in the 3D view */
  showLabels: boolean
  quality: VisualizerQuality
  ambientIntensity: number // 0-1
  // Layout editor
  gridSize: number  // metres
  snapToGrid: boolean
  layoutView: { panX: number; panY: number; zoom: number }

  setSubTab: (tab: VisualizerSubTab) => void
  selectFixture: (id: string | null) => void
  selectTruss: (id: string | null) => void
  setRoomConfig: (config: Partial<RoomConfig>) => void
  setShowBeams: (v: boolean) => void
  setShowRoom: (v: boolean) => void
  setShowGrid: (v: boolean) => void
  setShadowsEnabled: (v: boolean) => void
  setHazeEnabled: (v: boolean) => void
  setShowLabels: (v: boolean) => void
  setQuality: (q: VisualizerQuality) => void
  setAmbientIntensity: (v: number) => void
  setGridSize: (v: number) => void
  setSnapToGrid: (v: boolean) => void
  setLayoutView: (v: { panX: number; panY: number; zoom: number }) => void
  /** Adds a bar (optionally with initial fields, e.g. a depth) and selects it */
  addTrussBar: (init?: Partial<Omit<TrussBar, 'id'>>) => void
  removeTrussBar: (id: string) => void
  updateTrussBar: (id: string, updates: Partial<TrussBar>) => void
}

export const useVisualizerStore = create<VisualizerState>()(subscribeWithSelector((set) => ({
  subTab: '3d',
  selectedFixtureId: null,
  selectedTrussId: null,
  roomConfig: { ...DEFAULT_ROOM_CONFIG, trussBars: DEFAULT_ROOM_CONFIG.trussBars.map(t => ({ ...t })) },
  showBeams: true,
  showRoom: true,
  showGrid: true,
  shadowsEnabled: prefs.shadowsEnabled ?? false,
  hazeEnabled: prefs.hazeEnabled ?? true,
  showLabels: prefs.showLabels ?? true,
  quality: prefs.quality ?? defaultQuality(),
  ambientIntensity: 0.15,
  gridSize: 0.5,
  snapToGrid: true,
  layoutView: { panX: 0, panY: 0, zoom: 0 },  // zoom=0 means "not yet set, do fitToView"

  setSubTab: (tab) => set({ subTab: tab }),
  selectFixture: (id) => set({ selectedFixtureId: id, selectedTrussId: null }),
  selectTruss: (id) => set({ selectedTrussId: id, selectedFixtureId: null }),
  setRoomConfig: (config) => set((s) => ({ roomConfig: { ...s.roomConfig, ...config } })),
  setShowBeams: (v) => set({ showBeams: v }),
  setShowRoom: (v) => set({ showRoom: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShadowsEnabled: (v) => { writePrefs({ shadowsEnabled: v }); set({ shadowsEnabled: v }) },
  setHazeEnabled: (v) => { writePrefs({ hazeEnabled: v }); set({ hazeEnabled: v }) },
  setShowLabels: (v) => { writePrefs({ showLabels: v }); set({ showLabels: v }) },
  setQuality: (q) => { writePrefs({ quality: q }); set({ quality: q }) },
  setAmbientIntensity: (v) => set({ ambientIntensity: v }),
  setGridSize: (v) => set({ gridSize: v }),
  setSnapToGrid: (v) => set({ snapToGrid: v }),
  setLayoutView: (v) => set({ layoutView: v }),

  addTrussBar: (init) => set((s) => {
    const { width, height, trussBars } = s.roomConfig
    const newBar: TrussBar = {
      id: crypto.randomUUID(),
      name: `Bar ${trussBars.length + 1}`,
      z: 0,
      y: height - 0.05,
      width: width,
      ...init
    }
    return { roomConfig: { ...s.roomConfig, trussBars: [...trussBars, newBar] }, selectedTrussId: newBar.id }
  }),

  removeTrussBar: (id) => set((s) => ({
    roomConfig: { ...s.roomConfig, trussBars: s.roomConfig.trussBars.filter(t => t.id !== id) },
    selectedTrussId: s.selectedTrussId === id ? null : s.selectedTrussId,
  })),

  updateTrussBar: (id, updates) => set((s) => ({
    roomConfig: {
      ...s.roomConfig,
      trussBars: s.roomConfig.trussBars.map(t => t.id === id ? { ...t, ...updates } : t),
    },
  })),
})))
