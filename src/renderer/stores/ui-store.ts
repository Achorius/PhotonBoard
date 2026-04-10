import { create } from 'zustand'

export type ViewTab = 'faders' | 'patch' | 'fixtures' | 'fixture-sheet' | 'playback' | 'effects' | 'midi' | 'stage' | 'visualizer' | 'stage-layout' | 'follow' | 'settings' | 'live'

interface UiState {
  activeTab: ViewTab
  showName: string
  isDirty: boolean
  selectedUniverse: number
  // Bottom panel
  bottomPanelTab: 'cuelists' | 'chases' | 'presets'
  bottomPanelOpen: boolean
  // Modals
  activeModal: string | null
  modalData: any
  // Status toast
  statusMessage: string | null
  statusType: 'info' | 'success' | 'error'
  // Navigation data (e.g. open Scenes tab with a specific cuelist selected)
  pendingCuelistId: string | null

  // Actions
  setActiveTab: (tab: ViewTab) => void
  navigateToCuelist: (cuelistId: string) => void
  setShowName: (name: string) => void
  setDirty: (dirty: boolean) => void
  setSelectedUniverse: (u: number) => void
  setBottomPanelTab: (tab: 'cuelists' | 'chases' | 'presets') => void
  toggleBottomPanel: () => void
  openModal: (modal: string, data?: any) => void
  closeModal: () => void
  showStatus: (message: string, type?: 'info' | 'success' | 'error', duration?: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'visualizer',
  showName: 'New Show',
  isDirty: false,
  selectedUniverse: 0,
  bottomPanelTab: 'cuelists',
  bottomPanelOpen: true,
  activeModal: null,
  modalData: null,
  statusMessage: null,
  statusType: 'info',
  pendingCuelistId: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  navigateToCuelist: (cuelistId) => set({ activeTab: 'playback', pendingCuelistId: cuelistId }),
  setShowName: (name) => set({ showName: name }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelectedUniverse: (u) => set({ selectedUniverse: u }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  openModal: (modal, data = null) => set({ activeModal: modal, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: null }),
  showStatus: (message, type = 'info', duration = 3000) => {
    set({ statusMessage: message, statusType: type })
    if (duration > 0) {
      setTimeout(() => set({ statusMessage: null }), duration)
    }
  }
}))
