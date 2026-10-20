// ============================================================
// Cue list table of the selected scene: inline timing edits
// (NumberField, 0.1 s), pointer-drag reordering on the grip,
// current / next / selected cue states, row menu with GO-to-cue,
// update from programmer, move, duplicate, rename and delete.
// ============================================================

import { memo, useMemo } from 'react'
import {
  LuArrowDown, LuArrowUp, LuChevronRight, LuCopy, LuEllipsis, LuGripVertical, LuHand, LuPencil, LuPlay, LuRefreshCw, LuReplace, LuTimer, LuTrash2, LuX
} from 'react-icons/lu'
import type { Cue, Cuelist } from '@shared/types'
import {
  Button, DropdownMenu, IconButton, NumberField, TBody, THead, Table, Td, Th, Tr, cn, toast, type MenuEntry
} from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { isRemoteMode } from '@renderer/lib/runtime'
import { trackedCounts } from './scene-meta'
import { capture, captureSummary, recordUpdateCue } from './record'
import { deleteCue, duplicateCue, focusNameField, formatCueNumber } from './actions'
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
  const t = useT()
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
          <Th className="px-0"><span className="sr-only">{t('scenes.table.reorder')}</span></Th>
          <Th className="pl-2">{t('common.cue')}</Th>
          <Th className="pl-2">{t('common.name')}</Th>
          <Th align="right" className="truncate px-1.5" title={t('scenes.cues.fadeInTitle')}>{t('scenes.cues.fadeIn')}</Th>
          <Th align="right" className="truncate px-1.5" title={t('scenes.cues.fadeOutTitle')}>{t('scenes.cues.fadeOut')}</Th>
          {columns.delay && <Th align="right" className="truncate px-1.5" title={t('scenes.cues.delayTitle')}>{t('scenes.cues.delay')}</Th>}
          <Th className="truncate px-1.5" title={t('scenes.cues.followTitle')}>{t('scenes.cues.follow')}</Th>
          <Th align="right" className="px-1.5" title={t('scenes.cues.channelsTitle')}>{t('scenes.cues.channelsShort')}</Th>
          {columns.tracked && <Th align="right" className="truncate px-1.5" title={t('scenes.cues.trackedTitle')}>{t('scenes.cues.tracked')}</Th>}
          <Th className="px-0"><span className="sr-only">{t('scenes.table.actions')}</span></Th>
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
  const t = useT()
  const update = (u: Partial<Cue>) => usePlaybackStore.getState().updateCue(cuelistId, cue.id, u)
  const dragging = drag?.from === index
  const number = formatCueNumber(cue.number)

  return (
    <Tr
      data-reorder-index={index}
      selected={selected}
      data-cue-row={cue.id}
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
          aria-label={t('scenes.cues.dragAria', { number })}
          title={t('scenes.table.dragTitle')}
          {...handleProps(index)}
          className="flex h-row w-full cursor-grab touch-none items-center justify-center text-fg-tertiary hover:text-fg-primary active:cursor-grabbing"
        >
          <LuGripVertical size={14} aria-hidden />
        </button>
      </Td>
      <Td className="pl-2 pr-1">
        <span className="flex items-center gap-1">
          {current ? (
            <LuPlay size={12} aria-label={t('scenes.cues.onStage')} className="shrink-0 fill-current text-go-fg" />
          ) : next ? (
            <LuChevronRight size={12} aria-label={t('scenes.onStage.next')} className="shrink-0 text-accent-fg" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={cn('font-mono text-xs font-semibold tabular', current ? 'text-go-fg' : 'text-fg-primary')}>{number}</span>
        </span>
      </Td>
      <Td className="pl-2 pr-1.5">
        <input
          aria-label={t('scenes.cues.nameAria', { number })}
          data-name-field={`cue:${cue.id}`}
          value={cue.name}
          placeholder={t('common.untitled')}
          onChange={(e) => update({ name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm w-full min-w-0 rounded bg-transparent px-1.5 text-sm text-fg-primary outline-none ring-inset placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
      </Td>
      <Td className="px-1.5">
        <NumberField size="sm" value={cue.fadeIn} onChange={(v) => update({ fadeIn: v })} min={0} max={MAX_TIME} step={0.1} unit={t('units.seconds')} aria-label={t('scenes.cues.fadeInAria', { number })} />
      </Td>
      <Td className="px-1.5">
        <NumberField size="sm" value={cue.fadeOut} onChange={(v) => update({ fadeOut: v })} min={0} max={MAX_TIME} step={0.1} unit={t('units.seconds')} aria-label={t('scenes.cues.fadeOutAria', { number })} />
      </Td>
      {columns.delay && (
        <Td className="px-1.5">
          <NumberField size="sm" value={cue.delay} onChange={(v) => update({ delay: v })} min={0} max={MAX_TIME} step={0.1} unit={t('units.seconds')} aria-label={t('scenes.cues.delayAria', { number })} />
        </Td>
      )}
      <Td className="px-1.5">
        {cue.followTime === null ? (
          <Button
            variant="ghost"
            size="sm"
            icon={LuHand}
            className="w-full justify-start text-fg-tertiary"
            tooltip={t('scenes.cues.manualTooltip')}
            onClick={(e) => { e.stopPropagation(); update({ followTime: 0 }) }}
          >
            <span className="truncate">{t('scenes.cues.manual')}</span>
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
              unit={t('units.seconds')}
              label={undefined}
              aria-label={t('scenes.cues.followAria', { number })}
            />
            <IconButton icon={LuX} size="xs" label={t('scenes.cues.backToManual')} onClick={(e) => { e.stopPropagation(); update({ followTime: null }) }} />
          </span>
        )}
      </Td>
      <Td mono align="right" className="px-1.5 text-fg-secondary">{cue.values.length}</Td>
      {columns.tracked && <Td mono align="right" muted className="px-1.5">{tracked}</Td>}
      <Td className="px-0 text-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          placement="bottom-end"
          items={() => cueMenu(cuelistId, cue, index, count, onSelect)}
          trigger={(p) => <IconButton {...p} icon={LuEllipsis} label={t('scenes.cues.actionsAria', { number })} size="sm" />}
        />
      </Td>
    </Tr>
  )
})

/** Row "…" menu — built when it opens (current language) */
function cueMenu(cuelistId: string, cue: Cue, index: number, count: number, onSelect: (id: string) => void): MenuEntry[] {
  const pb = usePlaybackStore.getState
  const number = formatCueNumber(cue.number)
  const fromProgrammer = (mode: 'merge' | 'replace') => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning(t('scenes.record.nothing'), { description: t('scenes.record.nothingHint') })
      return
    }
    recordUpdateCue(cuelistId, cue.id, cap, mode)
    toast.success(t(mode === 'merge' ? 'scenes.toast.cueUpdated' : 'scenes.toast.cueReplaced', { number }), { description: captureSummary(cap) })
  }
  return [
    { type: 'label', label: cue.name ? t('scenes.cues.menuTitleNamed', { number, name: cue.name }) : t('scenes.cueN', { number }) },
    ...(isRemoteMode() ? [] : [{ label: t('scenes.cues.goTo'), icon: LuPlay, onSelect: () => pb().goToCue(cuelistId, index) } satisfies MenuEntry]),
    { type: 'separator' },
    { label: t('scenes.update.fromProgrammer'), description: t('scenes.update.mergeDescription'), icon: LuRefreshCw, onSelect: () => fromProgrammer('merge') },
    { label: t('scenes.update.replaceWithProgrammer'), description: t('scenes.update.replaceCueDescription'), icon: LuReplace, onSelect: () => fromProgrammer('replace') },
    { type: 'separator' },
    { label: t('scenes.cues.autoFollow'), icon: LuTimer, checked: cue.followTime !== null, onSelect: () => pb().updateCue(cuelistId, cue.id, { followTime: cue.followTime === null ? 0 : null }) },
    { label: t('scenes.table.moveUp'), icon: LuArrowUp, disabled: index === 0, onSelect: () => pb().moveCue(cuelistId, index, index - 1) },
    { label: t('scenes.table.moveDown'), icon: LuArrowDown, disabled: index >= count - 1, onSelect: () => pb().moveCue(cuelistId, index, index + 1) },
    { type: 'separator' },
    { label: t('common.renameEllipsis'), icon: LuPencil, shortcut: 'F2', onSelect: () => { onSelect(cue.id); focusNameField(`cue:${cue.id}`) } },
    { label: t('scenes.cues.duplicate'), icon: LuCopy, shortcut: 'Mod+D', onSelect: () => { const id = duplicateCue(cuelistId, cue); if (id) onSelect(id) } },
    { label: t('scenes.cues.deleteEllipsis'), icon: LuTrash2, danger: true, shortcut: 'Backspace', onSelect: () => void deleteCue(cuelistId, cue) }
  ]
}

