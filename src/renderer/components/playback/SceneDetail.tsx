// ============================================================
// Scene editor (detail side of the Scenes view): header, large
// playback controls (Back, GO, Stop, Flash hold, level), on-stage /
// next cue readout with fade progress, and tabs for the cue list,
// stored effects and settings. Header: visible Duplicate / Delete
// buttons for the scene; the cue table registers the cue selection
// actions (Delete / Mod+D / F2 on the selected cue).
// Pro view: advanced cue columns (Columns menu, remembered) and the
// cue timing editor beside the table (below it when narrow).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowUp, LuCircleDot, LuColumns3, LuCopy, LuEllipsis, LuListOrdered, LuPencil, LuPiano, LuPlay, LuRefreshCw, LuSettings2,
  LuSkipBack, LuSparkles, LuSquare, LuTimer, LuTrash2, LuX, LuZap
} from 'react-icons/lu'
import type { Cuelist } from '@shared/types'
import {
  Badge, Button, DropdownMenu, EmptyState, IconButton, Slider, Tabs, ToggleButton, cn, formatCuePosition, formatPercent, formatSeconds, toast,
  type MenuEntry
} from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useSelectionActions } from '@renderer/lib/selection-actions'
import { CueTable } from './CueTable'
import { CueTimingEditor } from './CueTimingEditor'
import { PRO_COLUMNS_KEY, parseProColumns, type ProCueColumns } from './pro-cue'
import {
  cueSelectionActions, deleteCue, deleteScene, duplicateCue, duplicateScene, focusNameField, formatCueNumber, sceneSelectionActions
} from './actions'
import { SceneEffects } from './SceneEffects'
import { SceneSettings } from './SceneSettings'
import { FadeProgress } from './FadeProgress'
import { capture, captureSummary, recordAddCue, recordUpdateCue } from './record'
import { MODE_LABEL, formatMidiSource, formatSlot, startSceneLearn, useLearningSceneId, useSceneMidi, type ExecutorSlot } from './scene-meta'

type SceneTab = 'cues' | 'effects' | 'settings'

const TIMING_EDITOR_KEY = 'photonboard.scenes.timingEditor'

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeLocal(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}

export function SceneDetail({ cuelist: cl, number, slot, selectedCueId, onSelectCue }: {
  cuelist: Cuelist
  number: number
  slot: ExecutorSlot | undefined
  selectedCueId: string | null
  onSelectCue: (id: string | null) => void
}) {
  const t = useT()
  const [tab, setTab] = useState<SceneTab>('cues')
  const cueScope = useRef<HTMLDivElement>(null)
  const midi = useSceneMidi().get(cl.id)
  const learning = useLearningSceneId() === cl.id
  const body = useRef<HTMLDivElement>(null)
  const width = useWidth(body)
  const outer = useRef<HTMLDivElement>(null)
  const outerWidth = useWidth(outer)
  const pb = usePlaybackStore.getState
  // Pro view: advanced columns and the cue timing editor (remembered on this machine)
  const proMode = useUiStore((s) => s.proMode)
  const [proColumns, setProColumnsState] = useState<ProCueColumns>(() => parseProColumns(readLocal(PRO_COLUMNS_KEY)))
  const setProColumn = (k: keyof ProCueColumns, on: boolean) => setProColumnsState((cur) => {
    const next = { ...cur, [k]: on }
    writeLocal(PRO_COLUMNS_KEY, JSON.stringify(next))
    return next
  })
  const [timingOpen, setTimingOpenState] = useState(() => readLocal(TIMING_EDITOR_KEY) === '1')
  const setTimingOpen = (open: boolean) => {
    setTimingOpenState(open)
    writeLocal(TIMING_EDITOR_KEY, open ? '1' : '0')
  }
  const showTiming = proMode && tab === 'cues' && timingOpen && cl.cues.length > 0
  const timingSide = outerWidth === 0 || outerWidth >= 980
  // Width the advanced columns take (Delay / Total give way to them first)
  const proExtra = proMode ? (proColumns.featureTiming ? 120 : 0) + (proColumns.parts ? 84 : 0) + (proColumns.trigger ? 84 : 0) + (proColumns.presets ? 44 : 0) : 0

  const selectedIndex = cl.cues.findIndex((c) => c.id === selectedCueId)
  const selectedCue = selectedIndex >= 0 ? cl.cues[selectedIndex] : undefined
  const fxCount = cl.effectSnapshots?.length ?? 0

  // Delete / Mod+D / F2 in the cue table: the selected cue (else the scene)
  useSelectionActions(selectedCue ? cueSelectionActions(cl.id, selectedCue, onSelectCue) : sceneSelectionActions(cl), { scope: cueScope })

  const recordCue = () => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning(t('scenes.record.nothing'), { description: t('scenes.record.nothingHint') })
      return
    }
    const id = recordAddCue(cl.id, cap)
    if (id) onSelectCue(id)
    toast.success(t('scenes.toast.cueAdded', { number: cl.cues.length + 1, name: cl.name }), { description: captureSummary(cap) })
  }

  const updateSelectedCue = () => {
    if (!selectedCue) return
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning(t('scenes.record.nothing'), { description: t('scenes.record.nothingHint') })
      return
    }
    recordUpdateCue(cl.id, selectedCue.id, cap, 'merge')
    toast.success(t('scenes.toast.cueUpdated', { number: formatCueNumber(selectedCue.number) }), { description: t('scenes.toast.channelsMerged', { count: cap.channelCount }) })
  }

  const columnsMenu = (): MenuEntry[] => [
    { type: 'label', label: translate('pro.scenes.columns.menuTitle') },
    ...(['featureTiming', 'parts', 'trigger', 'presets'] as const).map((k): MenuEntry => ({
      label: translate(`pro.scenes.columns.${k}`),
      checked: proColumns[k],
      onSelect: () => setProColumn(k, !proColumns[k])
    }))
  ]

  const menu = (): MenuEntry[] => [
    { type: 'label', label: cl.name || translate('common.untitled') },
    { label: translate('common.renameEllipsis'), icon: LuPencil, shortcut: 'F2', onSelect: () => focusNameField(`scene:${cl.id}`) },
    { label: translate('scenes.detail.duplicate'), icon: LuCopy, shortcut: 'Mod+D', onSelect: () => { duplicateScene(cl) } },
    learning
      ? { label: translate('scenes.midi.cancelLearn'), icon: LuX, onSelect: () => useMidiStore.getState().cancelLearn() }
      : { label: midi ? translate('scenes.midi.relearnTrigger') : translate('scenes.midi.learnTrigger'), icon: LuPiano, description: translate('scenes.midi.learnHint'), onSelect: () => startSceneLearn(cl, slot?.mode ?? 'toggle') },
    { label: translate('common.settings'), icon: LuSettings2, onSelect: () => setTab('settings') },
    { type: 'separator' },
    { label: translate('scenes.detail.deleteEllipsis'), icon: LuTrash2, danger: true, shortcut: 'Backspace', onSelect: () => void deleteScene(cl) }
  ]

  return (
    <section aria-label={t('scenes.detail.aria', { name: cl.name })} data-scene-detail="" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex min-h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5">
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-line-strong" style={{ backgroundColor: slot?.color }} />
        <span className="shrink-0 font-mono text-xs tabular text-fg-tertiary">{t('scenes.detail.numberShort', { n: number })}</span>
        <input
          aria-label={t('scenes.detail.nameAria')}
          data-name-field={`scene:${cl.id}`}
          value={cl.name}
          placeholder={t('scenes.detail.namePlaceholder')}
          onChange={(e) => pb().renameCuelist(cl.id, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm min-w-0 max-w-[360px] flex-1 truncate rounded bg-transparent px-1.5 text-base font-semibold text-fg-primary outline-none placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {cl.isPlaying
            ? <Badge tone="go" variant="solid">{cl.flash ? t('scenes.flashBadge') : t('scenes.liveBadge')}</Badge>
            : <Badge>{t('scenes.detail.stopped')}</Badge>}
          {cl.isLooping && <Badge tone="info">{t('scenes.loop')}</Badge>}
          {slot && (
            <Badge mono title={t('scenes.slotTitle', { col: slot.col + 1, row: slot.row + 1 })}>
              {slot.mode !== 'toggle'
                ? t('scenes.slotShortMode', { slot: formatSlot(slot), mode: MODE_LABEL[slot.mode] })
                : t('scenes.slotShort', { slot: formatSlot(slot) })}
            </Badge>
          )}
          {learning ? <Badge tone="midi" variant="solid" className="animate-pulse">{t('scenes.midi.learning')}</Badge> : midi && <Badge tone="midi" mono>{formatMidiSource(midi)}</Badge>}
          {cl.priority !== 50 && <Badge title={t('scenes.priority')}>{t('scenes.priorityShort', { n: cl.priority })}</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Visible (not only in the "…" menu): label from xl, icon + tooltip below */}
          <Button
            icon={LuCopy}
            aria-label={t('scenes.detail.duplicate')}
            tooltip={t('scenes.detail.duplicate')}
            shortcut="Mod+D"
            size="sm"
            variant="ghost"
            labelClassName="hidden xl:inline"
            className="max-xl:w-control-sm max-xl:px-0"
            data-scene-action="duplicate"
            onClick={() => { duplicateScene(cl) }}
          >
            {t('common.duplicate')}
          </Button>
          <Button
            icon={LuTrash2}
            aria-label={t('scenes.detail.delete')}
            tooltip={t('scenes.detail.delete')}
            shortcut="Backspace"
            size="sm"
            variant="ghost"
            labelClassName="hidden xl:inline"
            className="text-danger-fg hover:bg-danger/15 max-xl:w-control-sm max-xl:px-0"
            data-scene-action="delete"
            onClick={() => void deleteScene(cl)}
          >
            {t('common.delete')}
          </Button>
          <DropdownMenu
            placement="bottom-end"
            items={menu}
            trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={t('scenes.detail.actions')} size="sm" />}
          />
        </div>
      </header>

      {/* Playback */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-subtle px-3 py-3">
        <div className="flex items-center gap-2">
          <Button size="lg" icon={LuSkipBack} disabled={cl.cues.length === 0} onClick={() => pb().goBackCuelist(cl.id)} tooltip={t('scenes.detail.backTooltip')}>{t('common.back')}</Button>
          <Button
            size="lg"
            variant="success"
            icon={LuPlay}
            disabled={cl.cues.length === 0}
            className="min-w-[120px] [[data-density=touch]_&]:min-w-[148px]"
            tooltip={t('scenes.detail.goTooltip')}
            shortcut="Space"
            onClick={() => pb().goCuelist(cl.id)}
          >
            {t('common.go')}
          </Button>
          <Button size="lg" icon={LuSquare} disabled={!cl.isPlaying} onClick={() => pb().stopCuelist(cl.id)} tooltip={t('scenes.detail.stopTooltip')}>{t('common.stop')}</Button>
          <FlashButton cuelistId={cl.id} disabled={cl.cues.length === 0} />
        </div>
        <OnStage cuelist={cl} />
        <div className="flex min-w-[200px] max-w-[280px] flex-1 flex-col gap-1 [[data-density=touch]_&]:max-w-[320px]">
          <span className="flex items-baseline justify-between text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
            {t('scenes.level')}
            <span className="font-mono text-xs normal-case tabular tracking-normal text-fg-secondary">{formatPercent(cl.flash ? 255 : cl.faderLevel)}</span>
          </span>
          <Slider aria-label={t('scenes.detail.levelAria')} value={cl.faderLevel} onChange={(v) => pb().setCuelistFader(cl.id, v)} defaultValue={255} color={slot?.color} />
        </div>
      </div>

      {/* Tabs + cue actions */}
      <div className="flex shrink-0 items-end gap-2 border-b border-line px-3">
        <Tabs<SceneTab>
          aria-label={t('scenes.detail.tabsAria')}
          className="min-w-0 border-b-0"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'cues', label: t('common.cues'), badge: cl.cues.length, 'data-scene-tab': 'cues' },
            { id: 'effects', label: t('common.effects'), icon: LuSparkles, badge: fxCount || undefined, 'data-scene-tab': 'effects' },
            { id: 'settings', label: t('common.settings'), icon: LuSettings2, 'data-scene-tab': 'settings' }
          ]}
        />
        <div className="flex-1" />
        {tab === 'cues' && (
          <div className="flex shrink-0 items-center gap-1 pb-1">
            {selectedCue && (
              <>
                <span className="mr-1 hidden truncate text-xs text-fg-tertiary xl:inline">{t('scenes.cueN', { number: formatCueNumber(selectedCue.number) })}</span>
                <IconButton icon={LuArrowUp} size="sm" label={t('scenes.cues.moveUp')} disabled={selectedIndex <= 0} onClick={() => pb().moveCue(cl.id, selectedIndex, selectedIndex - 1)} />
                <IconButton icon={LuArrowDown} size="sm" label={t('scenes.cues.moveDown')} disabled={selectedIndex >= cl.cues.length - 1} onClick={() => pb().moveCue(cl.id, selectedIndex, selectedIndex + 1)} />
                <IconButton
                  icon={LuCopy}
                  size="sm"
                  label={t('scenes.cues.duplicate')}
                  shortcut="Mod+D"
                  data-cue-action="duplicate"
                  onClick={() => { const id = duplicateCue(cl.id, selectedCue); if (id) onSelectCue(id) }}
                />
                <IconButton
                  icon={LuTrash2}
                  size="sm"
                  label={t('scenes.cues.delete')}
                  shortcut="Backspace"
                  data-cue-action="delete"
                  className="hover:bg-danger/15 hover:text-danger-fg"
                  onClick={() => void deleteCue(cl.id, selectedCue, onSelectCue)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={LuRefreshCw}
                  aria-label={t('common.update')}
                  tooltip={t('scenes.cues.updateTooltip')}
                  labelClassName="hidden xl:inline"
                  className="max-xl:w-control-sm max-xl:px-0"
                  onClick={updateSelectedCue}
                >
                  {t('common.update')}
                </Button>
              </>
            )}
            {proMode && (
              <>
                <DropdownMenu
                  placement="bottom-end"
                  items={columnsMenu}
                  trigger={(p) => (
                    <Button {...p} size="sm" variant="ghost" icon={LuColumns3} aria-label={t('pro.scenes.columns.menu')} tooltip={t('pro.scenes.columns.menuTitle')} labelClassName="hidden 2xl:inline" className="max-2xl:w-control-sm max-2xl:px-0" data-cue-columns-menu="">
                      {t('pro.scenes.columns.menu')}
                    </Button>
                  )}
                />
                <ToggleButton
                  size="sm"
                  tone="neutral"
                  icon={LuTimer}
                  pressed={timingOpen}
                  onPressedChange={setTimingOpen}
                  aria-label={t('pro.scenes.timing.button')}
                  tooltip={timingOpen ? t('pro.scenes.timing.hide') : t('pro.scenes.timing.show')}
                  labelClassName="hidden xl:inline"
                  className="max-xl:w-control-sm max-xl:px-0"
                  data-cue-timing-toggle=""
                >
                  {t('pro.scenes.timing.button')}
                </ToggleButton>
              </>
            )}
            <Button size="sm" variant="secondary" icon={LuCircleDot} className="text-accent-fg" tooltip={t('scenes.cues.addTooltip')} onClick={recordCue}>{t('scenes.cues.add')}</Button>
          </div>
        )}
      </div>

      <div ref={outer} className={cn('flex min-h-0 flex-1', showTiming && timingSide ? 'flex-row' : 'flex-col')}>
      <div ref={body} data-reorder-scroll="" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {tab === 'cues' && (cl.cues.length === 0 ? (
          <EmptyState
            icon={LuListOrdered}
            title={t('scenes.cues.emptyTitle')}
            description={t('scenes.cues.emptyText')}
            action={<Button variant="primary" icon={LuCircleDot} onClick={recordCue}>{t('scenes.cues.recordFirst')}</Button>}
          />
        ) : (
          <div ref={cueScope} data-cue-table="">
            <CueTable
              cuelist={cl}
              selectedCueId={selectedCueId}
              onSelectCue={onSelectCue}
              columns={{ delay: width === 0 || width >= 720 + proExtra, tracked: width === 0 || width >= 840 + proExtra, ...(proMode ? proColumns : {}) }}
              proMode={proMode}
              onEditTiming={() => setTimingOpen(true)}
            />
          </div>
        ))}
        {tab === 'effects' && <SceneEffects cuelist={cl} />}
        {tab === 'settings' && <SceneSettings cuelist={cl} slot={slot} learning={learning} />}
      </div>
      {showTiming && <CueTimingEditor cuelist={cl} cue={selectedCue} layout={timingSide ? 'side' : 'bottom'} onClose={() => setTimingOpen(false)} />}
      </div>
    </section>
  )
}

/** Hold to flash (full level; a stopped scene plays while held) */
function FlashButton({ cuelistId, disabled }: { cuelistId: string; disabled: boolean }) {
  const t = useT()
  // Released on unmount by Button's press handling (pointer up / cancel / blur / unmount)
  return (
    <Button
      size="lg"
      tone="warning"
      icon={LuZap}
      disabled={disabled}
      tooltip={t('scenes.detail.flashTooltip')}
      onPress={() => usePlaybackStore.getState().flashCuelist(cuelistId, true)}
      onRelease={() => usePlaybackStore.getState().flashCuelist(cuelistId, false)}
    >
      {t('common.flash')}
    </Button>
  )
}

/** On-stage cue, next cue and fade progress */
function OnStage({ cuelist: cl }: { cuelist: Cuelist }) {
  const t = useT()
  const cur = cl.isPlaying ? cl.cues[cl.currentCueIndex] : undefined
  const nextIndex = cl.isPlaying
    ? (cl.currentCueIndex + 1 < cl.cues.length ? cl.currentCueIndex + 1 : cl.isLooping && cl.cues.length > 1 ? 0 : -1)
    : (cl.cues.length > 0 ? 0 : -1)
  const next = nextIndex >= 0 ? cl.cues[nextIndex] : undefined
  const auto = cur && cur.followTime !== null && next ? t('scenes.onStage.autoAfter', { time: formatSeconds(cur.followTime) }) : null

  return (
    <div className="relative flex min-w-[220px] flex-1 flex-col justify-center gap-0.5 overflow-hidden rounded-lg bg-surface-0 px-3 py-1.5 ring-1 ring-inset ring-line-subtle [[data-density=touch]_&]:py-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="w-12 shrink-0 truncate text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('common.cue')}</span>
        {cur ? (
          <>
            <span className="shrink-0 font-mono text-sm font-semibold tabular text-go-fg">{formatCueNumber(cur.number)}</span>
            <span className="min-w-0 truncate text-sm font-medium text-fg-primary">{cur.name || t('common.untitled')}</span>
          </>
        ) : (
          <span className="text-sm text-fg-tertiary">{cl.cues.length === 0 ? t('scenes.noCues') : t('scenes.detail.stopped')}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs tabular text-fg-tertiary">{formatCuePosition(cl.isPlaying ? cl.currentCueIndex : -1, cl.cues.length)}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="w-12 shrink-0 truncate text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('scenes.onStage.next')}</span>
        {next ? (
          <>
            <span className="shrink-0 font-mono font-semibold tabular text-accent-fg">{formatCueNumber(next.number)}</span>
            <span className="min-w-0 truncate text-fg-secondary">{next.name || t('common.untitled')}</span>
            <span className="ml-auto shrink-0 font-mono tabular text-fg-tertiary">
              {auto ?? (next.delay > 0
                ? t('scenes.onStage.delayPlusFade', { delay: formatSeconds(next.delay), fade: formatSeconds(next.fadeIn) })
                : formatSeconds(next.fadeIn))}
            </span>
          </>
        ) : (
          <span className="text-fg-tertiary">{cl.cues.length === 0 ? '—' : t('scenes.onStage.end')}</span>
        )}
      </div>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-3" />
      <FadeProgress cuelist={cl} className="absolute inset-x-0 bottom-0" />
    </div>
  )
}

/** Width of an element, rounded to 40 px steps (layout decisions only) */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const next = Math.round(el.clientWidth / 40) * 40
      setW((cur) => (cur === next ? cur : next))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}
