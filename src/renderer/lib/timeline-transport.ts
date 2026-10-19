// ============================================================
// PhotonBoard — Timeline transport for the UI (console and remote)
// On the console these are the engine calls. On a remote the engine
// does not run: it mirrors the console's play state / playhead, so the
// buttons decide from that mirror and send EXPLICIT commands (start /
// stop / rewind / set-time — never a toggle that could flip twice),
// with an optimistic local update held until the console confirms.
// ============================================================

import {
  getTimelineState, mirrorTimelineState, rewindTimeline, setTimelineTime, startTimeline, stopTimeline, toggleTimeline
} from './timeline-engine'
import { isRemoteMode, markLocalChange, sendRemoteCommand } from './runtime'

/** Play / pause */
export function transportToggle(): void {
  if (!isRemoteMode()) {
    toggleTimeline()
    return
  }
  const { isPlaying, currentTime } = getTimelineState()
  markLocalChange('timelinePlaying')
  if (isPlaying) {
    sendRemoteCommand('stop-timeline')
    mirrorTimelineState(currentTime, false)
  } else {
    sendRemoteCommand('start-timeline')
    mirrorTimelineState(currentTime, true)
  }
}

/** Stop; pressed again (already stopped): back to the start. Returns true when it rewound. */
export function transportStop(): boolean {
  const { isPlaying } = getTimelineState()
  if (!isRemoteMode()) {
    if (isPlaying) stopTimeline()
    else rewindTimeline()
    return !isPlaying
  }
  markLocalChange('timelinePlaying')
  if (isPlaying) {
    sendRemoteCommand('stop-timeline')
    mirrorTimelineState(getTimelineState().currentTime, false)
    return false
  }
  markLocalChange('timelineTime')
  sendRemoteCommand('rewind-timeline')
  mirrorTimelineState(0, false)
  return true
}

/** Back to 0 (keeps playing when playing) */
export function transportRewind(): void {
  if (!isRemoteMode()) {
    rewindTimeline()
    return
  }
  markLocalChange('timelineTime')
  sendRemoteCommand('rewind-timeline')
  mirrorTimelineState(0, getTimelineState().isPlaying)
}

/** Start (no-op when playing) */
export function transportStart(): void {
  if (!isRemoteMode()) {
    startTimeline()
    return
  }
  markLocalChange('timelinePlaying')
  sendRemoteCommand('start-timeline')
  mirrorTimelineState(getTimelineState().currentTime, true)
}

/** Seek */
export function transportSeek(t: number): void {
  if (!Number.isFinite(t)) return
  setTimelineTime(t) // remote: throttled 'set-timeline-time'
  if (isRemoteMode()) {
    markLocalChange('timelineTime')
    mirrorTimelineState(Math.max(0, t), getTimelineState().isPlaying)
  }
}
