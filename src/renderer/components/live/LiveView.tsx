import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { useMidiStore } from '../../stores/midi-store'
import {
  startTimeline, stopTimeline, rewindTimeline, toggleTimeline,
  setTimelineTime, setTimelineLooping, setTimelineTotalDuration,
  getTimelineState, setTimelineUpdateCallback, getActiveClipIds
} from '../../lib/timeline-engine'
import {
  enableTimecode, isTimecodeEnabled, isTimecodeReceiving,
  getTimecodeFramerate, setTimecodeFramerate, formatSecondsAsTimecode,
  FRAMERATES, type TimecodeFramerate
} from '../../lib/timecode-engine'
import { stopAllEffects } from '../../lib/effect-engine'
import { useUiStore } from '../../stores/ui-store'
import type { TimelineClip, TimelineMarker, TimelineZone, MidiTargetType } from '@shared/types'

// ── Constants ──
const TRACK_HEIGHT = 48
const RULER_HEIGHT = 32
const MARKER_ROW_HEIGHT = 20
const MIN_CLIP_DURATION = 0.5

const CLIP_COLORS = [
  '#e85d04', '#2563eb', '#16a34a', '#dc2626', '#9333ea',
  '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#059669'
]
const MARKER_COLORS = ['#facc15', '#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7']
const ZONE_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#eab308']
const ZONE_ROW_HEIGHT = 16

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ============================================================
// LiveView — DAW-style Timeline
// ============================================================
export function LiveView() {
  const {
    cuelists, timelineClips, timelineMarkers, timelineTrackCount,
    timelineZones,
    addTimelineClip, removeTimelineClip, updateTimelineClip,
    addTimelineMarker, removeTimelineMarker, updateTimelineMarker,
    setTimelineTrackCount,
    addTimelineZone, removeTimelineZone, updateTimelineZone, reorderTimelineZones
  } = usePlaybackStore()
  const { startLearn } = useMidiStore()

  const [zoom, setZoom] = useState(80)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [totalDuration, setTotalDuration] = useState(120)
  const [tcEnabled, setTcEnabled] = useState(isTimecodeEnabled())
  const [tcReceiving, setTcReceiving] = useState(false)
  const [tcFramerate, setTcFramerate] = useState<TimecodeFramerate>(getTimecodeFramerate())

  // Drag state
  const [dragClip, setDragClip] = useState<{ clipId: string; offsetX: number; offsetTrack: number } | null>(null)
  const [resizeClip, setResizeClip] = useState<{ clipId: string; edge: 'left' | 'right' } | null>(null)
  const [dragMarker, setDragMarker] = useState<string | null>(null)

  // Context menus
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; trackIndex: number } | null>(null)
  const [markerMenu, setMarkerMenu] = useState<{ x: number; y: number; markerId: string } | null>(null)
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number; clipId: string; cuelistId: string } | null>(null)
  const [midiMenu, setMidiMenu] = useState<{ x: number; y: number; items: { label: string; onClick: () => void }[] } | null>(null)
  const [editingTrack, setEditingTrack] = useState<number | null>(null)
  const [trackNames, setTrackNames] = useState<Record<number, string>>({})
  const [editingTrackName, setEditingTrackName] = useState('')

  // Track reorder drag
  const [dragTrack, setDragTrack] = useState<{ from: number; current: number } | null>(null)

  // Marker editing in sidebar
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null)
  const [editingMarkerName, setEditingMarkerName] = useState('')

  // Zone state
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; zoneId: string } | null>(null)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [editingZoneName, setEditingZoneName] = useState('')
  const [dragZoneSidebar, setDragZoneSidebar] = useState<{ fromId: string; overId: string | null } | null>(null)
  const [creatingZone, setCreatingZone] = useState<{ startX: number; startTime: number } | null>(null)

  const timelineRef = useRef<HTMLDivElement>(null)

  const topOffset = RULER_HEIGHT + MARKER_ROW_HEIGHT + ZONE_ROW_HEIGHT
  const sortedZones = useMemo(() => [...timelineZones].sort((a, b) => a.order - b.order), [timelineZones])

  // Sync with global timeline engine
  useEffect(() => {
    const state = getTimelineState()
    setIsPlaying(state.isPlaying)
    setCurrentTime(state.currentTime)
    setIsLooping(state.isLooping)
    setTotalDuration(state.totalDuration)

    setTimelineUpdateCallback((time, playing) => {
      setCurrentTime(time)
      setIsPlaying(playing)
    })

    return () => setTimelineUpdateCallback(() => {})
  }, [])

  // Sync loop and duration to engine
  useEffect(() => { setTimelineLooping(isLooping) }, [isLooping])

  // Poll TC receiving status
  useEffect(() => {
    if (!tcEnabled) return
    const interval = setInterval(() => setTcReceiving(isTimecodeReceiving()), 250)
    return () => clearInterval(interval)
  }, [tcEnabled])
  useEffect(() => { setTimelineTotalDuration(totalDuration) }, [totalDuration])

  const handlePlayStop = useCallback(() => toggleTimeline(), [])

  // Scroll the timeline view to center on a given time
  const scrollToTime = useCallback((t: number) => {
    if (!timelineRef.current) return
    const px = t * zoom
    const viewWidth = timelineRef.current.clientWidth
    timelineRef.current.scrollLeft = Math.max(0, px - viewWidth / 3)
  }, [zoom])

  // ── Zoom ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom(z => Math.max(10, Math.min(400, z - e.deltaY * 0.5)))
    }
  }, [])

  // ── Drop scene ──
  const handleTimelineDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const cuelistId = e.dataTransfer.getData('application/x-cuelist-id')
    if (!cuelistId) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const y = e.clientY - rect.top - topOffset
    const startTime = Math.max(0, x / zoom)
    const trackIndex = Math.max(0, Math.floor(y / TRACK_HEIGHT))
    const store = usePlaybackStore.getState()
    const cuelist = store.cuelists.find(c => c.id === cuelistId)
    const dur = cuelist?.cues.reduce((sum, cue) => sum + (cue.fadeIn || 1), 0) || 4
    const colorIdx = store.cuelists.findIndex(c => c.id === cuelistId) % CLIP_COLORS.length
    addTimelineClip({
      cuelistId,
      trackIndex: Math.min(trackIndex, timelineTrackCount - 1),
      startTime: Math.round(startTime * 4) / 4,
      duration: Math.max(MIN_CLIP_DURATION, dur),
      color: CLIP_COLORS[colorIdx >= 0 ? colorIdx : 0]
    })
  }, [zoom, addTimelineClip, timelineTrackCount])

  // ── Clip drag ──
  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const clip = timelineClips.find(c => c.id === clipId)
    if (!clip) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const clickX = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const clickY = e.clientY - rect.top - topOffset

    // Option+click (Alt+click) → duplicate clip and drag the copy
    let targetClipId = clipId
    if (e.altKey) {
      const newId = addTimelineClip({
        cuelistId: clip.cuelistId,
        trackIndex: clip.trackIndex,
        startTime: clip.startTime,
        duration: clip.duration,
        color: clip.color
      })
      targetClipId = newId
    }

    setDragClip({
      clipId: targetClipId,
      offsetX: clickX - clip.startTime * zoom,
      offsetTrack: Math.floor(clickY / TRACK_HEIGHT) - clip.trackIndex
    })
  }, [timelineClips, zoom, addTimelineClip])

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()
    setResizeClip({ clipId, edge })
  }, [])

  // ── Marker drag ──
  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, markerId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    setDragMarker(markerId)
  }, [])

  // ── Mouse move/up for clip drag, resize, and marker drag ──
  useEffect(() => {
    if (!dragClip && !resizeClip && !dragMarker && !dragTrack) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect) return
      const sl = timelineRef.current?.scrollLeft || 0

      if (dragClip) {
        const x = e.clientX - rect.left + sl - dragClip.offsetX
        const y = e.clientY - rect.top - topOffset
        const newStart = Math.max(0, Math.round((x / zoom) * 4) / 4)
        const newTrack = Math.max(0, Math.min(timelineTrackCount - 1, Math.floor(y / TRACK_HEIGHT)))
        updateTimelineClip(dragClip.clipId, { startTime: newStart, trackIndex: newTrack })
      }

      if (resizeClip) {
        const clip = usePlaybackStore.getState().timelineClips.find(c => c.id === resizeClip.clipId)
        if (!clip) return
        const x = e.clientX - rect.left + sl
        const time = Math.max(0, Math.round((x / zoom) * 4) / 4)
        if (resizeClip.edge === 'right') {
          updateTimelineClip(resizeClip.clipId, { duration: Math.max(MIN_CLIP_DURATION, time - clip.startTime) })
        } else {
          const endTime = clip.startTime + clip.duration
          const newStart = Math.min(endTime - MIN_CLIP_DURATION, Math.max(0, time))
          updateTimelineClip(resizeClip.clipId, { startTime: newStart, duration: endTime - newStart })
        }
      }

      if (dragMarker) {
        const x = e.clientX - rect.left + sl
        const time = Math.max(0, Math.round((x / zoom) * 4) / 4)
        updateTimelineMarker(dragMarker, { time })
      }

      if (dragTrack) {
        const y = e.clientY - rect.top - topOffset
        const newTrack = Math.max(0, Math.min(timelineTrackCount - 1, Math.floor(y / TRACK_HEIGHT)))
        setDragTrack({ ...dragTrack, current: newTrack })
      }
    }

    const handleMouseUp = () => {
      if (dragTrack && dragTrack.from !== dragTrack.current) {
        // Swap clips between tracks
        const from = dragTrack.from
        const to = dragTrack.current
        const clips = usePlaybackStore.getState().timelineClips
        for (const clip of clips) {
          if (clip.trackIndex === from) updateTimelineClip(clip.id, { trackIndex: to })
          else if (clip.trackIndex === to) updateTimelineClip(clip.id, { trackIndex: from })
        }
        // Swap track names
        setTrackNames(prev => {
          const next = { ...prev }
          const tmp = next[from]
          next[from] = next[to] || ''
          next[to] = tmp || ''
          return next
        })
      }
      setDragClip(null)
      setResizeClip(null)
      setDragMarker(null)
      setDragTrack(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [dragClip, resizeClip, dragMarker, dragTrack, zoom, updateTimelineClip, updateTimelineMarker, timelineTrackCount])

  // ── Ruler click = set playhead, double-click = add marker ──
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    setTimelineTime(Math.max(0, x / zoom))
  }, [zoom])

  const handleRulerDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const time = Math.max(0, Math.round((x / zoom) * 4) / 4)
    const idx = usePlaybackStore.getState().timelineMarkers.length
    addTimelineMarker({ time, name: `M${idx + 1}`, color: MARKER_COLORS[idx % MARKER_COLORS.length] })
  }, [zoom, addTimelineMarker])

  // ── Marker right-click = delete ──
  const handleMarkerContextMenu = useCallback((e: React.MouseEvent, markerId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMarkerMenu({ x: e.clientX, y: e.clientY, markerId })
  }, [])

  // ── Track header right-click ──
  const handleTrackContextMenu = useCallback((e: React.MouseEvent, trackIndex: number) => {
    e.preventDefault()
    setTrackMenu({ x: e.clientX, y: e.clientY, trackIndex })
  }, [])

  // ── Navigate markers ──
  const goToNextMarker = useCallback(() => {
    const markers = usePlaybackStore.getState().timelineMarkers
    const ct = getTimelineState().currentTime
    const next = markers.find(m => m.time > ct + 0.1)
    if (next) { setTimelineTime(next.time); scrollToTime(next.time) }
  }, [scrollToTime])
  const goToPrevMarker = useCallback(() => {
    const markers = usePlaybackStore.getState().timelineMarkers
    const ct = getTimelineState().currentTime
    const prev = [...markers].reverse().find(m => m.time < ct - 0.1)
    if (prev) { setTimelineTime(prev.time); scrollToTime(prev.time) }
  }, [scrollToTime])

  // ── Zone reorder: split overlapping clips, then shift everything ──
  const handleZoneReorder = useCallback((orderedIds: string[]) => {
    const store = usePlaybackStore.getState()
    const zones = store.timelineZones
    let clips = [...store.timelineClips]

    // Build old order (by current order field)
    const oldOrder = [...zones].sort((a, b) => a.order - b.order)
    const newOrder = orderedIds.map(id => zones.find(z => z.id === id)!).filter(Boolean)
    if (newOrder.length !== oldOrder.length) return

    // ── Phase 1: Split clips that straddle zone boundaries ──
    for (const zone of oldOrder) {
      const toSplit: typeof clips = []
      for (const clip of clips) {
        const clipEnd = clip.startTime + clip.duration
        const overlapsStart = clip.startTime < zone.startTime && clipEnd > zone.startTime
        const overlapsEnd = clip.startTime < zone.endTime && clipEnd > zone.endTime
        if (overlapsStart || overlapsEnd) toSplit.push(clip)
      }

      for (const clip of toSplit) {
        const clipEnd = clip.startTime + clip.duration
        const fragments: { startTime: number; duration: number }[] = []

        // Build fragments by cutting at zone boundaries
        let fragStart = clip.startTime
        const cuts = [zone.startTime, zone.endTime].filter(t => t > clip.startTime && t < clipEnd).sort((a, b) => a - b)
        for (const cut of cuts) {
          if (cut > fragStart) {
            fragments.push({ startTime: fragStart, duration: cut - fragStart })
            fragStart = cut
          }
        }
        if (fragStart < clipEnd) {
          fragments.push({ startTime: fragStart, duration: clipEnd - fragStart })
        }

        if (fragments.length > 1) {
          // Update original clip to first fragment
          updateTimelineClip(clip.id, { startTime: fragments[0].startTime, duration: fragments[0].duration })
          // Create new clips for remaining fragments
          for (let i = 1; i < fragments.length; i++) {
            addTimelineClip({
              cuelistId: clip.cuelistId,
              trackIndex: clip.trackIndex,
              startTime: fragments[i].startTime,
              duration: fragments[i].duration,
              color: clip.color
            })
          }
        }
      }
    }

    // ── Phase 2: Re-read clips after splits ──
    clips = [...usePlaybackStore.getState().timelineClips]

    // Calculate each zone's duration & new start positions
    const zoneIdToDuration = new Map(oldOrder.map(z => [z.id, z.endTime - z.startTime]))
    let cursor = oldOrder.length > 0 ? Math.min(...oldOrder.map(z => z.startTime)) : 0
    const newZoneStarts = new Map<string, number>()
    for (const z of newOrder) {
      newZoneStarts.set(z.id, cursor)
      cursor += zoneIdToDuration.get(z.id) || 0
    }

    // ── Phase 3: Move clips — any clip fully or partially inside a zone moves with it ──
    const movedClipIds = new Set<string>()
    for (const clip of clips) {
      const clipEnd = clip.startTime + clip.duration
      // Find zone that contains this clip (clip is inside if it overlaps the zone at all)
      const sourceZone = oldOrder.find(z => clip.startTime >= z.startTime && clipEnd <= z.endTime + 0.01)
      if (!sourceZone) continue
      const newZoneStart = newZoneStarts.get(sourceZone.id)
      if (newZoneStart === undefined) continue
      const offset = newZoneStart - sourceZone.startTime
      if (offset !== 0) {
        updateTimelineClip(clip.id, { startTime: Math.max(0, clip.startTime + offset) })
      }
      movedClipIds.add(clip.id)
    }

    // ── Phase 4: Update zone positions ──
    for (const z of oldOrder) {
      const newStart = newZoneStarts.get(z.id)
      if (newStart === undefined) continue
      const dur = zoneIdToDuration.get(z.id) || 0
      updateTimelineZone(z.id, { startTime: newStart, endTime: newStart + dur })
    }

    // ── Phase 5: Move markers within zones ──
    const markers = store.timelineMarkers
    for (const marker of markers) {
      const sourceZone = oldOrder.find(z => marker.time >= z.startTime && marker.time < z.endTime)
      if (!sourceZone) continue
      const newZoneStart = newZoneStarts.get(sourceZone.id)
      if (newZoneStart === undefined) continue
      const offset = newZoneStart - sourceZone.startTime
      if (offset !== 0) {
        updateTimelineMarker(marker.id, { time: Math.max(0, marker.time + offset) })
      }
    }

    reorderTimelineZones(orderedIds)
  }, [updateTimelineClip, addTimelineClip, updateTimelineZone, updateTimelineMarker, reorderTimelineZones])

  // ── Zone sidebar drag reorder ──
  const handleZoneDragStart = useCallback((e: React.DragEvent, zoneId: string) => {
    e.dataTransfer.setData('application/x-zone-id', zoneId)
    e.dataTransfer.effectAllowed = 'move'
    setDragZoneSidebar({ fromId: zoneId, overId: null })
  }, [])

  const handleZoneDragOver = useCallback((e: React.DragEvent, overId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragZoneSidebar(prev => prev ? { ...prev, overId } : null)
  }, [])

  const handleZoneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const fromId = e.dataTransfer.getData('application/x-zone-id')
    if (!fromId || !dragZoneSidebar?.overId) { setDragZoneSidebar(null); return }
    const currentOrder = [...sortedZones].map(z => z.id)
    const fromIdx = currentOrder.indexOf(fromId)
    const toIdx = currentOrder.indexOf(dragZoneSidebar.overId)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) { setDragZoneSidebar(null); return }
    // Reorder
    currentOrder.splice(fromIdx, 1)
    currentOrder.splice(toIdx, 0, fromId)
    handleZoneReorder(currentOrder)
    setDragZoneSidebar(null)
  }, [dragZoneSidebar, sortedZones, handleZoneReorder])

  // ── Create zone by Shift+drag on ruler ──
  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    if (!e.shiftKey) return
    e.preventDefault()
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const time = Math.max(0, Math.round((x / zoom) * 4) / 4)
    setCreatingZone({ startX: x, startTime: time })
  }, [zoom])

  useEffect(() => {
    if (!creatingZone) return
    const handleMouseMove = (e: MouseEvent) => {
      // Just track — the zone will be created on mouseup
    }
    const handleMouseUp = (e: MouseEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect) { setCreatingZone(null); return }
      const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
      const endTime = Math.max(0, Math.round((x / zoom) * 4) / 4)
      const start = Math.min(creatingZone.startTime, endTime)
      const end = Math.max(creatingZone.startTime, endTime)
      if (end - start >= 1) {
        const idx = usePlaybackStore.getState().timelineZones.length
        addTimelineZone({ name: `Zone ${idx + 1}`, startTime: start, endTime: end, color: ZONE_COLORS[idx % ZONE_COLORS.length], order: idx })
      }
      setCreatingZone(null)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [creatingZone, zoom, addTimelineZone])

  // ── Zone right-click ──
  const handleZoneContextMenu = useCallback((e: React.MouseEvent, zoneId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setZoneMenu({ x: e.clientX, y: e.clientY, zoneId })
  }, [])

  // ── Click empty area = set playhead ──
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('timeline-track') && target !== e.currentTarget) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    setTimelineTime(Math.max(0, x / zoom))
  }, [zoom])

  // Keep playhead visible
  useEffect(() => {
    if (!isPlaying || !timelineRef.current) return
    const playheadX = currentTime * zoom
    const viewLeft = timelineRef.current.scrollLeft
    const viewWidth = timelineRef.current.clientWidth
    if (playheadX > viewLeft + viewWidth - 80) {
      timelineRef.current.scrollLeft = playheadX - 80
    }
  }, [currentTime, isPlaying, zoom])

  // Close context menus on click
  useEffect(() => {
    if (!trackMenu && !markerMenu && !midiMenu && !clipMenu && !zoneMenu) return
    const handler = () => { setTrackMenu(null); setMarkerMenu(null); setMidiMenu(null); setClipMenu(null); setZoneMenu(null) }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [trackMenu, markerMenu, midiMenu, clipMenu, zoneMenu])

  const maxEnd = useMemo(() => {
    const clipEnd = timelineClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
    return Math.max(totalDuration, clipEnd + 10)
  }, [timelineClips, totalDuration])
  const totalWidth = maxEnd * zoom
  const activeClipIds = isPlaying ? getActiveClipIds() : new Set<string>()

  return (
    <div className="flex h-full overflow-hidden">
      {/* ═══════ LEFT SIDEBAR ═══════ */}
      <div className="w-48 shrink-0 border-r border-surface-3 bg-surface-1 flex flex-col">
        <div className="px-3 py-2 border-b border-surface-3">
          <h3 className="text-[10px] uppercase text-gray-500 font-semibold">Scenes</h3>
          <p className="text-[9px] text-gray-600 mt-0.5">Drag onto timeline</p>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {cuelists.map((cl, idx) => (
            <div
              key={cl.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-cuelist-id', cl.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => useUiStore.getState().navigateToCuelist(cl.id)}
              className="px-2 py-1.5 rounded bg-surface-2 border border-surface-3 cursor-grab active:cursor-grabbing hover:border-accent/50 transition-colors flex items-center gap-2"
              title="Drag onto timeline — Double-click to edit"
            >
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CLIP_COLORS[idx % CLIP_COLORS.length] }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-300 truncate">{cl.name}</div>
                <div className="text-[9px] text-gray-600">
                  {cl.cues.length} cue{cl.cues.length !== 1 ? 's' : ''}
                  {cl.effectSnapshots?.length ? ` + ${cl.effectSnapshots.length} fx` : ''}
                </div>
              </div>
            </div>
          ))}
          {cuelists.length === 0 && (
            <p className="text-[9px] text-gray-600 text-center py-4">No scenes yet.<br/>Create in Scenes tab.</p>
          )}
        </div>

        {/* Markers list */}
        <div className="border-t border-surface-3">
          <div className="px-3 py-1.5 text-[10px] uppercase text-gray-500 font-semibold">Markers</div>
          <div className="overflow-y-auto max-h-40 px-1.5 pb-1.5 space-y-0.5">
            {timelineMarkers.map(m => (
              <div
                key={m.id}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-3 text-[10px] cursor-pointer group"
                onClick={() => { setTimelineTime(m.time); scrollToTime(m.time) }}
                onContextMenu={(e) => handleMarkerContextMenu(e, m.id)}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color || '#facc15' }} />
                {editingMarkerId === m.id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-surface-3 text-gray-200 text-[10px] rounded px-1 py-0 border-none outline-none"
                    value={editingMarkerName}
                    onChange={(e) => setEditingMarkerName(e.target.value)}
                    onBlur={() => { updateTimelineMarker(m.id, { name: editingMarkerName }); setEditingMarkerId(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { updateTimelineMarker(m.id, { name: editingMarkerName }); setEditingMarkerId(null) } }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-gray-300 truncate" onDoubleClick={(e) => { e.stopPropagation(); setEditingMarkerId(m.id); setEditingMarkerName(m.name) }}>{m.name}</span>
                )}
                <span className="text-gray-600 font-mono shrink-0">{formatTime(m.time)}</span>
              </div>
            ))}
            {timelineMarkers.length === 0 && (
              <p className="text-[9px] text-gray-700 text-center py-1">Double-click ruler to add</p>
            )}
          </div>
        </div>

        {/* Zones list */}
        <div className="border-t border-surface-3">
          <div className="px-3 py-1.5 text-[10px] uppercase text-gray-500 font-semibold flex items-center justify-between">
            <span>Zones</span>
            <span className="text-[8px] text-gray-600 font-normal">Shift+drag ruler</span>
          </div>
          <div className="overflow-y-auto max-h-48 px-1.5 pb-1.5 space-y-0.5">
            {sortedZones.map(z => (
              <div
                key={z.id}
                draggable
                onDragStart={(e) => handleZoneDragStart(e, z.id)}
                onDragOver={(e) => handleZoneDragOver(e, z.id)}
                onDrop={handleZoneDrop}
                onContextMenu={(e) => handleZoneContextMenu(e, z.id)}
                className={`flex items-center gap-1 px-1.5 py-1 rounded text-[10px] cursor-grab active:cursor-grabbing transition-colors ${
                  dragZoneSidebar?.overId === z.id ? 'bg-accent/20 border border-accent/30' : 'hover:bg-surface-3'
                }`}
                onClick={() => { setTimelineTime(z.startTime); scrollToTime(z.startTime) }}
              >
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: (z.color || '#3b82f6') + '66', border: `1px solid ${z.color || '#3b82f6'}` }} />
                {editingZoneId === z.id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-surface-3 text-gray-200 text-[10px] rounded px-1 py-0 border-none outline-none"
                    value={editingZoneName}
                    onChange={(e) => setEditingZoneName(e.target.value)}
                    onBlur={() => { updateTimelineZone(z.id, { name: editingZoneName }); setEditingZoneId(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { updateTimelineZone(z.id, { name: editingZoneName }); setEditingZoneId(null) } }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-gray-300 truncate" onDoubleClick={(e) => { e.stopPropagation(); setEditingZoneId(z.id); setEditingZoneName(z.name) }}>{z.name}</span>
                )}
                <span className="text-gray-600 font-mono shrink-0 text-[8px]">{formatTime(z.startTime)}-{formatTime(z.endTime)}</span>
              </div>
            ))}
            {sortedZones.length === 0 && (
              <p className="text-[9px] text-gray-700 text-center py-1">Shift+drag on ruler to create</p>
            )}
          </div>
        </div>
      </div>

      {/* ═══════ MAIN ═══════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Transport ── */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-3 bg-surface-1 shrink-0">
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${isPlaying ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-accent hover:bg-accent-light text-white'}`}
            onClick={handlePlayStop}
            onContextMenu={(e) => { e.preventDefault(); setMidiMenu({ x: e.clientX, y: e.clientY, items: [
              { label: 'MIDI Learn: Timeline Play/Stop', onClick: () => startLearn({ type: 'timeline_play' as MidiTargetType, label: 'Timeline Play/Stop' }) },
              { label: 'MIDI Learn: Timeline Stop', onClick: () => startLearn({ type: 'timeline_stop' as MidiTargetType, label: 'Timeline Stop' }) },
            ]}) }}
          >
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>
          <button
            className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={() => { rewindTimeline(); setCurrentTime(0); scrollToTime(0) }}
            onContextMenu={(e) => { e.preventDefault(); startLearn({ type: 'timeline_rewind' as MidiTargetType, label: 'Timeline Rewind' }) }}
            title="Rewind (right-click: MIDI Learn)"
          >⏮</button>
          <button className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200" onClick={goToPrevMarker} title="Prev marker">◂</button>
          <button className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200" onClick={goToNextMarker} title="Next marker">▸</button>
          <button
            className={`px-2 py-1 rounded text-xs transition-colors ${isLooping ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-gray-400 hover:bg-surface-4'}`}
            onClick={() => setIsLooping(!isLooping)}
          >↻</button>

          <div className="w-px h-5 bg-surface-3" />
          <div className="font-mono text-sm text-gray-300 min-w-[60px]">
            {tcEnabled ? formatSecondsAsTimecode(currentTime, tcFramerate) : formatTime(currentTime)}
          </div>

          {/* Timecode sync */}
          <div className="w-px h-5 bg-surface-3" />
          <button
            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
              tcEnabled
                ? tcReceiving
                  ? 'bg-green-600 text-white'
                  : 'bg-yellow-600/80 text-white animate-pulse'
                : 'bg-surface-3 text-gray-500 hover:bg-surface-4'
            }`}
            onClick={() => {
              const next = !tcEnabled
              setTcEnabled(next)
              enableTimecode(next)
            }}
            title={tcEnabled ? (tcReceiving ? 'MTC receiving — click to disable' : 'MTC enabled, waiting for signal…') : 'Enable MTC timecode sync'}
          >
            TC {tcEnabled ? (tcReceiving ? '●' : '○') : 'OFF'}
          </button>
          {tcEnabled && (
            <select
              className="bg-surface-3 border border-surface-4 rounded px-1 py-0.5 text-[10px] text-gray-300"
              value={tcFramerate}
              onChange={(e) => {
                const fps = parseFloat(e.target.value) as TimecodeFramerate
                setTcFramerate(fps)
                setTimecodeFramerate(fps)
              }}
            >
              {FRAMERATES.map(fps => (
                <option key={fps} value={fps}>{fps} fps</option>
              ))}
            </select>
          )}

          <div className="flex-1" />

          <span className="text-[10px] text-gray-500">Zoom</span>
          <input type="range" min={10} max={400} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24 h-1 accent-accent" />

          <div className="w-px h-5 bg-surface-3" />
          <span className="text-[10px] text-gray-500">Durée</span>
          <input type="number" min={10} max={3600} value={totalDuration} onChange={(e) => setTotalDuration(Math.max(10, Number(e.target.value)))} className="w-14 text-xs bg-surface-3 border border-surface-4 rounded px-1 py-0.5 text-gray-300 text-center" />
          <span className="text-[10px] text-gray-600">s</span>
        </div>

        {/* ── Timeline ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track headers */}
          <div className="w-24 shrink-0 border-r border-surface-3 bg-surface-1 flex flex-col">
            <div style={{ height: RULER_HEIGHT }} className="border-b border-surface-3" />
            <div style={{ height: MARKER_ROW_HEIGHT }} className="border-b border-surface-3 flex items-center justify-center text-[8px] text-gray-600">Markers</div>
            <div style={{ height: ZONE_ROW_HEIGHT }} className="border-b border-surface-3 flex items-center justify-center text-[8px] text-gray-600">Zones</div>
            {Array.from({ length: timelineTrackCount }, (_, i) => (
              <div
                key={i}
                className={`border-b border-surface-3/50 flex items-center justify-center text-[10px] cursor-grab transition-colors ${
                  dragTrack?.current === i ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:bg-surface-2'
                }`}
                style={{ height: TRACK_HEIGHT }}
                onContextMenu={(e) => handleTrackContextMenu(e, i)}
                onMouseDown={(e) => { if (e.button === 0) setDragTrack({ from: i, current: i }) }}
              >
                {editingTrack === i ? (
                  <input
                    autoFocus
                    className="w-16 bg-surface-3 text-gray-200 text-[10px] rounded px-1 text-center border-none outline-none"
                    value={editingTrackName}
                    onChange={(e) => setEditingTrackName(e.target.value)}
                    onBlur={() => { setTrackNames(p => ({ ...p, [i]: editingTrackName })); setEditingTrack(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setTrackNames(p => ({ ...p, [i]: editingTrackName })); setEditingTrack(null) } }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate px-1">{trackNames[i] || `Track ${i + 1}`}</span>
                )}
              </div>
            ))}
          </div>

          {/* Scrollable timeline */}
          <div
            ref={timelineRef}
            className="flex-1 overflow-auto relative"
            onWheel={handleWheel}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={handleTimelineDrop}
            onClick={handleTimelineClick}
          >
            <div className="relative" style={{ width: totalWidth, minHeight: topOffset + timelineTrackCount * TRACK_HEIGHT }}>
              {/* Time ruler */}
              <div className="sticky top-0 z-20 bg-surface-1 border-b border-surface-3 cursor-pointer" style={{ height: RULER_HEIGHT }} onClick={handleRulerClick} onDoubleClick={handleRulerDoubleClick} onMouseDown={handleRulerMouseDown}>
                <svg width={totalWidth} height={RULER_HEIGHT} className="block">
                  {Array.from({ length: Math.ceil(maxEnd) + 1 }, (_, i) => {
                    const x = i * zoom
                    const isMajor = i % 10 === 0
                    const isMinor = i % 5 === 0
                    return (
                      <g key={i}>
                        <line x1={x} y1={isMajor ? 0 : isMinor ? 12 : 20} x2={x} y2={RULER_HEIGHT} stroke={isMajor ? '#555' : '#333'} strokeWidth={isMajor ? 1 : 0.5} />
                        {(isMajor || (isMinor && zoom > 30)) && (
                          <text x={x + 3} y={12} fill="#888" fontSize={9} fontFamily="monospace">{formatTime(i)}</text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>

              {/* Marker row */}
              <div className="sticky z-15 bg-surface-0/80 border-b border-surface-3/50" style={{ top: RULER_HEIGHT, height: MARKER_ROW_HEIGHT }}>
                {timelineMarkers.map(m => (
                  <div
                    key={m.id}
                    className={`absolute top-0 bottom-0 flex items-center cursor-grab hover:opacity-80 ${dragMarker === m.id ? 'opacity-60' : ''}`}
                    style={{ left: m.time * zoom }}
                    onMouseDown={(e) => handleMarkerMouseDown(e, m.id)}
                    onContextMenu={(e) => handleMarkerContextMenu(e, m.id)}
                    title={`${m.name} — ${formatTime(m.time)} (drag to move, right-click to delete)`}
                  >
                    <div className="w-px h-full" style={{ backgroundColor: m.color || '#facc15' }} />
                    <span className="text-[8px] px-1 rounded-r whitespace-nowrap" style={{ backgroundColor: (m.color || '#facc15') + '33', color: m.color || '#facc15' }}>{m.name}</span>
                  </div>
                ))}
              </div>

              {/* Zone row */}
              <div className="sticky z-14 bg-surface-0/60 border-b border-surface-3/50" style={{ top: RULER_HEIGHT + MARKER_ROW_HEIGHT, height: ZONE_ROW_HEIGHT }}>
                {sortedZones.map(z => {
                  const left = z.startTime * zoom
                  const width = (z.endTime - z.startTime) * zoom
                  const zColor = z.color || '#3b82f6'
                  return (
                    <div
                      key={z.id}
                      className="absolute top-0 bottom-0 flex items-center overflow-hidden cursor-pointer hover:brightness-125"
                      style={{ left, width, backgroundColor: zColor + '33', borderLeft: `2px solid ${zColor}`, borderRight: `2px solid ${zColor}` }}
                      onClick={() => { setTimelineTime(z.startTime); scrollToTime(z.startTime) }}
                      onContextMenu={(e) => handleZoneContextMenu(e, z.id)}
                      title={`${z.name} (${formatTime(z.startTime)} - ${formatTime(z.endTime)})`}
                    >
                      <span className="text-[8px] px-1 truncate font-medium" style={{ color: zColor }}>{z.name}</span>
                    </div>
                  )
                })}
              </div>

              {/* Zone background on tracks */}
              {sortedZones.map(z => {
                const left = z.startTime * zoom
                const width = (z.endTime - z.startTime) * zoom
                const zColor = z.color || '#3b82f6'
                return (
                  <div
                    key={`zone-bg-${z.id}`}
                    className="absolute pointer-events-none z-0"
                    style={{ left, width, top: topOffset, height: timelineTrackCount * TRACK_HEIGHT, backgroundColor: zColor + '08', borderLeft: `1px dashed ${zColor}44`, borderRight: `1px dashed ${zColor}44` }}
                  />
                )
              })}

              {/* Track rows */}
              {Array.from({ length: timelineTrackCount }, (_, i) => (
                <div
                  key={i}
                  className={`timeline-track absolute left-0 right-0 border-b border-surface-3/30 ${i % 2 === 0 ? 'bg-surface-0/50' : 'bg-surface-2/30'}`}
                  style={{ top: topOffset + i * TRACK_HEIGHT, height: TRACK_HEIGHT }}
                  onContextMenu={(e) => handleTrackContextMenu(e, i)}
                />
              ))}

              {/* Clips */}
              {timelineClips.map(clip => {
                const cuelist = cuelists.find(c => c.id === clip.cuelistId)
                const left = clip.startTime * zoom
                const width = clip.duration * zoom
                const top = topOffset + clip.trackIndex * TRACK_HEIGHT + 4
                const isDragging = dragClip?.clipId === clip.id
                const isResizing = resizeClip?.clipId === clip.id
                const clipColor = clip.color || '#e85d04'
                const isActive = activeClipIds.has(clip.id)

                return (
                  <div
                    key={clip.id}
                    className={`absolute rounded shadow-md flex items-center overflow-hidden select-none group ${isDragging || isResizing ? 'opacity-70 z-30' : 'z-10'} ${isActive ? 'ring-2 ring-white/60 brightness-125' : ''}`}
                    style={{
                      left, width: Math.max(width, 20), top, height: TRACK_HEIGHT - 8,
                      backgroundColor: clipColor + 'cc', border: `1px solid ${clipColor}`,
                      cursor: isDragging ? 'grabbing' : 'grab'
                    }}
                    onMouseDown={(e) => handleClipMouseDown(e, clip.id)}
                    onDoubleClick={() => useUiStore.getState().navigateToCuelist(clip.cuelistId)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setClipMenu({ x: e.clientX, y: e.clientY, clipId: clip.id, cuelistId: clip.cuelistId }) }}
                    title={`${cuelist?.name || '?'} — ${clip.duration.toFixed(1)}s (double-click to edit, right-click for options)`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20" onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'left')} />
                    <div className="flex-1 px-2 truncate text-[10px] text-white font-medium pointer-events-none">{cuelist?.name || '?'}</div>
                    {width > 50 && <div className="text-[8px] text-white/60 pr-2 pointer-events-none shrink-0">{clip.duration.toFixed(1)}s</div>}
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20" onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'right')} />
                  </div>
                )
              })}

              {/* Marker lines through tracks */}
              {timelineMarkers.map(m => (
                <div key={`line-${m.id}`} className="absolute pointer-events-none z-5" style={{ left: m.time * zoom, top: topOffset, width: 1, backgroundColor: (m.color || '#facc15') + '40', height: timelineTrackCount * TRACK_HEIGHT }} />
              ))}

              {/* Playhead */}
              <div className="absolute top-0 w-px bg-red-500 z-40 pointer-events-none" style={{ left: currentTime * zoom, height: topOffset + timelineTrackCount * TRACK_HEIGHT }}>
                <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ CONTEXT MENUS ═══════ */}
      {trackMenu && (
        <div className="fixed z-50 bg-surface-1 border border-surface-3 rounded shadow-xl py-1 min-w-[160px]" style={{ left: trackMenu.x, top: trackMenu.y }}>
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-accent/20 hover:text-accent" onClick={() => { setEditingTrack(trackMenu.trackIndex); setEditingTrackName(trackNames[trackMenu.trackIndex] || `Track ${trackMenu.trackIndex + 1}`); setTrackMenu(null) }}>
            Rename Track
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-accent/20 hover:text-accent" onClick={() => { setTimelineTrackCount(timelineTrackCount + 1); setTrackMenu(null) }}>
            Add Track Below
          </button>
          {timelineTrackCount > 1 && (
            <button className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20" onClick={() => {
              // Remove track: move clips from higher tracks down
              const idx = trackMenu.trackIndex
              const clips = usePlaybackStore.getState().timelineClips
              for (const clip of clips) {
                if (clip.trackIndex === idx) removeTimelineClip(clip.id)
                else if (clip.trackIndex > idx) updateTimelineClip(clip.id, { trackIndex: clip.trackIndex - 1 })
              }
              setTimelineTrackCount(timelineTrackCount - 1)
              setTrackMenu(null)
            }}>
              Remove Track
            </button>
          )}
        </div>
      )}

      {markerMenu && (
        <div className="fixed z-50 bg-surface-1 border border-surface-3 rounded shadow-xl py-1 min-w-[180px]" style={{ left: markerMenu.x, top: markerMenu.y }}>
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-accent/20 hover:text-accent" onClick={() => { setEditingMarkerId(markerMenu.markerId); const m = timelineMarkers.find(x => x.id === markerMenu.markerId); setEditingMarkerName(m?.name || ''); setMarkerMenu(null) }}>
            Rename
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/20" onClick={() => {
            const m = timelineMarkers.find(x => x.id === markerMenu.markerId)
            startLearn({ type: 'timeline_goto_marker' as MidiTargetType, id: markerMenu.markerId, label: `Go to ${m?.name || 'marker'}` })
            setMarkerMenu(null)
          }}>
            MIDI Learn: Go to Marker
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20" onClick={() => { removeTimelineMarker(markerMenu.markerId); setMarkerMenu(null) }}>
            Delete Marker
          </button>
        </div>
      )}

      {/* Clip context menu */}
      {clipMenu && (
        <div className="fixed z-50 bg-surface-1 border border-surface-3 rounded shadow-xl py-1 min-w-[160px]" style={{ left: clipMenu.x, top: clipMenu.y }}>
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-accent/20 hover:text-accent" onClick={() => { useUiStore.getState().navigateToCuelist(clipMenu.cuelistId); setClipMenu(null) }}>
            Edit Scene
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20" onClick={() => { removeTimelineClip(clipMenu.clipId); setClipMenu(null) }}>
            Remove from Timeline
          </button>
        </div>
      )}

      {/* Zone context menu */}
      {zoneMenu && (
        <div className="fixed z-50 bg-surface-1 border border-surface-3 rounded shadow-xl py-1 min-w-[180px]" style={{ left: zoneMenu.x, top: zoneMenu.y }}>
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-accent/20 hover:text-accent" onClick={() => {
            const z = sortedZones.find(x => x.id === zoneMenu.zoneId)
            setEditingZoneId(zoneMenu.zoneId); setEditingZoneName(z?.name || ''); setZoneMenu(null)
          }}>
            Rename Zone
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/20" onClick={() => {
            const z = sortedZones.find(x => x.id === zoneMenu.zoneId)
            startLearn({ type: 'timeline_goto_zone' as MidiTargetType, id: zoneMenu.zoneId, label: `Go to ${z?.name || 'zone'}` })
            setZoneMenu(null)
          }}>
            MIDI Learn: Go to Zone
          </button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20" onClick={() => { removeTimelineZone(zoneMenu.zoneId); setZoneMenu(null) }}>
            Delete Zone
          </button>
        </div>
      )}

      {/* MIDI context menu */}
      {midiMenu && (
        <div className="fixed z-50 bg-surface-1 border border-surface-3 rounded shadow-xl py-1 min-w-[200px]" style={{ left: midiMenu.x, top: midiMenu.y }}>
          {midiMenu.items.map((item, i) => (
            <button key={i} className="w-full text-left px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-500/20" onClick={() => { item.onClick(); setMidiMenu(null) }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
