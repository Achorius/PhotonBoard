// Properties of the selected clip / marker / section / track.
// The header has the delete button (same as the Delete key: see
// timelineSelectionActions); the name field is what F2 / Enter focus.

import { useEffect, useState } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowUp, LuClapperboard, LuCopy, LuFlag, LuPiano, LuPlus, LuScissors, LuSquareDashed, LuTrash2, LuX, LuRows3
} from 'react-icons/lu'
import {
  Button, Field, IconButton, NumberField, SWATCH_COLORS, Section, Select, SwatchPicker, TextInput, cn, formatSeconds
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useUiStore } from '@renderer/stores/ui-store'
import type { MidiTargetType } from '@shared/types'
import { MIN_CLIP_DURATION, addTrack, clipEnd, fitFades, reorderZones, splitClip, swapTracks, trackName } from './timeline-model'
import {
  deleteClip, deleteMarker, deleteTrack, deleteZone, duplicateClipAndSelect, learnTimelineTarget, seek
} from './timeline-actions'
import { getClockTime, useTimelineView } from './timeline-view-store'

export function Inspector() {
  const t = useT()
  const selection = useTimelineView((s) => s.selection)
  if (!selection) return null
  return (
    <aside data-timeline-inspector aria-label={t('timeline.inspector.aria')} className="flex h-full min-h-0 flex-col bg-surface-1">
      {selection.kind === 'clip' && <ClipInspector id={selection.id} />}
      {selection.kind === 'marker' && <MarkerInspector id={selection.id} />}
      {selection.kind === 'zone' && <ZoneInspector id={selection.id} />}
      {selection.kind === 'track' && <TrackInspector index={selection.index} />}
    </aside>
  )
}

function Header({ icon: Icon, title, subtitle, color, deleteLabel, onDelete, deleteDisabled }: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
  title: string
  subtitle: string
  color?: string
  /** Tooltip of the header's delete button */
  deleteLabel: string
  onDelete: () => void
  deleteDisabled?: boolean
}) {
  const t = useT()
  return (
    <header className="flex min-h-control-lg shrink-0 items-center gap-2.5 border-b border-line-subtle py-1.5 pl-3 pr-1.5">
      {color ? <span aria-hidden className="h-4 w-4 shrink-0 rounded-sm ring-1 ring-inset ring-white/10" style={{ backgroundColor: color }} /> : <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-sm font-semibold" title={title}>{title}</h2>
        <p className="truncate text-xs text-fg-tertiary" title={subtitle}>{subtitle}</p>
      </div>
      <IconButton
        data-inspector-delete
        icon={LuTrash2}
        label={deleteLabel}
        shortcut="Delete"
        size="sm"
        className="hover:text-danger-fg"
        disabled={deleteDisabled}
        onClick={onDelete}
      />
      <IconButton icon={LuX} label={t('timeline.inspector.close')} size="sm" onClick={() => useTimelineView.getState().select(null)} />
    </header>
  )
}

/** Text field that commits on Enter / blur (store writes once per edit) */
function CommitText({ value, onCommit, placeholder, label, nameField }: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  label: string
  /** The item's name: focused by F2 / Enter (rename the selection) */
  nameField?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <TextInput
      aria-label={label}
      data-inspector-name={nameField ? '' : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft) }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() }
      }}
    />
  )
}

function MidiLearnButton({ type, id, label }: { type: MidiTargetType; id: string; label: string }) {
  const t = useT()
  const mapped = useMidiStore((s) => s.mappings.some((m) => m.target.type === type && m.target.id === id))
  const learning = useMidiStore((s) => s.isLearning && s.learnTarget?.type === type && s.learnTarget?.id === id)
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={LuPiano}
      tone="midi"
      active={learning}
      onClick={() => learnTimelineTarget({ type, id, label })}
      className={cn(learning && 'animate-pulse')}
    >
      {learning ? t('timeline.midi.learning') : mapped ? t('timeline.midi.relearn') : t('common.midiLearn')}
    </Button>
  )
}

const Actions = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap gap-1.5">{children}</div>

// ---------------------------------------------------------------- Clip

function ClipInspector({ id }: { id: string }) {
  const t = useT()
  const clip = usePlaybackStore((s) => s.timelineClips.find((c) => c.id === id))
  const cuelists = usePlaybackStore((s) => s.cuelists)
  const trackCount = usePlaybackStore((s) => s.timelineTrackCount)
  const trackNames = usePlaybackStore((s) => s.timelineTrackNames)
  if (!clip) return <Gone />
  const scene = cuelists.find((c) => c.id === clip.cuelistId)
  const update = (u: Parameters<ReturnType<typeof usePlaybackStore.getState>['updateTimelineClip']>[1]) => usePlaybackStore.getState().updateTimelineClip(id, u)
  const fadeIn = clip.fadeIn ?? 0
  const fadeOut = clip.fadeOut ?? 0
  const canSplit = (() => { const now = getClockTime(); return now > clip.startTime + MIN_CLIP_DURATION && now < clipEnd(clip) - MIN_CLIP_DURATION })()

  return (
    <>
      <Header
        icon={LuClapperboard}
        color={clip.color}
        title={clip.name || scene?.name || t('timeline.clip.missingScene')}
        subtitle={t('timeline.inspector.clipSubtitle', { track: trackName(trackNames, clip.trackIndex) })}
        deleteLabel={t('timeline.clip.remove')}
        onDelete={() => { void deleteClip(id) }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t('timeline.inspector.clipSection')}>
          <Field label={t('common.scene')}>
            {(fid) => (
              <Select
                id={fid}
                value={clip.cuelistId}
                onChange={(v) => update({ cuelistId: v })}
                options={[...(scene ? [] : [{ value: clip.cuelistId, label: t('timeline.clip.missingScene') }]), ...cuelists.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
          </Field>
          <Field label={t('timeline.inspector.label')}>
            <CommitText nameField label={t('timeline.inspector.clipLabelAria')} value={clip.name ?? ''} placeholder={scene?.name ?? t('timeline.inspector.sceneNamePlaceholder')} onCommit={(v) => update({ name: v.trim() || undefined })} />
          </Field>
          <Field label={t('timeline.inspector.track')}>
            {(fid) => (
              <Select
                id={fid}
                value={String(clip.trackIndex)}
                onChange={(v) => update({ trackIndex: Number(v) })}
                options={Array.from({ length: trackCount }, (_, i) => ({ value: String(i), label: `${i + 1} · ${trackName(trackNames, i)}` }))}
              />
            )}
          </Field>
          <Field label={t('common.color')}>
            <SwatchPicker colors={SWATCH_COLORS} value={clip.color} onChange={(c) => update({ color: c })} columns={6} size="sm" />
          </Field>
        </Section>

        <Section title={t('timeline.inspector.timing')}>
          <Field label={t('timeline.inspector.start')}>
            <NumberField aria-label={t('timeline.inspector.start')} value={clip.startTime} min={0} step={0.05} precision={2} unit="s" onChange={(v) => update({ startTime: v })} />
          </Field>
          <Field label={t('timeline.inspector.length')} hint={t('timeline.inspector.endsAt', { time: formatSeconds(clipEnd(clip)) })}>
            <NumberField aria-label={t('timeline.inspector.length')} value={clip.duration} min={MIN_CLIP_DURATION} step={0.05} precision={2} unit="s"
              onChange={(v) => update({ duration: v, ...fitFades({ duration: v, fadeIn, fadeOut }) })} />
          </Field>
          <Field label={t('timeline.inspector.fadeIn')}>
            <NumberField aria-label={t('timeline.inspector.fadeIn')} value={fadeIn} min={0} max={Math.max(0, clip.duration - fadeOut)} step={0.05} precision={2} unit="s" onChange={(v) => update({ fadeIn: v })} />
          </Field>
          <Field label={t('timeline.inspector.fadeOut')} hint={t('timeline.inspector.fadeHint')}>
            <NumberField aria-label={t('timeline.inspector.fadeOut')} value={fadeOut} min={0} max={Math.max(0, clip.duration - fadeIn)} step={0.05} precision={2} unit="s" onChange={(v) => update({ fadeOut: v })} />
          </Field>
        </Section>

        <Section title={t('timeline.inspector.actions')}>
          <Actions>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => seek(clip.startTime, true)}>{t('timeline.clip.goToStartShort')}</Button>
            <Button size="sm" variant="secondary" icon={LuClapperboard} disabled={!scene} onClick={() => useUiStore.getState().navigateToCuelist(clip.cuelistId)}>{t('timeline.clip.editScene')}</Button>
            <Button size="sm" variant="secondary" icon={LuCopy} tooltip={t('common.duplicate')} shortcut="Mod+D" onClick={() => duplicateClipAndSelect(id)}>{t('common.duplicate')}</Button>
            <Button size="sm" variant="secondary" icon={LuScissors} disabled={!canSplit} tooltip={canSplit ? undefined : t('timeline.clip.splitHint')} onClick={() => splitClip(id, getClockTime())}>{t('timeline.clip.splitAtPlayhead')}</Button>
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void deleteClip(id) }} className="self-start">{t('timeline.clip.remove')}</Button>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Marker

function MarkerInspector({ id }: { id: string }) {
  const t = useT()
  const marker = usePlaybackStore((s) => s.timelineMarkers.find((m) => m.id === id))
  if (!marker) return <Gone />
  const update = (u: { name?: string; time?: number; color?: string }) => usePlaybackStore.getState().updateTimelineMarker(id, u)
  return (
    <>
      <Header
        icon={LuFlag}
        color={marker.color}
        title={marker.name}
        subtitle={t('timeline.inspector.markerSubtitle', { time: formatSeconds(marker.time) })}
        deleteLabel={t('timeline.marker.delete')}
        onDelete={() => { void deleteMarker(id) }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t('timeline.inspector.markerSection')}>
          <Field label={t('common.name')}><CommitText nameField label={t('timeline.inspector.markerNameAria')} value={marker.name} onCommit={(v) => update({ name: v.trim() || marker.name })} /></Field>
          <Field label={t('timeline.inspector.time')}><NumberField aria-label={t('timeline.inspector.markerTimeAria')} value={marker.time} min={0} step={0.05} precision={2} unit="s" onChange={(v) => update({ time: v })} /></Field>
          <Field label={t('common.color')}><SwatchPicker colors={SWATCH_COLORS} value={marker.color} onChange={(c) => update({ color: c })} columns={6} size="sm" /></Field>
        </Section>
        <Section title={t('timeline.inspector.actions')}>
          <Actions>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => seek(marker.time, true)}>{t('timeline.marker.goTo')}</Button>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => update({ time: getClockTime() })}>{t('timeline.marker.moveToPlayhead')}</Button>
            <MidiLearnButton type="timeline_goto_marker" id={id} label={t('timeline.midi.goTo', { name: marker.name })} />
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void deleteMarker(id) }} className="self-start">{t('timeline.marker.delete')}</Button>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Section (zone)

function ZoneInspector({ id }: { id: string }) {
  const t = useT()
  const zones = usePlaybackStore((s) => s.timelineZones)
  const zone = zones.find((z) => z.id === id)
  if (!zone) return <Gone />
  const sorted = [...zones].sort((a, b) => a.order - b.order)
  const index = sorted.findIndex((z) => z.id === id)
  const update = (u: { name?: string; startTime?: number; endTime?: number; color?: string }) => usePlaybackStore.getState().updateTimelineZone(id, u)
  const move = (dir: -1 | 1) => {
    const ids = sorted.map((z) => z.id)
    const to = index + dir
    if (to < 0 || to >= ids.length) return
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    reorderZones(ids)
  }
  return (
    <>
      <Header
        icon={LuSquareDashed}
        color={zone.color}
        title={zone.name}
        subtitle={t('timeline.inspector.sectionSubtitle', { n: index + 1, count: sorted.length })}
        deleteLabel={t('timeline.section.delete')}
        onDelete={() => { void deleteZone(id) }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t('timeline.inspector.sectionSection')}>
          <Field label={t('common.name')}><CommitText nameField label={t('timeline.inspector.sectionNameAria')} value={zone.name} onCommit={(v) => update({ name: v.trim() || zone.name })} /></Field>
          <Field label={t('timeline.inspector.start')}><NumberField aria-label={t('timeline.inspector.sectionStartAria')} value={zone.startTime} min={0} max={zone.endTime - 0.5} step={0.05} precision={2} unit="s" onChange={(v) => update({ startTime: v })} /></Field>
          <Field label={t('timeline.inspector.end')}><NumberField aria-label={t('timeline.inspector.sectionEndAria')} value={zone.endTime} min={zone.startTime + 0.5} step={0.05} precision={2} unit="s" onChange={(v) => update({ endTime: v })} /></Field>
          <Field label={t('common.color')}><SwatchPicker colors={SWATCH_COLORS} value={zone.color} onChange={(c) => update({ color: c })} columns={6} size="sm" /></Field>
        </Section>
        <Section title={t('timeline.inspector.arrange')} actions={<span className="text-xs text-fg-tertiary">{t('timeline.inspector.arrangeHint')}</span>}>
          <Actions>
            <Button size="sm" variant="secondary" icon={LuArrowUp} disabled={index <= 0} onClick={() => move(-1)}>{t('timeline.section.moveEarlier')}</Button>
            <Button size="sm" variant="secondary" icon={LuArrowDown} disabled={index >= sorted.length - 1} onClick={() => move(1)}>{t('timeline.section.moveLater')}</Button>
          </Actions>
        </Section>
        <Section title={t('timeline.inspector.actions')}>
          <Actions>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => seek(zone.startTime, true)}>{t('timeline.section.goTo')}</Button>
            <MidiLearnButton type="timeline_goto_zone" id={id} label={t('timeline.midi.goTo', { name: zone.name })} />
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void deleteZone(id) }} className="self-start">{t('timeline.section.delete')}</Button>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Track

function TrackInspector({ index }: { index: number }) {
  const t = useT()
  const trackNames = usePlaybackStore((s) => s.timelineTrackNames)
  const trackCount = usePlaybackStore((s) => s.timelineTrackCount)
  const clipCount = usePlaybackStore((s) => s.timelineClips.filter((c) => c.trackIndex === index).length)
  if (index >= trackCount) return <Gone />
  const name = trackName(trackNames, index)
  const lastTrack = trackCount <= 1
  return (
    <>
      <Header
        icon={LuRows3}
        title={name}
        subtitle={t('timeline.inspector.trackSubtitle', { n: index + 1, clips: t('timeline.clipCount', { count: clipCount }) })}
        deleteLabel={lastTrack ? t('timeline.track.lastTrack') : t('timeline.track.remove')}
        deleteDisabled={lastTrack}
        onDelete={() => { void deleteTrack(index) }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t('timeline.inspector.trackSection')}>
          <Field label={t('common.name')} hint={t('timeline.inspector.trackNameHint')}>
            <CommitText nameField label={t('timeline.inspector.trackNameAria')} value={trackNames[index] ?? ''} placeholder={t('timeline.defaults.trackName', { n: index + 1 })} onCommit={(v) => usePlaybackStore.getState().setTimelineTrackName(index, v)} />
          </Field>
        </Section>
        <Section title={t('timeline.inspector.actions')}>
          <Actions>
            <Button size="sm" variant="secondary" icon={LuPlus} onClick={() => addTrack(index)}>{t('timeline.track.insertBelow')}</Button>
            <Button size="sm" variant="secondary" icon={LuArrowUp} disabled={index === 0} onClick={() => { swapTracks(index, index - 1); useTimelineView.getState().select({ kind: 'track', index: index - 1 }) }}>{t('timeline.track.moveUp')}</Button>
            <Button size="sm" variant="secondary" icon={LuArrowDown} disabled={index >= trackCount - 1} onClick={() => { swapTracks(index, index + 1); useTimelineView.getState().select({ kind: 'track', index: index + 1 }) }}>{t('timeline.track.moveDown')}</Button>
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} disabled={lastTrack} tooltip={lastTrack ? t('timeline.track.lastTrack') : undefined} onClick={() => { void deleteTrack(index) }} className="self-start">{t('timeline.track.remove')}</Button>
        </Section>
      </div>
    </>
  )
}

function Gone() {
  useEffect(() => { useTimelineView.getState().select(null) }, [])
  return null
}
