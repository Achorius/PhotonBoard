// Properties of the selected clip / marker / section / track.

import { useEffect, useState } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowUp, LuClapperboard, LuCopy, LuFlag, LuPiano, LuPlus, LuScissors, LuSquareDashed, LuTrash2, LuX, LuRows3
} from 'react-icons/lu'
import {
  Button, Field, IconButton, NumberField, SWATCH_COLORS, Section, Select, SwatchPicker, TextInput, cn, formatSeconds
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { useUiStore } from '@renderer/stores/ui-store'
import type { MidiTargetType } from '@shared/types'
import { MIN_CLIP_DURATION, addTrack, clipEnd, duplicateClip, fitFades, reorderZones, splitClip, swapTracks, trackName } from './timeline-model'
import { deleteClip, deleteMarker, deleteTrack, deleteZone, learnTimelineTarget, seek } from './timeline-actions'
import { getClockTime, useTimelineView } from './timeline-view-store'

export function Inspector() {
  const selection = useTimelineView((s) => s.selection)
  if (!selection) return null
  return (
    <aside aria-label="Properties" className="flex h-full min-h-0 flex-col bg-surface-1">
      {selection.kind === 'clip' && <ClipInspector id={selection.id} />}
      {selection.kind === 'marker' && <MarkerInspector id={selection.id} />}
      {selection.kind === 'zone' && <ZoneInspector id={selection.id} />}
      {selection.kind === 'track' && <TrackInspector index={selection.index} />}
    </aside>
  )
}

function Header({ icon: Icon, title, subtitle, color }: { icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>; title: string; subtitle: string; color?: string }) {
  return (
    <header className="flex min-h-control-lg shrink-0 items-center gap-2.5 border-b border-line-subtle py-1.5 pl-3 pr-1.5">
      {color ? <span aria-hidden className="h-4 w-4 shrink-0 rounded-sm ring-1 ring-inset ring-white/10" style={{ backgroundColor: color }} /> : <Icon size={16} aria-hidden className="shrink-0 text-fg-tertiary" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        <p className="truncate text-xs text-fg-tertiary">{subtitle}</p>
      </div>
      <IconButton icon={LuX} label="Close properties (Esc)" size="sm" onClick={() => useTimelineView.getState().select(null)} />
    </header>
  )
}

/** Text field that commits on Enter / blur (store writes once per edit) */
function CommitText({ value, onCommit, placeholder, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <TextInput
      aria-label={label}
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
      {learning ? 'Learning… (tap to cancel)' : mapped ? 'MIDI mapped — re-learn' : 'MIDI learn'}
    </Button>
  )
}

const Actions = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap gap-1.5">{children}</div>

// ---------------------------------------------------------------- Clip

function ClipInspector({ id }: { id: string }) {
  const clip = usePlaybackStore((s) => s.timelineClips.find((c) => c.id === id))
  const cuelists = usePlaybackStore((s) => s.cuelists)
  const trackCount = usePlaybackStore((s) => s.timelineTrackCount)
  const trackNames = usePlaybackStore((s) => s.timelineTrackNames)
  if (!clip) return <Gone />
  const scene = cuelists.find((c) => c.id === clip.cuelistId)
  const update = (u: Parameters<ReturnType<typeof usePlaybackStore.getState>['updateTimelineClip']>[1]) => usePlaybackStore.getState().updateTimelineClip(id, u)
  const fadeIn = clip.fadeIn ?? 0
  const fadeOut = clip.fadeOut ?? 0
  const canSplit = (() => { const t = getClockTime(); return t > clip.startTime + MIN_CLIP_DURATION && t < clipEnd(clip) - MIN_CLIP_DURATION })()

  return (
    <>
      <Header icon={LuClapperboard} color={clip.color} title={clip.name || scene?.name || 'Missing scene'} subtitle={`Scene clip · ${trackName(trackNames, clip.trackIndex)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Clip">
          <Field label="Scene">
            {(fid) => (
              <Select
                id={fid}
                value={clip.cuelistId}
                onChange={(v) => update({ cuelistId: v })}
                options={[...(scene ? [] : [{ value: clip.cuelistId, label: 'Missing scene' }]), ...cuelists.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
          </Field>
          <Field label="Label">
            <CommitText label="Clip label" value={clip.name ?? ''} placeholder={scene?.name ?? 'Scene name'} onCommit={(v) => update({ name: v.trim() || undefined })} />
          </Field>
          <Field label="Track">
            {(fid) => (
              <Select
                id={fid}
                value={String(clip.trackIndex)}
                onChange={(v) => update({ trackIndex: Number(v) })}
                options={Array.from({ length: trackCount }, (_, i) => ({ value: String(i), label: `${i + 1} · ${trackName(trackNames, i)}` }))}
              />
            )}
          </Field>
          <Field label="Colour">
            <SwatchPicker colors={SWATCH_COLORS} value={clip.color} onChange={(c) => update({ color: c })} columns={6} size="sm" />
          </Field>
        </Section>

        <Section title="Timing">
          <Field label="Start">
            <NumberField aria-label="Start" value={clip.startTime} min={0} step={0.05} precision={2} unit="s" onChange={(v) => update({ startTime: v })} />
          </Field>
          <Field label="Length" hint={`Ends at ${formatSeconds(clipEnd(clip))}`}>
            <NumberField aria-label="Length" value={clip.duration} min={MIN_CLIP_DURATION} step={0.05} precision={2} unit="s"
              onChange={(v) => update({ duration: v, ...fitFades({ duration: v, fadeIn, fadeOut }) })} />
          </Field>
          <Field label="Fade in">
            <NumberField aria-label="Fade in" value={fadeIn} min={0} max={Math.max(0, clip.duration - fadeOut)} step={0.05} precision={2} unit="s" onChange={(v) => update({ fadeIn: v })} />
          </Field>
          <Field label="Fade out" hint="Fades scale the scene's level; drag the dots on the clip too">
            <NumberField aria-label="Fade out" value={fadeOut} min={0} max={Math.max(0, clip.duration - fadeIn)} step={0.05} precision={2} unit="s" onChange={(v) => update({ fadeOut: v })} />
          </Field>
        </Section>

        <Section title="Actions">
          <Actions>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => seek(clip.startTime, true)}>Go to start</Button>
            <Button size="sm" variant="secondary" icon={LuClapperboard} disabled={!scene} onClick={() => useUiStore.getState().navigateToCuelist(clip.cuelistId)}>Edit scene</Button>
            <Button size="sm" variant="secondary" icon={LuCopy} onClick={() => { const nid = duplicateClip(id); if (nid) useTimelineView.getState().select({ kind: 'clip', id: nid }) }}>Duplicate</Button>
            <Button size="sm" variant="secondary" icon={LuScissors} disabled={!canSplit} tooltip={canSplit ? undefined : 'Move the playhead inside the clip'} onClick={() => splitClip(id, getClockTime())}>Split at playhead</Button>
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void deleteClip(id) }} className="self-start">Remove clip</Button>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Marker

function MarkerInspector({ id }: { id: string }) {
  const marker = usePlaybackStore((s) => s.timelineMarkers.find((m) => m.id === id))
  if (!marker) return <Gone />
  const update = (u: { name?: string; time?: number; color?: string }) => usePlaybackStore.getState().updateTimelineMarker(id, u)
  return (
    <>
      <Header icon={LuFlag} color={marker.color} title={marker.name} subtitle={`Marker · ${formatSeconds(marker.time)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Marker">
          <Field label="Name"><CommitText label="Marker name" value={marker.name} onCommit={(v) => update({ name: v.trim() || marker.name })} /></Field>
          <Field label="Time"><NumberField aria-label="Marker time" value={marker.time} min={0} step={0.05} precision={2} unit="s" onChange={(v) => update({ time: v })} /></Field>
          <Field label="Colour"><SwatchPicker colors={SWATCH_COLORS} value={marker.color} onChange={(c) => update({ color: c })} columns={6} size="sm" /></Field>
        </Section>
        <Section title="Actions">
          <Actions>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => seek(marker.time, true)}>Go to marker</Button>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => update({ time: getClockTime() })}>Move to playhead</Button>
            <MidiLearnButton type="timeline_goto_marker" id={id} label={`Go to ${marker.name}`} />
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void deleteMarker(id) }} className="self-start">Delete marker</Button>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Section (zone)

function ZoneInspector({ id }: { id: string }) {
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
      <Header icon={LuSquareDashed} color={zone.color} title={zone.name} subtitle={`Section ${index + 1} of ${sorted.length}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Section">
          <Field label="Name"><CommitText label="Section name" value={zone.name} onCommit={(v) => update({ name: v.trim() || zone.name })} /></Field>
          <Field label="Start"><NumberField aria-label="Section start" value={zone.startTime} min={0} max={zone.endTime - 0.5} step={0.05} precision={2} unit="s" onChange={(v) => update({ startTime: v })} /></Field>
          <Field label="End"><NumberField aria-label="Section end" value={zone.endTime} min={zone.startTime + 0.5} step={0.05} precision={2} unit="s" onChange={(v) => update({ endTime: v })} /></Field>
          <Field label="Colour"><SwatchPicker colors={SWATCH_COLORS} value={zone.color} onChange={(c) => update({ color: c })} columns={6} size="sm" /></Field>
        </Section>
        <Section title="Arrange" actions={<span className="text-xs text-fg-tertiary">clips & markers move along</span>}>
          <Actions>
            <Button size="sm" variant="secondary" icon={LuArrowUp} disabled={index <= 0} onClick={() => move(-1)}>Move earlier</Button>
            <Button size="sm" variant="secondary" icon={LuArrowDown} disabled={index >= sorted.length - 1} onClick={() => move(1)}>Move later</Button>
          </Actions>
        </Section>
        <Section title="Actions">
          <Actions>
            <Button size="sm" variant="secondary" icon={LuFlag} onClick={() => seek(zone.startTime, true)}>Go to section</Button>
            <MidiLearnButton type="timeline_goto_zone" id={id} label={`Go to ${zone.name}`} />
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={() => { void deleteZone(id) }} className="self-start">Delete section</Button>
        </Section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Track

function TrackInspector({ index }: { index: number }) {
  const trackNames = usePlaybackStore((s) => s.timelineTrackNames)
  const trackCount = usePlaybackStore((s) => s.timelineTrackCount)
  const clipCount = usePlaybackStore((s) => s.timelineClips.filter((c) => c.trackIndex === index).length)
  if (index >= trackCount) return <Gone />
  const name = trackName(trackNames, index)
  return (
    <>
      <Header icon={LuRows3} title={name} subtitle={`Track ${index + 1} · ${clipCount} clip${clipCount === 1 ? '' : 's'}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Track">
          <Field label="Name" hint="Saved with the show">
            <CommitText label="Track name" value={trackNames[index] ?? ''} placeholder={`Track ${index + 1}`} onCommit={(v) => usePlaybackStore.getState().setTimelineTrackName(index, v)} />
          </Field>
        </Section>
        <Section title="Actions">
          <Actions>
            <Button size="sm" variant="secondary" icon={LuPlus} onClick={() => addTrack(index)}>Insert track below</Button>
            <Button size="sm" variant="secondary" icon={LuArrowUp} disabled={index === 0} onClick={() => { swapTracks(index, index - 1); useTimelineView.getState().select({ kind: 'track', index: index - 1 }) }}>Move up</Button>
            <Button size="sm" variant="secondary" icon={LuArrowDown} disabled={index >= trackCount - 1} onClick={() => { swapTracks(index, index + 1); useTimelineView.getState().select({ kind: 'track', index: index + 1 }) }}>Move down</Button>
          </Actions>
          <Button size="sm" variant="danger-outline" icon={LuTrash2} disabled={trackCount <= 1} onClick={() => { void deleteTrack(index) }} className="self-start">Remove track</Button>
        </Section>
      </div>
    </>
  )
}

function Gone() {
  useEffect(() => { useTimelineView.getState().select(null) }, [])
  return null
}
