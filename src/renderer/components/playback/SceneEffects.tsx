// ============================================================
// Effects stored in a scene (snapshots restarted on GO): rename,
// speed (BPM), size, spread, remove; replace with the effects
// running now.
// ============================================================

import { LuRefreshCw, LuSparkles, LuTrash2 } from 'react-icons/lu'
import type { Cuelist, Effect } from '@shared/types'
import { Badge, Button, EmptyState, IconButton, NumberField, Slider, confirm, effectCategoryIcon, toast } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'

function setSnapshots(cuelistId: string, fn: (list: Effect[]) => Effect[]) {
  const cl = usePlaybackStore.getState().cuelists.find((c) => c.id === cuelistId)
  if (!cl) return
  usePlaybackStore.getState().updateCuelist(cuelistId, { effectSnapshots: fn(cl.effectSnapshots ?? []) })
}

export function SceneEffects({ cuelist: cl }: { cuelist: Cuelist }) {
  const running = useEffectsStore((s) => s.effects.reduce((n, e) => n + (e.isRunning ? 1 : 0), 0))
  const fx = cl.effectSnapshots ?? []

  const snapshotRunning = async () => {
    const effects = useEffectsStore.getState().effects.filter((e) => e.isRunning).map((e) => ({ ...e, fixtureIds: [...e.fixtureIds] }))
    if (effects.length === 0) return
    if (fx.length > 0) {
      const ok = await confirm({
        title: `Replace the effects of “${cl.name}”?`,
        message: `Its ${fx.length} stored effect${fx.length === 1 ? '' : 's'} are replaced by the ${effects.length} running now.`,
        confirmLabel: 'Replace effects',
        tone: 'danger'
      })
      if (!ok) return
    }
    usePlaybackStore.getState().updateCuelist(cl.id, { effectSnapshots: effects })
    toast.success(`${effects.length} effect${effects.length === 1 ? '' : 's'} stored in “${cl.name}”`)
  }

  const action = (
    <Button
      size="sm"
      variant={fx.length === 0 ? 'primary' : 'secondary'}
      icon={LuRefreshCw}
      disabled={running === 0}
      tooltip={running === 0 ? 'No effect is running — start effects in the Effects view' : 'Store the effects running now in this scene'}
      onClick={() => void snapshotRunning()}
    >
      {fx.length === 0 ? `Store running effects${running ? ` (${running})` : ''}` : `Replace with running (${running})`}
    </Button>
  )

  if (fx.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={LuSparkles}
        title="No effects in this scene"
        description="Effects stored in a scene restart on every GO and stop with the scene."
        action={action}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-fg-tertiary">
          {fx.length} effect{fx.length === 1 ? '' : 's'} · restart on GO, stop with the scene
        </span>
        {action}
      </div>
      {fx.map((e) => <EffectCard key={e.id} cuelistId={cl.id} effect={e} />)}
    </div>
  )
}

function EffectCard({ cuelistId, effect: e }: { cuelistId: string; effect: Effect }) {
  const update = (u: Partial<Effect>) => setSnapshots(cuelistId, (list) => list.map((x) => (x.id === e.id ? { ...x, ...u } : x)))
  const Icon = effectCategoryIcon(categoryOf(e))
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line-subtle bg-surface-2 px-3 py-2">
      <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
      <input
        aria-label="Effect name"
        value={e.name}
        onChange={(ev) => update({ name: ev.target.value })}
        className="h-control-sm w-40 min-w-0 rounded bg-transparent px-1.5 text-sm font-medium text-fg-primary outline-none hover:bg-surface-3 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
      />
      <Badge size="xs">{e.channels?.length ? `${e.channels.length} ch` : e.channelType}</Badge>
      <span className="text-xs tabular text-fg-tertiary">{e.fixtureIds.length} fixtures</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <NumberField size="sm" className="w-[112px]" label="Speed" value={Math.round(e.speed * 60)} onChange={(v) => update({ speed: v / 60 })} min={1} max={600} step={1} unit="BPM" />
        <div className="flex w-[160px] items-center gap-2">
          <span className="text-xs text-fg-tertiary">Size</span>
          <Slider
            className="flex-1"
            aria-label="Size"
            value={Math.round((e.depth / 255) * 100)}
            onChange={(v) => update({ depth: Math.round((v / 100) * 255) })}
            min={0}
            max={100}
            showValue={(v) => `${Math.round(v)}%`}
          />
        </div>
        <NumberField size="sm" className="w-[96px]" label="Spread" value={e.fan} onChange={(v) => update({ fan: v })} min={0} max={360} step={1} unit="°" />
        <IconButton
          icon={LuTrash2}
          size="sm"
          label={`Remove ${e.name}`}
          className="hover:!text-danger-fg"
          onClick={async () => {
            const ok = await confirm({ title: `Remove “${e.name}” from this scene?`, message: 'The effect stays in the Effects view.', confirmLabel: 'Remove effect', tone: 'danger' })
            if (ok) setSnapshots(cuelistId, (list) => list.filter((x) => x.id !== e.id))
          }}
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
