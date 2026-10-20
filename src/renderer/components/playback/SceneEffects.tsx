// ============================================================
// Effects stored in a scene (snapshots restarted on GO): rename,
// speed (BPM), size, spread, remove; replace with the effects
// running now.
// ============================================================

import { LuRefreshCw, LuSparkles, LuTrash2 } from 'react-icons/lu'
import type { Cuelist, Effect } from '@shared/types'
import { Badge, Button, EmptyState, IconButton, NumberField, Slider, confirm, effectCategoryIcon, formatPercent, toast } from '@renderer/components/ui'
import { formatShortcut } from '@renderer/components/ui/Kbd'
import { t as translate, useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { deleteWithUndo } from '@renderer/lib/selection-actions'

function setSnapshots(cuelistId: string, fn: (list: Effect[]) => Effect[]) {
  const cl = usePlaybackStore.getState().cuelists.find((c) => c.id === cuelistId)
  if (!cl) return
  usePlaybackStore.getState().updateCuelist(cuelistId, { effectSnapshots: fn(cl.effectSnapshots ?? []) })
}

export function SceneEffects({ cuelist: cl }: { cuelist: Cuelist }) {
  const t = useT()
  const running = useEffectsStore((s) => s.effects.reduce((n, e) => n + (e.isRunning ? 1 : 0), 0))
  const fx = cl.effectSnapshots ?? []

  const snapshotRunning = async () => {
    const effects = useEffectsStore.getState().effects.filter((e) => e.isRunning).map((e) => ({ ...e, fixtureIds: [...e.fixtureIds] }))
    if (effects.length === 0) return
    if (fx.length > 0) {
      const ok = await confirm({
        title: translate('scenes.effects.replaceTitle', { name: cl.name }),
        message: translate('scenes.effects.replaceMessage', { count: fx.length, running: effects.length }),
        confirmLabel: translate('scenes.effects.replaceAction'),
        tone: 'danger'
      })
      if (!ok) return
    }
    usePlaybackStore.getState().updateCuelist(cl.id, { effectSnapshots: effects })
    toast.success(translate('scenes.effects.stored', { count: effects.length, name: cl.name }))
  }

  const action = (
    <Button
      size="sm"
      variant={fx.length === 0 ? 'primary' : 'secondary'}
      icon={LuRefreshCw}
      disabled={running === 0}
      tooltip={running === 0 ? t('scenes.effects.noneRunningTooltip') : t('scenes.effects.storeTooltip')}
      onClick={() => void snapshotRunning()}
    >
      {fx.length === 0
        ? running ? t('scenes.effects.storeRunningCount', { count: running }) : t('scenes.effects.storeRunning')
        : t('scenes.effects.replaceRunning', { count: running })}
    </Button>
  )

  if (fx.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={LuSparkles}
        title={t('scenes.effects.emptyTitle')}
        description={t('scenes.effects.emptyText')}
        action={action}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-fg-tertiary">
          {t('scenes.effects.summary', { effects: t('scenes.effectCount', { count: fx.length }) })}
        </span>
        {action}
      </div>
      {fx.map((e) => <EffectCard key={e.id} cuelistId={cl.id} effect={e} />)}
    </div>
  )
}

function EffectCard({ cuelistId, effect: e }: { cuelistId: string; effect: Effect }) {
  const t = useT()
  const update = (u: Partial<Effect>) => setSnapshots(cuelistId, (list) => list.map((x) => (x.id === e.id ? { ...x, ...u } : x)))
  const Icon = effectCategoryIcon(categoryOf(e))
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line-subtle bg-surface-2 px-3 py-2">
      <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
      <input
        aria-label={t('scenes.effects.nameAria')}
        value={e.name}
        onChange={(ev) => update({ name: ev.target.value })}
        className="h-control-sm w-40 min-w-0 rounded bg-transparent px-1.5 text-sm font-medium text-fg-primary outline-none hover:bg-surface-3 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
      />
      <Badge size="xs">{e.channels?.length ? t('units.channelsShortValue', { count: e.channels.length }) : e.channelType}</Badge>
      <span className="text-xs tabular text-fg-tertiary">{t('common.fixtureCount', { count: e.fixtureIds.length })}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <NumberField size="sm" className="w-[120px]" label={t('scenes.effects.speed')} value={Math.round(e.speed * 60)} onChange={(v) => update({ speed: v / 60 })} min={1} max={600} step={1} unit={t('units.bpm')} />
        <div className="flex w-[210px] items-center gap-2">
          <span className="text-xs text-fg-tertiary">{t('scenes.effects.size')}</span>
          <Slider
            className="flex-1"
            aria-label={t('scenes.effects.size')}
            value={Math.round((e.depth / 255) * 100)}
            onChange={(v) => update({ depth: Math.round((v / 100) * 255) })}
            min={0}
            max={100}
            showValue={(v) => formatPercent(v, 100)}
          />
        </div>
        <NumberField size="sm" className="w-[104px]" label={t('scenes.effects.spread')} value={e.fan} onChange={(v) => update({ fan: v })} min={0} max={360} step={1} unit={t('units.degrees')} />
        <IconButton
          icon={LuTrash2}
          size="sm"
          label={t('scenes.effects.removeNamed', { name: e.name })}
          className="hover:bg-danger/15 hover:text-danger-fg"
          onClick={() => void deleteWithUndo({
            label: translate('scenes.selection.effect', { name: e.name }),
            confirm: {
              title: translate('scenes.effects.removeTitle', { name: e.name }),
              message: `${translate('scenes.effects.removeMessage')} ${translate('edit.confirmDeleteMessage', { keys: formatShortcut('Mod+Z') })}`,
              confirmLabel: translate('scenes.effects.removeAction')
            },
            run: () => setSnapshots(cuelistId, (list) => list.filter((x) => x.id !== e.id))
          })}
        />
      </div>
    </div>
  )
}

function categoryOf(e: Effect): string {
  const t = (e.channels?.[0]?.channelType ?? e.channelType ?? '').toLowerCase()
  if (t.includes('pan') || t.includes('tilt')) return 'movement'
  if (t.includes('red') || t.includes('green') || t.includes('blue') || t.includes('color') || t.includes('colour') || t.includes('hue')) return 'color'
  return 'intensity'
}
