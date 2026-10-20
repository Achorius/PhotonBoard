// ============================================================
// Effects view — the show's effects: start/stop, live phase ring,
// solo, edit. Phase rings animate from the shared ticker (no React
// render per frame). Long-press / right-click a row for more.
// ============================================================

import { memo, useMemo, useRef, useState, type RefObject } from 'react'
import type React from 'react'
import {
  LuCopy, LuEllipsis, LuHeadphones, LuPencil, LuPlay, LuRotateCcw, LuSave, LuSlidersHorizontal, LuSparkles, LuSquare, LuTrash2
} from 'react-icons/lu'
import type { CueChannelValue, Effect } from '@shared/types'
import {
  Badge, Button, DropdownMenu, EmptyState, IconButton, SegmentedControl, ToggleButton, cn, confirm, effectCategoryIcon,
  contextMenuHandlers, formatBpm, toast, useContextMenu, type MenuEntry, type MenuPoint
} from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { deleteWithUndo, useSelectionActions } from '@renderer/lib/selection-actions'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { CATEGORY_COLOR, effectCategoryOf, waveformLabel } from './effect-templates'
import { PhaseRing } from './effect-graphics'
import { runEffect, useEffectsUiStore } from './effects-ui-store'

type Filter = 'all' | 'running'

/** "All fixtures", a group name, up to 3 names, or "N fixtures" */
export function useTargetLabel(): (ids: string[]) => string {
  const t = useT()
  const patch = usePatchStore((s) => s.patch)
  const groups = usePatchStore((s) => s.groups)
  return useMemo(() => {
    const names = new Map(patch.map((p) => [p.id, p.name]))
    return (ids: string[]) => {
      if (ids.length === 0) return t('effects.targets.none')
      const set = new Set(ids)
      if (patch.length > 0 && ids.length === patch.length && patch.every((p) => set.has(p.id))) return t('effects.targets.allFixtures')
      const g = groups.find((gr) => gr.fixtureIds.length === ids.length && gr.fixtureIds.every((id) => set.has(id)))
      if (g) return g.name
      if (ids.length <= 3) return ids.map((id) => names.get(id) ?? t('effects.targets.missingFixture')).join(', ')
      return t('common.fixtureCount', { count: ids.length })
    }
  }, [patch, groups, t])
}

/** Noun phrase for the confirm dialog / Undo toast (en 'effect “Rainbow”', fr 'l’effet « Rainbow »') */
export function effectLabel(effect: Pick<Effect, 'name'>): string {
  return translate('effects.selection.effect', { name: effect.name })
}

/** Remove an effect now (synchronous: one undo step inside deleteWithUndo / selection actions) */
function removeEffectNow(id: string): void {
  useEffectsStore.getState().removeEffect(id)
  const ui = useEffectsUiStore.getState()
  if (ui.editingId === id) ui.setEditing(null)
  if (ui.solo?.id === id) useEffectsUiStore.setState({ solo: null })
}

/** Delete an effect: confirm, one undo step, Undo toast */
export function deleteEffect(effect: Effect): Promise<boolean> {
  return deleteWithUndo({
    label: effectLabel(effect),
    run: () => removeEffectNow(effect.id),
    confirm: { confirmLabel: translate('effects.editor.deleteEffect') }
  })
}

export function duplicateEffect(effect: Effect): void {
  const { id: _id, ...rest } = effect
  const id = useEffectsStore.getState().createEffect({
    ...rest, name: translate('effects.list.copyName', { name: effect.name }), isRunning: false, fixtureIds: [...effect.fixtureIds]
  })
  useEffectsUiStore.getState().setEditing(id)
}

/** Focus the name field of the editor (rename) */
export function focusEffectName(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('[data-fx-name]')
    el?.focus()
    el?.select()
  })
}

/**
 * Delete / Mod+D / F2 on the effect being edited. Registered by the list and
 * the editor (each with its own scope) so the keys work from either, never
 * from the library or the targets.
 */
export function useEffectSelectionActions(scope: RefObject<HTMLElement | null>): void {
  const editingId = useEffectsUiStore((s) => s.editingId)
  const selected = useEffectsStore((s) => (editingId ? s.effects.find((e) => e.id === editingId) : undefined))
  useSelectionActions(selected ? {
    label: () => effectLabel(selected),
    delete: () => removeEffectNow(selected.id),
    confirmDelete: { confirmLabel: translate('effects.editor.deleteEffect') },
    duplicate: () => duplicateEffect(selected),
    rename: focusEffectName
  } : null, { scope })
}

/** Snapshot the running effects + current output of their fixtures as a new scene */
function saveRunningAsScene(): void {
  const running = useEffectsStore.getState().effects.filter((e) => e.isRunning)
  if (running.length === 0) return
  const patchStore = usePatchStore.getState()
  const values = useDmxStore.getState().values
  const playback = usePlaybackStore.getState()
  const fixtureIds = new Set(running.flatMap((e) => e.fixtureIds))
  const cueValues: CueChannelValue[] = []
  for (const fixtureId of fixtureIds) {
    const entry = patchStore.patch.find((p) => p.id === fixtureId)
    if (!entry) continue
    for (const ch of patchStore.getFixtureChannels(entry)) {
      const val = values[entry.universe]?.[ch.absoluteChannel] ?? 0
      if (val > 0) cueValues.push({ fixtureId, channelName: ch.name, value: val })
    }
  }
  const names = running.map((e) => e.name)
  const sceneName = names.length <= 2 ? names.join(' + ') : translate('effects.list.sceneNameMore', { name: names[0], count: names.length - 1 })
  const cuelistId = playback.addCuelist(sceneName)
  playback.addCue(cuelistId, translate('effects.list.sceneCueName'), cueValues)
  const effectSnapshots = running.map((fx) => ({ ...fx }))
  usePlaybackStore.setState((state) => ({
    cuelists: state.cuelists.map((cl) => (cl.id === cuelistId ? { ...cl, effectSnapshots } : cl))
  }))
  toast.success(translate('effects.list.sceneCreated', { name: sceneName }), { description: translate('effects.list.sceneCaptured', { count: running.length }) })
}

export function EffectList({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const t = useT()
  const sectionRef = useRef<HTMLElement>(null)
  useEffectSelectionActions(sectionRef)
  const effects = useEffectsStore((s) => s.effects)
  const editingId = useEffectsUiStore((s) => s.editingId)
  const soloId = useEffectsUiStore((s) => s.solo?.id ?? null)
  const [filter, setFilter] = useState<Filter>('all')
  const targetLabel = useTargetLabel()
  const ctx = useContextMenu()

  const runningCount = effects.reduce((n, e) => n + (e.isRunning ? 1 : 0), 0)
  const shown = filter === 'running' ? effects.filter((e) => e.isRunning) : effects

  const stopAll = async () => {
    const ok = await confirm({
      title: t('effects.list.stopAllTitle'),
      message: t('effects.list.stopAllText', { count: runningCount }),
      confirmLabel: t('effects.list.stopAllAction'),
      tone: 'danger'
    })
    if (!ok) return
    useEffectsStore.getState().stopAllEffects()
    useEffectsUiStore.setState({ solo: null })
  }

  const removeAll = () => {
    const count = useEffectsStore.getState().effects.length
    if (count === 0) return
    void deleteWithUndo({
      label: t('effects.selection.allEffects', { count }),
      confirm: { confirmLabel: t('effects.list.deleteAllAction') },
      run: () => {
        const store = useEffectsStore.getState()
        for (const e of [...store.effects]) store.removeEffect(e.id)
        useEffectsUiStore.setState({ editingId: null, solo: null })
      }
    })
  }

  const moreItems = (): MenuEntry[] => [
    { label: t('effects.list.saveAsScene'), icon: LuSave, disabled: runningCount === 0, onSelect: saveRunningAsScene, description: t('effects.list.saveAsSceneHint') },
    { type: 'separator' },
    { label: t('effects.list.deleteAll'), icon: LuTrash2, danger: true, disabled: effects.length === 0, onSelect: removeAll }
  ]

  const rowMenu = (e: Effect): MenuEntry[] => [
    { label: t('common.edit'), icon: LuSlidersHorizontal, onSelect: () => useEffectsUiStore.getState().setEditing(e.id) },
    { label: t('effects.list.restartPhase'), icon: LuRotateCcw, disabled: !e.isRunning, onSelect: () => useEffectsStore.getState().setEffectRunning(e.id, true) },
    { label: t('common.duplicate'), icon: LuCopy, onSelect: () => duplicateEffect(e) },
    { label: t('common.renameEllipsis'), icon: LuPencil, onSelect: () => { useEffectsUiStore.getState().setEditing(e.id); focusEffectName() } },
    { type: 'separator' },
    { label: t('common.deleteEllipsis'), icon: LuTrash2, danger: true, onSelect: () => { void deleteEffect(e) } }
  ]

  return (
    <section ref={sectionRef} aria-label={t('effects.list.region')} className={cn('flex min-h-0 flex-col bg-surface-1', className)} style={style}>
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <h2 className="text-sm font-semibold text-fg-primary">{t('effects.list.title')}</h2>
        <span className="text-xs tabular text-fg-tertiary">{effects.length}</span>
        {runningCount > 0 && <Badge tone="go" className="hidden xl:inline-flex">{t('effects.list.runningBadge', { count: runningCount })}</Badge>}
        <div className="flex-1" />
        <SegmentedControl
          size="xs"
          aria-label={t('effects.list.filterLabel')}
          value={filter}
          onChange={setFilter}
          items={[{ value: 'all', label: t('effects.list.filterAll') }, { value: 'running', label: t('effects.list.filterRunning') }]}
        />
        <Button size="sm" variant="danger-outline" icon={LuSquare} disabled={runningCount === 0} data-fx-stop-all onClick={() => { void stopAll() }}>
          {t('effects.list.stopAll')}
        </Button>
        <DropdownMenu
          placement="bottom-end"
          items={moreItems}
          trigger={(p) => <IconButton {...p} size="sm" icon={LuEllipsis} label={t('effects.list.moreActions')} />}
        />
      </header>

      <div role="listbox" aria-label={t('effects.list.region')} className="min-h-0 flex-1 overflow-y-auto py-1">
        {effects.length === 0 ? (
          <EmptyState size="sm" icon={LuSparkles} title={t('effects.list.emptyTitle')} description={t('effects.list.emptyText')} />
        ) : shown.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuSquare}
            title={t('effects.list.nothingRunningTitle')}
            description={t('effects.list.nothingRunningText')}
            action={<Button size="sm" variant="ghost" onClick={() => setFilter('all')}>{t('common.showAll')}</Button>}
          />
        ) : (
          shown.map((e) => (
            <EffectRow
              key={e.id}
              effect={e}
              targets={targetLabel(e.fixtureIds)}
              editing={e.id === editingId}
              soloed={e.id === soloId}
              onMenu={(ev) => ctx.open(ev, rowMenu(e))}
            />
          ))
        )}
      </div>
      {ctx.menu}
    </section>
  )
}

const EffectRow = memo(function EffectRow({ effect, targets, editing, soloed, onMenu }: {
  effect: Effect
  targets: string
  editing: boolean
  soloed: boolean
  onMenu: (e: MenuPoint) => void
}) {
  const t = useT()
  const category = effectCategoryOf(effect)
  const color = CATEGORY_COLOR[category]
  const Icon = effectCategoryIcon(category)
  const running = effect.isRunning
  const edit = () => useEffectsUiStore.getState().setEditing(effect.id)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div
      role="option"
      aria-selected={editing}
      tabIndex={0}
      data-fx-row={effect.name}
      onClick={edit}
      {...contextMenuHandlers(onMenu)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') { e.preventDefault(); edit() }
        else if (e.key === ' ' && !e.repeat) { e.preventDefault(); runEffect(effect.id, !running) }
      }}
      className={cn(
        'relative mx-1.5 flex min-h-row cursor-pointer items-center gap-2 rounded px-1.5 py-1 outline-offset-[-2px] transition-colors duration-fast',
        editing ? 'bg-info/15 hover:bg-info/20' : 'hover:bg-surface-2'
      )}
    >
      {(editing || running) && <span aria-hidden className={cn('absolute inset-y-1 left-0 w-0.5 rounded-full', running ? 'bg-go-fg' : 'bg-info-fg')} />}
      <span onClick={stop} className="flex">
        <IconButton
          size="sm"
          variant="secondary"
          tone="go"
          active={running}
          icon={running ? LuSquare : LuPlay}
          label={running ? t('effects.list.stop', { name: effect.name }) : t('effects.list.start', { name: effect.name })}
          data-fx-play
          onClick={() => runEffect(effect.id, !running)}
        />
      </span>
      <PhaseRing id={effect.id} running={running} color={color} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon size={12} aria-hidden className="shrink-0" style={{ color }} />
          <span className={cn('truncate text-sm', running ? 'font-medium text-fg-primary' : 'text-fg-secondary')}>{effect.name}</span>
          {effect.oneShot && <Badge size="xs">{t('effects.library.oneShotBadge')}</Badge>}
        </span>
        <span className="truncate text-xs text-fg-tertiary">
          <span className={effect.fixtureIds.length === 0 ? 'text-warning-fg' : undefined}>{targets}</span>
          <span className="tabular"> · {t('common.fixtureCount', { count: effect.fixtureIds.length })} · {waveformLabel(effect.waveform)} · {formatBpm(effect.speed * 60)}</span>
        </span>
      </span>
      <span onClick={stop} className="flex items-center gap-1">
        <ToggleButton
          size="sm"
          variant="ghost"
          tone="accent"
          icon={LuHeadphones}
          pressed={soloed}
          onPressedChange={() => useEffectsUiStore.getState().toggleSolo(effect.id)}
          tooltip={soloed ? t('effects.list.unsoloHint') : t('effects.list.soloHint')}
          aria-label={t('effects.list.soloLabel', { name: effect.name })}
          labelClassName="hidden xl:inline"
        >
          {t('effects.list.solo')}
        </ToggleButton>
        <IconButton size="sm" icon={LuSlidersHorizontal} label={t('effects.list.editLabel', { name: effect.name })} data-fx-edit onClick={edit} active={editing} tone="info" />
        <IconButton size="sm" icon={LuEllipsis} label={t('common.more')} onClick={(e) => onMenu(e)} className="[[data-density=compact]_&]:hidden" />
      </span>
    </div>
  )
})
