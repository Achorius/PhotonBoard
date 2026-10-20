// Timeline library: scenes to place (drag the grip onto a track, or + to
// add at the playhead), markers and sections (reorder by dragging the grip).

import { memo, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  LuClapperboard, LuFlag, LuGripVertical, LuPlus, LuSearch, LuSearchX, LuSparkles, LuSquareDashed
} from 'react-icons/lu'
import {
  Badge, Button, EmptyState, IconButton, Tabs, TextInput, cn, palette, useDensity, usePointerDrag
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useUiStore } from '@renderer/stores/ui-store'
import type { Cuelist, TimelineZone } from '@shared/types'
import { addSceneClip, clipColorFor, formatShortTime, reorderZones, snapStep } from './timeline-model'
import { addMarkerAt, addZoneAt, seek } from './timeline-actions'
import { getCanvasApi, getClockTime, useTimelineView, type LibraryTab } from './timeline-view-store'

export function LibraryPanel() {
  const t = useT()
  const tab = useTimelineView((s) => s.libraryTab)
  const counts = usePlaybackStore(useShallow((s) => ({ scenes: s.cuelists.length, markers: s.timelineMarkers.length, zones: s.timelineZones.length })))
  return (
    <aside aria-label={t('timeline.library.aria')} className="flex h-full min-h-0 flex-col bg-surface-1">
      <Tabs<LibraryTab>
        aria-label={t('timeline.library.tabsAria')}
        size="sm"
        fit
        className="shrink-0 gap-0 px-1"
        value={tab}
        onChange={(next) => useTimelineView.getState().setLibraryTab(next)}
        items={[
          { id: 'scenes', label: t('common.scenes'), badge: counts.scenes, 'data-library-tab': 'scenes' },
          { id: 'markers', label: t('timeline.canvas.markers'), badge: counts.markers, 'data-library-tab': 'markers' },
          { id: 'zones', label: t('timeline.canvas.sections'), badge: counts.zones, 'data-library-tab': 'zones' }
        ]}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === 'scenes' ? <ScenesTab /> : tab === 'markers' ? <MarkersTab /> : <ZonesTab />}
      </div>
    </aside>
  )
}

/** Track a new clip goes to: the selected track, or the selected clip's track */
function targetTrack(): number {
  const sel = useTimelineView.getState().selection
  if (sel?.kind === 'track') return sel.index
  if (sel?.kind === 'clip') return usePlaybackStore.getState().timelineClips.find((c) => c.id === sel.id)?.trackIndex ?? 0
  return 0
}

// ---------------------------------------------------------------- Scenes

function ScenesTab() {
  const t = useT()
  const cuelists = usePlaybackStore((s) => s.cuelists)
  const clips = usePlaybackStore((s) => s.timelineClips)
  const [query, setQuery] = useState('')
  const uses = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of clips) m.set(c.cuelistId, (m.get(c.cuelistId) ?? 0) + 1)
    return m
  }, [clips])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? cuelists.filter((c) => c.name.toLowerCase().includes(q)) : cuelists
  }, [cuelists, query])

  if (cuelists.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={LuClapperboard}
        title={t('timeline.library.noScenesTitle')}
        description={t('timeline.library.noScenesDescription')}
        action={<Button variant="primary" size="sm" onClick={() => useUiStore.getState().setActiveTab('playback')}>{t('timeline.openScenes')}</Button>}
      />
    )
  }
  return (
    <>
      <div className="shrink-0 px-2.5 py-2">
        <TextInput size="sm" icon={LuSearch} placeholder={t('timeline.library.searchScenes')} value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} aria-label={t('timeline.library.searchScenes')} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {shown.length === 0 ? (
          <EmptyState size="sm" icon={LuSearchX} title={t('timeline.library.noMatch')} description={t('common.nothingMatches', { query: query.trim() })} action={<Button size="sm" variant="ghost" onClick={() => setQuery('')}>{t('timeline.library.clearSearch')}</Button>} />
        ) : shown.map((cl) => (
          <SceneRow key={cl.id} cuelist={cl} color={clipColorFor(cuelists, cl.id)} uses={uses.get(cl.id) ?? 0} />
        ))}
      </div>
      <p className="shrink-0 border-t border-line-subtle px-3 py-2 text-xs text-fg-tertiary">
        {t('timeline.library.scenesHint')}
      </p>
    </>
  )
}

const SceneRow = memo(function SceneRow({ cuelist, color, uses }: { cuelist: Cuelist; color: string; uses: number }) {
  const t = useT()
  const drag = usePointerDrag({
    onStart: (s) => { useTimelineView.getState().setLibraryDrag({ cuelistId: cuelist.id, x: s.x, y: s.y, over: false }) },
    onMove: (s) => {
      const over = !!getCanvasApi()?.dropTarget(s.x, s.y)
      useTimelineView.getState().setLibraryDrag({ cuelistId: cuelist.id, x: s.x, y: s.y, over })
    },
    onEnd: (s, canceled) => {
      useTimelineView.getState().setLibraryDrag(null)
      if (canceled) return
      const target = getCanvasApi()?.dropTarget(s.x, s.y)
      if (!target) return
      const id = addSceneClip(cuelist.id, target.track, target.time)
      useTimelineView.getState().select({ kind: 'clip', id })
    }
  })
  const fx = cuelist.effectSnapshots?.length ?? 0
  const addAtPlayhead = () => {
    const { snap, bpm } = useTimelineView.getState()
    const step = snapStep(snap, bpm)
    const at = step > 0 ? Math.round(getClockTime() / step) * step : getClockTime()
    const id = addSceneClip(cuelist.id, targetTrack(), at)
    useTimelineView.getState().select({ kind: 'clip', id })
    getCanvasApi()?.reveal(at)
  }
  return (
    <div className="group flex min-h-row items-center gap-1 pl-1 pr-1.5 hover:bg-surface-2" onDoubleClick={addAtPlayhead}>
      <div
        {...drag}
        role="button"
        aria-label={t('timeline.library.dragScene', { name: cuelist.name })}
        className="flex h-control w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary active:cursor-grabbing"
      >
        <LuGripVertical size={14} aria-hidden />
      </div>
      <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-white/10 [[data-density=touch]_&]:h-4 [[data-density=touch]_&]:w-4" style={{ backgroundColor: color }} />
      <div className="flex min-w-0 flex-1 flex-col py-1 pl-1.5">
        <span className="truncate text-sm text-fg-primary">{cuelist.name}</span>
        <span className="flex items-center gap-1 truncate text-xs text-fg-tertiary">
          {t('common.cueCount', { count: cuelist.cues.length })}
          {fx > 0 && <><span aria-hidden>·</span><LuSparkles size={11} aria-hidden />{fx}</>}
        </span>
      </div>
      {uses > 0 && <Badge size="xs" mono title={t('timeline.library.placedCount', { count: uses })}>{uses}</Badge>}
      <IconButton icon={LuPlus} label={t('timeline.library.addSceneAtPlayhead', { name: cuelist.name })} size="sm" onClick={addAtPlayhead} />
    </div>
  )
})

// ---------------------------------------------------------------- Markers

function MarkersTab() {
  const t = useT()
  const markers = usePlaybackStore((s) => s.timelineMarkers)
  const selected = useTimelineView((s) => (s.selection?.kind === 'marker' ? s.selection.id : null))
  return (
    <>
      <div className="flex shrink-0 items-center px-2.5 py-2">
        <Button size="sm" variant="secondary" icon={LuPlus} onClick={() => addMarkerAt(getClockTime())} fullWidth>{t('timeline.marker.addAtPlayhead')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {markers.length === 0 ? (
          <EmptyState size="sm" icon={LuFlag} title={t('timeline.library.noMarkersTitle')} description={t('timeline.library.noMarkersDescription')} />
        ) : markers.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => { useTimelineView.getState().select({ kind: 'marker', id: m.id }); seek(m.time, true) }}
            className={cn('relative flex min-h-row w-full items-center gap-2.5 px-3 text-left', selected === m.id ? 'bg-info/15' : 'hover:bg-surface-2')}
          >
            {selected === m.id && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-info-fg" />}
            <LuFlag size={14} aria-hidden style={{ color: m.color || palette.warning }} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
            <span className="shrink-0 font-mono text-xs tabular text-fg-tertiary">{formatShortTime(m.time)}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Sections (zones)

function ZonesTab() {
  const t = useT()
  const zones = usePlaybackStore((s) => s.timelineZones)
  const selected = useTimelineView((s) => (s.selection?.kind === 'zone' ? s.selection.id : null))
  const sorted = useMemo(() => [...zones].sort((a, b) => a.order - b.order), [zones])
  const density = useDensity()
  const rowH = density === 'touch' ? 52 : 40
  const [dragging, setDragging] = useState<{ id: string; offset: number } | null>(null)

  const addSection = () => {
    const { bpm } = useTimelineView.getState()
    const start = getClockTime()
    addZoneAt(start, start + Math.max(8, (60 / bpm) * 16))
  }

  return (
    <>
      <div className="flex shrink-0 items-center px-2.5 py-2">
        <Button size="sm" variant="secondary" icon={LuPlus} onClick={addSection} fullWidth>{t('timeline.section.addAtPlayhead')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {sorted.length === 0 ? (
          <EmptyState size="sm" icon={LuSquareDashed} title={t('timeline.library.noSectionsTitle')} description={t('timeline.library.noSectionsDescription')} />
        ) : sorted.map((z, i) => (
          <ZoneRow
            key={z.id}
            zone={z}
            index={i}
            count={sorted.length}
            rowH={rowH}
            selected={selected === z.id}
            shift={dragging && dragging.id !== z.id ? shiftFor(i, sorted, dragging) : 0}
            draggingOffset={dragging?.id === z.id ? dragging.offset : null}
            onReorderDrag={(offset) => setDragging(offset === null ? null : { id: z.id, offset })}
            onReorderDrop={(to) => {
              setDragging(null)
              if (to === i) return
              const ids = sorted.map((x) => x.id)
              ids.splice(i, 1)
              ids.splice(to, 0, z.id)
              reorderZones(ids)
            }}
          />
        ))}
      </div>
      {sorted.length > 1 && <p className="shrink-0 border-t border-line-subtle px-3 py-2 text-xs text-fg-tertiary">{t('timeline.library.sectionsHint')}</p>}
    </>
  )
}

/** Visual shift of other rows while one is dragged (in rows: -1, 0, 1) */
function shiftFor(i: number, sorted: TimelineZone[], drag: { id: string; offset: number }): number {
  const from = sorted.findIndex((z) => z.id === drag.id)
  const to = Math.max(0, Math.min(sorted.length - 1, from + drag.offset))
  if (from < to && i > from && i <= to) return -1
  if (from > to && i < from && i >= to) return 1
  return 0
}

const ZoneRow = memo(function ZoneRow({ zone, index, count, rowH, selected, shift, draggingOffset, onReorderDrag, onReorderDrop }: {
  zone: TimelineZone
  index: number
  count: number
  rowH: number
  selected: boolean
  shift: number
  draggingOffset: number | null
  onReorderDrag: (offset: number | null) => void
  onReorderDrop: (to: number) => void
}) {
  const t = useT()
  const dy = useRef(0)
  const drag = usePointerDrag({
    onStart: () => { dy.current = 0; onReorderDrag(0) },
    onMove: (s) => { dy.current = s.dy; onReorderDrag(Math.round(s.dy / rowH)) },
    onEnd: (_s, canceled) => {
      if (canceled) { onReorderDrag(null); return }
      onReorderDrop(Math.max(0, Math.min(count - 1, index + Math.round(dy.current / rowH))))
    }
  })
  const color = zone.color || palette.info
  const isDragging = draggingOffset !== null
  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 pl-1 pr-3 transition-transform duration-fast',
        selected ? 'bg-info/15' : 'hover:bg-surface-2',
        isDragging && 'z-10 bg-surface-3 shadow-popover transition-none'
      )}
      style={{ height: rowH, transform: `translateY(${isDragging ? dy.current : shift * rowH}px)` }}
    >
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-info-fg" />}
      <div {...drag} role="button" aria-label={t('timeline.library.moveSection', { name: zone.name })} className="flex h-control w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary active:cursor-grabbing">
        <LuGripVertical size={14} aria-hidden />
      </div>
      <button
        type="button"
        onClick={() => { useTimelineView.getState().select({ kind: 'zone', id: zone.id }); seek(zone.startTime, true) }}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left"
      >
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate text-sm">{zone.name}</span>
        <span className="shrink-0 font-mono text-xs tabular text-fg-tertiary">{formatShortTime(zone.startTime)}–{formatShortTime(zone.endTime)}</span>
      </button>
    </div>
  )
})
