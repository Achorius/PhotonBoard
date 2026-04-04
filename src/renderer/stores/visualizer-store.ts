import { create } from 'zustand'
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from '@shared/types'

export type VisualizerSubTab = '3d' | 'layout'

interface VisualizerState {
  subTab: VisualizerSubTab
  selectedFixtureId: string | null
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
  setRoomConfig: (config: Partial<RoomConfig>) => void
  setShowBeams: (v: boolean) => void
  setShowRoom: (v: boolean) => void
  setShowGrid: (v: boolean) => void
  setShadowsEnabled: (v: boolean) => void
  setAmbientIntensity: (v: number) => void
  setGridSize: (v: number) => void
  setSnapToGrid: (v: boolean) => void
}

export const useVisualizerStore = create<VisualizerState>((set) => ({
  subTab: '3d',
  selectedFixtureId: null,
  roomConfig: { ...DEFAULT_ROOM_CONFIG },
  showBeams: true,
  showRoom: true,
  showGrid: true,
  shadowsEnabled: false,
  ambientIntensity: 0.15,
  gridSize: 0.5,
  snapToGrid: true,

  setSubTab: (tab) => set({ subTab: tab }),
  selectFixture: (id) => set({ selectedFixtureId: id }),
  setRoomConfig: (config) => set((s) => ({ roomConfig: { ...s.roomConfig, ...config } })),
  setShowBeams: (v) => set({ showBeams: v }),
  setShowRoom: (v) => set({ showRoom: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShadowsEnabled: (v) => set({ shadowsEnabled: v }),
  setAmbientIntensity: (v) => set({ ambientIntensity: v }),
  setGridSize: (v) => set({ gridSize: v }),
  setSnapToGrid: (v) => set({ snapToGrid: v })
}))
