import { create } from 'zustand'
import { getDeviceProfile } from '@renderer/lib/device-detect'

// ---- Device type detection ----

const _ua = navigator.userAgent.toLowerCase()
const _isElectron = !!(window as any).__ELECTRON__ || !!(window as any).photonboard?.stage?.open

/** True on phones (small screen, no room for full app) */
export function isPhone(): boolean {
  if (_isElectron) return false
  // iPhone / iPod
  if (/iphone|ipod/.test(_ua)) return true
  // Android phone (no "tablet" hint, small screen)
  if (/android/.test(_ua) && !/tablet/.test(_ua) && window.innerWidth < 800) return true
  // Small touch screen
  if ('ontouchstart' in window && window.innerWidth < 600) return true
  return false
}

/** True on tablets (medium screen, can show full app if wanted) */
export function isTablet(): boolean {
  if (_isElectron) return false
  // iPad
  if (/ipad/.test(_ua)) return true
  // iPadOS 13+ reports as Mac but has touch
  if (_ua.includes('macintosh') && navigator.maxTouchPoints > 1) return true
  // Android tablet (large screen)
  if (/android/.test(_ua) && (window.innerWidth >= 800 || /tablet/.test(_ua))) return true
  // Touch device with medium screen
  if ('ontouchstart' in window && window.innerWidth >= 600 && window.innerWidth < 1024) return true
  return false
}

function getDefaultTab(): ViewTab {
  // Remote browser: default to Scenes
  if (!_isElectron) return 'playback'
  // Pi (ARM / mid-range): default to Scenes
  if (getDeviceProfile().isMidRange) return 'playback'
  // Desktop: default to 3D
  return 'visualizer'
}

export type ViewTab = 'faders' | 'patch' | 'fixtures' | 'playback' | 'effects' | 'midi' | 'stage' | 'visualizer' | 'stage-layout' | 'follow' | 'settings' | 'live'

interface UiState {
  activeTab: ViewTab
  showName: string
  isDirty: boolean
  selectedUniverse: number
  // Stage mode (browser only): show full-screen stage view
  stageMode: boolean
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
  setStageMode: (on: boolean) => void
  setBottomPanelTab: (tab: 'cuelists' | 'chases' | 'presets') => void
  toggleBottomPanel: () => void
  openModal: (modal: string, data?: any) => void
  closeModal: () => void
  showStatus: (message: string, type?: 'info' | 'success' | 'error', duration?: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: getDefaultTab(),
  // Phone/tablet: start in stage mode. Desktop browser: start in app mode.
  stageMode: !_isElectron && (isPhone() || isTablet()),
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
  setStageMode: (on) => set({ stageMode: on }),
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
