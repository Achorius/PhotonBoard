// Track header: name (double-tap or menu to rename — saved in the show),
// clip count, and a visible "…" menu (rename, insert, move, remove).

import { memo, useState } from 'react'
import { LuArrowDown, LuArrowUp, LuEllipsisVertical, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu'
import { DropdownMenu, IconButton, TextInput, cn, type MenuEntry } from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { addTrack, swapTracks } from './timeline-model'
import { deleteTrack } from './timeline-actions'
import { useTimelineView } from './timeline-view-store'

export interface TrackHeaderProps {
  index: number
  name: string
  customName: boolean
  clipCount: number
  trackCount: number
  height: number
  selected: boolean
}

export const TrackHeader = memo(function TrackHeader({ index, name, customName, clipCount, trackCount, height, selected }: TrackHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const startEdit = () => { setDraft(customName ? name : ''); setEditing(true) }
  const commit = () => {
    usePlaybackStore.getState().setTimelineTrackName(index, draft)
    setEditing(false)
  }

  const menu = (): MenuEntry[] => [
    { label: 'Rename track', icon: LuPencil, onSelect: startEdit },
    { label: 'Insert track below', icon: LuPlus, onSelect: () => addTrack(index) },
    { label: 'Move up', icon: LuArrowUp, disabled: index === 0, onSelect: () => swapTracks(index, index - 1) },
    { label: 'Move down', icon: LuArrowDown, disabled: index >= trackCount - 1, onSelect: () => swapTracks(index, index + 1) },
    { type: 'separator' },
    { label: 'Remove track…', icon: LuTrash2, danger: true, disabled: trackCount <= 1, onSelect: () => { void deleteTrack(index) } }
  ]

  return (
    <div
      data-track-header={index}
      onClick={() => useTimelineView.getState().select({ kind: 'track', index })}
      onDoubleClick={startEdit}
      className={cn(
        'relative flex shrink-0 cursor-pointer items-center gap-1 border-b border-line-subtle pl-3 pr-1',
        selected ? 'bg-info/15' : 'bg-surface-1 hover:bg-surface-2'
      )}
      style={{ height }}
    >
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-info-fg" />}
      <span className="w-5 shrink-0 font-mono text-2xs tabular text-fg-tertiary">{index + 1}</span>
      {editing ? (
        <TextInput
          size="sm"
          autoFocus
          aria-label={`Track ${index + 1} name`}
          placeholder={`Track ${index + 1}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          className="min-w-0 flex-1"
        />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn('truncate text-sm font-medium', customName ? 'text-fg-primary' : 'text-fg-secondary')}>{name}</span>
          <span className="truncate text-2xs text-fg-tertiary">{clipCount === 0 ? 'Empty' : `${clipCount} clip${clipCount === 1 ? '' : 's'}`}</span>
        </div>
      )}
      {!editing && (
        <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <DropdownMenu
            items={menu}
            trigger={(p) => <IconButton {...p} icon={LuEllipsisVertical} label={`Track ${index + 1} options`} size="sm" />}
          />
        </div>
      )}
    </div>
  )
})
