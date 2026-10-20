// ============================================================
// Chases: list + editor (BPM with tap tempo, crossfade, direction,
// loop, priority, level) and a step editor (look preview, hold
// time, reorder, update from programmer). Header: visible Duplicate /
// Delete buttons; the step table registers the step selection actions.
// ============================================================

import { memo, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowLeft, LuArrowLeftRight, LuArrowRight, LuArrowUp, LuCircleDot, LuCopy, LuEllipsis, LuGripVertical, LuListMusic, LuPencil,
  LuPiano, LuPlay, LuPlus, LuRefreshCw, LuReplace, LuShuffle, LuSquare, LuTrash2, LuX
} from 'react-icons/lu'
import type { Chase, ChaseStep, CueChannelValue } from '@shared/types'
import {
  Badge, Button, DropdownMenu, EmptyState, IconButton, NumberField, SegmentedControl, Slider, Switch, TBody, THead, Table, Td, Th, Tr,
  cn, formatBpm, formatPercent, formatSeconds, toast, type MenuEntry
} from '@renderer/components/ui'
import { t as translate, useT, type TFunction } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { handleTapTempo } from '@renderer/lib/midi-manager'
import { isRemoteMode, sendRemoteCommand } from '@renderer/lib/runtime'
import { useSelectionActions } from '@renderer/lib/selection-actions'
import { capture, captureSummary, countFixtures, createEmptyChase, recordAddStep, recordUpdateStep } from './record'
import { formatMidiSource } from './scene-meta'
import { dropIndicator, useReorder, type ReorderState } from './useReorder'
import {
  chaseSelectionActions, deleteChase, deleteStep, duplicateChase, duplicateStep, focusNameField, stepSelectionActions
} from './actions'

type Direction = Chase['direction']

const DIRECTION_ICONS: Record<Direction, typeof LuArrowRight> = {
  forward: LuArrowRight,
  backward: LuArrowLeft,
  bounce: LuArrowLeftRight,
  random: LuShuffle
}
const DIRECTION_ORDER: Direction[] = ['forward', 'backward', 'bounce', 'random']

function directionItem(d: Direction, t: TFunction) {
  return { value: d, icon: DIRECTION_ICONS[d], label: t(`scenes.chase.direction.${d}`), title: t(`scenes.chase.directionTitle.${d}`) }
}

// ---------------------------------------------------------------
// List
// ---------------------------------------------------------------

export function ChaseList({ selectedId, onRecord }: { selectedId: string | null; onRecord: () => void }) {
  const t = useT()
  const chases = usePlaybackStore((s) => s.chases)
  const select = (id: string, focus = false) => {
    usePlaybackStore.getState().selectChase(id)
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-chase-row="${id}"]`)?.focus())
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (chases.length === 0) return
    const idx = chases.findIndex((c) => c.id === selectedId)
    let next = -1
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(chases.length - 1, idx + 1)
    else if (e.key === 'ArrowUp') next = idx < 0 ? 0 : Math.max(0, idx - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = chases.length - 1
    else return
    e.preventDefault()
    e.stopPropagation()
    select(chases[next].id, true)
  }
  const playing = chases.reduce((n, c) => n + (c.isPlaying ? 1 : 0), 0)

  return (
    <section aria-label={t('common.chases')} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <h2 className="text-sm font-semibold text-fg-primary">{t('common.chases')}</h2>
        <span className="text-xs tabular text-fg-tertiary">{chases.length}</span>
        {playing > 0 && <Badge tone="go" size="xs">{t('scenes.liveCount', { count: playing })}</Badge>}
        <div className="flex-1" />
        <IconButton icon={LuPlus} label={t('scenes.chaseList.newEmpty')} size="sm" onClick={() => createEmptyChase()} />
      </header>
      <div role="listbox" aria-label={t('common.chases')} data-chase-list="" onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {chases.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuListMusic}
            title={t('scenes.chaseList.emptyTitle')}
            description={t('scenes.chaseList.emptyText')}
            action={<>
              <Button variant="primary" size="sm" onClick={onRecord}>{t('scenes.chaseList.recordChase')}</Button>
              <Button variant="ghost" size="sm" icon={LuPlus} onClick={() => createEmptyChase()}>{t('scenes.chaseList.emptyChase')}</Button>
            </>}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {chases.map((ch, i) => (
              <ChaseRow key={ch.id} chase={ch} number={i + 1} selected={ch.id === selectedId} onSelect={select} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

const ChaseRow = memo(function ChaseRow({ chase: ch, number, selected, onSelect }: {
  chase: Chase
  number: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const t = useT()
  const DirIcon = DIRECTION_ICONS[ch.direction] ?? LuArrowRight
  return (
    <div
      role="option"
      aria-selected={selected}
      data-chase-row={ch.id}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(ch.id)}
      onFocus={() => { if (!selected) onSelect(ch.id) }}
      className={cn(
        'relative flex min-h-[52px] cursor-pointer select-none items-center gap-2.5 overflow-hidden rounded-md border pl-3 pr-1.5 outline-offset-[-2px] transition-colors duration-fast',
        '[[data-density=touch]_&]:min-h-[64px]',
        selected ? 'border-info/60 bg-info/15' : cn('bg-surface-2 hover:bg-surface-3', ch.isPlaying ? 'border-go/40' : 'border-transparent')
      )}
    >
      <span
        className={cn(
          'flex h-7 min-w-7 shrink-0 items-center justify-center rounded px-1 font-mono text-xs font-semibold tabular',
          '[[data-density=touch]_&]:h-9 [[data-density=touch]_&]:min-w-9',
          ch.isPlaying ? 'bg-go text-on-go' : 'bg-surface-4 text-fg-secondary'
        )}
      >
        {number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-fg-primary">{ch.name || t('common.untitled')}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-tertiary">
          {ch.isPlaying
            ? <span className="font-mono tabular text-go-fg">{Math.min(ch.currentStepIndex, ch.steps.length - 1) + 1}/{ch.steps.length}</span>
            : <span className="truncate">{t('scenes.stepCount', { count: ch.steps.length })}</span>}
          <span aria-hidden>·</span>
          <span className="shrink-0 font-mono tabular">{formatBpm(ch.bpm)}</span>
          <DirIcon size={12} aria-label={t(`scenes.chase.directionTitle.${ch.direction}`)} className="shrink-0" />
        </span>
      </span>
      <IconButton
        icon={ch.isPlaying ? LuSquare : LuPlay}
        label={ch.isPlaying ? t('scenes.list.stopNamed', { name: ch.name }) : t('scenes.chaseList.playNamed', { name: ch.name })}
        size="sm"
        variant="secondary"
        active={ch.isPlaying}
        tone="go"
        disabled={ch.steps.length === 0}
        className={ch.isPlaying ? undefined : 'text-go-fg'}
        onClick={() => usePlaybackStore.getState().toggleChase(ch.id)}
      />
    </div>
  )
})

// ---------------------------------------------------------------
// Editor
// ---------------------------------------------------------------

function tapTempo(chaseId: string) {
  if (isRemoteMode()) sendRemoteCommand('tap-tempo', chaseId)
  else handleTapTempo(chaseId)
}

export function ChaseDetail({ chase: ch, number, selectedStepId, onSelectStep }: {
  chase: Chase
  number: number
  selectedStepId: string | null
  onSelectStep: (id: string | null) => void
}) {
  const t = useT()
  const pb = usePlaybackStore.getState
  const stepScope = useRef<HTMLDivElement>(null)
  const mapping = useMidiStore((s) => s.mappings.find((m) => m.target.type === 'chase_toggle' && m.target.id === ch.id))
  const learning = useMidiStore((s) => s.isLearning && s.learnTarget?.type === 'chase_toggle' && s.learnTarget.id === ch.id)
  const [tapFlash, setTapFlash] = useState(0)
  const selectedIndex = ch.steps.findIndex((s) => s.id === selectedStepId)
  const beat = 60 / (ch.bpm > 0 ? ch.bpm : 120)
  const selectedStep = selectedIndex >= 0 ? ch.steps[selectedIndex] : undefined

  // Delete / Mod+D in the step table: the selected step (else the chase)
  useSelectionActions(
    selectedStep ? stepSelectionActions(ch.id, selectedStep, selectedIndex, onSelectStep) : chaseSelectionActions(ch),
    { scope: stepScope }
  )

  const addStep = () => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning(t('scenes.record.nothing'), { description: t('scenes.record.nothingHint') })
      return
    }
    recordAddStep(ch.id, cap)
    const after = usePlaybackStore.getState().chases.find((c) => c.id === ch.id)
    const last = after?.steps[after.steps.length - 1]
    if (last) onSelectStep(last.id)
    toast.success(t('scenes.toast.stepAdded', { n: ch.steps.length + 1, name: ch.name }), { description: captureSummary(cap) })
  }

  const menu = (): MenuEntry[] => [
    { type: 'label', label: ch.name || translate('common.untitled') },
    { label: translate('common.renameEllipsis'), icon: LuPencil, shortcut: 'F2', onSelect: () => focusNameField(`chase:${ch.id}`) },
    { label: translate('scenes.chase.duplicate'), icon: LuCopy, shortcut: 'Mod+D', onSelect: () => { duplicateChase(ch) } },
    learning
      ? { label: translate('scenes.midi.cancelLearn'), icon: LuX, onSelect: () => useMidiStore.getState().cancelLearn() }
      : { label: mapping ? translate('scenes.midi.relearnChase') : translate('scenes.midi.learnChase'), icon: LuPiano, description: translate('scenes.midi.learnHint'), onSelect: () => useMidiStore.getState().startLearn({ type: 'chase_toggle', id: ch.id, label: ch.name }) },
    { type: 'separator' },
    { label: translate('scenes.chase.deleteEllipsis'), icon: LuTrash2, danger: true, shortcut: 'Backspace', onSelect: () => void deleteChase(ch) }
  ]

  return (
    <section aria-label={t('scenes.chase.aria', { name: ch.name })} data-chase-detail="" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5">
        <span className="shrink-0 font-mono text-xs tabular text-fg-tertiary">{t('scenes.chase.numberShort', { n: number })}</span>
        <input
          aria-label={t('scenes.chase.nameAria')}
          data-name-field={`chase:${ch.id}`}
          value={ch.name}
          placeholder={t('scenes.chase.namePlaceholder')}
          onChange={(e) => pb().updateChase(ch.id, { name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm min-w-0 max-w-[360px] flex-1 truncate rounded bg-transparent px-1.5 text-base font-semibold text-fg-primary outline-none placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {ch.isPlaying ? <Badge tone="go" variant="solid">{t('scenes.liveBadge')}</Badge> : <Badge>{t('scenes.chase.stopped')}</Badge>}
          {learning ? <Badge tone="midi" variant="solid" className="animate-pulse">{t('scenes.midi.learning')}</Badge> : mapping && <Badge tone="midi" mono>{formatMidiSource(mapping)}</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Visible (not only in the "…" menu): label from xl, icon + tooltip below */}
          <Button
            icon={LuCopy}
            aria-label={t('scenes.chase.duplicate')}
            tooltip={t('scenes.chase.duplicate')}
            shortcut="Mod+D"
            size="sm"
            variant="ghost"
            labelClassName="hidden xl:inline"
            className="max-xl:w-control-sm max-xl:px-0"
            data-chase-action="duplicate"
            onClick={() => { duplicateChase(ch) }}
          >
            {t('common.duplicate')}
          </Button>
          <Button
            icon={LuTrash2}
            aria-label={t('scenes.chase.delete')}
            tooltip={t('scenes.chase.delete')}
            shortcut="Backspace"
            size="sm"
            variant="ghost"
            labelClassName="hidden xl:inline"
            className="text-danger-fg hover:bg-danger/15 max-xl:w-control-sm max-xl:px-0"
            data-chase-action="delete"
            onClick={() => void deleteChase(ch)}
          >
            {t('common.delete')}
          </Button>
          <DropdownMenu placement="bottom-end" items={menu} trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={t('scenes.chase.actions')} size="sm" />} />
        </div>
      </header>

      {/* Playback */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-subtle px-3 py-3">
        <div className="flex items-center gap-2">
          {ch.isPlaying ? (
            <Button
              size="lg"
              icon={LuSquare}
              className="min-w-[120px] [[data-density=touch]_&]:min-w-[148px]"
              tooltip={t('scenes.chase.stopTooltip')}
              shortcut="Space"
              onClick={() => pb().toggleChase(ch.id, false)}
            >
              {t('common.stop')}
            </Button>
          ) : (
            <Button
              size="lg"
              variant="success"
              icon={LuPlay}
              disabled={ch.steps.length === 0}
              className="min-w-[120px] [[data-density=touch]_&]:min-w-[148px]"
              tooltip={t('scenes.chase.playTooltip')}
              shortcut="Space"
              onClick={() => pb().toggleChase(ch.id, true)}
            >
              {t('scenes.chase.play')}
            </Button>
          )}
          <Button
            size="lg"
            variant="outline"
            className={cn('min-w-[92px] transition-colors', tapFlash % 2 === 1 && '!bg-accent/20')}
            tooltip={t('scenes.chase.tapTooltip')}
            onPress={() => { tapTempo(ch.id); setTapFlash((n) => n + 1) }}
            onRelease={() => setTapFlash((n) => (n % 2 === 1 ? n + 1 : n))}
          >
            {t('scenes.chase.tap')}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <NumberField
            size="lg"
            className="w-[150px]"
            label={t('units.bpm')}
            value={Math.round(ch.bpm * 10) / 10}
            onChange={(v) => pb().setChaseBpm(ch.id, v)}
            min={1}
            max={999}
            step={1}
            precision={ch.bpm % 1 === 0 ? 0 : 1}
          />
          <span className="font-mono text-xs tabular text-fg-tertiary" title={t('scenes.chase.stepTimeTitle')}>{t('scenes.chase.perStep', { time: formatSeconds(beat) })}</span>
        </div>
        <div className="ml-auto flex min-w-[200px] max-w-[280px] flex-1 flex-col gap-1 [[data-density=touch]_&]:max-w-[320px]">
          <span className="flex items-baseline justify-between text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
            {t('scenes.level')}
            <span className="font-mono text-xs normal-case tabular tracking-normal text-fg-secondary">{formatPercent(ch.faderLevel)}</span>
          </span>
          <Slider aria-label={t('scenes.chase.levelAria')} value={ch.faderLevel} onChange={(v) => pb().setChaseFader(ch.id, v)} defaultValue={255} />
        </div>
      </div>

      {/* Settings */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle px-3 py-2.5">
        <SegmentedControl<Direction>
          size="sm"
          aria-label={t('scenes.chase.directionAria')}
          value={ch.direction}
          onChange={(d) => pb().updateChase(ch.id, { direction: d })}
          items={DIRECTION_ORDER.map((d) => directionItem(d, t))}
        />
        <NumberField size="sm" className="w-[132px]" label={t('scenes.chase.crossfade')} value={ch.fadePercent} onChange={(v) => pb().updateChase(ch.id, { fadePercent: v })} min={0} max={100} step={1} unit={t('units.percent')} />
        <NumberField size="sm" className="w-[104px]" label={t('scenes.priority')} value={ch.priority ?? 40} onChange={(v) => pb().updateChase(ch.id, { priority: v })} min={0} max={100} step={1} />
        <Switch checked={ch.isLooping} onChange={(v) => pb().updateChase(ch.id, { isLooping: v })} label={t('scenes.loop')} className="min-h-0 gap-2" />
      </div>

      {/* Steps toolbar */}
      <div className="flex h-control-lg shrink-0 items-center gap-1 border-b border-line px-3">
        <h3 className="text-sm font-semibold text-fg-primary">{t('common.steps')}</h3>
        <span className="text-xs tabular text-fg-tertiary">{ch.steps.length}</span>
        <div className="flex-1" />
        {selectedStep && (
          <>
            <IconButton icon={LuArrowUp} size="sm" label={t('scenes.steps.moveUp')} disabled={selectedIndex <= 0} onClick={() => pb().moveChaseStep(ch.id, selectedIndex, selectedIndex - 1)} />
            <IconButton icon={LuArrowDown} size="sm" label={t('scenes.steps.moveDown')} disabled={selectedIndex >= ch.steps.length - 1} onClick={() => pb().moveChaseStep(ch.id, selectedIndex, selectedIndex + 1)} />
            <IconButton
              icon={LuCopy}
              size="sm"
              label={t('scenes.steps.duplicate')}
              shortcut="Mod+D"
              data-step-action="duplicate"
              onClick={() => { const id = duplicateStep(ch.id, selectedStep, selectedIndex); if (id) onSelectStep(id) }}
            />
            <IconButton
              icon={LuTrash2}
              size="sm"
              label={t('scenes.steps.delete')}
              shortcut="Backspace"
              data-step-action="delete"
              className="hover:bg-danger/15 hover:text-danger-fg"
              onClick={() => void deleteStep(ch.id, selectedStep, selectedIndex, onSelectStep)}
            />
            <Button size="sm" variant="ghost" icon={LuRefreshCw} tooltip={t('scenes.steps.updateTooltip')} onClick={() => updateStepFromProgrammer(ch.id, selectedStep, selectedIndex, 'merge')}>{t('common.update')}</Button>
          </>
        )}
        <Button size="sm" variant="secondary" icon={LuCircleDot} className="text-accent-fg" tooltip={t('scenes.steps.addTooltip')} onClick={addStep}>{t('scenes.steps.add')}</Button>
      </div>

      <div data-reorder-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        {ch.steps.length === 0 ? (
          <EmptyState
            icon={LuListMusic}
            title={t('scenes.steps.emptyTitle')}
            description={t('scenes.steps.emptyText')}
            action={<Button variant="primary" icon={LuCircleDot} onClick={addStep}>{t('scenes.steps.recordFirst')}</Button>}
          />
        ) : (
          <div ref={stepScope} data-step-table="">
            <StepTable chase={ch} selectedStepId={selectedStepId} onSelectStep={onSelectStep} beat={beat} />
          </div>
        )}
      </div>
    </section>
  )
}

function updateStepFromProgrammer(chaseId: string, step: ChaseStep, index: number, mode: 'merge' | 'replace') {
  const cap = capture(true)
  if (cap.channelCount === 0) {
    toast.warning(translate('scenes.record.nothing'), { description: translate('scenes.record.nothingHint') })
    return
  }
  recordUpdateStep(chaseId, step.id, cap, mode)
  toast.success(translate(mode === 'merge' ? 'scenes.toast.stepUpdated' : 'scenes.toast.stepReplaced', { n: index + 1 }), { description: captureSummary(cap) })
}

// ---------------------------------------------------------------
// Steps
// ---------------------------------------------------------------

function StepTable({ chase: ch, selectedStepId, onSelectStep, beat }: {
  chase: Chase
  selectedStepId: string | null
  onSelectStep: (id: string) => void
  beat: number
}) {
  const t = useT()
  const { drag, handleProps } = useReorder((from, to) => usePlaybackStore.getState().moveChaseStep(ch.id, from, to))
  const patch = usePatchStore((s) => s.patch)
  const names = useMemo(() => new Map(patch.map((p) => [p.id, p.name])), [patch])
  const current = ch.isPlaying ? Math.min(ch.currentStepIndex, ch.steps.length - 1) : -1
  return (
    <Table className="table-fixed">
      <colgroup>
        <col className="w-8 [[data-density=touch]_&]:w-11" />
        <col className="w-[52px]" />
        <col />
        <col className="w-[150px]" />
        <col className="w-[150px] [[data-density=touch]_&]:w-[170px]" />
        <col className="w-10 [[data-density=touch]_&]:w-12" />
      </colgroup>
      <THead>
        <Tr>
          <Th className="px-0"><span className="sr-only">{t('scenes.table.reorder')}</span></Th>
          <Th className="pl-2">{t('common.step')}</Th>
          <Th className="pl-2">{t('scenes.steps.look')}</Th>
          <Th align="right" className="px-1.5">{t('scenes.steps.contents')}</Th>
          <Th className="px-1.5" title={t('scenes.steps.timeTitle')}>{t('scenes.steps.time')}</Th>
          <Th className="px-0"><span className="sr-only">{t('scenes.table.actions')}</span></Th>
        </Tr>
      </THead>
      <TBody>
        {ch.steps.map((step, i) => (
          <StepRow
            key={step.id}
            chaseId={ch.id}
            step={step}
            index={i}
            count={ch.steps.length}
            current={i === current}
            selected={step.id === selectedStepId}
            beat={beat}
            names={names}
            drag={drag}
            handleProps={handleProps}
            onSelect={onSelectStep}
          />
        ))}
      </TBody>
    </Table>
  )
}

const StepRow = memo(function StepRow({ chaseId, step, index, count, current, selected, beat, names, drag, handleProps, onSelect }: {
  chaseId: string
  step: ChaseStep
  index: number
  count: number
  current: boolean
  selected: boolean
  beat: number
  names: Map<string, string>
  drag: ReorderState | null
  handleProps: ReturnType<typeof useReorder>['handleProps']
  onSelect: (id: string) => void
}) {
  const t = useT()
  const swatches = useMemo(() => lookSwatches(step.values), [step.values])
  const fixtures = useMemo(() => countFixtures(step.values), [step.values])
  const hold = step.holdTime && step.holdTime > 0 ? step.holdTime : null
  const pb = usePlaybackStore.getState

  const menu = (): MenuEntry[] => [
    { type: 'label', label: translate('scenes.stepN', { n: index + 1 }) },
    { label: translate('scenes.update.fromProgrammer'), description: translate('scenes.update.mergeDescription'), icon: LuRefreshCw, onSelect: () => updateStepFromProgrammer(chaseId, step, index, 'merge') },
    { label: translate('scenes.update.replaceWithProgrammer'), description: translate('scenes.update.replaceStepDescription'), icon: LuReplace, onSelect: () => updateStepFromProgrammer(chaseId, step, index, 'replace') },
    { type: 'separator' },
    { label: translate('scenes.table.moveUp'), icon: LuArrowUp, disabled: index === 0, onSelect: () => pb().moveChaseStep(chaseId, index, index - 1) },
    { label: translate('scenes.table.moveDown'), icon: LuArrowDown, disabled: index >= count - 1, onSelect: () => pb().moveChaseStep(chaseId, index, index + 1) },
    { type: 'separator' },
    { label: translate('scenes.steps.duplicate'), icon: LuCopy, shortcut: 'Mod+D', onSelect: () => { const id = duplicateStep(chaseId, step, index); if (id) onSelect(id) } },
    { label: translate('scenes.steps.deleteEllipsis'), icon: LuTrash2, danger: true, shortcut: 'Backspace', onSelect: () => void deleteStep(chaseId, step, index) }
  ]

  return (
    <Tr
      data-reorder-index={index}
      selected={selected}
      data-step-row={step.id}
      onClick={() => onSelect(step.id)}
      className={cn(
        'cursor-default',
        current && !selected && 'bg-go/10 [&>td:first-child]:shadow-[inset_2px_0_0_rgb(var(--pb-go-fg))]',
        drag?.from === index && 'opacity-40',
        dropIndicator(drag, index)
      )}
    >
      <Td className="px-0">
        <button
          type="button"
          aria-label={t('scenes.steps.dragAria', { n: index + 1 })}
          title={t('scenes.table.dragTitle')}
          {...handleProps(index)}
          className="flex h-row w-full cursor-grab touch-none items-center justify-center text-fg-tertiary hover:text-fg-primary active:cursor-grabbing"
        >
          <LuGripVertical size={14} aria-hidden />
        </button>
      </Td>
      <Td className="pl-2 pr-1">
        <span className={cn('flex items-center gap-1 font-mono text-xs font-semibold tabular', current ? 'text-go-fg' : 'text-fg-primary')}>
          {current ? <LuPlay size={12} aria-label={t('common.playing')} className="fill-current" /> : <span className="w-3" />}
          {index + 1}
        </span>
      </Td>
      <Td className="pl-2 pr-1.5">
        <span className="flex min-w-0 items-center gap-1 overflow-hidden" title={swatches.length ? t('scenes.steps.lookTitle') : undefined}>
          {swatches.length === 0 ? (
            <span className="truncate text-xs text-fg-tertiary">{t('scenes.steps.noColour')}</span>
          ) : swatches.length <= 4 ? (
            swatches.map((s) => (
              <span key={s.id} className="flex min-w-0 shrink items-center gap-1.5 pr-2">
                <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-inset ring-line-strong [[data-density=touch]_&]:h-5 [[data-density=touch]_&]:w-5" style={{ backgroundColor: s.color }} />
                <span className="truncate text-xs text-fg-secondary">{names.get(s.id) ?? t('scenes.steps.unpatched')}</span>
              </span>
            ))
          ) : (
            swatches.slice(0, 24).map((s) => (
              <span
                key={s.id}
                aria-hidden
                title={names.get(s.id)}
                className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-inset ring-line-strong [[data-density=touch]_&]:h-5 [[data-density=touch]_&]:w-5"
                style={{ backgroundColor: s.color }}
              />
            ))
          )}
          {swatches.length > 24 && <span className="text-xs text-fg-tertiary">+{swatches.length - 24}</span>}
        </span>
      </Td>
      <Td mono align="right" className="px-1.5 text-fg-secondary">{t('scenes.programmer.counts', { fixtures, channels: step.values.length })}</Td>
      <Td className="px-1.5">
        {hold === null ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-fg-tertiary"
            tooltip={t('scenes.steps.beatTooltip')}
            onClick={(e) => { e.stopPropagation(); pb().updateChaseStep(chaseId, step.id, { holdTime: Math.max(0.1, Math.round(beat * 10) / 10) }) }}
          >
            <span className="truncate">{t('scenes.steps.oneBeat', { time: formatSeconds(beat) })}</span>
          </Button>
        ) : (
          <span className="flex items-center gap-0.5">
            <NumberField
              size="sm"
              className="min-w-0 flex-1"
              label={t('scenes.steps.hold')}
              value={hold}
              onChange={(v) => pb().updateChaseStep(chaseId, step.id, { holdTime: v })}
              min={0.1}
              max={600}
              step={0.1}
              unit={t('units.seconds')}
            />
            <IconButton icon={LuX} size="xs" label={t('scenes.steps.backToBeat')} onClick={(e) => { e.stopPropagation(); pb().updateChaseStep(chaseId, step.id, { holdTime: undefined }) }} />
          </span>
        )}
      </Td>
      <Td className="px-0 text-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu placement="bottom-end" items={menu} trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={t('scenes.steps.actionsAria', { n: index + 1 })} size="sm" />} />
      </Td>
    </Tr>
  )
})

/** Approximate colour of each fixture in a look (RGB/W/A × dimmer; dimmer-only = warm white) */
function lookSwatches(values: CueChannelValue[]): { id: string; color: string }[] {
  const byFixture = new Map<string, { r?: number; g?: number; b?: number; w?: number; a?: number; dim?: number }>()
  for (const v of values) {
    const name = v.channelName.toLowerCase()
    const f = byFixture.get(v.fixtureId) ?? {}
    if (name.includes('red')) f.r = v.value
    else if (name.includes('green')) f.g = v.value
    else if (name.includes('blue')) f.b = v.value
    else if (name.includes('white')) f.w = v.value
    else if (name.includes('amber')) f.a = v.value
    else if (name.includes('dimmer') || name.includes('intensity') || name === 'master') f.dim = v.value
    else continue
    byFixture.set(v.fixtureId, f)
  }
  const out: { id: string; color: string }[] = []
  for (const [id, f] of byFixture) {
    const hasColour = f.r !== undefined || f.g !== undefined || f.b !== undefined || f.w !== undefined || f.a !== undefined
    const dim = (f.dim ?? 255) / 255
    let r: number, g: number, b: number
    if (hasColour) {
      const w = f.w ?? 0
      const a = f.a ?? 0
      r = Math.min(255, (f.r ?? 0) + w + a)
      g = Math.min(255, (f.g ?? 0) + w + a * 0.6)
      b = Math.min(255, (f.b ?? 0) + w)
    } else {
      r = 255; g = 236; b = 200
    }
    out.push({ id, color: `rgb(${Math.round(r * dim)} ${Math.round(g * dim)} ${Math.round(b * dim)})` })
  }
  return out
}
