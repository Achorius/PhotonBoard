// ============================================================
// Scene editor (detail side of the Scenes view): header, large
// playback controls (Back, GO, Stop, Flash hold, level), on-stage /
// next cue readout with fade progress, and tabs for the cue list,
// stored effects and settings.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  LuArrowDown, LuArrowUp, LuCircleDot, LuCopy, LuEllipsis, LuListOrdered, LuPiano, LuPlay, LuRefreshCw, LuSettings2,
  LuSkipBack, LuSparkles, LuSquare, LuTrash2, LuX, LuZap
} from 'react-icons/lu'
import type { Cuelist } from '@shared/types'
import {
  Badge, Button, DropdownMenu, EmptyState, IconButton, Slider, Tabs, confirm, formatCuePosition, formatPercent, formatSeconds, toast,
  type MenuEntry
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { CueTable, deleteCue, formatCueNumber } from './CueTable'
import { SceneEffects } from './SceneEffects'
import { SceneSettings } from './SceneSettings'
import { FadeProgress } from './FadeProgress'
import { capture, recordAddCue, recordUpdateCue } from './record'
import { MODE_LABEL, formatMidiSource, formatSlot, startSceneLearn, useLearningSceneId, useSceneMidi, type ExecutorSlot } from './scene-meta'

type SceneTab = 'cues' | 'effects' | 'settings'

export function SceneDetail({ cuelist: cl, number, slot, selectedCueId, onSelectCue }: {
  cuelist: Cuelist
  number: number
  slot: ExecutorSlot | undefined
  selectedCueId: string | null
  onSelectCue: (id: string | null) => void
}) {
  const [tab, setTab] = useState<SceneTab>('cues')
  const midi = useSceneMidi().get(cl.id)
  const learning = useLearningSceneId() === cl.id
  const body = useRef<HTMLDivElement>(null)
  const width = useWidth(body)
  const pb = usePlaybackStore.getState

  const selectedIndex = cl.cues.findIndex((c) => c.id === selectedCueId)
  const selectedCue = selectedIndex >= 0 ? cl.cues[selectedIndex] : undefined
  const fxCount = cl.effectSnapshots?.length ?? 0

  const recordCue = () => {
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning('Nothing to record', { description: 'Set levels in Fixtures (programmer) first.' })
      return
    }
    const id = recordAddCue(cl.id, cap)
    if (id) onSelectCue(id)
    toast.success(`Cue ${cl.cues.length + 1} added to “${cl.name}”`, { description: `${cap.fixtureCount} fixtures · ${cap.channelCount} channels` })
  }

  const updateSelectedCue = () => {
    if (!selectedCue) return
    const cap = capture(true)
    if (cap.channelCount === 0) {
      toast.warning('Nothing to record', { description: 'Set levels in Fixtures (programmer) first.' })
      return
    }
    recordUpdateCue(cl.id, selectedCue.id, cap, 'merge')
    toast.success(`Cue ${formatCueNumber(selectedCue.number)} updated`, { description: `${cap.channelCount} channels merged` })
  }

  const deleteScene = async () => {
    const ok = await confirm({
      title: `Delete scene “${cl.name}”?`,
      message: `Its ${cl.cues.length} cue${cl.cues.length === 1 ? '' : 's'}${fxCount ? ` and ${fxCount} effect${fxCount === 1 ? '' : 's'}` : ''}, its executor button and its timeline clips are removed. This cannot be undone.`,
      confirmLabel: 'Delete scene',
      tone: 'danger'
    })
    if (!ok) return
    const list = pb().cuelists
    const at = list.findIndex((c) => c.id === cl.id)
    const neighbour = list[at + 1] ?? list[at - 1]
    pb().removeCuelist(cl.id)
    pb().selectCuelist(neighbour?.id ?? null)
  }

  const menu = (): MenuEntry[] => [
    { type: 'label', label: cl.name },
    { label: 'Duplicate scene', icon: LuCopy, onSelect: () => { const id = pb().duplicateCuelist(cl.id); if (id) pb().selectCuelist(id) } },
    learning
      ? { label: 'Cancel MIDI learn', icon: LuX, onSelect: () => useMidiStore.getState().cancelLearn() }
      : { label: midi ? 'Re-learn MIDI trigger…' : 'MIDI learn…', icon: LuPiano, description: 'Then press a MIDI key or pad', onSelect: () => startSceneLearn(cl, slot?.mode ?? 'toggle') },
    { label: 'Settings', icon: LuSettings2, onSelect: () => setTab('settings') },
    { type: 'separator' },
    { label: 'Delete scene…', icon: LuTrash2, danger: true, onSelect: () => void deleteScene() }
  ]

  return (
    <section aria-label={`Scene ${cl.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex min-h-control-lg shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5">
        <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-line-strong" style={{ backgroundColor: slot?.color }} />
        <span className="shrink-0 font-mono text-xs tabular text-fg-tertiary">S{number}</span>
        <input
          aria-label="Scene name"
          value={cl.name}
          placeholder="Untitled scene"
          onChange={(e) => pb().renameCuelist(cl.id, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          className="h-control-sm min-w-0 max-w-[360px] flex-1 truncate rounded bg-transparent px-1.5 text-base font-semibold text-fg-primary outline-none placeholder:text-fg-disabled hover:bg-surface-2 focus:bg-surface-0 focus:ring-1 focus:ring-info-fg"
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {cl.isPlaying
            ? <Badge tone="go" variant="solid">{cl.flash ? 'FLASH' : 'LIVE'}</Badge>
            : <Badge>Stopped</Badge>}
          {cl.isLooping && <Badge tone="info">Loop</Badge>}
          {slot && <Badge mono title={`Executor column ${slot.col + 1}, row ${slot.row + 1}`}>EX {formatSlot(slot)}{slot.mode !== 'toggle' ? ` · ${MODE_LABEL[slot.mode]}` : ''}</Badge>}
          {learning ? <Badge tone="midi" variant="solid" className="animate-pulse">MIDI learn…</Badge> : midi && <Badge tone="midi" mono>{formatMidiSource(midi)}</Badge>}
          {cl.priority !== 50 && <Badge title="Priority">P{cl.priority}</Badge>}
        </div>
        <DropdownMenu
          placement="bottom-end"
          items={menu}
          trigger={(p) => <IconButton {...p} icon={LuEllipsis} label="Scene actions" size="sm" />}
        />
      </header>

      {/* Playback */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-subtle px-3 py-3">
        <div className="flex items-center gap-2">
          <Button size="lg" icon={LuSkipBack} disabled={cl.cues.length === 0} onClick={() => pb().goBackCuelist(cl.id)} tooltip="Previous cue">Back</Button>
          <Button
            size="lg"
            variant="success"
            icon={LuPlay}
            disabled={cl.cues.length === 0}
            className="min-w-[120px] [[data-density=touch]_&]:min-w-[148px]"
            tooltip="GO next cue"
            shortcut="Space"
            onClick={() => pb().goCuelist(cl.id)}
          >
            GO
          </Button>
          <Button size="lg" icon={LuSquare} disabled={!cl.isPlaying} onClick={() => pb().stopCuelist(cl.id)} tooltip="Stop and release the scene">Stop</Button>
          <FlashButton cuelistId={cl.id} disabled={cl.cues.length === 0} />
        </div>
        <OnStage cuelist={cl} />
        <div className="flex min-w-[200px] max-w-[280px] flex-1 flex-col gap-1 [[data-density=touch]_&]:max-w-[320px]">
          <span className="flex items-baseline justify-between text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
            Level
            <span className="font-mono text-xs normal-case tabular tracking-normal text-fg-secondary">{formatPercent(cl.flash ? 255 : cl.faderLevel)}</span>
          </span>
          <Slider aria-label="Scene level" value={cl.faderLevel} onChange={(v) => pb().setCuelistFader(cl.id, v)} defaultValue={255} color={slot?.color} />
        </div>
      </div>

      {/* Tabs + cue actions */}
      <div className="flex shrink-0 items-end gap-2 border-b border-line px-3">
        <Tabs<SceneTab>
          aria-label="Scene editor"
          className="!border-b-0"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'cues', label: 'Cues', badge: cl.cues.length },
            { id: 'effects', label: 'Effects', icon: LuSparkles, badge: fxCount || undefined },
            { id: 'settings', label: 'Settings', icon: LuSettings2 }
          ]}
        />
        <div className="flex-1" />
        {tab === 'cues' && (
          <div className="flex items-center gap-1 pb-1">
            {selectedCue && (
              <>
                <span className="mr-1 hidden truncate text-xs text-fg-tertiary xl:inline">Cue {formatCueNumber(selectedCue.number)}</span>
                <IconButton icon={LuArrowUp} size="sm" label="Move cue up" disabled={selectedIndex <= 0} onClick={() => pb().moveCue(cl.id, selectedIndex, selectedIndex - 1)} />
                <IconButton icon={LuArrowDown} size="sm" label="Move cue down" disabled={selectedIndex >= cl.cues.length - 1} onClick={() => pb().moveCue(cl.id, selectedIndex, selectedIndex + 1)} />
                <IconButton
                  icon={LuTrash2}
                  size="sm"
                  label="Delete cue"
                  className="hover:!text-danger-fg"
                  onClick={async () => { if (await deleteCue(cl.id, selectedCue)) onSelectCue(null) }}
                />
                <Button size="sm" variant="ghost" icon={LuRefreshCw} tooltip="Merge the programmer into the selected cue" onClick={updateSelectedCue}>Update</Button>
              </>
            )}
            <Button size="sm" variant="secondary" icon={LuCircleDot} className="!text-accent-fg" tooltip="Record the programmer as a new cue at the end" onClick={recordCue}>Add cue</Button>
          </div>
        )}
      </div>

      <div ref={body} data-reorder-scroll="" className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'cues' && (cl.cues.length === 0 ? (
          <EmptyState
            icon={LuListOrdered}
            title="No cues in this scene"
            description="Set a look in Fixtures, then record it as cue 1. Each cue fades from the previous one; unchanged channels track through."
            action={<Button variant="primary" icon={LuCircleDot} onClick={recordCue}>Record cue 1</Button>}
          />
        ) : (
          <CueTable
            cuelist={cl}
            selectedCueId={selectedCueId}
            onSelectCue={onSelectCue}
            columns={{ delay: width === 0 || width >= 720, tracked: width === 0 || width >= 840 }}
          />
        ))}
        {tab === 'effects' && <SceneEffects cuelist={cl} />}
        {tab === 'settings' && <SceneSettings cuelist={cl} slot={slot} learning={learning} onDelete={() => void deleteScene()} />}
      </div>
    </section>
  )
}

/** Hold to flash (full level; a stopped scene plays while held) */
function FlashButton({ cuelistId, disabled }: { cuelistId: string; disabled: boolean }) {
  // Released on unmount by Button's press handling (pointer up / cancel / blur / unmount)
  return (
    <Button
      size="lg"
      tone="warning"
      icon={LuZap}
      disabled={disabled}
      tooltip="Hold: full level (plays a stopped scene while held)"
      onPress={() => usePlaybackStore.getState().flashCuelist(cuelistId, true)}
      onRelease={() => usePlaybackStore.getState().flashCuelist(cuelistId, false)}
    >
      Flash
    </Button>
  )
}

/** On-stage cue, next cue and fade progress */
function OnStage({ cuelist: cl }: { cuelist: Cuelist }) {
  const cur = cl.isPlaying ? cl.cues[cl.currentCueIndex] : undefined
  const nextIndex = cl.isPlaying
    ? (cl.currentCueIndex + 1 < cl.cues.length ? cl.currentCueIndex + 1 : cl.isLooping && cl.cues.length > 1 ? 0 : -1)
    : (cl.cues.length > 0 ? 0 : -1)
  const next = nextIndex >= 0 ? cl.cues[nextIndex] : undefined
  const auto = cur && cur.followTime !== null && next ? `auto after ${formatSeconds(cur.followTime)}` : null

  return (
    <div className="relative flex min-w-[220px] flex-1 flex-col justify-center gap-0.5 overflow-hidden rounded-lg bg-surface-0 px-3 py-1.5 ring-1 ring-inset ring-line-subtle [[data-density=touch]_&]:py-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="w-10 shrink-0 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Cue</span>
        {cur ? (
          <>
            <span className="shrink-0 font-mono text-sm font-semibold tabular text-go-fg">{formatCueNumber(cur.number)}</span>
            <span className="min-w-0 truncate text-sm font-medium text-fg-primary">{cur.name || 'Untitled'}</span>
          </>
        ) : (
          <span className="text-sm text-fg-tertiary">{cl.cues.length === 0 ? 'No cues' : 'Stopped'}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-xs tabular text-fg-tertiary">{formatCuePosition(cl.isPlaying ? cl.currentCueIndex : -1, cl.cues.length)}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="w-10 shrink-0 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Next</span>
        {next ? (
          <>
            <span className="shrink-0 font-mono font-semibold tabular text-accent-fg">{formatCueNumber(next.number)}</span>
            <span className="min-w-0 truncate text-fg-secondary">{next.name || 'Untitled'}</span>
            <span className="ml-auto shrink-0 font-mono tabular text-fg-tertiary">
              {auto ?? `${formatSeconds(next.delay) !== '0s' ? `${formatSeconds(next.delay)} + ` : ''}${formatSeconds(next.fadeIn)}`}
            </span>
          </>
        ) : (
          <span className="text-fg-tertiary">{cl.cues.length === 0 ? '—' : 'End of scene'}</span>
        )}
      </div>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-3" />
      <FadeProgress cuelist={cl} className="absolute inset-x-0 bottom-0" />
    </div>
  )
}

/** Width of an element, rounded to 40 px steps (layout decisions only) */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const next = Math.round(el.clientWidth / 40) * 40
      setW((cur) => (cur === next ? cur : next))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}
