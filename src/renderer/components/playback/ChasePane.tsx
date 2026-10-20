// ============================================================
// Chases: list + editor (BPM with tap tempo, crossfade, direction,
// loop, priority, level) and a step editor (look preview, hold
// time, reorder, update from programmer).
// ============================================================

import { memo, useMemo, useState } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowLeft, LuArrowLeftRight, LuArrowRight, LuArrowUp, LuCircleDot, LuEllipsis, LuGripVertical, LuListMusic, LuPiano,
  LuPlay, LuPlus, LuRefreshCw, LuReplace, LuShuffle, LuSquare, LuTrash2, LuX
} from 'react-icons/lu'
import type { Chase, ChaseStep, CueChannelValue } from '@shared/types'
import {
  Badge, Button, DropdownMenu, EmptyState, IconButton, NumberField, SegmentedControl, Slider, Switch, TBody, THead, Table, Td, Th, Tr,
  cn, confirm, formatBpm, formatPercent, formatSeconds, toast, type MenuEntry
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { handleTapTempo } from '@renderer/lib/midi-manager'
import { isRemoteMode, sendRemoteCommand } from '@renderer/lib/runtime'
import { capture, countFixtures, createEmptyChase, recordAddStep, recordUpdateStep } from './record'
import { formatMidiSource } from './scene-meta'
import { dropIndicator, useReorder, type ReorderState } from './useReorder'

type Direction = Chase['direction']

const DIRECTIONS: { value: Direction; label: string; icon: typeof LuArrowRight; title: string }[] = [
  { value: 'forward', label: 'Fwd', icon: LuArrowRight, title: 'Forward: 1 → n' },
  { value: 'backward', label: 'Back', icon: LuArrowLeft, title: 'Backward: n → 1' },
  { value: 'bounce', label: 'Bounce', icon: LuArrowLeftRight, title: 'Bounce: 1 → n → 1' },
  { value: 'random', label: 'Random', icon: LuShuffle, title: 'Random step order' }
]

// ---------------------------------------------------------------
// List
// ---------------------------------------------------------------

export function ChaseList({ selectedId, onRecord }: { selectedId: string | null; onRecord: () => void }) {
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
    <section aria-label="Chases" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle pl-3 pr-1.5">
        <h2 className="text-sm font-semibold text-fg-primary">Chases</h2>
        <span className="text-xs tabular text-fg-tertiary">{chases.length}</span>
        {playing > 0 && <Badge tone="go" size="xs">{playing} LIVE</Badge>}
        <div className="flex-1" />
        <IconButton icon={LuPlus} label="New empty chase" size="sm" onClick={() => createEmptyChase()} />
      </header>
      <div role="listbox" aria-label="Chases" onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {chases.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuListMusic}
            title="No chases yet"
            description="A chase steps through looks to the beat. Record each look as a step."
            action={<>
              <Button variant="primary" size="sm" onClick={onRecord}>Record chase</Button>
              <Button variant="ghost" size="sm" icon={LuPlus} onClick={() => createEmptyChase()}>Empty chase</Button>
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
  const dir = DIRECTIONS.find((d) => d.value === ch.direction) ?? DIRECTIONS[0]
  const DirIcon = dir.icon
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
        <span className="truncate text-sm font-medium text-fg-primary">{ch.name || 'Untitled'}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-tertiary">
          {ch.isPlaying
            ? <span className="font-mono tabular text-go-fg">{Math.min(ch.currentStepIndex, ch.steps.length - 1) + 1}/{ch.steps.length}</span>
            : <span>{ch.steps.length} step{ch.steps.length === 1 ? '' : 's'}</span>}
          <span aria-hidden>·</span>
          <span className="font-mono tabular">{formatBpm(ch.bpm)}</span>
          <DirIcon size={12} aria-label={dir.title} className="shrink-0" />
        </span>
      </span>
      <IconButton
        icon={ch.isPlaying ? LuSquare : LuPlay}
        label={ch.isPlaying ? `Stop ${ch.name}` : `Play ${ch.name}`}
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
  const pb = usePlaybackStore.getState
  const mapping = useMidiStore((s) => s.mappings.find((m) => m.target.type === 'chase_toggle' && m.target.id === ch.id))
  const learning = useMidiStore((s) => s.isLearning && s.learnTarget?.type === 'chase_toggle' && s.learnTarget.id === ch.id)
  const [tapFlash, setTapFlash] = useState(0)
  const selectedIndex = ch.steps.findIndex((s) => s.id === selectedStepId)
  const beat = 60 / (ch.bpm > 0 ? ch.bpm : 120)

  const addStep = () => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning('Nothing to record', { description: 'Set levels in Fixtures (programmer) first.' })
      return
    }
    recordAddStep(ch.id, cap)
    const after = usePlaybackStore.getState().chases.find((c) => c.id === ch.id)
    const last = after?.steps[after.steps.length - 1]
    if (last) onSelectStep(last.id)
    toast.success(`Step ${ch.steps.length + 1} added to “${ch.name}”`, { description: `${cap.fixtureCount} fixtures · ${cap.channelCount} channels` })
  }

  const deleteChase = async () => {
    const ok = await confirm({
      title: `Delete chase “${ch.name}”?`,
      message: `Its ${ch.steps.length} step${ch.steps.length === 1 ? '' : 's'} are removed. This cannot be undone.`,
      confirmLabel: 'Delete chase',
      tone: 'danger'
    })
    if (!ok) return
    const list = pb().chases
    const at = list.findIndex((c) => c.id === ch.id)
    const neighbour = list[at + 1] ?? list[at - 1]
    pb().removeChase(ch.id)
    pb().selectChase(neighbour?.id ?? null)
  }

  const menu = (): MenuEntry[] => [
    { type: 'label', label: ch.name },
    learning
      ? { label: 'Cancel MIDI learn', icon: LuX, onSelect: () => useMidiStore.getState().cancelLearn() }
      : { label: mapping ? 'Re-learn MIDI start/stop…' : 'MIDI learn start/stop…', icon: LuPiano, description: 'Then press a MIDI key or pad', onSelect: () => useMidiStore.getState().startLearn({ type: 'chase_toggle', id: ch.id, label: ch.name }) },
    { type: 'separator' },
    { label: 'Delete chase…', icon: LuTrash2, danger: true, onSelect: () => void deleteChase() }
  ]

  return (
    <section aria-label={`Chase ${ch.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5">
        <span className="shrink-0 font-mono text-xs tabular text-fg-tertiary">C{number}</span>
        <input
          aria-label="Chase name"
          value={ch.name}
          placeholder="Untitled chase"
          onChange={(e) => pb().updateChase(ch.id, { name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm min-w-0 max-w-[360px] flex-1 truncate rounded bg-transparent px-1.5 text-base font-semibold text-fg-primary outline-none placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {ch.isPlaying ? <Badge tone="go" variant="solid">LIVE</Badge> : <Badge>Stopped</Badge>}
          {learning ? <Badge tone="midi" variant="solid" className="animate-pulse">MIDI learn…</Badge> : mapping && <Badge tone="midi" mono>{formatMidiSource(mapping)}</Badge>}
        </div>
        <DropdownMenu placement="bottom-end" items={menu} trigger={(p) => <IconButton {...p} icon={LuEllipsis} label="Chase actions" size="sm" />} />
      </header>

      {/* Playback */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-subtle px-3 py-3">
        <div className="flex items-center gap-2">
          {ch.isPlaying ? (
            <Button
              size="lg"
              icon={LuSquare}
              className="min-w-[120px] [[data-density=touch]_&]:min-w-[148px]"
              tooltip="Stop the chase"
              shortcut="Space"
              onClick={() => pb().toggleChase(ch.id, false)}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="lg"
              variant="success"
              icon={LuPlay}
              disabled={ch.steps.length === 0}
              className="min-w-[120px] [[data-density=touch]_&]:min-w-[148px]"
              tooltip="Start the chase"
              shortcut="Space"
              onClick={() => pb().toggleChase(ch.id, true)}
            >
              Play
            </Button>
          )}
          <Button
            size="lg"
            variant="outline"
            className={cn('min-w-[92px] transition-colors', tapFlash % 2 === 1 && '!bg-accent/20')}
            tooltip="Tap 2+ times to the beat"
            onPress={() => { tapTempo(ch.id); setTapFlash((n) => n + 1) }}
            onRelease={() => setTapFlash((n) => (n % 2 === 1 ? n + 1 : n))}
          >
            Tap
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <NumberField
            size="lg"
            className="w-[150px]"
            label="BPM"
            value={Math.round(ch.bpm * 10) / 10}
            onChange={(v) => pb().setChaseBpm(ch.id, v)}
            min={1}
            max={999}
            step={1}
            precision={ch.bpm % 1 === 0 ? 0 : 1}
          />
          <span className="font-mono text-xs tabular text-fg-tertiary" title="Step time at this tempo">{formatSeconds(beat)} / step</span>
        </div>
        <div className="ml-auto flex min-w-[200px] max-w-[280px] flex-1 flex-col gap-1 [[data-density=touch]_&]:max-w-[320px]">
          <span className="flex items-baseline justify-between text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
            Level
            <span className="font-mono text-xs normal-case tabular tracking-normal text-fg-secondary">{formatPercent(ch.faderLevel)}</span>
          </span>
          <Slider aria-label="Chase level" value={ch.faderLevel} onChange={(v) => pb().setChaseFader(ch.id, v)} defaultValue={255} />
        </div>
      </div>

      {/* Settings */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle px-3 py-2.5">
        <SegmentedControl<Direction>
          size="sm"
          aria-label="Direction"
          value={ch.direction}
          onChange={(d) => pb().updateChase(ch.id, { direction: d })}
          items={DIRECTIONS.map((d) => ({ value: d.value, label: d.label, icon: d.icon, title: d.title }))}
        />
        <NumberField size="sm" className="w-[132px]" label="Crossfade" value={ch.fadePercent} onChange={(v) => pb().updateChase(ch.id, { fadePercent: v })} min={0} max={100} step={1} unit="%" />
        <NumberField size="sm" className="w-[104px]" label="Priority" value={ch.priority ?? 40} onChange={(v) => pb().updateChase(ch.id, { priority: v })} min={0} max={100} step={1} />
        <Switch checked={ch.isLooping} onChange={(v) => pb().updateChase(ch.id, { isLooping: v })} label="Loop" className="min-h-0 gap-2" />
      </div>

      {/* Steps toolbar */}
      <div className="flex h-control-lg shrink-0 items-center gap-1 border-b border-line px-3">
        <h3 className="text-sm font-semibold text-fg-primary">Steps</h3>
        <span className="text-xs tabular text-fg-tertiary">{ch.steps.length}</span>
        <div className="flex-1" />
        {selectedIndex >= 0 && (
          <>
            <IconButton icon={LuArrowUp} size="sm" label="Move step up" disabled={selectedIndex <= 0} onClick={() => pb().moveChaseStep(ch.id, selectedIndex, selectedIndex - 1)} />
            <IconButton icon={LuArrowDown} size="sm" label="Move step down" disabled={selectedIndex >= ch.steps.length - 1} onClick={() => pb().moveChaseStep(ch.id, selectedIndex, selectedIndex + 1)} />
            <IconButton
              icon={LuTrash2}
              size="sm"
              label="Delete step"
              className="hover:!text-danger-fg"
              onClick={async () => { if (await deleteStep(ch.id, ch.steps[selectedIndex], selectedIndex)) onSelectStep(null) }}
            />
            <Button size="sm" variant="ghost" icon={LuRefreshCw} tooltip="Merge the programmer into the selected step" onClick={() => updateStepFromProgrammer(ch.id, ch.steps[selectedIndex], selectedIndex, 'merge')}>Update</Button>
          </>
        )}
        <Button size="sm" variant="secondary" icon={LuCircleDot} className="text-accent-fg" tooltip="Record the programmer as a new step at the end" onClick={addStep}>Add step</Button>
      </div>

      <div data-reorder-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        {ch.steps.length === 0 ? (
          <EmptyState
            icon={LuListMusic}
            title="No steps yet"
            description="Set a look in Fixtures and record it as step 1, then change the look and add the next step."
            action={<Button variant="primary" icon={LuCircleDot} onClick={addStep}>Record step 1</Button>}
          />
        ) : (
          <StepTable chase={ch} selectedStepId={selectedStepId} onSelectStep={onSelectStep} beat={beat} />
        )}
      </div>
    </section>
  )
}

function updateStepFromProgrammer(chaseId: string, step: ChaseStep, index: number, mode: 'merge' | 'replace') {
  const cap = capture(true)
  if (cap.channelCount === 0) {
    toast.warning('Nothing to record', { description: 'Set levels in Fixtures (programmer) first.' })
    return
  }
  recordUpdateStep(chaseId, step.id, cap, mode)
  toast.success(`Step ${index + 1} ${mode === 'merge' ? 'updated' : 'replaced'}`, { description: `${cap.fixtureCount} fixtures · ${cap.channelCount} channels` })
}

async function deleteStep(chaseId: string, step: ChaseStep, index: number): Promise<boolean> {
  const ok = await confirm({
    title: `Delete step ${index + 1}?`,
    message: `Its ${step.values.length} channel values are removed.`,
    confirmLabel: 'Delete step',
    tone: 'danger'
  })
  if (ok) usePlaybackStore.getState().removeChaseStep(chaseId, step.id)
  return ok
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
          <Th className="px-0"><span className="sr-only">Reorder</span></Th>
          <Th className="pl-2">Step</Th>
          <Th className="pl-2">Look</Th>
          <Th align="right" className="px-1.5">Contents</Th>
          <Th className="px-1.5" title="Step time: one beat at the chase tempo, or a fixed hold time">Time</Th>
          <Th className="px-0"><span className="sr-only">Actions</span></Th>
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
  const swatches = useMemo(() => lookSwatches(step.values), [step.values])
  const fixtures = useMemo(() => countFixtures(step.values), [step.values])
  const hold = step.holdTime && step.holdTime > 0 ? step.holdTime : null
  const pb = usePlaybackStore.getState

  const menu = (): MenuEntry[] => [
    { type: 'label', label: `Step ${index + 1}` },
    { label: 'Update from programmer', description: 'Merge: add / override channels', icon: LuRefreshCw, onSelect: () => updateStepFromProgrammer(chaseId, step, index, 'merge') },
    { label: 'Replace with programmer', description: 'The step keeps only the new values', icon: LuReplace, onSelect: () => updateStepFromProgrammer(chaseId, step, index, 'replace') },
    { type: 'separator' },
    { label: 'Move up', icon: LuArrowUp, disabled: index === 0, onSelect: () => pb().moveChaseStep(chaseId, index, index - 1) },
    { label: 'Move down', icon: LuArrowDown, disabled: index >= count - 1, onSelect: () => pb().moveChaseStep(chaseId, index, index + 1) },
    { type: 'separator' },
    { label: 'Delete step…', icon: LuTrash2, danger: true, onSelect: () => void deleteStep(chaseId, step, index) }
  ]

  return (
    <Tr
      data-reorder-index={index}
      selected={selected}
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
          aria-label={`Drag to reorder step ${index + 1}`}
          title="Drag to reorder"
          {...handleProps(index)}
          className="flex h-row w-full cursor-grab touch-none items-center justify-center text-fg-tertiary hover:text-fg-primary active:cursor-grabbing"
        >
          <LuGripVertical size={14} aria-hidden />
        </button>
      </Td>
      <Td className="pl-2 pr-1">
        <span className={cn('flex items-center gap-1 font-mono text-xs font-semibold tabular', current ? 'text-go-fg' : 'text-fg-primary')}>
          {current ? <LuPlay size={12} aria-label="Playing" className="fill-current" /> : <span className="w-3" />}
          {index + 1}
        </span>
      </Td>
      <Td className="pl-2 pr-1.5">
        <span className="flex min-w-0 items-center gap-1 overflow-hidden" title={swatches.length ? 'Approximate colour / level of each fixture' : undefined}>
          {swatches.length === 0 ? (
            <span className="text-xs text-fg-tertiary">No colour or level (position / beam only)</span>
          ) : swatches.length <= 4 ? (
            swatches.map((s) => (
              <span key={s.id} className="flex min-w-0 shrink items-center gap-1.5 pr-2">
                <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-inset ring-line-strong [[data-density=touch]_&]:h-5 [[data-density=touch]_&]:w-5" style={{ backgroundColor: s.color }} />
                <span className="truncate text-xs text-fg-secondary">{names.get(s.id) ?? 'Unpatched'}</span>
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
      <Td mono align="right" className="px-1.5 text-fg-secondary">{fixtures} fix · {step.values.length} ch</Td>
      <Td className="px-1.5">
        {hold === null ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-fg-tertiary"
            tooltip="One beat at the chase tempo. Click to hold this step for a fixed time."
            onClick={(e) => { e.stopPropagation(); pb().updateChaseStep(chaseId, step.id, { holdTime: Math.max(0.1, Math.round(beat * 10) / 10) }) }}
          >
            1 beat · {formatSeconds(beat)}
          </Button>
        ) : (
          <span className="flex items-center gap-0.5">
            <NumberField
              size="sm"
              className="min-w-0 flex-1"
              label="Hold"
              value={hold}
              onChange={(v) => pb().updateChaseStep(chaseId, step.id, { holdTime: v })}
              min={0.1}
              max={600}
              step={0.1}
              unit="s"
            />
            <IconButton icon={LuX} size="xs" label="Back to one beat" onClick={(e) => { e.stopPropagation(); pb().updateChaseStep(chaseId, step.id, { holdTime: undefined }) }} />
          </span>
        )}
      </Td>
      <Td className="px-0 text-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu placement="bottom-end" items={menu} trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={`Step ${index + 1} actions`} size="sm" />} />
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
