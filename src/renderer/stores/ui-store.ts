import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { getDeviceProfile } from '@renderer/lib/device-detect'
import { isElectronRuntime } from '@renderer/lib/runtime'
import { dismissToast, showToast } from './toast-store'

// ---- Device type detection ----

const _ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
// The Electron renderer always has "Electron/x.y" in its user agent; the remote
// bridge (which also defines window.photonboard) never does — import order safe.
const _isElectron = isElectronRuntime()

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

/** Control sizing: 'compact' for mouse/trackpad, 'touch' for fingers (>= 44px targets) */
export type Density = 'compact' | 'touch'
export type DensityPreference = 'auto' | Density
export type StatusType = 'info' | 'success' | 'warning' | 'error'

// ---- Per-viewer UI preferences (localStorage can be unavailable: never required) ----

const PREF_PREFIX = 'photonboard.ui.'

function readPref<T extends string | boolean>(key: string, fallback: T, allowed?: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(PREF_PREFIX + key)
    if (raw === null) return fallback
    const value = (typeof fallback === 'boolean' ? raw === 'true' : raw) as T
    return allowed && !allowed.includes(value) ? fallback : value
  } catch {
    return fallback
  }
}

function writePref(key: string, value: string | boolean): void {
  try { window.localStorage.setItem(PREF_PREFIX + key, String(value)) } catch { /* ignore */ }
}

/** Auto density: touch on coarse-pointer devices and on the Pi (kiosk touchscreen). */
export function detectAutoDensity(): Density {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return 'touch'
  } catch { /* very old browser */ }
  const arch = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (_isElectron && /aarch64|arm64|armv\d/.test(arch) && arch.includes('linux')) return 'touch'
  return 'compact'
}

function resolveDensity(pref: DensityPreference): Density {
  return pref === 'auto' ? detectAutoDensity() : pref
}

const initialDensityPreference = readPref<DensityPreference>('density', 'auto', ['auto', 'compact', 'touch'])

interface UiState {
  activeTab: ViewTab
  showName: string
  isDirty: boolean
  selectedUniverse: number
  // Stage mode (browser only): show full-screen stage view
  stageMode: boolean
  /** Density chosen in Settings ('auto' follows the device) */
  densityPreference: DensityPreference
  /** Density in effect (also set as data-density on <html>) */
  density: Density
  /** Left fixture sidebar visible */
  sidebarOpen: boolean
  /** Bottom executor bar visible */
  executorBarOpen: boolean
  /** Keyboard shortcut cheat sheet open */
  shortcutsOpen: boolean
  // Last status message (also shown as a toast)
  statusMessage: string | null
  statusType: StatusType
  // Navigation data (e.g. open Scenes tab with a specific cuelist selected)
  pendingCuelistId: string | null

  // Actions
  setActiveTab: (tab: ViewTab) => void
  navigateToCuelist: (cuelistId: string) => void
  setShowName: (name: string) => void
  setDirty: (dirty: boolean) => void
  setSelectedUniverse: (u: number) => void
  setStageMode: (on: boolean) => void
  setDensityPreference: (pref: DensityPreference) => void
  /** Re-evaluate 'auto' density (pointer type changed) */
  refreshDensity: () => void
  toggleSidebar: (open?: boolean) => void
  toggleExecutorBar: (open?: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  /** Show a status message as a toast; duration 0 = until replaced. A newer message is never cleared by an older timer. */
  showStatus: (message: string, type?: StatusType, duration?: number) => void
  clearStatus: () => void
}

let statusToken = 0
let statusTimer: ReturnType<typeof setTimeout> | null = null
/** Status messages share one toast slot: each replaces the previous one */
const STATUS_TOAST_ID = 'status'

export const useUiStore = create<UiState>((set, get) => ({
  activeTab: getDefaultTab(),
  // Phone/tablet: start in stage mode. Desktop browser: start in app mode.
  stageMode: !_isElectron && (isPhone() || isTablet()),
  showName: 'New Show',
  isDirty: false,
  selectedUniverse: 0,
  densityPreference: initialDensityPreference,
  density: resolveDensity(initialDensityPreference),
  // Narrow screens (tablets) start with the fixture list hidden
  sidebarOpen: readPref('sidebarOpen', window.innerWidth >= 1280),
  executorBarOpen: readPref('executorBarOpen', true),
  shortcutsOpen: false,
  statusMessage: null,
  statusType: 'info',
  pendingCuelistId: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setStageMode: (on) => set({ stageMode: on }),
  navigateToCuelist: (cuelistId) => set({ activeTab: 'playback', pendingCuelistId: cuelistId }),
  setShowName: (name) => set({ showName: name }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  setSelectedUniverse: (u) => set({ selectedUniverse: u }),
  setDensityPreference: (pref) => {
    writePref('density', pref)
    set({ densityPreference: pref, density: resolveDensity(pref) })
  },
  refreshDensity: () => {
    const density = resolveDensity(get().densityPreference)
    if (density !== get().density) set({ density })
  },
  toggleSidebar: (open) => {
    const sidebarOpen = open ?? !get().sidebarOpen
    writePref('sidebarOpen', sidebarOpen)
    set({ sidebarOpen })
  },
  toggleExecutorBar: (open) => {
    const executorBarOpen = open ?? !get().executorBarOpen
    writePref('executorBarOpen', executorBarOpen)
    set({ executorBarOpen })
  },
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  showStatus: (message, type = 'info', duration = 3000) => {
    const token = ++statusToken
    if (statusTimer) {
      clearTimeout(statusTimer)
      statusTimer = null
    }
    set({ statusMessage: message, statusType: type })
    showToast(type, message, { id: STATUS_TOAST_ID, duration })
    if (duration > 0) {
      statusTimer = setTimeout(() => {
        statusTimer = null
        if (token === statusToken) set({ statusMessage: null })
      }, duration)
    }
  },

  clearStatus: () => {
    statusToken++
    if (statusTimer) {
      clearTimeout(statusTimer)
      statusTimer = null
    }
    set({ statusMessage: null })
    dismissToast(STATUS_TOAST_ID)
  }
}))

// ---- Selector hooks ----

/** Status toast (message + type). */
export function useStatus() {
  return useUiStore(useShallow((s) => ({ message: s.statusMessage, type: s.statusType })))
}

/** Density in effect ('compact' | 'touch') — for JS sizing; CSS uses the --pb-* variables. */
export function useDensity(): Density {
  return useUiStore((s) => s.density)
}

/** Show name + unsaved-changes flag. */
export function useShowTitle() {
  return useUiStore(useShallow((s) => ({ showName: s.showName, isDirty: s.isDirty })))
}
