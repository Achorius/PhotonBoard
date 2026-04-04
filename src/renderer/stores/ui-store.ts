import { create } from 'zustand'

export type ViewTab = 'faders' | 'patch' | 'fixtures' | 'playback' | 'effects' | 'midi' | 'stage' | 'visualizer' | 'settings'

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

  // Actions
  setActiveTab: (tab: ViewTab) => void
  setShowName: (name: string) => void
  setDirty: (dirty: boolean) => void
  setSelectedUniverse: (u: number) => void
  setBottomPanelTab: (tab: 'cuelists' | 'chases' | 'presets') => void
  toggleBottomPanel: () => void
  openModal: (modal: string, data?: any) => void
  closeModal: () => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'faders',
  showName: 'New Show',
  isDirty: false,
  selectedUniverse: 0,
  bottomPanelTab: 'cuelists',
  bottomPanelOpen: true,
  activeModal: null,
  modalData: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setShowName: (name) => set({ showName: name }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelectedUniverse: (u) => set({ selectedUniverse: u }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  openModal: (modal, data = null) => set({ activeModal: modal, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: null })
}))
