// Context menu (right-click / long-press) on programmer faders:
// MIDI learn for the channel, Grand Master, Blackout, and release.

import { createContext, useCallback, useContext, useMemo } from 'react'
import type React from 'react'
import { LuEraser, LuPiano } from 'react-icons/lu'
import { useContextMenu, type MenuEntry } from '@renderer/components/ui'
import { t } from '@renderer/i18n'
import { useMidiStore } from '@renderer/stores/midi-store'

export interface ChannelMenuTarget {
  fixtureId: string
  fixtureName: string
  /** Shown in the menu (translated attribute name or channel name) */
  channelName: string
  /** MIDI learn parameter when it differs from channelName (untranslated attribute label) */
  parameter?: string
  /** Release this channel / attribute from the programmer */
  onRelease?: () => void
  /** Extra label for multi-fixture attributes ("+3 more") */
  note?: string
}

type OpenMenu = (e: React.MouseEvent, target: ChannelMenuTarget) => void

const ChannelMenuContext = createContext<OpenMenu | null>(null)

/** Provide the channel menu to the faders below; renders the menu itself. */
export function ChannelMenuProvider({ children }: { children: React.ReactNode }) {
  const ctx = useContextMenu()
  const { open } = ctx
  const openMenu = useCallback<OpenMenu>((e, target) => {
    const learn = useMidiStore.getState().startLearn
    const { fixtureId, fixtureName, channelName, note } = target
    const items: MenuEntry[] = [
      { type: 'label', label: note ? `${fixtureName} · ${channelName} (${note})` : `${fixtureName} · ${channelName}` },
      {
        label: t('fixtures.channelMenu.learn', { name: channelName }),
        icon: LuPiano,
        description: note ? t('fixtures.channelMenu.maps', { name: fixtureName }) : undefined,
        onSelect: () => learn({ type: 'channel', id: fixtureId, parameter: target.parameter ?? channelName, label: `${fixtureName} → ${channelName}` })
      },
      { label: t('fixtures.channelMenu.learnGrandMaster'), icon: LuPiano, onSelect: () => learn({ type: 'master', label: t('common.grandMaster') }) },
      { label: t('fixtures.channelMenu.learnBlackout'), icon: LuPiano, onSelect: () => learn({ type: 'blackout', label: t('common.blackout') }) }
    ]
    if (target.onRelease) items.push({ type: 'separator' }, { label: t('fixtures.release.label'), icon: LuEraser, onSelect: target.onRelease })
    open(e, items)
  }, [open])
  const value = useMemo(() => openMenu, [openMenu])
  return (
    <ChannelMenuContext.Provider value={value}>
      {children}
      {ctx.menu}
    </ChannelMenuContext.Provider>
  )
}

/** Open the channel menu (no-op outside a provider) */
export function useChannelMenu(): OpenMenu {
  return useContext(ChannelMenuContext) ?? noop
}

function noop(): void { /* no provider */ }
