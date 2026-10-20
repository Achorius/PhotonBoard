// Pools › Groups: numbered group tiles. Tap = select the group's
// fixtures; "+" = store the selection as a new group there; menu:
// Store (merge / overwrite), Label, Colour, Renumber, Assign, Delete.
// Below the tiles: the group master of the group tapped last (scales
// its fixtures' intensity on the output, before the Grand Master).

import { useMemo } from 'react'
import { LuCable, LuHash, LuMousePointerClick, LuPalette, LuPencil, LuSave, LuSquareStack, LuTrash2 } from 'react-icons/lu'
import type { Group } from '@shared/types'
import { Button, EmptyState, Slider, useContextMenu, type MenuEntry } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { getProApi } from '@renderer/lib/pro/api'
import { formatPercent } from '@renderer/components/ui/format'
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
  const masters = usePoolStore((s) => s.groupMasters)

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
              subtitle={(masters[item.id] ?? 255) < 255
                ? t('pro.pools.groups.subtitleMaster', { fixtures: t('common.fixtureCount', { count: item.fixtureIds.length }), level: formatPercent(masters[item.id]) })
                : t('common.fixtureCount', { count: item.fixtureIds.length })}
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
      <GroupMasterBar group={groups.find((g) => g.id === selected) ?? null} level={selected ? masters[selected] ?? 255 : 255} />
      {ctx.menu}
    </div>
  )
}

/** Group master of the group selected in the pool */
function GroupMasterBar({ group, level }: { group: Group | null; level: number }) {
  const t = useT()
  return (
    <section
      data-group-master=""
      aria-label={t('pro.pools.groups.masterTitle')}
      className="mt-1 flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-1 px-3 py-2 ring-1 ring-inset ring-line-subtle"
    >
      <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.pools.groups.masterTitle')}</span>
      {group ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-primary">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
            <span className="truncate">{group.name}</span>
          </span>
          <Slider
            className="min-w-[180px] flex-1"
            value={level}
            onChange={(v) => getProApi().setGroupMaster(group.id, v)}
            defaultValue={255}
            color={group.color}
            showValue
            aria-label={t('pro.pools.groups.masterAria', { name: group.name })}
          />
        </>
      ) : (
        <span className="text-xs text-fg-tertiary">{t('pro.pools.groups.masterHint')}</span>
      )}
    </section>
  )
}
