// ============================================================
// Cue list table of the selected scene: inline timing edits
// (NumberField, 0.1 s), pointer-drag reordering on the grip,
// current / next / selected cue states, row menu with GO-to-cue,
// update from programmer, move, duplicate, rename and delete.
// Pro view: optional advanced columns (per-feature timing, parts,
// follow trigger, presets); the simple view shows a passive "P"
// badge on cues holding such data.
// ============================================================

import { memo, useMemo } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowUp, LuChevronRight, LuCopy, LuEllipsis, LuEraser, LuGripVertical, LuHand, LuPencil, LuPlay, LuRefreshCw, LuRefreshCwOff, LuReplace, LuTimer, LuTrash2, LuX
} from 'react-icons/lu'
import type { Cue, Cuelist } from '@shared/types'
import {
  Badge, Button, DropdownMenu, IconButton, NumberField, TBody, THead, Table, Td, Th, Tr, cn, toast, useDensity, type MenuEntry
} from '@renderer/components/ui'
import { formatList, t, useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { isRemoteMode } from '@renderer/lib/runtime'
import { trackedCounts } from './scene-meta'
import { capture, captureSummary, recordUpdateCue } from './record'
import { deleteCue, duplicateCue, focusNameField, formatCueNumber } from './actions'
import { dropIndicator, useReorder, type ReorderState } from './useReorder'
import { cueProInfo, hasProData, presetNames } from './pro-cue'
import { storeIntoExistingCue } from './store-modes'
import { featureLabel } from './feature-label'

const MAX_TIME = 600

export interface CueColumns {
  delay: boolean
  tracked: boolean
  /** Pro view: per-feature timing summary */
  featureTiming?: boolean
  /** Pro view: number of cue parts */
  parts?: boolean
  /** Pro view: follow counts after the fade / after the GO */
  trigger?: boolean
  /** Pro view: "P" badge on cues using presets */
  presets?: boolean
}

export function CueTable({ cuelist: cl, selectedCueId, onSelectCue, columns, proMode = false, onEditTiming }: {
  cuelist: Cuelist
  selectedCueId: string | null
  onSelectCue: (id: string) => void
  columns: CueColumns
  /** Pro view (advanced columns); off = passive "P" hints only */
  proMode?: boolean
  /** Open the cue timing editor on this cue (Pro) */
  onEditTiming?: (cueId: string) => void
}) {
  const t = useT()
  const tracked = useMemo(() => trackedCounts(cl.cues), [cl.cues])
  const { drag, handleProps } = useReorder((from, to) => usePlaybackStore.getState().moveCue(cl.id, from, to))
  const next = cl.isPlaying
    ? (cl.currentCueIndex + 1 < cl.cues.length ? cl.currentCueIndex + 1 : cl.isLooping ? 0 : -1)
    : 0

  // Pro: fixed columns + a readable name column; below that the table scrolls sideways
  const touch = useDensity() === 'touch'
  const minWidth = proMode
    ? (touch ? 562 : 492) + 120 + (columns.delay ? (touch ? 104 : 92) : 0) + (columns.tracked ? 64 : 0) +
      (columns.featureTiming ? (touch ? 150 : 120) : 0) + (columns.parts ? 84 : 0) + (columns.trigger ? (touch ? 96 : 84) : 0) + (columns.presets ? 44 : 0)
    : undefined

  return (
    <Table className="table-fixed" style={minWidth ? { minWidth } : undefined}>
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
        {proMode && columns.featureTiming && <col className="w-[120px] [[data-density=touch]_&]:w-[150px]" />}
        {proMode && columns.parts && <col className="w-[84px]" />}
        {proMode && columns.trigger && <col className="w-[84px] [[data-density=touch]_&]:w-[96px]" />}
        {proMode && columns.presets && <col className="w-[44px]" />}
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
          {proMode && columns.featureTiming && <Th className="truncate px-1.5" title={t('pro.scenes.columns.featureTiming')}>{t('pro.scenes.columns.featureTimingShort')}</Th>}
          {proMode && columns.parts && <Th className="truncate px-1.5" title={t('pro.scenes.columns.parts')}>{t('pro.scenes.columns.partsShort')}</Th>}
          {proMode && columns.trigger && <Th className="truncate px-1.5" title={t('pro.scenes.trigger.hint')}>{t('pro.scenes.columns.triggerShort')}</Th>}
          {proMode && columns.presets && <Th align="center" className="truncate px-1" title={t('pro.scenes.columns.presets')}>{t('pro.scenes.columns.presetsShort')}</Th>}
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
            proMode={proMode}
            drag={drag}
            handleProps={handleProps}
            onSelect={onSelectCue}
            onEditTiming={onEditTiming}
          />
        ))}
      </TBody>
    </Table>
  )
}

const CueRow = memo(function CueRow({ cuelistId, cue, index, count, current, next, selected, tracked, columns, proMode, drag, handleProps, onSelect, onEditTiming }: {
  cuelistId: string
  cue: Cue
  index: number
  count: number
  current: boolean
  next: boolean
  selected: boolean
  tracked: number
  columns: CueColumns
  proMode: boolean
  drag: ReorderState | null
  handleProps: ReturnType<typeof useReorder>['handleProps']
  onSelect: (id: string) => void
  onEditTiming?: (cueId: string) => void
}) {
  const t = useT()
  const update = (u: Partial<Cue>) => usePlaybackStore.getState().updateCue(cuelistId, cue.id, u)
  const dragging = drag?.from === index
  const number = formatCueNumber(cue.number)
  const pro = useMemo(() => cueProInfo(cue), [cue])
  const editTiming = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(cue.id)
    onEditTiming?.(cue.id)
  }

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
        <span className="flex min-w-0 items-center gap-1">
        <input
          aria-label={t('scenes.cues.nameAria', { number })}
          data-name-field={`cue:${cue.id}`}
          value={cue.name}
          placeholder={t('common.untitled')}
          onChange={(e) => update({ name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm w-full min-w-0 flex-1 rounded bg-transparent px-1.5 text-sm text-fg-primary outline-none ring-inset placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
        {!proMode && hasProData(pro) && (
          <span data-cue-pro-badge="" className="shrink-0">
            <Badge size="xs" mono title={t('pro.scenes.proBadgeTitle')}>{t('pro.scenes.proBadge')}</Badge>
          </span>
        )}
        </span>
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
      {proMode && columns.featureTiming && (
        <Td className="px-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full justify-start px-1.5', pro.timedFeatures.length === 0 && 'text-fg-tertiary')}
            tooltip={t('pro.scenes.featureTimingTitle', { number })}
            data-cue-feature-timing=""
            onClick={editTiming}
          >
            <span className="truncate">{pro.timedFeatures.length > 0 ? formatList(pro.timedFeatures.map(featureLabel)) : t('pro.scenes.featureTimingNone')}</span>
          </Button>
        </Td>
      )}
      {proMode && columns.parts && (
        <Td className="px-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('w-full justify-start px-1.5', pro.parts === 0 && 'text-fg-tertiary')}
            tooltip={t('pro.scenes.featureTimingTitle', { number })}
            onClick={editTiming}
          >
            <span className="truncate">{t('pro.scenes.partsCount', { count: pro.parts })}</span>
          </Button>
        </Td>
      )}
      {proMode && columns.trigger && (
        <Td className="px-1">
          {cue.followTime === null ? (
            <span className="block truncate px-1.5 text-xs text-fg-tertiary" title={t('pro.scenes.trigger.manual')}>—</span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className={cn('w-full justify-start px-1.5 font-mono', pro.followAfterGo ? 'text-go-fg' : 'text-fg-secondary')}
              tooltip={t('pro.scenes.trigger.hint')}
              aria-label={t('pro.scenes.trigger.aria', { number })}
              data-cue-trigger={pro.followAfterGo ? 'after-go' : 'after-fade'}
              onClick={(e) => { e.stopPropagation(); update({ followMode: pro.followAfterGo ? undefined : 'after-go' }) }}
            >
              <span className="truncate">{pro.followAfterGo ? t('pro.scenes.trigger.afterGoShort') : t('pro.scenes.trigger.afterFadeShort')}</span>
            </Button>
          )}
        </Td>
      )}
      {proMode && columns.presets && (
        <Td align="center" className="px-1">
          {pro.presetIds.length > 0 ? <PresetBadge ids={pro.presetIds} /> : null}
        </Td>
      )}
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

/** "P" (+ count) on a cue using presets; tooltip = their names */
function PresetBadge({ ids }: { ids: string[] }) {
  const t = useT()
  const presets = usePlaybackStore((s) => s.presets)
  const names = useMemo(() => presetNames(ids, presets), [ids, presets])
  const title = names.length > 0
    ? t('pro.scenes.presetsTitle', { count: names.length, names: names.length > 4 ? `${names.slice(0, 4).join(', ')}…` : formatList(names) })
    : t('pro.scenes.presetsNone')
  return (
    <span data-cue-presets={ids.length} className="inline-flex">
      <Badge size="xs" tone="accent" mono title={title}>{ids.length > 1 ? `${t('pro.scenes.proBadge')}${ids.length}` : t('pro.scenes.proBadge')}</Badge>
    </span>
  )
}

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
  // Pro store modes (lib/pro/store-ops)
  const storeMode = (mode: 'remove' | 'cueonly') => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning(t('scenes.record.nothing'), { description: t('scenes.record.nothingHint') })
      return
    }
    const message = mode === 'remove'
      ? t('pro.scenes.record.toastRemoved', { number, count: cap.channelCount })
      : t('scenes.toast.cueUpdated', { number })
    storeIntoExistingCue(cuelistId, cue.id, cap.values, { mode }, message)
    toast.success(message, { description: captureSummary(cap) })
  }
  return [
    { type: 'label', label: cue.name ? t('scenes.cues.menuTitleNamed', { number, name: cue.name }) : t('scenes.cueN', { number }) },
    ...(isRemoteMode() ? [] : [{ label: t('scenes.cues.goTo'), icon: LuPlay, onSelect: () => pb().goToCue(cuelistId, index) } satisfies MenuEntry]),
    { type: 'separator' },
    { label: t('scenes.update.fromProgrammer'), description: t('scenes.update.mergeDescription'), icon: LuRefreshCw, onSelect: () => fromProgrammer('merge') },
    { label: t('scenes.update.replaceWithProgrammer'), description: t('scenes.update.replaceCueDescription'), icon: LuReplace, onSelect: () => fromProgrammer('replace') },
    ...(useUiStore.getState().proMode && !isRemoteMode() ? [
      { label: t('pro.scenes.record.remove'), description: t('pro.scenes.record.removeTitle'), icon: LuEraser, onSelect: () => storeMode('remove') } satisfies MenuEntry,
      { label: t('pro.scenes.record.cueonly'), description: t('pro.scenes.record.cueonlyTitle'), icon: LuRefreshCwOff, onSelect: () => storeMode('cueonly') } satisfies MenuEntry
    ] : []),
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

