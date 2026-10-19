// Context menu (right-click / long-press) on programmer faders:
// MIDI learn for the channel, Grand Master, Blackout, and release.

import { createContext, useCallback, useContext, useMemo } from 'react'
import type React from 'react'
import { LuEraser, LuPiano } from 'react-icons/lu'
import { useContextMenu, type MenuEntry } from '@renderer/components/ui'
import { useMidiStore } from '@renderer/stores/midi-store'

export interface ChannelMenuTarget {
  fixtureId: string
  fixtureName: string
  channelName: string
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
  const openMenu = useCallback<OpenMenu>((e, t) => {
    const learn = useMidiStore.getState().startLearn
    const items: MenuEntry[] = [
      { type: 'label', label: t.note ? `${t.fixtureName} · ${t.channelName} (${t.note})` : `${t.fixtureName} · ${t.channelName}` },
      {
        label: `MIDI learn: ${t.channelName}`,
        icon: LuPiano,
        description: t.note ? `Maps ${t.fixtureName}` : undefined,
        onSelect: () => learn({ type: 'channel', id: t.fixtureId, parameter: t.channelName, label: `${t.fixtureName} → ${t.channelName}` })
      },
      { label: 'MIDI learn: Grand Master', icon: LuPiano, onSelect: () => learn({ type: 'master', label: 'Grand Master' }) },
      { label: 'MIDI learn: Blackout', icon: LuPiano, onSelect: () => learn({ type: 'blackout', label: 'Blackout' }) }
    ]
    if (t.onRelease) items.push({ type: 'separator' }, { label: 'Release', icon: LuEraser, onSelect: t.onRelease })
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
