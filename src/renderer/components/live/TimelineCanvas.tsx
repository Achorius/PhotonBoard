// ============================================================
// Timeline canvas: one scroll container with a sticky ruler,
// marker and section lanes, sticky track headers, the tracks
// with their clips, and the playhead (moved by the engine clock
// without re-rendering React).
//   wheel: scroll · Ctrl/Cmd+wheel or pinch: zoom around the pointer
//   keyboard (when focused): Space play/pause · Home rewind ·
//   ←/→ nudge · ↑/↓ change track · M marker · Esc deselect.
//   Delete / Backspace, Mod+D and F2 are the global selection actions
//   (registered by LiveView, see timeline-actions) — not handled here.
// ============================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  LuClapperboard, LuCopy, LuFlag, LuMapPin, LuPlus, LuScissors, LuTrash2
} from 'react-icons/lu'
import { Button, EmptyState, cn, palette, useContextMenu, useDensity, withAlpha, type MenuEntry } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { getActiveClipIds } from '@renderer/lib/timeline-engine'
import { transportRewind, transportToggle } from '@renderer/lib/timeline-transport'
import { CanvasContext, type CanvasContextValue } from './canvas-context'
import { TimelineClip } from './TimelineClip'
import { MarkerLane, Ruler, ZoneLane } from './TimelineLanes'
import { TrackHeader } from './TrackHeader'
import {
  GEOMETRY, MIN_CLIP_DURATION, addSceneClip, addTrack, clampZoom, clipEnd, rulerTicks,
  formatShortTime, snapStep, snapWithEdges, splitClip, trackName
} from './timeline-model'
import { addMarkerAt, deleteClip, duplicateClipAndSelect, seek } from './timeline-actions'
import {
  getCanvasApi, getClockTime, registerCanvasApi, subscribeTimelineTime, useTimelinePlaying, useTimelineView, zoomChosen
} from './timeline-view-store'

export function TimelineCanvas() {
  const t = useT()
  const density = useDensity()
  const g = GEOMETRY[density]
  const { zoom, snap: snapMode, bpm, timeDisplay, selection, followPlayhead, length } = useTimelineView(useShallow((s) => ({
    zoom: s.zoom, snap: s.snap, bpm: s.bpm, timeDisplay: s.timeDisplay, selection: s.selection, followPlayhead: s.followPlayhead, length: s.length
  })))
  const { clips, markers, zones, trackCount, trackNames, cuelists } = usePlaybackStore(useShallow((s) => ({
    clips: s.timelineClips, markers: s.timelineMarkers, zones: s.timelineZones,
    trackCount: s.timelineTrackCount, trackNames: s.timelineTrackNames, cuelists: s.cuelists
  })))
  const playing = useTimelinePlaying()
  const ctxMenu = useContextMenu()

  const scrollRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const playheadRefs = useRef<(HTMLDivElement | null)[]>([])
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [view, setView] = useState({ left: 0, width: 1200 })

  // ---- Geometry ----
  const contentEnd = useMemo(() => Math.max(
    clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0),
    zones.reduce((m, z) => Math.max(m, z.endTime), 0),
    markers.reduce((m, mk) => Math.max(m, mk.time), 0)
  ), [clips, zones, markers])
  const laneWidth = Math.max(view.width, (Math.max(length, contentEnd) + 30) * zoom)
  const ticks = useMemo(
    () => rulerTicks(view.left / zoom - 2, (view.left + view.width) / zoom + 2, zoom, timeDisplay === 'bars' ? 'bars' : 'time', bpm),
    [view.left, view.width, zoom, timeDisplay, bpm]
  )
  const majorTicks = useMemo(() => ticks.filter((t) => t.major), [ticks])
  const tracksHeight = trackCount * g.track

  // ---- Coordinates & snapping ----
  const timeAt = useCallback((clientX: number) => {
    const r = tracksRef.current?.getBoundingClientRect()
    return r ? Math.max(0, (clientX - r.left) / zoomRef.current) : 0
  }, [])
  const trackAt = useCallback((clientY: number) => {
    const r = tracksRef.current?.getBoundingClientRect()
    const count = usePlaybackStore.getState().timelineTrackCount
    return r ? Math.max(0, Math.min(count - 1, Math.floor((clientY - r.top) / g.track))) : 0
  }, [g.track])
  const snap = useCallback((t: number, exclude?: string) => {
    const { snap: mode, bpm: tempo } = useTimelineView.getState()
    if (mode === 'off') return Math.max(0, t)
    const pb = usePlaybackStore.getState()
    const edges: number[] = [0, getClockTime()]
    for (const c of pb.timelineClips) if (c.id !== exclude) edges.push(c.startTime, clipEnd(c))
    for (const m of pb.timelineMarkers) edges.push(m.time)
    return snapWithEdges(t, snapStep(mode, tempo), edges, 8 / zoomRef.current)
  }, [])
  const openMenu = useCallback<CanvasContextValue['openMenu']>((e, items) => ctxMenu.open(e, items), [ctxMenu.open])
  const ctx = useMemo<CanvasContextValue>(() => ({ zoom, g, timeAt, trackAt, snap, openMenu }), [zoom, g, timeAt, trackAt, snap, openMenu])

  // ---- Visible range (ruler ticks) ----
  const syncView = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = { left: el.scrollLeft, width: Math.max(100, el.clientWidth - g.header) }
    setView((v) => (Math.abs(v.left - next.left) < 1 && v.width === next.width ? v : next))
  }, [g.header])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(syncView) }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(syncView)
    ro.observe(el)
    syncView()
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [syncView])

  // ---- Playhead (DOM only) ----
  const placePlayhead = useCallback((t: number) => {
    const x = t * zoomRef.current
    for (const el of playheadRefs.current) if (el) el.style.transform = `translateX(${x}px)`
    const sc = scrollRef.current
    if (sc && useTimelineView.getState().followPlayhead && usePlayingRef.current) {
      const w = sc.clientWidth - g.header
      if (x > sc.scrollLeft + w - 48 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - w * 0.1)
    }
  }, [g.header])
  const usePlayingRef = useRef(playing)
  usePlayingRef.current = playing
  useEffect(() => subscribeTimelineTime(placePlayhead), [placePlayhead])
  useLayoutEffect(() => { placePlayhead(getClockTime()) }, [zoom, placePlayhead, trackCount])

  // ---- Active clips (≤ 4 Hz while playing) ----
  const [activeKey, setActiveKey] = useState('')
  useEffect(() => {
    if (!playing) { setActiveKey(''); return }
    const poll = () => {
      const key = [...getActiveClipIds()].sort().join('|')
      setActiveKey((k) => (k === key ? k : key))
    }
    poll()
    const id = setInterval(poll, 250)
    return () => clearInterval(id)
  }, [playing])
  const activeIds = useMemo(() => new Set(activeKey ? activeKey.split('|') : []), [activeKey])

  // ---- Zoom keeping a time anchored ----
  const pendingAnchor = useRef<{ time: number; offset: number } | null>(null)
  const zoomTo = useCallback((next: number, anchorTime?: number) => {
    const sc = scrollRef.current
    const z = clampZoom(next)
    if (!sc) { useTimelineView.getState().setZoom(z); return }
    const w = sc.clientWidth - g.header
    const ph = getClockTime() * zoomRef.current
    const t = anchorTime ?? (ph >= sc.scrollLeft && ph <= sc.scrollLeft + w ? getClockTime() : (sc.scrollLeft + w / 2) / zoomRef.current)
    pendingAnchor.current = { time: t, offset: t * zoomRef.current - sc.scrollLeft }
    useTimelineView.getState().setZoom(z)
  }, [g.header])
  useLayoutEffect(() => {
    const a = pendingAnchor.current
    const sc = scrollRef.current
    if (!a || !sc) return
    pendingAnchor.current = null
    sc.scrollLeft = Math.max(0, a.time * zoom - a.offset)
    syncView()
  }, [zoom, syncView])

  useEffect(() => {
    registerCanvasApi({
      zoomTo,
      fit: () => {
        const sc = scrollRef.current
        if (!sc) return
        const pb = usePlaybackStore.getState()
        const end = Math.max(10,
          pb.timelineClips.reduce((m, c) => Math.max(m, clipEnd(c)), 0),
          pb.timelineZones.reduce((m, z) => Math.max(m, z.endTime), 0),
          pb.timelineMarkers.reduce((m, mk) => Math.max(m, mk.time), 0))
        pendingAnchor.current = { time: 0, offset: 0 }
        useTimelineView.getState().setZoom(clampZoom((sc.clientWidth - g.header - 24) / end))
      },
      reveal: (t) => {
        const sc = scrollRef.current
        if (!sc) return
        const x = t * zoomRef.current
        const w = sc.clientWidth - g.header
        if (x < sc.scrollLeft || x > sc.scrollLeft + w - 32) sc.scrollLeft = Math.max(0, x - w * 0.25)
      },
      dropTarget: (x, y) => {
        const sc = scrollRef.current?.getBoundingClientRect()
        const r = tracksRef.current?.getBoundingClientRect()
        if (!sc || !r) return null
        if (x < r.left || x > sc.right || y < r.top || y > Math.min(sc.bottom, r.top + tracksHeight)) return null
        return { time: snap(timeAt(x)), track: trackAt(y) }
      }
    })
    return () => registerCanvasApi(null)
  }, [zoomTo, g.header, snap, timeAt, trackAt, tracksHeight])

  // First open: fit the whole show in view
  useEffect(() => {
    if (!zoomChosen && usePlaybackStore.getState().timelineClips.length > 0) getCanvasApi()?.fit()
  }, [])

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms around the pointer
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.004), timeAt(e.clientX))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo, timeAt])

  // Two-finger pinch zoom (touch). Native touch events: the browser would
  // otherwise turn the second finger into a page pinch / cancel the pointers.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let pinch: { dist: number; zoom: number; time: number } | null = null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: dist(e.touches), zoom: zoomRef.current, time: timeAt(mid(e.touches)) }
    }
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return
      if (e.cancelable) e.preventDefault()
      const ratio = dist(e.touches) / Math.max(1, pinch.dist)
      zoomTo(pinch.zoom * ratio, pinch.time)
    }
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [zoomTo, timeAt])

  // ---- Menus ----
  const clipMenu = useCallback((e: React.MouseEvent, id: string) => {
    const pb = usePlaybackStore.getState()
    const clip = pb.timelineClips.find((c) => c.id === id)
    if (!clip) return
    useTimelineView.getState().select({ kind: 'clip', id })
    const now = getClockTime()
    const canSplit = now > clip.startTime + MIN_CLIP_DURATION && now < clipEnd(clip) - MIN_CLIP_DURATION
    ctxMenu.open(e, [
      { label: t('timeline.clip.editScene'), icon: LuClapperboard, onSelect: () => useUiStore.getState().navigateToCuelist(clip.cuelistId) },
      { label: t('timeline.clip.goToStart'), icon: LuFlag, onSelect: () => seek(clip.startTime) },
      { label: t('common.duplicate'), icon: LuCopy, shortcut: 'Mod+D', onSelect: () => duplicateClipAndSelect(id) },
      { label: t('timeline.clip.splitAtPlayhead'), icon: LuScissors, disabled: !canSplit, onSelect: () => { splitClip(id, now) } },
      { type: 'separator' },
      { label: t('timeline.clip.removeFromTimeline'), icon: LuTrash2, danger: true, shortcut: 'Delete', onSelect: () => { void deleteClip(id) } }
    ])
  }, [ctxMenu, t])

  const trackAreaMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-clip]')) return
    const at = snap(timeAt(e.clientX))
    const track = trackAt(e.clientY)
    const scenes = usePlaybackStore.getState().cuelists
    const items: MenuEntry[] = [
      { type: 'label', label: `${trackName(usePlaybackStore.getState().timelineTrackNames, track)} · ${formatShortTime(at)}` },
      {
        label: t('timeline.menu.addSceneHere'),
        icon: LuPlus,
        disabled: scenes.length === 0,
        submenu: scenes.map((cl) => ({ label: cl.name, onSelect: () => { const id = addSceneClip(cl.id, track, at); useTimelineView.getState().select({ kind: 'clip', id }) } }))
      },
      { label: t('timeline.menu.addMarkerHere'), icon: LuFlag, onSelect: () => addMarkerAt(at) },
      { label: t('timeline.menu.movePlayheadHere'), icon: LuMapPin, onSelect: () => seek(at) }
    ]
    ctxMenu.open(e, items)
  }, [ctxMenu, snap, timeAt, trackAt, t])

  // ---- Keyboard (focused canvas only; consumed keys never reach the global shortcuts).
  // Delete / Backspace / Mod+D / F2 are not consumed: the global selection actions handle them. ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    const sel = useTimelineView.getState().selection
    const pb = usePlaybackStore.getState()
    const consume = () => { e.preventDefault(); e.stopPropagation() }
    const mod = e.metaKey || e.ctrlKey
    if (e.key === ' ') { consume(); if (!e.repeat) transportToggle(); return }
    if (e.key === 'Home') { consume(); transportRewind(); scrollRef.current?.scrollTo({ left: 0 }); return }
    if (e.key === 'Escape' && sel) { consume(); useTimelineView.getState().select(null); return }
    if ((e.key === 'm' || e.key === 'M') && !mod) { consume(); if (!e.repeat) addMarkerAt(snap(getClockTime())); return }
    if (!sel) return
    if (sel.kind === 'clip') {
      const clip = pb.timelineClips.find((c) => c.id === sel.id)
      if (!clip) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        consume()
        const step = snapStep(useTimelineView.getState().snap, useTimelineView.getState().bpm) || 0.1
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        pb.updateTimelineClip(clip.id, { startTime: Math.max(0, clip.startTime + dir * step * (e.shiftKey ? 4 : 1)) })
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        consume()
        const track = Math.max(0, Math.min(pb.timelineTrackCount - 1, clip.trackIndex + (e.key === 'ArrowUp' ? -1 : 1)))
        pb.updateTimelineClip(clip.id, { trackIndex: track })
      }
    }
  }

  // ---- Render data ----
  const sceneById = useMemo(() => new Map(cuelists.map((c) => [c.id, c])), [cuelists])
  const clipCounts = useMemo(() => {
    const counts = new Array<number>(trackCount).fill(0)
    for (const c of clips) if (c.trackIndex < trackCount) counts[c.trackIndex]++
    return counts
  }, [clips, trackCount])
  const selClip = selection?.kind === 'clip' ? selection.id : null
  const selMarker = selection?.kind === 'marker' ? selection.id : null
  const selZone = selection?.kind === 'zone' ? selection.id : null
  const selTrack = selection?.kind === 'track' ? selection.index : null
  const playheadRef = (i: number) => (el: HTMLDivElement | null) => { playheadRefs.current[i] = el }

  const cornerCls = 'sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-surface-1 px-3 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary'

  return (
    <CanvasContext.Provider value={ctx}>
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={t('common.timeline')}
        className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-surface-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-info-fg/50"
      >
        <div className="relative" style={{ width: g.header + laneWidth, minHeight: '100%' }}>
          {/* Ruler */}
          <div className="sticky top-0 z-40 flex" style={{ height: g.ruler }}>
            <div className={cn(cornerCls, 'z-50 border-b')} style={{ width: g.header }}>
              {timeDisplay === 'bars' ? t('timeline.canvas.barsCorner', { bpm: Math.round(bpm) }) : t('timeline.canvas.timeCorner')}
            </div>
            <div className="relative">
              <Ruler ticks={ticks} width={laneWidth} length={length} />
              <div ref={playheadRef(0)} className="pointer-events-none absolute left-0 top-0 h-full" aria-hidden>
                <div className="absolute -left-[5px] bottom-0 h-2.5 w-[11px] rounded-b-sm bg-accent" />
                <div className="absolute left-0 top-0 h-full w-px bg-accent" />
              </div>
            </div>
          </div>

          {/* Markers */}
          <div className="sticky z-30 flex" style={{ top: g.ruler, height: g.markerLane }}>
            <div className={cn(cornerCls, 'border-b border-b-line-subtle')} style={{ width: g.header }}>{t('timeline.canvas.markers')}</div>
            <div className="relative">
              <MarkerLane markers={markers} width={laneWidth} selectedId={selMarker} />
              <div ref={playheadRef(1)} className="pointer-events-none absolute left-0 top-0 h-full w-px bg-accent" aria-hidden />
            </div>
          </div>

          {/* Sections */}
          <div className="sticky z-30 flex" style={{ top: g.ruler + g.markerLane, height: g.zoneLane }}>
            <div className={cn(cornerCls, 'border-b')} style={{ width: g.header }}>{t('timeline.canvas.sections')}</div>
            <div className="relative">
              <ZoneLane zones={zones} width={laneWidth} selectedId={selZone} />
              <div ref={playheadRef(2)} className="pointer-events-none absolute left-0 top-0 h-full w-px bg-accent" aria-hidden />
            </div>
          </div>

          {/* Tracks */}
          <div className="flex">
            <div className="sticky left-0 z-20 flex shrink-0 flex-col border-r border-line bg-surface-1" style={{ width: g.header }}>
              {Array.from({ length: trackCount }, (_, i) => (
                <TrackHeader
                  key={i}
                  index={i}
                  name={trackName(trackNames, i)}
                  customName={!!trackNames[i]}
                  clipCount={clipCounts[i] ?? 0}
                  trackCount={trackCount}
                  height={g.track}
                  selected={selTrack === i}
                />
              ))}
              <div className="flex items-center px-2 py-1.5">
                <Button size="sm" variant="ghost" icon={LuPlus} onClick={() => addTrack()} fullWidth className="justify-start">{t('timeline.track.add')}</Button>
              </div>
            </div>

            <div
              ref={tracksRef}
              className="relative"
              style={{ width: laneWidth, height: clips.length === 0 ? Math.max(tracksHeight, 280) : tracksHeight }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-clip]')) return
                useTimelineView.getState().select(null)
                seek(timeAt(e.clientX))
              }}
              onContextMenu={trackAreaMenu}
            >
              {/* Track rows */}
              {Array.from({ length: trackCount }, (_, i) => (
                <div
                  key={i}
                  className={cn('absolute inset-x-0 border-b border-line-subtle', i % 2 ? 'bg-surface-1/40' : 'bg-transparent', selTrack === i && 'bg-info/[0.06]')}
                  style={{ top: i * g.track, height: g.track }}
                />
              ))}
              {/* Grid */}
              {majorTicks.map((tk) => (
                <div key={tk.t} className="pointer-events-none absolute inset-y-0 w-px bg-line-subtle" style={{ left: tk.t * zoom }} />
              ))}
              {/* End of timeline */}
              <div className="pointer-events-none absolute inset-y-0 right-0 bg-surface-0/70" style={{ left: length * zoom }}>
                <div className="absolute inset-y-0 left-0 w-px bg-line-strong" />
              </div>
              {/* Sections & markers behind clips */}
              {zones.map((z) => (
                <div
                  key={z.id}
                  className="pointer-events-none absolute inset-y-0"
                  style={{ left: z.startTime * zoom, width: (z.endTime - z.startTime) * zoom, backgroundColor: withAlpha(z.color || palette.info, 0.05) }}
                />
              ))}
              {markers.map((m) => (
                <div key={m.id} className="pointer-events-none absolute inset-y-0 w-px" style={{ left: m.time * zoom, backgroundColor: withAlpha(m.color || palette.warning, 0.5) }} />
              ))}

              {clips.map((c) => {
                const scene = sceneById.get(c.cuelistId)
                return (
                  <TimelineClip
                    key={c.id}
                    id={c.id}
                    cuelistId={c.cuelistId}
                    name={c.name || scene?.name || t('common.scene')}
                    color={c.color || palette.accent}
                    trackIndex={Math.min(c.trackIndex, trackCount - 1)}
                    startTime={c.startTime}
                    duration={c.duration}
                    fadeIn={c.fadeIn ?? 0}
                    fadeOut={c.fadeOut ?? 0}
                    cueCount={scene?.cues.length ?? 0}
                    fxCount={scene?.effectSnapshots?.length ?? 0}
                    missing={!scene}
                    selected={c.id === selClip}
                    active={activeIds.has(c.id)}
                    onMenu={clipMenu}
                  />
                )
              })}

              <div ref={playheadRef(3)} className="pointer-events-none absolute left-0 top-0 z-40 h-full w-px bg-accent shadow-[0_0_6px_rgb(var(--pb-accent)/0.6)]" aria-hidden />

              {clips.length === 0 && <TimelineEmpty hasScenes={cuelists.length > 0} />}
            </div>
          </div>
        </div>
      </div>
      {ctxMenu.menu}
    </CanvasContext.Provider>
  )
}

function TimelineEmpty({ hasScenes }: { hasScenes: boolean }) {
  const t = useT()
  return (
    <div className="pointer-events-none sticky left-0 top-0 flex h-full items-center justify-center" style={{ width: 'min(100%, 640px)' }}>
      <div className="pointer-events-auto rounded-lg bg-surface-1/90 shadow-popover ring-1 ring-line" onClick={(e) => e.stopPropagation()}>
        {hasScenes ? (
          <EmptyState
            size="sm"
            icon={LuClapperboard}
            title={t('timeline.canvas.emptyTitle')}
            description={t('timeline.canvas.emptyDescription')}
          />
        ) : (
          <EmptyState
            size="sm"
            icon={LuClapperboard}
            title={t('timeline.canvas.noScenesTitle')}
            description={t('timeline.canvas.noScenesDescription')}
            action={<Button variant="primary" icon={LuClapperboard} onClick={() => useUiStore.getState().setActiveTab('playback')}>{t('timeline.openScenes')}</Button>}
          />
        )}
      </div>
    </div>
  )
}
