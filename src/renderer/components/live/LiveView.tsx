import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { startEffect, stopEffect, stopAllEffects } from '../../lib/effect-engine'
import { stopAllFades } from '../../lib/cue-engine'
import type { TimelineClip, TimelineMarker } from '@shared/types'

// ── Constants ──
const TRACK_HEIGHT = 48
const RULER_HEIGHT = 32
const MARKER_ROW_HEIGHT = 20
const MIN_CLIP_DURATION = 0.5
const DEFAULT_TOTAL = 120

// ── Color palette for clips ──
const CLIP_COLORS = [
  '#e85d04', '#2563eb', '#16a34a', '#dc2626', '#9333ea',
  '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#059669'
]
const MARKER_COLORS = ['#facc15', '#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7']

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
    addTimelineClip, removeTimelineClip, updateTimelineClip,
    addTimelineMarker, removeTimelineMarker, updateTimelineMarker,
    setTimelineTrackCount
  } = usePlaybackStore()

  const [zoom, setZoom] = useState(80)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [totalDuration, setTotalDuration] = useState(DEFAULT_TOTAL)

  // Drag state
  const [dragClip, setDragClip] = useState<{ clipId: string; offsetX: number; offsetTrack: number } | null>(null)
  const [resizeClip, setResizeClip] = useState<{ clipId: string; edge: 'left' | 'right' } | null>(null)

  // Marker editing
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null)
  const [editingMarkerName, setEditingMarkerName] = useState('')

  const timelineRef = useRef<HTMLDivElement>(null)
  const isPlayingRef = useRef(false)
  const isLoopingRef = useRef(false)
  const currentTimeRef = useRef(0)

  // Keep refs in sync
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { isLoopingRef.current = isLooping }, [isLooping])
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])

  const playbackRef = useRef<{ raf: number | null; lastTime: number; activeClipIds: Set<string> }>({
    raf: null, lastTime: 0, activeClipIds: new Set()
  })

  // ── Playback engine — reads EVERYTHING from stores/refs, no stale closures ──
  const triggerClip = useCallback((clip: TimelineClip) => {
    const store = usePlaybackStore.getState()
    const cuelist = store.cuelists.find(c => c.id === clip.cuelistId)
    if (!cuelist || cuelist.cues.length === 0) return

    const patchStore = usePatchStore.getState()
    const dmxStore = useDmxStore.getState()

    // Apply all cues' DMX values
    for (const cue of cuelist.cues) {
      for (const cv of cue.values) {
        const entry = patchStore.patch.find(p => p.id === cv.fixtureId)
        if (!entry) continue
        const channels = patchStore.getFixtureChannels(entry)
        const ch = channels.find((c: any) => c.name === cv.channelName)
        if (ch) dmxStore.setChannel(entry.universe, ch.absoluteChannel, cv.value)
      }
    }

    // Start effect snapshots if any
    if (cuelist.effectSnapshots) {
      for (const fx of cuelist.effectSnapshots) {
        startEffect({ ...fx, isRunning: true })
      }
    }
  }, [])

  const releaseClip = useCallback((clip: TimelineClip) => {
    const store = usePlaybackStore.getState()
    const cuelist = store.cuelists.find(c => c.id === clip.cuelistId)
    if (!cuelist) return
    // Stop effects for this clip
    if (cuelist.effectSnapshots) {
      for (const fx of cuelist.effectSnapshots) {
        stopEffect(fx.id)
      }
    }
  }, [])

  const stopPlayback = useCallback(() => {
    setIsPlaying(false)
    if (playbackRef.current.raf) {
      cancelAnimationFrame(playbackRef.current.raf)
      playbackRef.current.raf = null
    }
    playbackRef.current.activeClipIds.clear()
    stopAllEffects()
    stopAllFades()
  }, [])

  const startPlayback = useCallback(() => {
    setIsPlaying(true)
    playbackRef.current.lastTime = performance.now()
    // Check which clips are already active at current time
    const clips = usePlaybackStore.getState().timelineClips
    const t = currentTimeRef.current
    playbackRef.current.activeClipIds.clear()
    for (const clip of clips) {
      if (t >= clip.startTime && t < clip.startTime + clip.duration) {
        triggerClip(clip)
        playbackRef.current.activeClipIds.add(clip.id)
      }
    }

    const tick = () => {
      if (!isPlayingRef.current) return

      const now = performance.now()
      const dt = (now - playbackRef.current.lastTime) / 1000
      playbackRef.current.lastTime = now

      setCurrentTime(prev => {
        const next = prev + dt
        const clips = usePlaybackStore.getState().timelineClips

        // Trigger/release clips
        for (const clip of clips) {
          const wasActive = playbackRef.current.activeClipIds.has(clip.id)
          const isActive = next >= clip.startTime && next < clip.startTime + clip.duration
          if (isActive && !wasActive) {
            triggerClip(clip)
            playbackRef.current.activeClipIds.add(clip.id)
          }
          if (!isActive && wasActive) {
            releaseClip(clip)
            playbackRef.current.activeClipIds.delete(clip.id)
          }
        }

        // End of timeline
        const maxEnd = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), DEFAULT_TOTAL)
        if (next >= maxEnd) {
          if (isLoopingRef.current) {
            playbackRef.current.activeClipIds.clear()
            stopAllEffects()
            return 0
          }
          stopPlayback()
          return maxEnd
        }
        return next
      })

      playbackRef.current.raf = requestAnimationFrame(tick)
    }

    playbackRef.current.raf = requestAnimationFrame(tick)
  }, [triggerClip, releaseClip, stopPlayback])

  useEffect(() => {
    return () => {
      if (playbackRef.current.raf) cancelAnimationFrame(playbackRef.current.raf)
    }
  }, [])

  // ── Zoom with scroll wheel ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom(z => Math.max(10, Math.min(400, z - e.deltaY * 0.5)))
    } else {
      setScrollLeft(s => Math.max(0, s + e.deltaX + e.deltaY))
    }
  }, [])

  // ── Drop a new scene from sidebar ──
  const handleTimelineDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const cuelistId = e.dataTransfer.getData('application/x-cuelist-id')
    if (!cuelistId) return

    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const y = e.clientY - rect.top - RULER_HEIGHT - MARKER_ROW_HEIGHT
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

  // ── Clip drag (move) ──
  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const clip = timelineClips.find(c => c.id === clipId)
    if (!clip) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const clickX = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const clickY = e.clientY - rect.top - RULER_HEIGHT - MARKER_ROW_HEIGHT
    setDragClip({
      clipId,
      offsetX: clickX - clip.startTime * zoom,
      offsetTrack: Math.floor(clickY / TRACK_HEIGHT) - clip.trackIndex
    })
  }, [timelineClips, zoom])

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()
    setResizeClip({ clipId, edge })
  }, [])

  // ── Mouse move / up for drag & resize ──
  useEffect(() => {
    if (!dragClip && !resizeClip) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect) return
      const sl = timelineRef.current?.scrollLeft || 0

      if (dragClip) {
        const x = e.clientX - rect.left + sl - dragClip.offsetX
        const y = e.clientY - rect.top - RULER_HEIGHT - MARKER_ROW_HEIGHT
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
    }

    const handleMouseUp = () => { setDragClip(null); setResizeClip(null) }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [dragClip, resizeClip, zoom, updateTimelineClip, timelineTrackCount])

  // ── Click on ruler → set playhead ──
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    setCurrentTime(Math.max(0, x / zoom))
  }, [zoom])

  // ── Double-click ruler → add marker ──
  const handleRulerDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const time = Math.max(0, Math.round((x / zoom) * 4) / 4)
    const idx = usePlaybackStore.getState().timelineMarkers.length
    addTimelineMarker({ time, name: `M${idx + 1}`, color: MARKER_COLORS[idx % MARKER_COLORS.length] })
  }, [zoom, addTimelineMarker])

  // ── Navigate to next/prev marker ──
  const goToNextMarker = useCallback(() => {
    const markers = usePlaybackStore.getState().timelineMarkers
    const next = markers.find(m => m.time > currentTimeRef.current + 0.1)
    if (next) setCurrentTime(next.time)
  }, [])

  const goToPrevMarker = useCallback(() => {
    const markers = usePlaybackStore.getState().timelineMarkers
    const prev = [...markers].reverse().find(m => m.time < currentTimeRef.current - 0.1)
    if (prev) setCurrentTime(prev.time)
  }, [])

  // ── Click on empty area → set playhead ──
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('timeline-track') && target !== e.currentTarget) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    setCurrentTime(Math.max(0, x / zoom))
  }, [zoom])

  // Keep playhead visible during playback
  useEffect(() => {
    if (!isPlaying || !timelineRef.current) return
    const playheadX = currentTime * zoom
    const viewLeft = timelineRef.current.scrollLeft
    const viewWidth = timelineRef.current.clientWidth
    if (playheadX > viewLeft + viewWidth - 80) {
      timelineRef.current.scrollLeft = playheadX - 80
    }
  }, [currentTime, isPlaying, zoom])

  // Timeline total width
  const maxEnd = useMemo(() => {
    const clipEnd = timelineClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
    return Math.max(totalDuration, clipEnd + 10)
  }, [timelineClips, totalDuration])
  const totalWidth = maxEnd * zoom

  const topOffset = RULER_HEIGHT + MARKER_ROW_HEIGHT

  return (
    <div className="flex h-full overflow-hidden">
      {/* ═══════ LEFT SIDEBAR: Scene list ═══════ */}
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
              className="px-2 py-1.5 rounded bg-surface-2 border border-surface-3 cursor-grab active:cursor-grabbing hover:border-accent/50 transition-colors flex items-center gap-2"
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
            <p className="text-[9px] text-gray-600 text-center py-4">No scenes yet.<br/>Create them in Scenes tab.</p>
          )}
        </div>

        {/* Markers list */}
        <div className="border-t border-surface-3">
          <div className="px-3 py-1.5 text-[10px] uppercase text-gray-500 font-semibold flex items-center justify-between">
            Markers
            <span className="text-[9px] text-gray-600 font-normal">dbl-click ruler</span>
          </div>
          <div className="overflow-y-auto max-h-40 px-1.5 pb-1.5 space-y-0.5">
            {timelineMarkers.map(m => (
              <div
                key={m.id}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-surface-3 text-[10px] cursor-pointer group"
                onClick={() => setCurrentTime(m.time)}
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
                  <span
                    className="flex-1 text-gray-300 truncate"
                    onDoubleClick={(e) => { e.stopPropagation(); setEditingMarkerId(m.id); setEditingMarkerName(m.name) }}
                  >
                    {m.name}
                  </span>
                )}
                <span className="text-gray-600 font-mono shrink-0">{formatTime(m.time)}</span>
                <button
                  className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={(e) => { e.stopPropagation(); removeTimelineMarker(m.id) }}
                >
                  ×
                </button>
              </div>
            ))}
            {timelineMarkers.length === 0 && (
              <p className="text-[9px] text-gray-700 text-center py-1">Double-click ruler to add</p>
            )}
          </div>
        </div>
      </div>

      {/* ═══════ MAIN: Transport + Timeline ═══════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Transport bar ── */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-3 bg-surface-1 shrink-0">
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              isPlaying ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-accent hover:bg-accent-light text-white'
            }`}
            onClick={() => isPlaying ? stopPlayback() : startPlayback()}
          >
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>

          <button
            className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={() => { setCurrentTime(0); playbackRef.current.activeClipIds.clear(); stopAllEffects() }}
            title="Back to start"
          >
            ⏮
          </button>

          {/* Prev / Next marker */}
          <button
            className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={goToPrevMarker}
            title="Previous marker"
          >
            ◂
          </button>
          <button
            className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={goToNextMarker}
            title="Next marker"
          >
            ▸
          </button>

          <button
            className={`px-2 py-1 rounded text-xs transition-colors ${
              isLooping ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
            }`}
            onClick={() => setIsLooping(!isLooping)}
            title="Loop"
          >
            ↻
          </button>

          <div className="w-px h-5 bg-surface-3" />
          <div className="font-mono text-sm text-gray-300 min-w-[60px]">{formatTime(currentTime)}</div>

          <div className="flex-1" />

          {/* Add/Remove track */}
          <button
            className="px-2 py-0.5 rounded text-[10px] bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={() => setTimelineTrackCount(timelineTrackCount + 1)}
            title="Add track"
          >
            + Track
          </button>
          {timelineTrackCount > 1 && (
            <button
              className="px-2 py-0.5 rounded text-[10px] bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
              onClick={() => setTimelineTrackCount(timelineTrackCount - 1)}
              title="Remove last track"
            >
              − Track
            </button>
          )}

          <div className="w-px h-5 bg-surface-3" />

          <span className="text-[10px] text-gray-500">Zoom</span>
          <input type="range" min={10} max={400} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24 h-1 accent-accent" />

          <div className="w-px h-5 bg-surface-3" />

          <span className="text-[10px] text-gray-500">Durée</span>
          <input
            type="number" min={10} max={3600} value={totalDuration}
            onChange={(e) => setTotalDuration(Math.max(10, Number(e.target.value)))}
            className="w-14 text-xs bg-surface-3 border border-surface-4 rounded px-1 py-0.5 text-gray-300 text-center"
          />
          <span className="text-[10px] text-gray-600">s</span>
        </div>

        {/* ── Timeline area ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track headers (left) */}
          <div className="w-20 shrink-0 border-r border-surface-3 bg-surface-1 flex flex-col">
            <div style={{ height: RULER_HEIGHT }} className="border-b border-surface-3" />
            <div style={{ height: MARKER_ROW_HEIGHT }} className="border-b border-surface-3 flex items-center justify-center text-[8px] text-gray-600">
              Markers
            </div>
            {Array.from({ length: timelineTrackCount }, (_, i) => (
              <div key={i} className="border-b border-surface-3/50 flex items-center justify-center text-[10px] text-gray-500" style={{ height: TRACK_HEIGHT }}>
                Track {i + 1}
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
              {/* ── Time ruler ── */}
              <div className="sticky top-0 z-20 bg-surface-1 border-b border-surface-3 cursor-pointer" style={{ height: RULER_HEIGHT }} onClick={handleRulerClick} onDoubleClick={handleRulerDoubleClick}>
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

              {/* ── Marker row ── */}
              <div className="sticky z-15 bg-surface-0/80 border-b border-surface-3/50" style={{ top: RULER_HEIGHT, height: MARKER_ROW_HEIGHT }}>
                {timelineMarkers.map(m => (
                  <div
                    key={m.id}
                    className="absolute top-0 bottom-0 flex items-center cursor-pointer hover:opacity-80"
                    style={{ left: m.time * zoom }}
                    onClick={(e) => { e.stopPropagation(); setCurrentTime(m.time) }}
                    title={`${m.name} — ${formatTime(m.time)}`}
                  >
                    <div className="w-px h-full" style={{ backgroundColor: m.color || '#facc15' }} />
                    <span className="text-[8px] px-1 rounded-r whitespace-nowrap" style={{ backgroundColor: (m.color || '#facc15') + '33', color: m.color || '#facc15' }}>
                      {m.name}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Track rows ── */}
              {Array.from({ length: timelineTrackCount }, (_, i) => (
                <div
                  key={i}
                  className={`timeline-track absolute left-0 right-0 border-b border-surface-3/30 ${i % 2 === 0 ? 'bg-surface-0/50' : 'bg-surface-2/30'}`}
                  style={{ top: topOffset + i * TRACK_HEIGHT, height: TRACK_HEIGHT }}
                />
              ))}

              {/* ── Clips ── */}
              {timelineClips.map(clip => {
                const cuelist = cuelists.find(c => c.id === clip.cuelistId)
                const left = clip.startTime * zoom
                const width = clip.duration * zoom
                const top = topOffset + clip.trackIndex * TRACK_HEIGHT + 4
                const isDragging = dragClip?.clipId === clip.id
                const isResizing = resizeClip?.clipId === clip.id
                const clipColor = clip.color || '#e85d04'
                const isActive = playbackRef.current.activeClipIds.has(clip.id) && isPlaying

                return (
                  <div
                    key={clip.id}
                    className={`absolute rounded shadow-md flex items-center overflow-hidden select-none group ${isDragging || isResizing ? 'opacity-70 z-30' : 'z-10'} ${isActive ? 'ring-1 ring-white/50' : ''}`}
                    style={{
                      left, width: Math.max(width, 20), top, height: TRACK_HEIGHT - 8,
                      backgroundColor: clipColor + 'cc', border: `1px solid ${clipColor}`,
                      cursor: isDragging ? 'grabbing' : 'grab'
                    }}
                    onMouseDown={(e) => handleClipMouseDown(e, clip.id)}
                    onDoubleClick={() => removeTimelineClip(clip.id)}
                    title={`${cuelist?.name || '?'} — ${clip.duration.toFixed(1)}s (double-click to remove)`}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20" onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'left')} />
                    <div className="flex-1 px-2 truncate text-[10px] text-white font-medium pointer-events-none">{cuelist?.name || '?'}</div>
                    {width > 50 && <div className="text-[8px] text-white/60 pr-2 pointer-events-none shrink-0">{clip.duration.toFixed(1)}s</div>}
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20" onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'right')} />
                  </div>
                )
              })}

              {/* ── Marker lines through tracks ── */}
              {timelineMarkers.map(m => (
                <div
                  key={`line-${m.id}`}
                  className="absolute pointer-events-none z-5"
                  style={{ left: m.time * zoom, top: topOffset, bottom: 0, width: 1, backgroundColor: (m.color || '#facc15') + '40', height: timelineTrackCount * TRACK_HEIGHT }}
                />
              ))}

              {/* ── Playhead ── */}
              <div className="absolute top-0 w-px bg-red-500 z-40 pointer-events-none" style={{ left: currentTime * zoom, height: topOffset + timelineTrackCount * TRACK_HEIGHT }}>
                <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
