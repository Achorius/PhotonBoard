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
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiLearnTarget } from '@renderer/components/layout/MasterControls'
import { transportRewind, transportStop, transportToggle } from '@renderer/lib/timeline-transport'
import { formatSecondsAsTimecode, getTimecodeFramerate } from '@renderer/lib/timecode-engine'
import { TimecodeButton } from './TimecodePanel'
import { formatBars, snapOptions, type SnapMode, type TimeDisplay } from './timeline-model'
import { addMarkerAt, seek } from './timeline-actions'
import { getCanvasApi, getClockTime, subscribeTimelineTime, useTimelinePlaying, useTimelineView } from './timeline-view-store'

export function TransportBar() {
  const t = useT()
  const playing = useTimelinePlaying()
  const { looping, libraryOpen, snap, bpm, zoom } = useTimelineView(useShallow((s) => ({
    looping: s.looping, libraryOpen: s.libraryOpen, snap: s.snap, bpm: s.bpm, zoom: s.zoom
  })))
  const playMidi = useMidiLearnTarget('timeline_play', t('timeline.midi.playTarget'))
  const stopMidi = useMidiLearnTarget('timeline_stop', t('timeline.midi.stopTarget'))
  const rewindMidi = useMidiLearnTarget('timeline_rewind', t('timeline.midi.rewindTarget'))

  const jumpMarker = (dir: 1 | -1) => {
    const markers = usePlaybackStore.getState().timelineMarkers
    const now = getClockTime()
    const target = dir > 0 ? markers.find((m) => m.time > now + 0.05) : [...markers].reverse().find((m) => m.time < now - 0.25)
    if (target) seek(target.time, true)
    else if (dir < 0) seek(0, true)
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-1 px-3 py-2">
      {/* Transport */}
      <div className="flex items-center gap-1" role="group" aria-label={t('timeline.transport.aria')}>
        <IconButton icon={LuSkipBack} label={t('timeline.transport.rewind')} variant="secondary"
          onClick={() => { transportRewind(); getCanvasApi()?.reveal(0) }} onContextMenu={rewindMidi.onContextMenu} className={rewindMidi.ring} />
        <IconButton icon={LuStepBack} label={t('timeline.transport.previousMarker')} variant="secondary" onClick={() => jumpMarker(-1)} />
        <Button
          data-transport="play"
          size="lg"
          tone="go"
          variant="secondary"
          active={playing}
          icon={playing ? LuPause : LuPlay}
          onClick={transportToggle}
          onContextMenu={playMidi.onContextMenu}
          tooltip={playing ? t('timeline.transport.pauseTooltip') : t('timeline.transport.playTooltip')}
          aria-label={playing ? t('timeline.transport.pauseAria') : t('timeline.transport.playAria')}
          className={cn('min-w-[92px] [[data-density=touch]_&]:min-w-[112px]', playMidi.ring)}
        >
          {playing ? t('common.pause') : t('common.play')}
        </Button>
        <IconButton
          data-transport="stop"
          icon={LuSquare}
          label={t('timeline.transport.stop')}
          variant="secondary"
          onClick={() => { if (transportStop()) getCanvasApi()?.reveal(0) }}
          onContextMenu={stopMidi.onContextMenu}
          className={stopMidi.ring}
        />
        <IconButton icon={LuStepForward} label={t('timeline.transport.nextMarker')} variant="secondary" onClick={() => jumpMarker(1)} />
        <IconButton
          icon={LuRepeat}
          label={looping ? t('timeline.transport.loopOn') : t('timeline.transport.loopOff')}
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
        <Tooltip content={t('timeline.snap.tooltip')}>
          <div>
            <Select<SnapMode>
              aria-label={t('timeline.snap.aria')}
              size="sm"
              value={snap}
              onChange={(v) => useTimelineView.getState().setSnap(v)}
              options={snapOptions(t)}
              className="w-[104px] [[data-density=touch]_&]:w-[120px]"
            />
          </div>
        </Tooltip>
        {(snap === 'beat' || snap === 'bar') && (
          <NumberField aria-label={t('timeline.options.gridTempo')} size="sm" value={bpm} min={20} max={400} step={1} unit="BPM"
            onChange={(v) => useTimelineView.getState().setBpm(v)} className="w-[96px]" />
        )}
        <Divider />
        <div className="flex items-center gap-0.5" role="group" aria-label={t('timeline.zoom.aria')}>
          <IconButton icon={LuZoomOut} label={t('timeline.zoom.out')} size="sm" onClick={() => getCanvasApi()?.zoomTo(zoom / 1.5)} />
          <IconButton icon={LuZoomIn} label={t('timeline.zoom.in')} size="sm" onClick={() => getCanvasApi()?.zoomTo(zoom * 1.5)} />
          <IconButton icon={LuMoveHorizontal} label={t('timeline.zoom.fit')} size="sm" onClick={() => getCanvasApi()?.fit()} />
        </div>
        <Divider />
        <Button size="sm" variant="ghost" icon={LuFlag} onClick={() => addMarkerAt(getClockTime())} tooltip={t('timeline.marker.addAtPlayheadTooltip')} shortcut="M" labelClassName="hidden 2xl:inline">{t('timeline.marker.short')}</Button>
        <ViewOptions />
        <IconButton icon={LuPanelLeft} label={libraryOpen ? t('timeline.library.hide') : t('timeline.library.show')} size="sm" active={libraryOpen} tone="neutral"
          onClick={() => useTimelineView.getState().setLibraryOpen(!libraryOpen)} />
      </div>
    </div>
  )
}

/** Big playhead readout. Tap to cycle time / timecode / bars. Updated from the clock without React renders. */
function TimeReadout() {
  const t = useT()
  const display = useTimelineView((s) => s.timeDisplay)
  const bpm = useTimelineView((s) => s.bpm)
  const textRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const render = (time: number) => {
      if (!textRef.current) return
      textRef.current.textContent = display === 'timecode'
        ? formatSecondsAsTimecode(time, getTimecodeFramerate())
        : display === 'bars' ? formatBars(time, bpm) : formatClock(time)
    }
    render(getClockTime())
    return subscribeTimelineTime(render)
  }, [display, bpm])
  const next: Record<TimeDisplay, TimeDisplay> = { time: 'timecode', timecode: 'bars', bars: 'time' }
  const caption = display === 'timecode' ? t('timeline.readout.timecode') : display === 'bars' ? t('timeline.readout.bars', { bpm: Math.round(bpm) }) : t('timeline.readout.time')
  return (
    <button
      type="button"
      onClick={() => useTimelineView.getState().setTimeDisplay(next[display])}
      title={t('timeline.readout.tooltip')}
      className="flex h-control-lg min-w-[168px] flex-col items-start justify-center rounded bg-surface-0 px-3 ring-1 ring-inset ring-line hover:ring-line-strong [[data-density=touch]_&]:min-w-[200px]"
    >
      <span ref={textRef} className="font-mono text-xl font-medium leading-none tabular text-fg-primary [[data-density=touch]_&]:text-2xl">00:00.0</span>
      <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-tertiary">
        {caption}
        <LuChevronDown size={10} aria-hidden />
      </span>
    </button>
  )
}

function ViewOptions() {
  const t = useT()
  const pop = usePopover()
  const { followPlayhead, timeDisplay, length, bpm } = useTimelineView(useShallow((s) => ({
    followPlayhead: s.followPlayhead, timeDisplay: s.timeDisplay, length: s.length, bpm: s.bpm
  })))
  return (
    <>
      <IconButton ref={pop.anchorRef} {...pop.triggerProps} icon={LuSlidersHorizontal} label={t('timeline.options.title')} size="sm" active={pop.open} tone="neutral" onClick={pop.toggle} />
      <Popover {...pop.props} placement="bottom-end" aria-label={t('timeline.options.title')} className="w-[336px] [[data-density=touch]_&]:w-[400px]">
        <div className="flex flex-col gap-3 p-3">
          <h2 className="text-sm font-semibold">{t('timeline.options.title')}</h2>
          <Field label={t('timeline.options.timeDisplay')} layout="stacked">
            <SegmentedControl<TimeDisplay>
              fullWidth
              aria-label={t('timeline.options.timeDisplay')}
              value={timeDisplay}
              onChange={(v) => useTimelineView.getState().setTimeDisplay(v)}
              items={[
                { value: 'time', label: t('timeline.options.displayTime') },
                { value: 'timecode', label: t('timeline.options.displayTimecode') },
                { value: 'bars', label: t('timeline.options.displayBars') }
              ]}
            />
          </Field>
          <Field label={t('timeline.options.gridTempo')} hint={t('timeline.options.gridTempoHint')}>
            <NumberField aria-label={t('timeline.options.gridTempo')} value={bpm} min={20} max={400} step={1} unit="BPM" onChange={(v) => useTimelineView.getState().setBpm(v)} />
          </Field>
          <Field label={t('timeline.options.length')} hint={t('timeline.options.lengthHint')}>
            <NumberField aria-label={t('timeline.options.lengthAria')} value={length} min={10} max={36000} step={1} unit="s" onChange={(v) => useTimelineView.getState().setLength(v)} />
          </Field>
          <Switch
            checked={followPlayhead}
            onChange={(v) => useTimelineView.getState().setFollowPlayhead(v)}
            label={t('timeline.options.followPlayhead')}
            description={t('timeline.options.followPlayheadDescription')}
          />
        </div>
      </Popover>
    </>
  )
}
