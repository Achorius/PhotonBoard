// Pools › Speed masters: a card per master — tempo readout, Tap (fires
// on press for accurate tempo), BPM entry, ½ / ×2, and the scenes,
// chases and effects that follow it (link / unlink). Menu: Label,
// Renumber, Assign to executor, Delete.

import { memo, useMemo } from 'react'
import type React from 'react'
import { LuHash, LuLink, LuPencil, LuSquareStack, LuTrash2 } from 'react-icons/lu'
import type { SpeedMaster } from '@shared/types'
import {
  Button, DropdownMenu, NumberField, contextMenuHandlers, cn, formatBpm, useContextMenu, type MenuEntry, type MenuPoint
} from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePoolStore } from '@renderer/stores/pool-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { linkedToSpeedMaster, poolSlots } from './pool-model'
import {
  assignToExecutor, deleteSpeedMaster, linkToSpeedMaster, newSpeedMasterAt, renameSpeedMaster, renumberSpeedMaster, setSpeedBpm, speedLabel, tapSpeed
} from './pool-actions'
import { askLabel, askNumber, pickExecutor } from './PoolDialogs'
import { PoolTile } from './PoolTile'
import { usePoolsView } from './pools-view-store'

function speedMenu(m: SpeedMaster): MenuEntry[] {
  const t = translate
  const what = speedLabel(m.id)
  return [
    { label: t('pro.pools.menu.label'), icon: LuPencil, onSelect: () => { void askLabel(what, m.name).then((n) => { if (n !== null) renameSpeedMaster(m.id, n) }) } },
    { label: t('pro.pools.menu.renumber'), icon: LuHash, onSelect: () => { void askNumber(what, m.number).then((n) => { if (n !== null) renumberSpeedMaster(m.id, n) }) } },
    {
      label: t('pro.pools.menu.assign'),
      icon: LuSquareStack,
      onSelect: () => { void pickExecutor(t('pro.pools.assign.title', { what })).then((p) => { if (p) assignToExecutor('speed', m.id, p.page, p.col, p.row) }) }
    },
    { type: 'separator' },
    { label: t('pro.pools.menu.delete'), icon: LuTrash2, danger: true, onSelect: () => { void deleteSpeedMaster(m.id) } }
  ]
}

/** Link menu: every scene / chase / effect, checked when it follows this master */
function linkMenu(id: string): MenuEntry[] {
  const t = translate
  const { cuelists, chases } = usePlaybackStore.getState()
  const { effects } = useEffectsStore.getState()
  const entry = (kind: 'chase' | 'effect' | 'cuelist', o: { id: string; name: string; speedMasterId?: string }): MenuEntry => ({
    label: o.name,
    checked: o.speedMasterId === id,
    description: o.speedMasterId && o.speedMasterId !== id ? speedLabel(o.speedMasterId) : undefined,
    onSelect: () => linkToSpeedMaster(kind, o.id, o.speedMasterId === id ? undefined : id)
  })
  const out: MenuEntry[] = []
  if (chases.length) out.push({ type: 'label', label: t('pro.pools.speed.chases') }, ...chases.map((c) => entry('chase', c)))
  if (effects.length) out.push({ type: 'label', label: t('pro.pools.speed.effects') }, ...effects.map((e) => entry('effect', e)))
  if (cuelists.length) out.push({ type: 'label', label: t('pro.pools.speed.scenes') }, ...cuelists.map((c) => entry('cuelist', c)))
  if (out.length === 0) out.push({ label: t('pro.pools.speed.noObjects'), disabled: true })
  return out
}

export function SpeedPool() {
  const t = useT()
  const masters = usePoolStore((s) => s.speedMasters)
  const ctx = useContextMenu()
  const numbers = useMemo(() => new Map(masters.map((m) => [m.id, m.number])), [masters])
  const slots = useMemo(() => poolSlots(masters, numbers, { min: 4, spare: 1 }), [masters, numbers])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      <p className="max-w-3xl text-xs text-fg-tertiary">{t('pro.pools.hint.speed')}</p>
      <div className="flex flex-wrap items-start gap-2">
        {slots.map(({ number, item }) => item ? (
          <SpeedCard key={item.id} master={item} onMenu={(e) => { usePoolsView.getState().select('speed', item.id); ctx.open(e, speedMenu(item)) }} />
        ) : (
          <PoolTile
            key={`empty-${number}`}
            number={String(number)}
            empty
            data-slot={String(number)}
            ariaLabel={t('pro.pools.emptySlot', { ref: number })}
            onTap={() => { newSpeedMasterAt(number) }}
            className="h-auto min-h-[120px] w-[200px] self-stretch [[data-density=touch]_&]:h-auto [[data-density=touch]_&]:w-[232px]"
          />
        ))}
      </div>
      {ctx.menu}
    </div>
  )
}

const SpeedCard = memo(function SpeedCard({ master, onMenu }: { master: SpeedMaster; onMenu: (e: MenuPoint) => void }) {
  const t = useT()
  const selected = usePoolsView((s) => s.selected?.kind === 'speed' && s.selected.id === master.id)
  const cuelists = usePlaybackStore((s) => s.cuelists)
  const chases = usePlaybackStore((s) => s.chases)
  const effects = useEffectsStore((s) => s.effects)
  const linked = useMemo(() => linkedToSpeedMaster(master.id, cuelists, chases, effects), [master.id, cuelists, chases, effects])
  const name = master.name || t('pro.pools.defaults.speed', { n: master.number })
  const what = speedLabel(master.id)
  const beat = `${(60 / Math.max(1, master.bpm)).toFixed(3)}s`

  return (
    <section
      aria-label={name}
      data-speed={master.number}
      onPointerDownCapture={() => usePoolsView.getState().select('speed', master.id)}
      {...contextMenuHandlers(onMenu)}
      className={cn(
        'flex w-[200px] flex-col gap-2 rounded-lg bg-surface-2 p-2 ring-1 ring-inset ring-line-subtle [[data-density=touch]_&]:w-[232px]',
        selected && 'outline outline-2 -outline-offset-2 outline-info-fg'
      )}
    >
      <header className="flex items-center gap-2">
        <span className="font-mono text-2xs tabular text-fg-tertiary">{master.number}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg-primary">{name}</span>
        <span aria-hidden className="h-2 w-2 animate-blink rounded-full bg-accent" style={{ animationDuration: beat } as React.CSSProperties} />
      </header>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xl tabular leading-none text-fg-primary">{formatBpm(master.bpm)}</span>
      </div>
      <Button
        size="lg"
        variant="secondary"
        className="w-full font-semibold"
        aria-label={t('pro.pools.speed.tapAria', { what })}
        onPress={() => { tapSpeed(master.id) }}
      >
        {t('pro.pools.speed.tap')}
      </Button>
      <div className="flex items-center gap-1">
        <NumberField
          className="min-w-0 flex-1"
          value={master.bpm}
          onChange={(v) => setSpeedBpm(master.id, v)}
          min={1}
          max={999}
          step={0.1}
          aria-label={t('pro.pools.speed.bpmAria', { what })}
        />
        <Button size="sm" variant="ghost" tooltip={t('pro.pools.speed.half')} aria-label={t('pro.pools.speed.half')} onClick={() => setSpeedBpm(master.id, master.bpm / 2)}>{t('pro.pools.speed.halfShort')}</Button>
        <Button size="sm" variant="ghost" tooltip={t('pro.pools.speed.double')} aria-label={t('pro.pools.speed.double')} onClick={() => setSpeedBpm(master.id, master.bpm * 2)}>{t('pro.pools.speed.doubleShort')}</Button>
      </div>
      <div className="flex items-center gap-1.5">
        <DropdownMenu
          items={() => linkMenu(master.id)}
          trigger={(p) => (
            <Button {...p} size="sm" variant="ghost" icon={LuLink} aria-label={t('pro.pools.speed.linkAria', { what })}>
              {t('pro.pools.speed.link')}
            </Button>
          )}
        />
        <span className="min-w-0 flex-1 truncate text-2xs text-fg-tertiary" title={linked.map((l) => l.name).join(', ')}>
          {t('pro.pools.speed.linked', { count: linked.length })}
        </span>
      </div>
    </section>
  )
})
