// ============================================================
// LiveView — DAW-style show timeline.
//   TransportBar   play / stop / loop, time, timecode, grid, zoom
//   LibraryPanel   scenes to place, markers, sections
//   TimelineCanvas ruler, markers, sections, tracks and clips
//   Inspector      properties of the selected item
// Files: timeline-model (pure ops), timeline-view-store (UI state + engine clock),
// timeline-actions (edits with confirmation).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { LuClapperboard } from 'react-icons/lu'
import { ResizeHandle, cn, useResizable } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { Inspector } from './Inspector'
import { LibraryPanel } from './LibraryPanel'
import { TimelineCanvas } from './TimelineCanvas'
import { TransportBar } from './TransportBar'
import { getCanvasApi, useTimelineView } from './timeline-view-store'
import { formatShortTime } from './timeline-model'

export function LiveView() {
  const libraryOpen = useTimelineView((s) => s.libraryOpen)
  const hasSelection = useTimelineView((s) => s.selection !== null)
  const library = useResizable({ initial: 272, min: 248, max: 420, storageKey: 'timeline.library' })
  const inspector = useResizable({ initial: 300, min: 264, max: 460, storageKey: 'timeline.inspector', direction: -1 })
  // Narrow screens (tablet): the inspector floats over the timeline instead of squeezing it
  const bodyRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 1080))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TransportBar />
      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
        {libraryOpen && (
          <>
            <div className="h-full shrink-0 border-r border-line" style={{ width: library.size }}>
              <LibraryPanel />
            </div>
            <ResizeHandle {...library.handleProps} />
          </>
        )}
        <TimelineCanvas />
        {hasSelection && !narrow && (
          <>
            <ResizeHandle {...inspector.handleProps} />
            <div className="h-full shrink-0 border-l border-line" style={{ width: inspector.size }}>
              <Inspector />
            </div>
          </>
        )}
        {hasSelection && narrow && (
          <div className="absolute inset-y-0 right-0 z-popover w-[300px] border-l border-line shadow-modal animate-fade-in [[data-density=touch]_&]:w-[340px]">
            <Inspector />
          </div>
        )}
      </div>
      <DragGhost />
    </div>
  )
}

/** Follows the pointer while a scene is dragged from the library */
function DragGhost() {
  const drag = useTimelineView((s) => s.libraryDrag)
  const name = usePlaybackStore((s) => (drag ? s.cuelists.find((c) => c.id === drag.cuelistId)?.name : undefined))
  const trackNames = usePlaybackStore((s) => s.timelineTrackNames)
  if (!drag) return null
  const target = drag.over ? getCanvasApi()?.dropTarget(drag.x, drag.y) : null
  return (
    <div
      className="pointer-events-none fixed z-tooltip flex items-center gap-2 rounded-lg bg-surface-overlay px-3 py-2 text-sm shadow-popover ring-1 ring-line-strong"
      style={{ left: drag.x + 14, top: drag.y + 10 }}
    >
      <LuClapperboard size={14} aria-hidden className="text-fg-tertiary" />
      <span className="font-medium">{name ?? 'Scene'}</span>
      <span className={cn('text-xs', target ? 'text-go-fg' : 'text-fg-tertiary')}>
        {target ? `${trackNames[target.track] || `Track ${target.track + 1}`} at ${formatShortTime(target.time)}` : 'Drop on a track'}
      </span>
    </div>
  )
}
