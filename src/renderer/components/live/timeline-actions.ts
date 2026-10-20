// Timeline edit actions used by the canvas, menus, inspector and keyboard.
// Deletions go through the selection actions (lib/selection-actions): one
// definition per kind of item, used by the Delete / Backspace keys, the
// Edit menu, the trash buttons and the "…" menus alike (confirm when it
// matters, one undo step, "Deleted: … — Undo" toast).

import { formatShortcut } from '@renderer/components/ui/Kbd'
import { t } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { transportSeek } from '@renderer/lib/timeline-transport'
import { deleteWithUndo, type SelectionActions } from '@renderer/lib/selection-actions'
import { MARKER_COLORS, ZONE_COLORS, duplicateClip, removeTrack, trackName } from './timeline-model'
import { getCanvasApi, useTimelineView, type TimelineSelection } from './timeline-view-store'

export function seek(time: number, reveal = false): void {
  transportSeek(Math.max(0, time))
  if (reveal) getCanvasApi()?.reveal(time)
}

export function addMarkerAt(time: number): string {
  const store = usePlaybackStore.getState()
  const n = store.timelineMarkers.length
  const id = store.addTimelineMarker({ time: Math.max(0, time), name: t('timeline.defaults.markerName', { n: n + 1 }), color: MARKER_COLORS[n % MARKER_COLORS.length] })
  useTimelineView.getState().select({ kind: 'marker', id })
  return id
}

export function addZoneAt(start: number, end: number): string {
  const store = usePlaybackStore.getState()
  const n = store.timelineZones.length
  const order = store.timelineZones.reduce((m, z) => Math.max(m, z.order + 1), 0)
  const id = store.addTimelineZone({
    name: t('timeline.defaults.sectionName', { n: n + 1 }),
    startTime: Math.max(0, Math.min(start, end)),
    endTime: Math.max(start, end),
    color: ZONE_COLORS[n % ZONE_COLORS.length],
    order
  })
  useTimelineView.getState().select({ kind: 'zone', id })
  return id
}

/** Duplicate a clip right after itself and select the copy */
export function duplicateClipAndSelect(id: string): void {
  const nid = duplicateClip(id)
  if (nid) useTimelineView.getState().select({ kind: 'clip', id: nid })
}

function clearSelectionOf(kind: string, id: string | number): void {
  const sel = useTimelineView.getState().selection
  if (sel && sel.kind === kind && ('id' in sel ? sel.id : sel.index) === id) useTimelineView.getState().select(null)
}

/** F2 / Enter / "Rename…": edit the name field of the inspector (shown for any selection) */
function focusInspectorName(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('[data-timeline-inspector] [data-inspector-name]')
    if (!el) return
    el.focus()
    el.select()
  })
}

const undoKeys = () => formatShortcut('Mod+Z')

/**
 * What the keyboard (Delete, Mod+D, F2), the Edit menu and the delete buttons
 * do with a timeline item. Everything is read from the store when called, so
 * the object stays valid while the item is renamed or edited.
 */
export function timelineSelectionActions(sel: TimelineSelection): SelectionActions | null {
  if (!sel) return null
  const pb = () => usePlaybackStore.getState()
  switch (sel.kind) {
    case 'clip': {
      const find = () => pb().timelineClips.find((c) => c.id === sel.id)
      const name = () => {
        const clip = find()
        return clip?.name || pb().cuelists.find((c) => c.id === clip?.cuelistId)?.name || t('timeline.clip.missingScene')
      }
      return {
        label: () => t('timeline.selection.clip', { name: name() }),
        canDelete: () => !!find(),
        delete: () => {
          clearSelectionOf('clip', sel.id)
          pb().removeTimelineClip(sel.id)
        },
        get confirmDelete() {
          return {
            title: t('timeline.confirm.clipTitle', { name: name() }),
            message: t('timeline.confirm.clipMessage', { keys: undoKeys() }),
            confirmLabel: t('timeline.confirm.clipAction')
          }
        },
        canDuplicate: () => !!find(),
        duplicate: () => duplicateClipAndSelect(sel.id),
        canRename: () => !!find(),
        rename: focusInspectorName
      }
    }
    case 'marker': {
      const find = () => pb().timelineMarkers.find((m) => m.id === sel.id)
      return {
        label: () => t('timeline.selection.marker', { name: find()?.name ?? '' }),
        canDelete: () => !!find(),
        delete: () => {
          clearSelectionOf('marker', sel.id)
          pb().removeTimelineMarker(sel.id)
        },
        // Cheap to recreate, and the Undo toast brings it back (with its MIDI mappings)
        confirmDelete: false,
        canRename: () => !!find(),
        rename: focusInspectorName
      }
    }
    case 'zone': {
      const find = () => pb().timelineZones.find((z) => z.id === sel.id)
      return {
        label: () => t('timeline.selection.section', { name: find()?.name ?? '' }),
        canDelete: () => !!find(),
        delete: () => {
          clearSelectionOf('zone', sel.id)
          pb().removeTimelineZone(sel.id)
        },
        get confirmDelete() {
          return { message: t('timeline.confirm.sectionMessage', { keys: undoKeys() }) }
        },
        canRename: () => !!find(),
        rename: focusInspectorName
      }
    }
    case 'track': {
      const exists = () => sel.index < pb().timelineTrackCount
      return {
        label: () => t('timeline.selection.track', { name: trackName(pb().timelineTrackNames, sel.index) }),
        // The timeline always keeps one track
        canDelete: () => exists() && pb().timelineTrackCount > 1,
        delete: () => {
          useTimelineView.getState().select(null)
          removeTrack(sel.index)
        },
        get confirmDelete() {
          const count = pb().timelineClips.filter((c) => c.trackIndex === sel.index).length
          return {
            message: count > 0
              ? t('timeline.confirm.trackMessage', { count, keys: undoKeys() })
              : t('timeline.confirm.trackEmptyMessage', { keys: undoKeys() })
          }
        },
        canRename: exists,
        rename: focusInspectorName
      }
    }
  }
}

/** Delete a timeline item the same way as the Delete key (confirm, one undo step, Undo toast) */
export async function deleteTimelineItem(sel: TimelineSelection): Promise<boolean> {
  const a = timelineSelectionActions(sel)
  if (!a?.delete || !(a.canDelete?.() ?? true)) return false
  return deleteWithUndo({ label: a.label(), run: a.delete, confirm: a.confirmDelete })
}

export const deleteClip = (id: string) => deleteTimelineItem({ kind: 'clip', id })
export const deleteMarker = (id: string) => deleteTimelineItem({ kind: 'marker', id })
export const deleteZone = (id: string) => deleteTimelineItem({ kind: 'zone', id })
export const deleteTrack = (index: number) => deleteTimelineItem({ kind: 'track', index })

/** Start MIDI learn for a timeline target */
export function learnTimelineTarget(target: Parameters<ReturnType<typeof useMidiStore.getState>['startLearn']>[0]): void {
  const midi = useMidiStore.getState()
  if (midi.isLearning && midi.learnTarget?.type === target.type && midi.learnTarget?.id === target.id) midi.cancelLearn()
  else midi.startLearn(target)
}
