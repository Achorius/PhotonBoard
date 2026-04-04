import { create } from 'zustand'
import { DEFAULT_ROOM_CONFIG, type RoomConfig, type TrussBar } from '@shared/types'

export type VisualizerSubTab = '3d' | 'layout'

interface VisualizerState {
  subTab: VisualizerSubTab
  selectedFixtureId: string | null
  selectedTrussId: string | null
  roomConfig: RoomConfig
  showBeams: boolean
  showRoom: boolean
  showGrid: boolean
  shadowsEnabled: boolean
  ambientIntensity: number // 0-1
  // Layout editor
  gridSize: number  // metres
  snapToGrid: boolean

  setSubTab: (tab: VisualizerSubTab) => void
  selectFixture: (id: string | null) => void
  selectTruss: (id: string | null) => void
  setRoomConfig: (config: Partial<RoomConfig>) => void
  setShowBeams: (v: boolean) => void
  setShowRoom: (v: boolean) => void
  setShowGrid: (v: boolean) => void
  setShadowsEnabled: (v: boolean) => void
  setAmbientIntensity: (v: number) => void
  setGridSize: (v: number) => void
  setSnapToGrid: (v: boolean) => void
  addTrussBar: () => void
  removeTrussBar: (id: string) => void
  updateTrussBar: (id: string, updates: Partial<TrussBar>) => void
}

export const useVisualizerStore = create<VisualizerState>((set) => ({
  subTab: '3d',
  selectedFixtureId: null,
  selectedTrussId: null,
  roomConfig: { ...DEFAULT_ROOM_CONFIG, trussBars: DEFAULT_ROOM_CONFIG.trussBars.map(t => ({ ...t })) },
  showBeams: true,
  showRoom: true,
  showGrid: true,
  shadowsEnabled: false,
  ambientIntensity: 0.15,
  gridSize: 0.5,
  snapToGrid: true,

  setSubTab: (tab) => set({ subTab: tab }),
  selectFixture: (id) => set({ selectedFixtureId: id, selectedTrussId: null }),
  selectTruss: (id) => set({ selectedTrussId: id, selectedFixtureId: null }),
  setRoomConfig: (config) => set((s) => ({ roomConfig: { ...s.roomConfig, ...config } })),
  setShowBeams: (v) => set({ showBeams: v }),
  setShowRoom: (v) => set({ showRoom: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShadowsEnabled: (v) => set({ shadowsEnabled: v }),
  setAmbientIntensity: (v) => set({ ambientIntensity: v }),
  setGridSize: (v) => set({ gridSize: v }),
  setSnapToGrid: (v) => set({ snapToGrid: v }),

  addTrussBar: () => set((s) => {
    const { width, depth, height, trussBars } = s.roomConfig
    const newBar: TrussBar = {
      id: crypto.randomUUID(),
      name: `Bar ${trussBars.length + 1}`,
      z: 0,
      y: height - 0.05,
      width: width,
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
}))
