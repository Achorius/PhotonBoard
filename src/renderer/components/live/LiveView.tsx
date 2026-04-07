import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { startEffect, stopAllEffects } from '../../lib/effect-engine'
import { snapToCue, stopAllFades } from '../../lib/cue-engine'
import type { TimelineClip } from '@shared/types'

// ── Constants ──
const TRACK_HEIGHT = 48
const HEADER_HEIGHT = 28
const RULER_HEIGHT = 32
const MIN_CLIP_DURATION = 0.5
const SNAP_THRESHOLD = 5 // pixels
const DEFAULT_TOTAL = 120 // seconds

// ── Color palette for clips ──
const CLIP_COLORS = [
  '#e85d04', '#2563eb', '#16a34a', '#dc2626', '#9333ea',
  '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#059669'
]

// ── Timeline ruler time formatting ──
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ============================================================
// LiveView — DAW-style Timeline
// ============================================================
export function LiveView() {
  const { cuelists, timelineClips, addTimelineClip, removeTimelineClip, updateTimelineClip, goCuelist, stopCuelist } = usePlaybackStore()
  const { patch, fixtures, getFixtureChannels } = usePatchStore()
  const { setChannel } = useDmxStore()

  const [zoom, setZoom] = useState(80)          // pixels per second
  const [scrollLeft, setScrollLeft] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isLooping, setIsLooping] = useState(false)
  const [totalDuration, setTotalDuration] = useState(DEFAULT_TOTAL)

  // Drag state
  const [dragClip, setDragClip] = useState<{ clipId: string; offsetX: number; offsetTrack: number } | null>(null)
  const [resizeClip, setResizeClip] = useState<{ clipId: string; edge: 'left' | 'right' } | null>(null)
  const [dragNewScene, setDragNewScene] = useState<{ cuelistId: string } | null>(null)

  const timelineRef = useRef<HTMLDivElement>(null)
  const playbackRef = useRef<{ raf: number | null; lastTime: number; activeClipIds: Set<string> }>({
    raf: null, lastTime: 0, activeClipIds: new Set()
  })

  // Track count = max track index + 2 (at least 3 tracks)
  const trackCount = useMemo(() => {
    const maxTrack = timelineClips.reduce((max, c) => Math.max(max, c.trackIndex), -1)
    return Math.max(3, maxTrack + 2)
  }, [timelineClips])

  // ── Playback engine ──
  const triggerClip = useCallback((clip: TimelineClip) => {
    const cuelist = cuelists.find(c => c.id === clip.cuelistId)
    if (!cuelist || cuelist.cues.length === 0) return

    // Snap to the first cue immediately
    const cue = cuelist.cues[0]
    snapToCue(cuelist.id, cue)

    // Apply DMX values from the cue
    for (const cv of cue.values) {
      const entry = patch.find(p => p.id === cv.fixtureId)
      if (!entry) continue
      const channels = getFixtureChannels(entry)
      const ch = channels.find((c: any) => c.name === cv.channelName)
      if (ch) setChannel(entry.universe, ch.absoluteChannel, cv.value)
    }

    // Start effect snapshots if any
    if (cuelist.effectSnapshots) {
      for (const fx of cuelist.effectSnapshots) {
        startEffect({ ...fx, isRunning: true })
      }
    }
  }, [cuelists, patch, getFixtureChannels, setChannel])

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
    playbackRef.current.activeClipIds.clear()

    const tick = () => {
      const now = performance.now()
      const dt = (now - playbackRef.current.lastTime) / 1000
      playbackRef.current.lastTime = now

      setCurrentTime(prev => {
        const next = prev + dt
        const clips = usePlaybackStore.getState().timelineClips

        // Trigger clips that just started
        for (const clip of clips) {
          const wasActive = playbackRef.current.activeClipIds.has(clip.id)
          const isActive = next >= clip.startTime && next < clip.startTime + clip.duration
          if (isActive && !wasActive) {
            triggerClip(clip)
            playbackRef.current.activeClipIds.add(clip.id)
          }
          if (!isActive && wasActive) {
            playbackRef.current.activeClipIds.delete(clip.id)
          }
        }

        // End of timeline
        const total = usePlaybackStore.getState().timelineClips.reduce(
          (max, c) => Math.max(max, c.startTime + c.duration), DEFAULT_TOTAL
        )
        if (next >= total) {
          const looping = usePlaybackStore.getState() // check loop from ref
          // We'll check our local state via closure
          if (isLooping) {
            playbackRef.current.activeClipIds.clear()
            return 0
          }
          stopPlayback()
          return total
        }
        return next
      })

      playbackRef.current.raf = requestAnimationFrame(tick)
    }

    playbackRef.current.raf = requestAnimationFrame(tick)
  }, [triggerClip, stopPlayback, isLooping])

  // Cleanup on unmount
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

    const x = e.clientX - rect.left + scrollLeft
    const y = e.clientY - rect.top - RULER_HEIGHT
    const startTime = Math.max(0, x / zoom)
    const trackIndex = Math.max(0, Math.floor(y / TRACK_HEIGHT))

    const cuelist = cuelists.find(c => c.id === cuelistId)
    // Duration: sum of fadeIn times or default 4s
    const dur = cuelist?.cues.reduce((sum, cue) => sum + (cue.fadeIn || 1), 0) || 4
    const colorIdx = cuelists.findIndex(c => c.id === cuelistId) % CLIP_COLORS.length

    addTimelineClip({
      cuelistId,
      trackIndex,
      startTime: Math.round(startTime * 4) / 4, // snap to quarter second
      duration: Math.max(MIN_CLIP_DURATION, dur),
      color: CLIP_COLORS[colorIdx >= 0 ? colorIdx : 0]
    })

    setDragNewScene(null)
  }, [scrollLeft, zoom, cuelists, addTimelineClip])

  // ── Clip drag (move) ──
  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const clip = timelineClips.find(c => c.id === clipId)
    if (!clip) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const clickX = e.clientX - rect.left + scrollLeft
    const clickY = e.clientY - rect.top - RULER_HEIGHT
    setDragClip({
      clipId,
      offsetX: clickX - clip.startTime * zoom,
      offsetTrack: Math.floor(clickY / TRACK_HEIGHT) - clip.trackIndex
    })
  }, [timelineClips, scrollLeft, zoom])

  // ── Clip resize ──
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

      if (dragClip) {
        const x = e.clientX - rect.left + scrollLeft - dragClip.offsetX
        const y = e.clientY - rect.top - RULER_HEIGHT
        const newStart = Math.max(0, Math.round((x / zoom) * 4) / 4)
        const newTrack = Math.max(0, Math.floor(y / TRACK_HEIGHT))
        updateTimelineClip(dragClip.clipId, { startTime: newStart, trackIndex: newTrack })
      }

      if (resizeClip) {
        const clip = usePlaybackStore.getState().timelineClips.find(c => c.id === resizeClip.clipId)
        if (!clip) return
        const x = e.clientX - rect.left + scrollLeft
        const time = Math.max(0, Math.round((x / zoom) * 4) / 4)

        if (resizeClip.edge === 'right') {
          const newDur = Math.max(MIN_CLIP_DURATION, time - clip.startTime)
          updateTimelineClip(resizeClip.clipId, { duration: newDur })
        } else {
          const endTime = clip.startTime + clip.duration
          const newStart = Math.min(endTime - MIN_CLIP_DURATION, time)
          updateTimelineClip(resizeClip.clipId, { startTime: Math.max(0, newStart), duration: endTime - Math.max(0, newStart) })
        }
      }
    }

    const handleMouseUp = () => {
      setDragClip(null)
      setResizeClip(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragClip, resizeClip, scrollLeft, zoom, updateTimelineClip])

  // ── Click on ruler to set playhead ──
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + scrollLeft
    setCurrentTime(Math.max(0, x / zoom))
  }, [scrollLeft, zoom])

  // ── Click on empty area to set playhead ──
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('timeline-track')) return
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left + scrollLeft
    setCurrentTime(Math.max(0, x / zoom))
  }, [scrollLeft, zoom])

  // Keep playhead visible during playback
  useEffect(() => {
    if (!isPlaying || !timelineRef.current) return
    const playheadX = currentTime * zoom
    const viewWidth = timelineRef.current.clientWidth
    if (playheadX > scrollLeft + viewWidth - 60) {
      setScrollLeft(playheadX - 60)
    }
  }, [currentTime, isPlaying, zoom])

  // Timeline total width
  const maxEnd = useMemo(() => {
    const clipEnd = timelineClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
    return Math.max(totalDuration, clipEnd + 10)
  }, [timelineClips, totalDuration])
  const totalWidth = maxEnd * zoom

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
                setDragNewScene({ cuelistId: cl.id })
              }}
              onDragEnd={() => setDragNewScene(null)}
              className="px-2 py-1.5 rounded bg-surface-2 border border-surface-3 cursor-grab active:cursor-grabbing hover:border-accent/50 transition-colors flex items-center gap-2"
            >
              <div
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: CLIP_COLORS[idx % CLIP_COLORS.length] }}
              />
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
            <p className="text-[9px] text-gray-600 text-center py-4">
              No scenes yet.<br/>Create them in Scenes tab.
            </p>
          )}
        </div>
      </div>

      {/* ═══════ MAIN: Transport + Timeline ═══════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Transport bar ── */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-3 bg-surface-1 shrink-0">
          {/* Play / Stop */}
          <button
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              isPlaying
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-accent hover:bg-accent-light text-white'
            }`}
            onClick={() => isPlaying ? stopPlayback() : startPlayback()}
          >
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>

          {/* Back to start */}
          <button
            className="px-2 py-1 rounded text-xs bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={() => { setCurrentTime(0); playbackRef.current.activeClipIds.clear() }}
            title="Back to start"
          >
            ⏮
          </button>

          {/* Loop */}
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

          {/* Time display */}
          <div className="font-mono text-sm text-gray-300 min-w-[60px]">
            {formatTime(currentTime)}
          </div>

          <div className="flex-1" />

          {/* Zoom */}
          <span className="text-[10px] text-gray-500">Zoom</span>
          <input
            type="range"
            min={10}
            max={400}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-24 h-1 accent-accent"
          />
          <span className="text-[10px] text-gray-500 w-8">{zoom}px/s</span>

          <div className="w-px h-5 bg-surface-3" />

          {/* Duration */}
          <span className="text-[10px] text-gray-500">Durée</span>
          <input
            type="number"
            min={10}
            max={3600}
            value={totalDuration}
            onChange={(e) => setTotalDuration(Math.max(10, Number(e.target.value)))}
            className="w-14 text-xs bg-surface-3 border border-surface-4 rounded px-1 py-0.5 text-gray-300 text-center"
          />
          <span className="text-[10px] text-gray-600">s</span>
        </div>

        {/* ── Timeline area ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track headers (left) */}
          <div className="w-20 shrink-0 border-r border-surface-3 bg-surface-1 flex flex-col">
            <div className="h-8 border-b border-surface-3" /> {/* ruler spacer */}
            {Array.from({ length: trackCount }, (_, i) => (
              <div
                key={i}
                className="border-b border-surface-3/50 flex items-center justify-center text-[10px] text-gray-500"
                style={{ height: TRACK_HEIGHT }}
              >
                Track {i + 1}
              </div>
            ))}
          </div>

          {/* Scrollable timeline content */}
          <div
            ref={timelineRef}
            className="flex-1 overflow-auto relative"
            onWheel={handleWheel}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={handleTimelineDrop}
            onClick={handleTimelineClick}
            onScroll={(e) => setScrollLeft((e.target as HTMLElement).scrollLeft)}
          >
            {/* Container with total width */}
            <div className="relative" style={{ width: totalWidth, minHeight: trackCount * TRACK_HEIGHT + RULER_HEIGHT }}>
              {/* ── Time ruler ── */}
              <div
                className="sticky top-0 z-20 h-8 bg-surface-1 border-b border-surface-3 cursor-pointer"
                onClick={handleRulerClick}
              >
                <svg width={totalWidth} height={RULER_HEIGHT} className="block">
                  {Array.from({ length: Math.ceil(maxEnd) + 1 }, (_, i) => {
                    const x = i * zoom
                    const isMajor = i % 10 === 0
                    const isMinor = i % 5 === 0
                    return (
                      <g key={i}>
                        <line
                          x1={x} y1={isMajor ? 0 : isMinor ? 12 : 20}
                          x2={x} y2={RULER_HEIGHT}
                          stroke={isMajor ? '#555' : '#333'}
                          strokeWidth={isMajor ? 1 : 0.5}
                        />
                        {(isMajor || (isMinor && zoom > 30)) && (
                          <text x={x + 3} y={12} fill="#888" fontSize={9} fontFamily="monospace">
                            {formatTime(i)}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>

              {/* ── Track rows (backgrounds) ── */}
              {Array.from({ length: trackCount }, (_, i) => (
                <div
                  key={i}
                  className={`timeline-track absolute left-0 right-0 border-b border-surface-3/30 ${
                    i % 2 === 0 ? 'bg-surface-0/50' : 'bg-surface-2/30'
                  }`}
                  style={{ top: RULER_HEIGHT + i * TRACK_HEIGHT, height: TRACK_HEIGHT }}
                />
              ))}

              {/* ── Clips ── */}
              {timelineClips.map(clip => {
                const cuelist = cuelists.find(c => c.id === clip.cuelistId)
                const left = clip.startTime * zoom
                const width = clip.duration * zoom
                const top = RULER_HEIGHT + clip.trackIndex * TRACK_HEIGHT + 4
                const isDragging = dragClip?.clipId === clip.id
                const isResizing = resizeClip?.clipId === clip.id
                const clipColor = clip.color || '#e85d04'

                return (
                  <div
                    key={clip.id}
                    className={`absolute rounded shadow-md flex items-center overflow-hidden select-none group ${
                      isDragging || isResizing ? 'opacity-70 z-30' : 'z-10'
                    }`}
                    style={{
                      left, width: Math.max(width, 20), top,
                      height: TRACK_HEIGHT - 8,
                      backgroundColor: clipColor + 'cc',
                      border: `1px solid ${clipColor}`,
                      cursor: isDragging ? 'grabbing' : 'grab'
                    }}
                    onMouseDown={(e) => handleClipMouseDown(e, clip.id)}
                    onDoubleClick={() => removeTimelineClip(clip.id)}
                    title={`${cuelist?.name || '?'} — ${clip.duration.toFixed(1)}s (double-click to remove)`}
                  >
                    {/* Left resize handle */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20"
                      onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'left')}
                    />

                    {/* Clip label */}
                    <div className="flex-1 px-2 truncate text-[10px] text-white font-medium pointer-events-none">
                      {cuelist?.name || '?'}
                    </div>

                    {/* Duration badge */}
                    {width > 50 && (
                      <div className="text-[8px] text-white/60 pr-2 pointer-events-none shrink-0">
                        {clip.duration.toFixed(1)}s
                      </div>
                    )}

                    {/* Right resize handle */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-white/20"
                      onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'right')}
                    />
                  </div>
                )
              })}

              {/* ── Playhead ── */}
              <div
                className="absolute top-0 bottom-0 w-px bg-red-500 z-40 pointer-events-none"
                style={{ left: currentTime * zoom }}
              >
                <div className="absolute -top-0 -left-[5px] w-0 h-0 border-l-[5px] border-r-[5px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
