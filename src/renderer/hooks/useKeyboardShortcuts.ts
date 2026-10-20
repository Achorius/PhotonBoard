// ============================================================
// Global keyboard shortcuts (console window and remote browser).
// Rules: never while typing in a field or while a dialog / menu is
// open; single keys only without modifiers; held keys (auto-repeat)
// never re-trigger an action.
// ============================================================

import { useEffect } from 'react'
import { useUiStore } from '@renderer/stores/ui-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { selectGoTargetChaseId, selectGoTargetCuelistId, usePlaybackStore } from '@renderer/stores/playback-store'
import { clearProgrammer } from '@renderer/lib/dmx-mixer'
import { isRemoteMode } from '@renderer/lib/runtime'
import { hasOpenOverlay } from '@renderer/components/ui'
import { WORKSPACE_TABS } from '@renderer/components/layout/workspace-tabs'
import { requestNewShow, requestOpenShow, requestSave, requestSaveAs } from '@renderer/components/layout/file-actions'

export interface ShortcutInfo {
  keys: string
  label: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: ShortcutInfo[]
}

/** What the cheat sheet (?) lists — keep in sync with the handler below */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Masters',
    shortcuts: [
      { keys: 'Esc', label: 'Blackout on / off' },
      { keys: 'Backspace', label: 'Clear programmer' }
    ]
  },
  {
    title: 'Playback',
    shortcuts: [
      { keys: 'Space', label: 'GO selected scene / start-stop selected chase (Scenes view)' },
      { keys: 'Up', label: 'Previous scene / chase (list focused)' },
      { keys: 'Down', label: 'Next scene / chase (list focused)' }
    ]
  },
  {
    title: 'Views',
    shortcuts: WORKSPACE_TABS.map((t) => ({ keys: t.shortcut, label: t.title }))
  },
  {
    title: 'File',
    shortcuts: [
      { keys: 'Mod+N', label: 'New show' },
      { keys: 'Mod+O', label: 'Open show' },
      { keys: 'Mod+S', label: 'Save' },
      { keys: 'Mod+Shift+S', label: 'Save as' }
    ]
  },
  {
    title: 'General',
    shortcuts: [
      { keys: '/', label: 'Focus the command line' },
      { keys: '?', label: 'Show keyboard shortcuts' }
    ]
  }
]

/** Id of the command line input (focused by "/") */
export const COMMAND_LINE_ID = 'pb-command-line'

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey

      // File: in Electron the application menu owns these accelerators
      if (mod && !e.altKey && isRemoteMode()) {
        const key = e.key.toLowerCase()
        const action =
          key === 's' ? (e.shiftKey ? requestSaveAs : requestSave)
            : key === 'o' && !e.shiftKey ? requestOpenShow
              : key === 'n' && !e.shiftKey ? requestNewShow
                : null
        if (action) {
          e.preventDefault()
          if (!e.repeat) void action()
        }
        return
      }

      if (mod || e.altKey || hasOpenOverlay()) return
      // Shift is allowed only for characters that need it ("?")
      if (e.key === '?') {
        e.preventDefault()
        useUiStore.getState().setShortcutsOpen(true)
        return
      }
      if (e.shiftKey) return

      const tab = WORKSPACE_TABS.find((t) => t.shortcut === e.key)
      if (tab) {
        e.preventDefault()
        useUiStore.getState().setActiveTab(tab.id)
        return
      }

      switch (e.key) {
        case 'Escape':
          if (!e.repeat) useDmxStore.getState().toggleBlackout()
          break
        case 'Backspace':
          e.preventDefault()
          if (!e.repeat) clearProgrammer()
          break
        case ' ': {
          if (useUiStore.getState().activeTab !== 'playback') return
          e.preventDefault()
          if (e.repeat) break
          const pb = usePlaybackStore.getState()
          if (pb.editorPane === 'chases') {
            const chaseId = selectGoTargetChaseId(pb)
            if (chaseId) pb.toggleChase(chaseId)
          } else {
            const cuelistId = selectGoTargetCuelistId(pb)
            if (cuelistId) pb.goCuelist(cuelistId)
          }
          break
        }
        case '/': {
          const input = document.getElementById(COMMAND_LINE_ID)
          if (input) {
            e.preventDefault()
            input.focus()
          }
          break
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
