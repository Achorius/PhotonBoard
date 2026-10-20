// ============================================================
// Cue list table of the selected scene: inline timing edits
// (NumberField, 0.1 s), pointer-drag reordering on the grip,
// current / next / selected cue states, row menu with GO-to-cue,
// update from programmer, move and delete.
// ============================================================

import { memo, useMemo } from 'react'
import { LuArrowDown, LuArrowUp, LuChevronRight, LuEllipsis, LuGripVertical, LuHand, LuPlay, LuRefreshCw, LuReplace, LuTimer, LuTrash2, LuX } from 'react-icons/lu'
import type { Cue, Cuelist } from '@shared/types'
import {
  Button, DropdownMenu, IconButton, NumberField, TBody, THead, Table, Td, Th, Tr, cn, confirm, toast, type MenuEntry
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { isRemoteMode } from '@renderer/lib/runtime'
import { trackedCounts } from './scene-meta'
import { capture, recordUpdateCue } from './record'
import { dropIndicator, useReorder, type ReorderState } from './useReorder'

const MAX_TIME = 600

export interface CueColumns {
  delay: boolean
  tracked: boolean
}

export function CueTable({ cuelist: cl, selectedCueId, onSelectCue, columns }: {
  cuelist: Cuelist
  selectedCueId: string | null
  onSelectCue: (id: string) => void
  columns: CueColumns
}) {
  const tracked = useMemo(() => trackedCounts(cl.cues), [cl.cues])
  const { drag, handleProps } = useReorder((from, to) => usePlaybackStore.getState().moveCue(cl.id, from, to))
  const next = cl.isPlaying
    ? (cl.currentCueIndex + 1 < cl.cues.length ? cl.currentCueIndex + 1 : cl.isLooping ? 0 : -1)
    : 0

  return (
    <Table className="table-fixed">
      <colgroup>
        <col className="w-8 [[data-density=touch]_&]:w-11" />
        <col className="w-[60px]" />
        <col />
        <col className="w-[92px] [[data-density=touch]_&]:w-[104px]" />
        <col className="w-[92px] [[data-density=touch]_&]:w-[104px]" />
        {columns.delay && <col className="w-[92px] [[data-density=touch]_&]:w-[104px]" />}
        <col className="w-[124px] [[data-density=touch]_&]:w-[150px]" />
        <col className="w-[52px]" />
        {columns.tracked && <col className="w-[64px]" />}
        <col className="w-10 [[data-density=touch]_&]:w-12" />
      </colgroup>
      <THead>
        <Tr>
          <Th className="px-0"><span className="sr-only">Reorder</span></Th>
          <Th className="pl-2">Cue</Th>
          <Th className="pl-2">Name</Th>
          <Th align="right" className="px-1.5" title="Fade in: intensity going up and every other attribute">Fade in</Th>
          <Th align="right" className="px-1.5" title="Fade out: intensity going down">Fade out</Th>
          {columns.delay && <Th align="right" className="px-1.5" title="Wait before the fade starts">Delay</Th>}
          <Th className="px-1.5" title="Auto-follow: the next cue starts this long after this cue's fade ends">Follow</Th>
          <Th align="right" className="px-1.5" title="Channels stored in this cue">Ch</Th>
          {columns.tracked && <Th align="right" className="px-1.5" title="Channels on stage with tracking (this cue and the cues before it)">Tracked</Th>}
          <Th className="px-0"><span className="sr-only">Actions</span></Th>
        </Tr>
      </THead>
      <TBody>
        {cl.cues.map((cue, i) => (
          <CueRow
            key={cue.id}
            cuelistId={cl.id}
            cue={cue}
            index={i}
            count={cl.cues.length}
            current={cl.isPlaying && i === cl.currentCueIndex}
            next={i === next && cl.cues.length > 1}
            selected={cue.id === selectedCueId}
            tracked={tracked[i]}
            columns={columns}
            drag={drag}
            handleProps={handleProps}
            onSelect={onSelectCue}
          />
        ))}
      </TBody>
    </Table>
  )
}

const CueRow = memo(function CueRow({ cuelistId, cue, index, count, current, next, selected, tracked, columns, drag, handleProps, onSelect }: {
  cuelistId: string
  cue: Cue
  index: number
  count: number
  current: boolean
  next: boolean
  selected: boolean
  tracked: number
  columns: CueColumns
  drag: ReorderState | null
  handleProps: ReturnType<typeof useReorder>['handleProps']
  onSelect: (id: string) => void
}) {
  const update = (u: Partial<Cue>) => usePlaybackStore.getState().updateCue(cuelistId, cue.id, u)
  const dragging = drag?.from === index

  return (
    <Tr
      data-reorder-index={index}
      selected={selected}
      onClick={() => onSelect(cue.id)}
      className={cn(
        'cursor-default',
        current && !selected && 'bg-go/10 [&>td:first-child]:shadow-[inset_2px_0_0_rgb(var(--pb-go-fg))]',
        dragging && 'opacity-40',
        dropIndicator(drag, index)
      )}
    >
      <Td className="px-0">
        <button
          type="button"
          aria-label={`Drag to reorder cue ${cue.number}`}
          title="Drag to reorder"
          {...handleProps(index)}
          className="flex h-row w-full cursor-grab touch-none items-center justify-center text-fg-tertiary hover:text-fg-primary active:cursor-grabbing"
        >
          <LuGripVertical size={14} aria-hidden />
        </button>
      </Td>
      <Td className="pl-2 pr-1">
        <span className="flex items-center gap-1">
          {current ? (
            <LuPlay size={12} aria-label="On stage" className="shrink-0 fill-current text-go-fg" />
          ) : next ? (
            <LuChevronRight size={12} aria-label="Next" className="shrink-0 text-accent-fg" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={cn('font-mono text-xs font-semibold tabular', current ? 'text-go-fg' : 'text-fg-primary')}>{formatCueNumber(cue.number)}</span>
        </span>
      </Td>
      <Td className="pl-2 pr-1.5">
        <input
          aria-label={`Cue ${cue.number} name`}
          value={cue.name}
          placeholder="Untitled"
          onChange={(e) => update({ name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm w-full min-w-0 rounded bg-transparent px-1.5 text-sm text-fg-primary outline-none ring-inset placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
      </Td>
      <Td className="px-1.5">
        <NumberField size="sm" value={cue.fadeIn} onChange={(v) => update({ fadeIn: v })} min={0} max={MAX_TIME} step={0.1} unit="s" aria-label={`Cue ${cue.number} fade in`} />
      </Td>
      <Td className="px-1.5">
        <NumberField size="sm" value={cue.fadeOut} onChange={(v) => update({ fadeOut: v })} min={0} max={MAX_TIME} step={0.1} unit="s" aria-label={`Cue ${cue.number} fade out`} />
      </Td>
      {columns.delay && (
        <Td className="px-1.5">
          <NumberField size="sm" value={cue.delay} onChange={(v) => update({ delay: v })} min={0} max={MAX_TIME} step={0.1} unit="s" aria-label={`Cue ${cue.number} delay`} />
        </Td>
      )}
      <Td className="px-1.5">
        {cue.followTime === null ? (
          <Button
            variant="ghost"
            size="sm"
            icon={LuHand}
            className="w-full justify-start text-fg-tertiary"
            tooltip="Manual: waits for GO. Click for auto-follow."
            onClick={(e) => { e.stopPropagation(); update({ followTime: 0 }) }}
          >
            Manual
          </Button>
        ) : (
          <span className="flex items-center gap-0.5">
            <NumberField
              size="sm"
              className="min-w-0 flex-1"
              value={cue.followTime}
              onChange={(v) => update({ followTime: v })}
              min={0}
              max={MAX_TIME}
              step={0.1}
              unit="s"
              label={undefined}
              aria-label={`Cue ${cue.number} auto-follow time`}
            />
            <IconButton icon={LuX} size="xs" label="Back to manual GO" onClick={(e) => { e.stopPropagation(); update({ followTime: null }) }} />
          </span>
        )}
      </Td>
      <Td mono align="right" className="px-1.5 text-fg-secondary">{cue.values.length}</Td>
      {columns.tracked && <Td mono align="right" muted className="px-1.5">{tracked}</Td>}
      <Td className="px-0 text-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          placement="bottom-end"
          items={() => cueMenu(cuelistId, cue, index, count)}
          trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={`Cue ${cue.number} actions`} size="sm" />}
        />
      </Td>
    </Tr>
  )
})

/** 1 → "1", 2.5 → "2.5", 1.25 → "1.25" */
export function formatCueNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

function cueMenu(cuelistId: string, cue: Cue, index: number, count: number): MenuEntry[] {
  const pb = usePlaybackStore.getState
  const fromProgrammer = (mode: 'merge' | 'replace') => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning('Nothing to record', { description: 'Set levels in Fixtures first.' })
      return
    }
    recordUpdateCue(cuelistId, cue.id, cap, mode)
    toast.success(`Cue ${formatCueNumber(cue.number)} ${mode === 'merge' ? 'updated' : 'replaced'}`, { description: `${cap.fixtureCount} fixtures · ${cap.channelCount} channels` })
  }
  return [
    { type: 'label', label: `Cue ${formatCueNumber(cue.number)}${cue.name ? ` · ${cue.name}` : ''}` },
    ...(isRemoteMode() ? [] : [{ label: 'GO to this cue', icon: LuPlay, onSelect: () => pb().goToCue(cuelistId, index) } satisfies MenuEntry]),
    { type: 'separator' },
    { label: 'Update from programmer', description: 'Merge: add / override channels', icon: LuRefreshCw, onSelect: () => fromProgrammer('merge') },
    { label: 'Replace with programmer', description: 'The cue keeps only the new values', icon: LuReplace, onSelect: () => fromProgrammer('replace') },
    { type: 'separator' },
    { label: 'Auto-follow', icon: LuTimer, checked: cue.followTime !== null, onSelect: () => pb().updateCue(cuelistId, cue.id, { followTime: cue.followTime === null ? 0 : null }) },
    { label: 'Move up', icon: LuArrowUp, disabled: index === 0, onSelect: () => pb().moveCue(cuelistId, index, index - 1) },
    { label: 'Move down', icon: LuArrowDown, disabled: index >= count - 1, onSelect: () => pb().moveCue(cuelistId, index, index + 1) },
    { type: 'separator' },
    { label: 'Delete cue…', icon: LuTrash2, danger: true, onSelect: () => void deleteCue(cuelistId, cue) }
  ]
}

export async function deleteCue(cuelistId: string, cue: Cue): Promise<boolean> {
  const ok = await confirm({
    title: `Delete cue ${formatCueNumber(cue.number)}${cue.name ? ` “${cue.name}”` : ''}?`,
    message: `Its ${cue.values.length} channel values are removed. Cues after it may change on stage (tracking).`,
    confirmLabel: 'Delete cue',
    tone: 'danger'
  })
  if (ok) usePlaybackStore.getState().removeCue(cuelistId, cue.id)
  return ok
}
