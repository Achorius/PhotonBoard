// Timeline edit actions used by the canvas, menus, inspector and keyboard.
// Destructive ones ask first (danger confirm).

import { confirm } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { transportSeek } from '@renderer/lib/timeline-transport'
import { MARKER_COLORS, ZONE_COLORS, removeTrack, trackName } from './timeline-model'
import { getCanvasApi, useTimelineView } from './timeline-view-store'

export function seek(t: number, reveal = false): void {
  transportSeek(Math.max(0, t))
  if (reveal) getCanvasApi()?.reveal(t)
}

export function addMarkerAt(time: number): string {
  const store = usePlaybackStore.getState()
  const n = store.timelineMarkers.length
  const id = store.addTimelineMarker({ time: Math.max(0, time), name: `Marker ${n + 1}`, color: MARKER_COLORS[n % MARKER_COLORS.length] })
  useTimelineView.getState().select({ kind: 'marker', id })
  return id
}

export function addZoneAt(start: number, end: number): string {
  const store = usePlaybackStore.getState()
  const n = store.timelineZones.length
  const order = store.timelineZones.reduce((m, z) => Math.max(m, z.order + 1), 0)
  const id = store.addTimelineZone({
    name: `Section ${n + 1}`,
    startTime: Math.max(0, Math.min(start, end)),
    endTime: Math.max(start, end),
    color: ZONE_COLORS[n % ZONE_COLORS.length],
    order
  })
  useTimelineView.getState().select({ kind: 'zone', id })
  return id
}

function clearSelectionOf(kind: string, id: string | number): void {
  const sel = useTimelineView.getState().selection
  if (sel && sel.kind === kind && ('id' in sel ? sel.id : sel.index) === id) useTimelineView.getState().select(null)
}

export async function deleteClip(id: string): Promise<void> {
  const store = usePlaybackStore.getState()
  const clip = store.timelineClips.find((c) => c.id === id)
  if (!clip) return
  const name = clip.name || store.cuelists.find((c) => c.id === clip.cuelistId)?.name || 'clip'
  const ok = await confirm({ title: `Remove “${name}” from the timeline?`, message: 'The scene itself is kept.', confirmLabel: 'Remove clip', tone: 'danger' })
  if (!ok) return
  clearSelectionOf('clip', id)
  usePlaybackStore.getState().removeTimelineClip(id)
}

export async function deleteMarker(id: string): Promise<void> {
  const m = usePlaybackStore.getState().timelineMarkers.find((x) => x.id === id)
  if (!m) return
  const ok = await confirm({ title: `Delete marker “${m.name}”?`, message: 'MIDI mappings that jump to it stop working.', confirmLabel: 'Delete marker', tone: 'danger' })
  if (!ok) return
  clearSelectionOf('marker', id)
  usePlaybackStore.getState().removeTimelineMarker(id)
}

export async function deleteZone(id: string): Promise<void> {
  const z = usePlaybackStore.getState().timelineZones.find((x) => x.id === id)
  if (!z) return
  const ok = await confirm({ title: `Delete section “${z.name}”?`, message: 'Clips and markers inside it are kept.', confirmLabel: 'Delete section', tone: 'danger' })
  if (!ok) return
  clearSelectionOf('zone', id)
  usePlaybackStore.getState().removeTimelineZone(id)
}

export async function deleteTrack(index: number): Promise<void> {
  const store = usePlaybackStore.getState()
  if (store.timelineTrackCount <= 1) return
  const clipCount = store.timelineClips.filter((c) => c.trackIndex === index).length
  const name = trackName(store.timelineTrackNames, index)
  const ok = await confirm({
    title: `Remove track “${name}”?`,
    message: clipCount > 0 ? `Its ${clipCount} clip${clipCount === 1 ? '' : 's'} will be removed from the timeline.` : 'The track is empty.',
    confirmLabel: 'Remove track',
    tone: 'danger'
  })
  if (!ok) return
  useTimelineView.getState().select(null)
  removeTrack(index)
}

/** Start MIDI learn for a timeline target */
export function learnTimelineTarget(target: Parameters<ReturnType<typeof useMidiStore.getState>['startLearn']>[0]): void {
  const midi = useMidiStore.getState()
  if (midi.isLearning && midi.learnTarget?.type === target.type && midi.learnTarget?.id === target.id) midi.cancelLearn()
  else midi.startLearn(target)
}
