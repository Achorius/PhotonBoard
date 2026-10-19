// One clip on the timeline. Pointer gestures (mouse, pen, finger):
//   body       tap = select · drag = move (time + track) · Alt-drag = copy
//   edges      drag = trim start / end
//   fade dots  drag = fade-in / fade-out length
//   double-tap = open the scene · right-click / long-press = menu

import { memo, useRef, useState } from 'react'
import type React from 'react'
import { LuSparkles } from 'react-icons/lu'
import { cn, formatSeconds, palette, tint, usePointerDrag, withAlpha } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useCanvas } from './canvas-context'
import { MIN_CLIP_DURATION, duplicateClip, fitFades } from './timeline-model'
import { useTimelineView } from './timeline-view-store'

type Mode = 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut'

export interface TimelineClipProps {
  id: string
  cuelistId: string
  name: string
  color: string
  trackIndex: number
  startTime: number
  duration: number
  fadeIn: number
  fadeOut: number
  cueCount: number
  fxCount: number
  missing: boolean
  selected: boolean
  active: boolean
  onMenu: (e: React.MouseEvent, id: string) => void
}

export const TimelineClip = memo(function TimelineClip(p: TimelineClipProps) {
  const { zoom, g, timeAt, trackAt, snap } = useCanvas()
  const [drag, setDrag] = useState<Mode | null>(null)
  const gesture = useRef<{
    mode: Mode
    moved: boolean
    grab: number
    start: number
    duration: number
    fadeIn: number
    fadeOut: number
    copied: boolean
  } | null>(null)

  const left = p.startTime * zoom
  const width = Math.max(4, p.duration * zoom)
  const top = p.trackIndex * g.track + 4
  const height = g.track - 8
  const fiW = Math.min(width, p.fadeIn * zoom)
  const foW = Math.min(width, p.fadeOut * zoom)
  const touch = g.edge > 10
  const handleSize = touch ? 18 : 10

  const handlers = usePointerDrag({
    onStart: (s) => {
      const target = s.event.target as HTMLElement
      const mode = (target.closest('[data-handle]')?.getAttribute('data-handle') as Mode | null) ?? 'move'
      useTimelineView.getState().select({ kind: 'clip', id: p.id })
      gesture.current = {
        mode,
        moved: false,
        grab: timeAt(s.x) - p.startTime,
        start: p.startTime,
        duration: p.duration,
        fadeIn: p.fadeIn,
        fadeOut: p.fadeOut,
        copied: false
      }
    },
    onMove: (s) => {
      const gs = gesture.current
      if (!gs) return
      if (!gs.moved) {
        if (Math.abs(s.dx) < 4 && Math.abs(s.dy) < 4) return
        gs.moved = true
        setDrag(gs.mode)
      }
      const store = usePlaybackStore.getState()
      const t = timeAt(s.x)
      const end = gs.start + gs.duration
      switch (gs.mode) {
        case 'move': {
          if (s.event.altKey && !gs.copied) {
            // Leave a copy at the original place, keep dragging this one
            duplicateClip(p.id, gs.start)
            gs.copied = true
          }
          // Snap the start, or the end when that lands closer to the pointer position
          const raw = t - gs.grab
          const byStart = snap(raw, p.id)
          const byEnd = Math.max(0, snap(raw + gs.duration, p.id) - gs.duration)
          const start = Math.abs(byEnd - raw) < Math.abs(byStart - raw) ? byEnd : byStart
          store.updateTimelineClip(p.id, { startTime: start, trackIndex: trackAt(s.y) })
          break
        }
        case 'start': {
          const start = Math.max(0, Math.min(end - MIN_CLIP_DURATION, snap(t, p.id)))
          const duration = end - start
          store.updateTimelineClip(p.id, { startTime: start, duration, ...fitFades({ duration, fadeIn: gs.fadeIn, fadeOut: gs.fadeOut }) })
          break
        }
        case 'end': {
          const newEnd = Math.max(gs.start + MIN_CLIP_DURATION, snap(t, p.id))
          const duration = newEnd - gs.start
          store.updateTimelineClip(p.id, { duration, ...fitFades({ duration, fadeIn: gs.fadeIn, fadeOut: gs.fadeOut }) })
          break
        }
        case 'fadeIn': {
          const fi = Math.max(0, Math.min(gs.duration - gs.fadeOut, t - gs.start))
          store.updateTimelineClip(p.id, { fadeIn: Math.round(fi * 20) / 20 })
          break
        }
        case 'fadeOut': {
          const fo = Math.max(0, Math.min(gs.duration - gs.fadeIn, end - t))
          store.updateTimelineClip(p.id, { fadeOut: Math.round(fo * 20) / 20 })
          break
        }
      }
    },
    onEnd: () => {
      gesture.current = null
      setDrag(null)
    }
  })

  const showHandles = p.selected || drag !== null
  const label = p.missing ? 'Missing scene' : p.name
  const compactText = width < 56

  return (
    <div
      data-clip={p.id}
      role="button"
      tabIndex={-1}
      aria-label={`${label}, ${formatSeconds(p.startTime)} to ${formatSeconds(p.startTime + p.duration)}`}
      aria-pressed={p.selected}
      {...handlers}
      onDoubleClick={() => { if (!p.missing) useUiStore.getState().navigateToCuelist(p.cuelistId) }}
      onContextMenu={(e) => p.onMenu(e, p.id)}
      className={cn(
        'group absolute touch-none select-none overflow-hidden rounded',
        drag === 'move' ? 'z-30 cursor-grabbing shadow-popover' : 'z-10 cursor-grab',
        p.selected && 'z-20 outline outline-2 outline-offset-1 outline-info-fg',
        p.active && 'shadow-[inset_0_0_0_2px_rgb(var(--pb-go-fg))]'
      )}
      style={{
        left,
        top,
        width,
        height,
        backgroundColor: tint(p.missing ? palette.danger : p.color, p.active ? 0.55 : p.selected ? 0.42 : 0.32)
      }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: p.missing ? palette.danger : p.color }} />
      {/* Fade ramps */}
      {(fiW > 0 || foW > 0) && (
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
          {fiW > 0 && (
            <>
              <polygon points={`0,0 ${fiW},0 0,${height}`} fill={withAlpha(palette.surface0, 0.45)} />
              <line x1={0} y1={height} x2={fiW} y2={0} stroke={withAlpha(palette.fgPrimary, 0.55)} strokeWidth={1} />
            </>
          )}
          {foW > 0 && (
            <>
              <polygon points={`${width - foW},0 ${width},0 ${width},${height}`} fill={withAlpha(palette.surface0, 0.45)} />
              <line x1={width - foW} y1={0} x2={width} y2={height} stroke={withAlpha(palette.fgPrimary, 0.55)} strokeWidth={1} />
            </>
          )}
        </svg>
      )}

      {/* Label */}
      {!compactText && (
        <div className="pointer-events-none relative flex h-full min-w-0 flex-col justify-center gap-0.5 pl-2.5 pr-2">
          <div className={cn('flex min-w-0 items-center gap-1 text-xs font-semibold', p.missing ? 'text-danger-fg' : 'text-fg-primary')}>
            <span className="truncate">{label}</span>
            {p.fxCount > 0 && <LuSparkles size={11} aria-label={`${p.fxCount} effects`} className="shrink-0 text-fg-secondary" />}
          </div>
          {height >= 40 && (
            <div className="truncate font-mono text-2xs tabular text-fg-secondary">
              {drag ? formatSeconds(p.startTime) : formatSeconds(p.duration)}
              {!drag && p.cueCount > 1 && <span className="font-sans text-fg-tertiary"> · {p.cueCount} cues</span>}
            </div>
          )}
        </div>
      )}

      {/* Trim edges */}
      <div data-handle="start" aria-hidden className="absolute inset-y-0 left-0 cursor-ew-resize" style={{ width: Math.min(g.edge, width / 3) }}>
        {showHandles && <span className="absolute inset-y-2 left-0.5 w-1 rounded-full bg-fg-primary/70" />}
      </div>
      <div data-handle="end" aria-hidden className="absolute inset-y-0 right-0 cursor-ew-resize" style={{ width: Math.min(g.edge, width / 3) }}>
        {showHandles && <span className="absolute inset-y-2 right-0.5 w-1 rounded-full bg-fg-primary/70" />}
      </div>

      {/* Fade handles (visible on hover and when selected) */}
      {width > handleSize * 3 && (
        <>
          <div
            data-handle="fadeIn"
            aria-hidden
            className={cn('absolute top-0 flex cursor-ew-resize items-start justify-center', showHandles ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
            style={{ left: Math.min(width - handleSize * 2, Math.max(0, fiW - handleSize / 2)), width: handleSize, height: handleSize }}
          >
            <span className="mt-0.5 h-2 w-2 rounded-full bg-fg-primary ring-1 ring-surface-0 [[data-density=touch]_&]:h-3 [[data-density=touch]_&]:w-3" />
          </div>
          <div
            data-handle="fadeOut"
            aria-hidden
            className={cn('absolute top-0 flex cursor-ew-resize items-start justify-center', showHandles ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
            style={{ left: Math.max(handleSize, Math.min(width - handleSize, width - foW - handleSize / 2)), width: handleSize, height: handleSize }}
          >
            <span className="mt-0.5 h-2 w-2 rounded-full bg-fg-primary ring-1 ring-surface-0 [[data-density=touch]_&]:h-3 [[data-density=touch]_&]:w-3" />
          </div>
        </>
      )}
    </div>
  )
})
