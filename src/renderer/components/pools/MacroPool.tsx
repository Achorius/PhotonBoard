// Pools › Macros: numbered macro tiles. Tap = run (tap again = stop);
// "+" = new macro (opens the editor); menu: Run / Stop, Edit, Assign to
// an executor, Label, Colour, Renumber, Delete.

import { useEffect, useMemo, useState } from 'react'
import { LuHash, LuPalette, LuPencil, LuPlay, LuSquare, LuSquarePen, LuSquareStack, LuTrash2 } from 'react-icons/lu'
import type { Macro } from '@shared/types'
import { useContextMenu, type MenuEntry } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePoolStore } from '@renderer/stores/pool-store'
import { poolSlots } from './pool-model'
import {
  assignToExecutor, deleteMacro, isMacroRunning, macroLabel, newMacroAt, recolourMacro, renumberMacro, runMacro, stopMacro, updateMacro
} from './pool-actions'
import { askLabel, askNumber, pickColour, pickExecutor } from './PoolDialogs'
import { PoolTile } from './PoolTile'
import { MacroEditor } from './MacroEditor'
import { usePoolsView } from './pools-view-store'

/** Ids of running macros, polled at 4 Hz while mounted (state only changes when the set does) */
function useRunningMacros(macros: readonly Macro[]): ReadonlySet<string> {
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const poll = () => {
      const now = macros.filter((m) => isMacroRunning(m.id)).map((m) => m.id)
      setRunning((prev) => (prev.size === now.length && now.every((id) => prev.has(id)) ? prev : new Set(now)))
    }
    poll()
    const timer = setInterval(poll, 250)
    return () => clearInterval(timer)
  }, [macros])
  return running
}

function macroMenu(macro: Macro, running: boolean, edit: (id: string) => void): MenuEntry[] {
  const t = translate
  const what = macroLabel(macro.id)
  return [
    running
      ? { label: t('pro.pools.menu.stop'), icon: LuSquare, onSelect: () => stopMacro(macro.id) }
      : { label: t('pro.pools.menu.run'), icon: LuPlay, onSelect: () => { runMacro(macro.id) } },
    { label: t('pro.pools.menu.edit'), icon: LuSquarePen, onSelect: () => edit(macro.id) },
    {
      label: t('pro.pools.menu.assign'),
      icon: LuSquareStack,
      onSelect: () => { void pickExecutor(t('pro.pools.assign.title', { what })).then((p) => { if (p) assignToExecutor('macro', macro.id, p.page, p.col, p.row) }) }
    },
    { type: 'separator' },
    { label: t('pro.pools.menu.label'), icon: LuPencil, onSelect: () => { void askLabel(what, macro.name).then((n) => { if (n !== null) updateMacro(macro.id, { name: n }) }) } },
    { label: t('pro.pools.menu.colour'), icon: LuPalette, onSelect: () => { void pickColour(t('pro.pools.dialog.colourTitle', { what }), macro.color).then((c) => { if (c !== undefined) recolourMacro(macro.id, c ?? undefined) }) } },
    { label: t('pro.pools.menu.renumber'), icon: LuHash, onSelect: () => { void askNumber(what, macro.number).then((n) => { if (n !== null) renumberMacro(macro.id, n) }) } },
    { type: 'separator' },
    { label: t('pro.pools.menu.delete'), icon: LuTrash2, danger: true, onSelect: () => { void deleteMacro(macro.id) } }
  ]
}

export function MacroPool() {
  const t = useT()
  const macros = usePoolStore((s) => s.macros)
  const selected = usePoolsView((s) => (s.selected?.kind === 'macro' ? s.selected.id : null))
  const running = useRunningMacros(macros)
  const [editing, setEditing] = useState<string | null>(null)
  const ctx = useContextMenu()
  const numbers = useMemo(() => new Map(macros.map((m) => [m.id, m.number])), [macros])
  const slots = useMemo(() => poolSlots(macros, numbers, { min: 24, spare: 4, step: 8 }), [macros, numbers])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      <p className="max-w-3xl text-xs text-fg-tertiary">{t('pro.pools.hint.macros')}</p>
      <div className="flex flex-wrap gap-1.5">
        {slots.map(({ number, item }) => {
          const ref = String(number)
          if (!item) {
            return (
              <PoolTile
                key={`empty-${number}`}
                number={ref}
                empty
                data-slot={ref}
                ariaLabel={t('pro.pools.emptySlot', { ref })}
                onTap={() => setEditing(newMacroAt(number))}
              />
            )
          }
          const isRunning = running.has(item.id)
          return (
            <PoolTile
              key={item.id}
              number={ref}
              name={item.name || t('pro.pools.defaults.macro', { n: number })}
              subtitle={isRunning ? t('pro.pools.macros.running') : t('pro.pools.macros.lines', { count: item.lines.length })}
              color={item.color}
              data-slot={ref}
              active={isRunning}
              selected={selected === item.id}
              preview={isRunning ? <span className="block h-2 w-2 animate-blink rounded-full bg-go" /> : <LuPlay size={14} className="text-fg-tertiary" />}
              ariaLabel={`${ref} ${item.name}`}
              onTap={() => {
                usePoolsView.getState().select('macro', item.id)
                if (isRunning) stopMacro(item.id)
                else runMacro(item.id)
              }}
              onMenu={(e) => {
                usePoolsView.getState().select('macro', item.id)
                ctx.open(e, macroMenu(item, isRunning, setEditing))
              }}
            />
          )
        })}
      </div>
      {ctx.menu}
      {editing && <MacroEditor id={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
