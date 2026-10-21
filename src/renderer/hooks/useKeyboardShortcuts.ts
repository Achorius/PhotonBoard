// ============================================================
// Global keyboard shortcuts (console window and remote browser).
// Rules: never while typing in a field or while a dialog / menu is
// open; single keys only without modifiers; held keys (auto-repeat)
// never re-trigger an action.
//
// Selection keys (lib/selection-actions.ts): Delete / Backspace delete
// the selection of the active view, Mod+D duplicates it, F2 / Enter
// rename it. Mod+Backspace clears the programmer.
// Command line: "/" focuses it (also Shift+: on AZERTY keyboards, where
// "/" needs Shift; Shift+/ is "?" on QWERTY = the cheat sheet, so it gets
// no other binding). Keys typed in it never reach these shortcuts; its
// keypad buttons never take the focus.
// Undo / redo (lib/history.ts): Mod+Z, Mod+Shift+Z, Ctrl+Y. In
// Electron the application menu owns Mod+Z and the platform redo
// accelerator (menu:undo / menu:redo, see App.tsx).
// ============================================================

import { useEffect } from 'react'
import { useUiStore } from '@renderer/stores/ui-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { selectGoTargetChaseId, selectGoTargetCuelistId, usePlaybackStore } from '@renderer/stores/playback-store'
import { clearProgrammer } from '@renderer/lib/dmx-mixer'
import { isRemoteMode } from '@renderer/lib/runtime'
import { redo, undo } from '@renderer/lib/history'
import { deleteSelection, duplicateSelection, renameSelection } from '@renderer/lib/selection-actions'
import { hasOpenOverlay } from '@renderer/components/ui'
import { WORKSPACE_TABS } from '@renderer/components/layout/workspace-tabs'
import { requestNewShow, requestOpenShow, requestSave, requestSaveAs } from '@renderer/components/layout/file-actions'
import type { TFunction } from '@renderer/i18n'

export interface ShortcutInfo {
  keys: string
  label: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: ShortcutInfo[]
}

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

/** What the cheat sheet (?) lists, in the current language — keep in sync with the handler below */
export function getShortcutGroups(t: TFunction): ShortcutGroup[] {
  return [
    {
      title: t('shortcuts.groups.masters'),
      shortcuts: [
        { keys: 'Esc', label: t('shortcuts.items.blackout') },
        { keys: 'Mod+Backspace', label: t('shortcuts.items.clearProgrammer') }
      ]
    },
    {
      title: t('shortcuts.groups.playback'),
      shortcuts: [
        { keys: 'Space', label: t('shortcuts.items.go') },
        { keys: 'Up', label: t('shortcuts.items.previous') },
        { keys: 'Down', label: t('shortcuts.items.next') }
      ]
    },
    {
      title: t('shortcuts.groups.edit'),
      shortcuts: [
        { keys: 'Mod+Z', label: t('shortcuts.items.undo') },
        { keys: IS_MAC ? 'Mod+Shift+Z' : 'Ctrl+Y', label: t('shortcuts.items.redo') },
        { keys: 'Backspace', label: t('shortcuts.items.deleteSelection') },
        { keys: 'Mod+D', label: t('shortcuts.items.duplicateSelection') },
        { keys: 'F2', label: t('shortcuts.items.renameSelection') }
      ]
    },
    {
      title: t('shortcuts.groups.views'),
      shortcuts: WORKSPACE_TABS.map((tab) => ({ keys: tab.shortcut, label: t(`shell.tabs.${tab.id}.title`) }))
    },
    {
      title: t('shortcuts.groups.file'),
      shortcuts: [
        { keys: 'Mod+N', label: t('shortcuts.items.newShow') },
        { keys: 'Mod+O', label: t('shortcuts.items.openShow') },
        { keys: 'Mod+S', label: t('shortcuts.items.save') },
        { keys: 'Mod+Shift+S', label: t('shortcuts.items.saveAs') },
        // Application menu accelerators (console only: the remote imports from the File menu)
        ...(!isRemoteMode() ? [
          { keys: 'Mod+I', label: t('shortcuts.items.importFile') },
          { keys: 'Mod+Shift+E', label: t('shortcuts.items.exportFile') }
        ] : [])
      ]
    },
    {
      title: t('shortcuts.groups.general'),
      shortcuts: [
        { keys: '/', label: t('shortcuts.items.commandLine') },
        { keys: '?', label: t('shortcuts.items.showShortcuts') }
      ]
    }
  ]
}

/** Id of the command line input (focused by "/") */
export const COMMAND_LINE_ID = 'pb-command-line'

/** "/" — focus the command line (status bar); false when it is not on screen */
export function focusCommandLine(): boolean {
  const input = document.getElementById(COMMAND_LINE_ID)
  if (!(input instanceof HTMLInputElement)) return false
  input.focus()
  return true
}

/** Typing in a field (the command line included): global shortcuts stay quiet */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Enter on these activates them: it must not also rename the selection */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="spinbutton"]')
}

/** Undo / redo by keyboard. Electron: Mod+Z and the platform redo key come through the app menu. */
function handleHistoryKey(e: KeyboardEvent, key: string): boolean {
  const electron = !isRemoteMode()
  if (key === 'z' && !e.shiftKey) {
    if (electron) return false // menu:undo
    e.preventDefault()
    if (!e.repeat) undo()
    return true
  }
  const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && !e.metaKey)
  if (!isRedo) return false
  // Electron menu: Shift+Cmd+Z on macOS, Ctrl+Y elsewhere — handle the other alias here
  if (electron && (IS_MAC ? key === 'z' : key === 'y')) return false
  e.preventDefault()
  if (!e.repeat) redo()
  return true
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey

      if (mod && !e.altKey) {
        if (hasOpenOverlay()) return
        const key = e.key.toLowerCase()
        if (handleHistoryKey(e, key)) return
        // Clear programmer (Backspace alone deletes the selection)
        if ((e.key === 'Backspace' || e.key === 'Delete') && !e.shiftKey) {
          e.preventDefault()
          if (!e.repeat) clearProgrammer()
          return
        }
        if (key === 'd' && !e.shiftKey) {
          e.preventDefault() // never the browser's bookmark dialog
          if (!e.repeat) duplicateSelection()
          return
        }
        // File: in Electron the application menu owns these accelerators
        if (isRemoteMode()) {
          const action =
            key === 's' ? (e.shiftKey ? requestSaveAs : requestSave)
              : key === 'o' && !e.shiftKey ? requestOpenShow
                : key === 'n' && !e.shiftKey ? requestNewShow
                  : null
          if (action) {
            e.preventDefault()
            if (!e.repeat) void action()
          }
        }
        return
      }

      if (mod || e.altKey || hasOpenOverlay()) return
      // Shift is allowed only for characters that need it ("?"; "/" is Shift+: on AZERTY)
      if (e.key === '?') {
        e.preventDefault()
        useUiStore.getState().setShortcutsOpen(true)
        return
      }
      if (e.key === '/') {
        if (focusCommandLine()) e.preventDefault()
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
        case 'Delete':
          e.preventDefault()
          if (!e.repeat) void deleteSelection()
          break
        case 'F2':
          e.preventDefault()
          if (!e.repeat) renameSelection()
          break
        case 'Enter':
          if (e.repeat || isInteractive(e.target)) return
          if (renameSelection()) e.preventDefault()
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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
