// Pools › Groups: numbered group tiles. Tap = select the group's
// fixtures; "+" = store the selection as a new group there; menu:
// Store (merge / overwrite), Label, Colour, Renumber, Assign, Delete.

import { useMemo } from 'react'
import { LuCable, LuHash, LuMousePointerClick, LuPalette, LuPencil, LuSave, LuSquareStack, LuTrash2 } from 'react-icons/lu'
import type { Group } from '@shared/types'
import { Button, EmptyState, useContextMenu, type MenuEntry } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { numbersOf, poolSlots } from './pool-model'
import {
  assignToExecutor, deleteGroup, groupLabel, recolourGroup, renameGroup, renumberGroup, selectGroup, storeGroupAt
} from './pool-actions'
import { askLabel, askNumber, pickColour, pickExecutor } from './PoolDialogs'
import { PoolTile } from './PoolTile'
import { usePoolsView } from './pools-view-store'

function groupMenu(number: number, group: Group | null): MenuEntry[] {
  const t = translate
  if (!group) return [{ label: t('pro.pools.menu.storeSelection'), icon: LuSave, onSelect: () => { storeGroupAt(number) } }]
  const what = groupLabel(group, number)
  return [
    { label: t('pro.pools.menu.select'), icon: LuMousePointerClick, onSelect: () => selectGroup(group.id) },
    { type: 'separator' },
    {
      label: t('pro.pools.menu.storeSelection'),
      icon: LuSave,
      submenu: [
        { label: t('pro.pools.menu.merge'), description: t('pro.pools.menu.mergeHint'), onSelect: () => { storeGroupAt(number, 'merge') } },
        { label: t('pro.pools.menu.overwrite'), description: t('pro.pools.menu.overwriteHint'), onSelect: () => { storeGroupAt(number, 'overwrite') } }
      ]
    },
    { type: 'separator' },
    { label: t('pro.pools.menu.label'), icon: LuPencil, onSelect: () => { void askLabel(what, group.name).then((n) => { if (n) renameGroup(group.id, n) }) } },
    { label: t('pro.pools.menu.colour'), icon: LuPalette, onSelect: () => { void pickColour(t('pro.pools.dialog.colourTitle', { what }), group.color).then((c) => { if (c) recolourGroup(group.id, c) }) } },
    { label: t('pro.pools.menu.renumber'), icon: LuHash, onSelect: () => { void askNumber(what, number).then((n) => { if (n !== null) renumberGroup(group.id, n) }) } },
    {
      label: t('pro.pools.menu.assign'),
      icon: LuSquareStack,
      onSelect: () => { void pickExecutor(t('pro.pools.assign.title', { what })).then((p) => { if (p) assignToExecutor('group', group.id, p.page, p.col, p.row) }) }
    },
    { type: 'separator' },
    { label: t('pro.pools.menu.delete'), icon: LuTrash2, danger: true, onSelect: () => { void deleteGroup(group.id) } }
  ]
}

export function GroupPool() {
  const t = useT()
  const groups = usePatchStore((s) => s.groups)
  const hasPatch = usePatchStore((s) => s.patch.length > 0)
  const selection = usePatchStore((s) => s.selectedFixtureIds)
  const selected = usePoolsView((s) => (s.selected?.kind === 'group' ? s.selected.id : null))
  const ctx = useContextMenu()
  const numbers = useMemo(() => numbersOf(groups), [groups])
  const slots = useMemo(() => poolSlots(groups, numbers, { min: 24, spare: 4, step: 8 }), [groups, numbers])
  const selectionKey = useMemo(() => [...selection].sort().join('|'), [selection])

  if (!hasPatch && groups.length === 0) {
    return (
      <EmptyState
        icon={LuCable}
        title={t('pro.pools.groups.emptyPatchTitle')}
        description={t('pro.pools.groups.emptyPatchDescription')}
        action={<Button variant="primary" onClick={() => useUiStore.getState().setActiveTab('patch')}>{t('pro.pools.groups.openPatch')}</Button>}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      <p className="max-w-3xl text-xs text-fg-tertiary">{t('pro.pools.hint.groups')}</p>
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
                title={t('pro.pools.emptySlotHint')}
                onTap={() => { storeGroupAt(number) }}
                onMenu={(e) => ctx.open(e, groupMenu(number, null))}
              />
            )
          }
          const current = item.fixtureIds.length > 0 && [...item.fixtureIds].sort().join('|') === selectionKey
          return (
            <PoolTile
              key={item.id}
              number={ref}
              name={item.name}
              subtitle={t('common.fixtureCount', { count: item.fixtureIds.length })}
              color={item.color}
              data-slot={ref}
              active={current}
              selected={selected === item.id}
              ariaLabel={`${ref} ${item.name}`}
              onTap={() => {
                usePoolsView.getState().select('group', item.id)
                selectGroup(item.id)
              }}
              onMenu={(e) => {
                usePoolsView.getState().select('group', item.id)
                ctx.open(e, groupMenu(number, item))
              }}
            />
          )
        })}
      </div>
      {ctx.menu}
    </div>
  )
}
