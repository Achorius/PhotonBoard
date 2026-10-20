// Ruler, marker lane and section (zone) lane of the timeline.

import { memo, useRef, useState } from 'react'
import { LuFlag, LuPencil, LuPiano, LuTrash2, LuSquareDashed } from 'react-icons/lu'
import { cn, palette, tint, usePointerDrag, withAlpha } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import type { TimelineMarker, TimelineZone } from '@shared/types'
import { useCanvas } from './canvas-context'
import type { Tick } from './timeline-model'
import { formatShortTime } from './timeline-model'
import { addMarkerAt, addZoneAt, deleteMarker, deleteZone, learnTimelineTarget, seek } from './timeline-actions'
import { useTimelineView } from './timeline-view-store'

// ---------------------------------------------------------------- Ruler

export const Ruler = memo(function Ruler({ ticks, width, length }: { ticks: Tick[]; width: number; length: number }) {
  const t = useT()
  const { zoom, g, timeAt, snap, openMenu } = useCanvas()
  const drag = usePointerDrag({
    onStart: (s) => { seek(timeAt(s.x)) },
    onMove: (s) => { seek(timeAt(s.x)) }
  })
  return (
    <div
      {...drag}
      data-ruler
      onDoubleClick={(e) => addMarkerAt(snap(timeAt(e.clientX)))}
      onContextMenu={(e) => {
        const at = snap(timeAt(e.clientX))
        openMenu(e, [{ label: t('timeline.menu.addMarkerAt', { time: formatShortTime(at) }), icon: LuFlag, onSelect: () => addMarkerAt(at) }])
      }}
      className="relative cursor-text touch-none select-none overflow-hidden border-b border-line bg-surface-1"
      style={{ width, height: g.ruler }}
      aria-label={t('timeline.canvas.rulerAria')}
    >
      {/* Past the end of the timeline */}
      <div className="absolute inset-y-0 bg-surface-0/60" style={{ left: length * zoom, right: 0 }} />
      {ticks.map((tk) => (
        <div key={tk.t} className="absolute bottom-0" style={{ left: tk.t * zoom }}>
          <div className={cn('absolute bottom-0 w-px', tk.major ? 'bg-line-strong' : 'bg-line')} style={{ height: tk.major ? g.ruler * 0.45 : g.ruler * 0.22 }} />
          {tk.label && (
            <span className="absolute left-1 whitespace-nowrap font-mono text-2xs tabular text-fg-tertiary" style={{ bottom: g.ruler * 0.42 }}>
              {tk.label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
})

// ---------------------------------------------------------------- Markers

export const MarkerLane = memo(function MarkerLane({ markers, width, selectedId }: { markers: TimelineMarker[]; width: number; selectedId: string | null }) {
  const t = useT()
  const { g, timeAt, snap, openMenu } = useCanvas()
  const tap = usePointerDrag({
    onStart: (s) => {
      if ((s.event.target as HTMLElement).closest('[data-marker]')) return false
    },
    onEnd: (s, canceled) => { if (!canceled && Math.abs(s.dx) < 4) seek(timeAt(s.x)) }
  })
  return (
    <div
      {...tap}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('[data-marker]')) addMarkerAt(snap(timeAt(e.clientX))) }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-marker]')) return
        const at = snap(timeAt(e.clientX))
        openMenu(e, [{ label: t('timeline.menu.addMarkerAt', { time: formatShortTime(at) }), icon: LuFlag, onSelect: () => addMarkerAt(at) }])
      }}
      className="relative touch-none select-none border-b border-line-subtle bg-surface-1"
      style={{ width, height: g.markerLane }}
    >
      {markers.map((m) => <MarkerFlag key={m.id} marker={m} selected={m.id === selectedId} />)}
    </div>
  )
})

const MarkerFlag = memo(function MarkerFlag({ marker, selected }: { marker: TimelineMarker; selected: boolean }) {
  const t = useT()
  const { zoom, g, timeAt, snap, openMenu } = useCanvas()
  const color = marker.color || palette.warning
  const moved = useRef(false)
  const drag = usePointerDrag({
    onStart: () => {
      moved.current = false
      useTimelineView.getState().select({ kind: 'marker', id: marker.id })
    },
    onMove: (s) => {
      if (!moved.current && Math.abs(s.dx) < 4) return
      moved.current = true
      usePlaybackStore.getState().updateTimelineMarker(marker.id, { time: snap(timeAt(s.x)) })
    },
    onEnd: (_s, canceled) => { if (!moved.current && !canceled) seek(marker.time) }
  })
  return (
    <div
      data-marker={marker.id}
      {...drag}
      onContextMenu={(e) => openMenu(e, [
        { type: 'label', label: marker.name },
        { label: t('timeline.marker.goTo'), icon: LuFlag, onSelect: () => seek(marker.time, true) },
        { label: t('timeline.menu.renameEdit'), icon: LuPencil, onSelect: () => useTimelineView.getState().select({ kind: 'marker', id: marker.id }) },
        { label: t('timeline.marker.midiLearnMenu'), icon: LuPiano, onSelect: () => learnTimelineTarget({ type: 'timeline_goto_marker', id: marker.id, label: t('timeline.midi.goTo', { name: marker.name }) }) },
        { type: 'separator' },
        { label: t('timeline.marker.delete'), icon: LuTrash2, danger: true, onSelect: () => { void deleteMarker(marker.id) } }
      ])}
      className="absolute top-0 flex h-full cursor-grab touch-none items-center active:cursor-grabbing"
      style={{ left: marker.time * zoom }}
      title={`${marker.name} · ${formatShortTime(marker.time)}`}
    >
      <span className="absolute inset-y-0 left-0 w-0.5" style={{ backgroundColor: color }} />
      <span
        className={cn(
          'ml-0.5 flex items-center whitespace-nowrap rounded-r px-1.5 text-2xs font-semibold text-fg-primary',
          selected && 'outline outline-2 outline-info-fg'
        )}
        style={{ backgroundColor: tint(color, 0.45), height: Math.min(g.markerLane - 6, 24) }}
      >
        {marker.name}
      </span>
    </div>
  )
})

// ---------------------------------------------------------------- Zones (sections)

export const ZoneLane = memo(function ZoneLane({ zones, width, selectedId }: { zones: TimelineZone[]; width: number; selectedId: string | null }) {
  const t = useT()
  const { zoom, g, timeAt, snap } = useCanvas()
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null)
  const anchor = useRef<number | null>(null)
  const create = usePointerDrag({
    onStart: (s) => {
      if ((s.event.target as HTMLElement).closest('[data-zone]')) return false
      const t = snap(timeAt(s.x))
      anchor.current = t
      setDraft({ a: t, b: t })
    },
    onMove: (s) => { if (Math.abs(s.dx) >= 4 && anchor.current !== null) setDraft({ a: anchor.current, b: snap(timeAt(s.x)) }) },
    onEnd: (s, canceled) => {
      const a = anchor.current
      anchor.current = null
      setDraft(null)
      if (canceled || a === null) return
      const d = { a }
      const b = snap(timeAt(s.x))
      if (Math.abs(b - d.a) >= 0.5) addZoneAt(Math.min(d.a, b), Math.max(d.a, b))
      else if (Math.abs(s.dx) < 4) seek(timeAt(s.x))
    }
  })
  return (
    <div
      {...create}
      className="relative touch-none select-none border-b border-line bg-surface-1"
      style={{ width, height: g.zoneLane }}
      title={t('timeline.canvas.zoneLaneHint')}
    >
      {zones.map((z) => <ZoneBlock key={z.id} zone={z} selected={z.id === selectedId} />)}
      {draft && (
        <div
          className="pointer-events-none absolute inset-y-1 rounded-sm border border-dashed border-info-fg bg-info/20"
          style={{ left: Math.min(draft.a, draft.b) * zoom, width: Math.abs(draft.b - draft.a) * zoom }}
        />
      )}
    </div>
  )
})

const ZoneBlock = memo(function ZoneBlock({ zone, selected }: { zone: TimelineZone; selected: boolean }) {
  const t = useT()
  const { zoom, g, timeAt, snap, openMenu } = useCanvas()
  const color = zone.color || palette.info
  const gs = useRef<{ mode: 'move' | 'start' | 'end'; grab: number; start: number; end: number; moved: boolean } | null>(null)
  const drag = usePointerDrag({
    onStart: (s) => {
      const mode = ((s.event.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle') as 'start' | 'end' | null) ?? 'move'
      gs.current = { mode, grab: timeAt(s.x) - zone.startTime, start: zone.startTime, end: zone.endTime, moved: false }
      useTimelineView.getState().select({ kind: 'zone', id: zone.id })
    },
    onMove: (s) => {
      const st = gs.current
      if (!st) return
      if (!st.moved && Math.abs(s.dx) < 4) return
      st.moved = true
      const t = timeAt(s.x)
      const store = usePlaybackStore.getState()
      if (st.mode === 'move') {
        const start = snap(t - st.grab)
        store.updateTimelineZone(zone.id, { startTime: start, endTime: start + (st.end - st.start) })
      } else if (st.mode === 'start') {
        store.updateTimelineZone(zone.id, { startTime: Math.min(st.end - 0.5, snap(t)) })
      } else {
        store.updateTimelineZone(zone.id, { endTime: Math.max(st.start + 0.5, snap(t)) })
      }
    },
    onEnd: (_s, canceled) => {
      const st = gs.current
      gs.current = null
      if (st && !st.moved && !canceled) seek(zone.startTime)
    }
  })
  const left = zone.startTime * zoom
  const w = Math.max(6, (zone.endTime - zone.startTime) * zoom)
  return (
    <div
      data-zone={zone.id}
      {...drag}
      onContextMenu={(e) => openMenu(e, [
        { type: 'label', label: zone.name },
        { label: t('timeline.section.goTo'), icon: LuSquareDashed, onSelect: () => seek(zone.startTime, true) },
        { label: t('timeline.menu.renameEdit'), icon: LuPencil, onSelect: () => useTimelineView.getState().select({ kind: 'zone', id: zone.id }) },
        { label: t('timeline.section.midiLearnMenu'), icon: LuPiano, onSelect: () => learnTimelineTarget({ type: 'timeline_goto_zone', id: zone.id, label: t('timeline.midi.goTo', { name: zone.name }) }) },
        { type: 'separator' },
        { label: t('timeline.section.delete'), icon: LuTrash2, danger: true, onSelect: () => { void deleteZone(zone.id) } }
      ])}
      className={cn('absolute inset-y-1 flex cursor-grab touch-none items-center overflow-hidden rounded-sm active:cursor-grabbing', selected && 'outline outline-2 outline-info-fg')}
      style={{ left, width: w, backgroundColor: withAlpha(color, 0.28), boxShadow: `inset 2px 0 0 ${color}, inset -2px 0 0 ${color}` }}
      title={`${zone.name} · ${formatShortTime(zone.startTime)}–${formatShortTime(zone.endTime)}`}
    >
      <span className="truncate px-2 text-2xs font-semibold text-fg-primary">{zone.name}</span>
      <div data-handle="start" aria-hidden className="absolute inset-y-0 left-0 cursor-ew-resize" style={{ width: Math.min(g.edge, w / 3) }} />
      <div data-handle="end" aria-hidden className="absolute inset-y-0 right-0 cursor-ew-resize" style={{ width: Math.min(g.edge, w / 3) }} />
    </div>
  )
})
