// Transport bar: playback controls, big time readout, timecode status,
// grid (snap + tempo), zoom and view options.

import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  LuChevronDown, LuFlag, LuMoveHorizontal, LuPanelLeft, LuPause, LuPlay, LuRepeat, LuSkipBack, LuSquare,
  LuStepBack, LuStepForward, LuZoomIn, LuZoomOut, LuSlidersHorizontal
} from 'react-icons/lu'
import {
  Button, Divider, Field, IconButton, NumberField, Popover, SegmentedControl, Select, Switch, Tooltip, cn, formatClock, usePopover
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiLearnTarget } from '@renderer/components/layout/MasterControls'
import { transportRewind, transportStop, transportToggle } from '@renderer/lib/timeline-transport'
import { formatSecondsAsTimecode, getTimecodeFramerate } from '@renderer/lib/timecode-engine'
import { TimecodeButton } from './TimecodePanel'
import { SNAP_OPTIONS, formatBars, type SnapMode, type TimeDisplay } from './timeline-model'
import { addMarkerAt, seek } from './timeline-actions'
import { getCanvasApi, getClockTime, subscribeTimelineTime, useTimelinePlaying, useTimelineView } from './timeline-view-store'

export function TransportBar() {
  const playing = useTimelinePlaying()
  const { looping, libraryOpen, snap, bpm, zoom } = useTimelineView(useShallow((s) => ({
    looping: s.looping, libraryOpen: s.libraryOpen, snap: s.snap, bpm: s.bpm, zoom: s.zoom
  })))
  const playMidi = useMidiLearnTarget('timeline_play', 'Timeline play / pause')
  const stopMidi = useMidiLearnTarget('timeline_stop', 'Timeline stop')
  const rewindMidi = useMidiLearnTarget('timeline_rewind', 'Timeline rewind')

  const jumpMarker = (dir: 1 | -1) => {
    const markers = usePlaybackStore.getState().timelineMarkers
    const t = getClockTime()
    const target = dir > 0 ? markers.find((m) => m.time > t + 0.05) : [...markers].reverse().find((m) => m.time < t - 0.25)
    if (target) seek(target.time, true)
    else if (dir < 0) seek(0, true)
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-1 px-3 py-2">
      {/* Transport */}
      <div className="flex items-center gap-1" role="group" aria-label="Transport">
        <IconButton icon={LuSkipBack} label="Rewind to start (Home) · right-click: MIDI learn" variant="secondary"
          onClick={() => { transportRewind(); getCanvasApi()?.reveal(0) }} onContextMenu={rewindMidi.onContextMenu} className={rewindMidi.ring} />
        <IconButton icon={LuStepBack} label="Previous marker" variant="secondary" onClick={() => jumpMarker(-1)} />
        <Button
          data-transport="play"
          size="lg"
          tone="go"
          variant="secondary"
          active={playing}
          icon={playing ? LuPause : LuPlay}
          onClick={transportToggle}
          onContextMenu={playMidi.onContextMenu}
          tooltip={`${playing ? 'Pause' : 'Play'} (Space) · right-click: MIDI learn`}
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
          className={cn('min-w-[92px] [[data-density=touch]_&]:min-w-[112px]', playMidi.ring)}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <IconButton
          data-transport="stop"
          icon={LuSquare}
          label="Stop (press again: back to start) · right-click: MIDI learn"
          variant="secondary"
          onClick={() => { if (transportStop()) getCanvasApi()?.reveal(0) }}
          onContextMenu={stopMidi.onContextMenu}
          className={stopMidi.ring}
        />
        <IconButton icon={LuStepForward} label="Next marker" variant="secondary" onClick={() => jumpMarker(1)} />
        <IconButton
          icon={LuRepeat}
          label={looping ? 'Loop on — restart at the end' : 'Loop off'}
          variant="secondary"
          tone="info"
          active={looping}
          onClick={() => useTimelineView.getState().setLooping(!looping)}
        />
      </div>

      <TimeReadout />
      <TimecodeButton />

      <div className="flex-1" />

      {/* Grid & zoom */}
      <div className="flex items-center gap-2">
        <Tooltip content="Snap clips, markers and sections to this grid">
          <div>
            <Select<SnapMode>
              aria-label="Snap"
              size="sm"
              value={snap}
              onChange={(v) => useTimelineView.getState().setSnap(v)}
              options={SNAP_OPTIONS}
              className="w-[104px]"
            />
          </div>
        </Tooltip>
        {(snap === 'beat' || snap === 'bar') && (
          <NumberField aria-label="Grid tempo" size="sm" value={bpm} min={20} max={400} step={1} unit="BPM"
            onChange={(v) => useTimelineView.getState().setBpm(v)} className="w-[96px]" />
        )}
        <Divider />
        <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
          <IconButton icon={LuZoomOut} label="Zoom out (Ctrl+wheel, pinch)" size="sm" onClick={() => getCanvasApi()?.zoomTo(zoom / 1.5)} />
          <IconButton icon={LuZoomIn} label="Zoom in" size="sm" onClick={() => getCanvasApi()?.zoomTo(zoom * 1.5)} />
          <IconButton icon={LuMoveHorizontal} label="Zoom to fit" size="sm" onClick={() => getCanvasApi()?.fit()} />
        </div>
        <Divider />
        <Button size="sm" variant="ghost" icon={LuFlag} onClick={() => addMarkerAt(getClockTime())} tooltip="Add a marker at the playhead (M)" labelClassName="hidden 2xl:inline">Marker</Button>
        <ViewOptions />
        <IconButton icon={LuPanelLeft} label={libraryOpen ? 'Hide library' : 'Show library'} size="sm" active={libraryOpen} tone="neutral"
          onClick={() => useTimelineView.getState().setLibraryOpen(!libraryOpen)} />
      </div>
    </div>
  )
}

/** Big playhead readout. Tap to cycle time / timecode / bars. Updated from the clock without React renders. */
function TimeReadout() {
  const display = useTimelineView((s) => s.timeDisplay)
  const bpm = useTimelineView((s) => s.bpm)
  const textRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const render = (t: number) => {
      if (!textRef.current) return
      textRef.current.textContent = display === 'timecode'
        ? formatSecondsAsTimecode(t, getTimecodeFramerate())
        : display === 'bars' ? formatBars(t, bpm) : formatClock(t)
    }
    render(getClockTime())
    return subscribeTimelineTime(render)
  }, [display, bpm])
  const next: Record<TimeDisplay, TimeDisplay> = { time: 'timecode', timecode: 'bars', bars: 'time' }
  const caption = display === 'timecode' ? 'TIMECODE' : display === 'bars' ? `BARS · ${Math.round(bpm)}` : 'TIME'
  return (
    <button
      type="button"
      onClick={() => useTimelineView.getState().setTimeDisplay(next[display])}
      title="Tap to switch between time, timecode and bars"
      className="flex h-control-lg min-w-[168px] flex-col items-start justify-center rounded bg-surface-0 px-3 ring-1 ring-inset ring-line hover:ring-line-strong [[data-density=touch]_&]:min-w-[200px]"
    >
      <span ref={textRef} className="font-mono text-xl font-medium leading-none tabular text-fg-primary [[data-density=touch]_&]:text-2xl">00:00.0</span>
      <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] text-fg-tertiary">
        {caption}
        <LuChevronDown size={10} aria-hidden />
      </span>
    </button>
  )
}

function ViewOptions() {
  const pop = usePopover()
  const { followPlayhead, timeDisplay, length, bpm } = useTimelineView(useShallow((s) => ({
    followPlayhead: s.followPlayhead, timeDisplay: s.timeDisplay, length: s.length, bpm: s.bpm
  })))
  return (
    <>
      <IconButton ref={pop.anchorRef} {...pop.triggerProps} icon={LuSlidersHorizontal} label="Timeline options" size="sm" active={pop.open} tone="neutral" onClick={pop.toggle} />
      <Popover {...pop.props} placement="bottom-end" aria-label="Timeline options" className="w-[320px] [[data-density=touch]_&]:w-[380px]">
        <div className="flex flex-col gap-3 p-3">
          <h2 className="text-sm font-semibold">Timeline options</h2>
          <Field label="Time display">
            <SegmentedControl<TimeDisplay>
              fullWidth
              aria-label="Time display"
              value={timeDisplay}
              onChange={(v) => useTimelineView.getState().setTimeDisplay(v)}
              items={[{ value: 'time', label: 'Time' }, { value: 'timecode', label: 'TC' }, { value: 'bars', label: 'Bars' }]}
            />
          </Field>
          <Field label="Grid tempo" hint="Used by bar / beat snapping and the bars ruler">
            <NumberField aria-label="Grid tempo" value={bpm} min={20} max={400} step={1} unit="BPM" onChange={(v) => useTimelineView.getState().setBpm(v)} />
          </Field>
          <Field label="Length" hint="Playback stops (or loops) here, unless clips run longer">
            <NumberField aria-label="Timeline length" value={length} min={10} max={36000} step={1} unit="s" onChange={(v) => useTimelineView.getState().setLength(v)} />
          </Field>
          <Switch
            checked={followPlayhead}
            onChange={(v) => useTimelineView.getState().setFollowPlayhead(v)}
            label="Follow playhead"
            description="Scroll the view to keep the playhead visible while playing"
          />
        </div>
      </Popover>
    </>
  )
}
