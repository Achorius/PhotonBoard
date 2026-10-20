// ============================================================
// Record popover — makes the record target explicit:
//   Scenes: new scene · add cue to the selected scene · update a cue
//   Chases: new chase · add step to the selected chase · update a step
// Shows what will be stored (programmer or live output, fixtures,
// channels, running effects) and can clear the programmer after.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { IconType } from 'react-icons'
import { LuCirclePlus, LuCircleDot, LuListPlus, LuRefreshCw, LuSparkles, LuTriangleAlert } from 'react-icons/lu'
import {
  Button, Checkbox, Popover, SegmentedControl, Switch, TextInput, cn, toast
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import {
  capture, clearProgrammerAfterRecord, recordAddCue, recordAddStep, recordNewChase, recordNewScene, recordUpdateCue, recordUpdateStep,
  type Capture
} from './record'

type Target = 'new' | 'add' | 'update'

const PREF_KEY = 'photonboard.scenes.record'

interface RecordPrefs {
  target: Target
  clearAfter: boolean
  includeEffects: boolean
  updateMode: 'merge' | 'replace'
}

function readPrefs(): RecordPrefs {
  const fallback: RecordPrefs = { target: 'new', clearAfter: false, includeEffects: true, updateMode: 'merge' }
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? 'null')
    if (raw && typeof raw === 'object') return { ...fallback, ...raw }
  } catch { /* ignore */ }
  return fallback
}

function writePrefs(p: RecordPrefs): void {
  try { window.localStorage.setItem(PREF_KEY, JSON.stringify(p)) } catch { /* ignore */ }
}

export interface RecordPopoverProps {
  open: boolean
  onClose: () => void
  anchor: React.RefObject<HTMLElement | null>
  pane: 'scenes' | 'chases'
  /** Cue / step the "update" target acts on */
  selectedCueId: string | null
  selectedStepId: string | null
  /** Called after recording a cue or a step (to select it) */
  onRecordedCue?: (cueId: string) => void
}

export function RecordPopover(props: RecordPopoverProps) {
  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      anchor={props.anchor}
      placement="bottom-end"
      className="w-[400px] max-w-[calc(100vw-24px)] [[data-density=touch]_&]:w-[460px]"
      aria-label="Record"
    >
      {props.open && <RecordForm {...props} />}
    </Popover>
  )
}

function RecordForm({ onClose, pane, selectedCueId, selectedStepId, onRecordedCue }: RecordPopoverProps) {
  const [prefs, setPrefs] = useState(readPrefs)
  const update = (p: Partial<RecordPrefs>) => setPrefs((cur) => {
    const next = { ...cur, ...p }
    writePrefs(next)
    return next
  })
  const selectionCount = usePatchStore((s) => s.selectedFixtureIds.length)
  const [selectedOnly, setSelectedOnly] = useState(true)
  const [name, setName] = useState('')
  const [cap, setCap] = useState<Capture>(() => capture(selectedOnly))
  // The programmer can still change while the popover is open (≤ 4 Hz)
  useEffect(() => {
    setCap(capture(selectedOnly))
    const t = setInterval(() => {
      const next = capture(selectedOnly)
      setCap((cur) => (cur.channelCount === next.channelCount && cur.fixtureCount === next.fixtureCount && cur.source === next.source && cur.effects.length === next.effects.length ? cur : next))
    }, 300)
    return () => clearInterval(t)
  }, [selectedOnly, selectionCount])

  const scene = usePlaybackStore((s) => (pane === 'scenes' ? s.cuelists.find((c) => c.id === s.selectedCuelistId) ?? null : null))
  const chase = usePlaybackStore((s) => (pane === 'chases' ? s.chases.find((c) => c.id === s.selectedChaseId) ?? null : null))

  const cueIndex = scene ? scene.cues.findIndex((c) => c.id === selectedCueId) : -1
  const updateCueIndex = scene ? (cueIndex >= 0 ? cueIndex : scene.isPlaying ? scene.currentCueIndex : -1) : -1
  const updateCue = scene && updateCueIndex >= 0 ? scene.cues[updateCueIndex] : undefined
  const stepIndex = chase ? chase.steps.findIndex((s) => s.id === selectedStepId) : -1
  const updateStep = chase && stepIndex >= 0 ? chase.steps[stepIndex] : undefined

  const canAdd = pane === 'scenes' ? !!scene : !!chase
  const canUpdate = pane === 'scenes' ? !!updateCue : !!updateStep
  const target: Target = prefs.target === 'add' && !canAdd ? 'new' : prefs.target === 'update' && !canUpdate ? (canAdd ? 'add' : 'new') : prefs.target
  const empty = cap.channelCount === 0
  const nameInput = useRef<HTMLInputElement>(null)

  const doRecord = () => {
    if (empty) return
    const fresh = capture(selectedOnly)
    if (fresh.channelCount === 0) return
    let message = ''
    if (pane === 'scenes') {
      if (target === 'new') {
        const id = recordNewScene(fresh, { name, includeEffects: prefs.includeEffects })
        const cl = usePlaybackStore.getState().cuelists.find((c) => c.id === id)
        if (cl?.cues[0]) onRecordedCue?.(cl.cues[0].id)
        message = `Scene “${cl?.name ?? ''}” recorded`
      } else if (target === 'add' && scene) {
        const cueId = recordAddCue(scene.id, fresh, name)
        if (cueId) onRecordedCue?.(cueId)
        message = `Cue ${scene.cues.length + 1} added to “${scene.name}”`
      } else if (target === 'update' && scene && updateCue) {
        recordUpdateCue(scene.id, updateCue.id, fresh, prefs.updateMode)
        message = `Cue ${updateCue.number} ${prefs.updateMode === 'merge' ? 'updated' : 'replaced'}`
      }
    } else {
      if (target === 'new') {
        const id = recordNewChase(fresh, name)
        message = `Chase “${usePlaybackStore.getState().chases.find((c) => c.id === id)?.name ?? ''}” recorded`
      } else if (target === 'add' && chase) {
        recordAddStep(chase.id, fresh)
        message = `Step ${chase.steps.length + 1} added to “${chase.name}”`
      } else if (target === 'update' && chase && updateStep) {
        recordUpdateStep(chase.id, updateStep.id, fresh, prefs.updateMode)
        message = `Step ${stepIndex + 1} ${prefs.updateMode === 'merge' ? 'updated' : 'replaced'}`
      }
    }
    if (prefs.clearAfter && fresh.source === 'programmer') clearProgrammerAfterRecord()
    toast.success(message || 'Recorded', { description: `${fresh.fixtureCount} fixtures · ${fresh.channelCount} channels${prefs.clearAfter && fresh.source === 'programmer' ? ' · programmer cleared' : ''}` })
    onClose()
  }

  const isScenes = pane === 'scenes'
  const showName = target !== 'update'
  const defaultName = isScenes
    ? target === 'new' ? 'Scene name (optional)' : `Cue ${(scene?.cues.length ?? 0) + 1}`
    : 'Chase name (optional)'

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => { e.preventDefault(); doRecord() }}
    >
      <header className="flex items-center gap-2 border-b border-line-subtle px-4 py-3">
        <LuCircleDot size={16} aria-hidden className="text-accent-fg" />
        <h2 className="flex-1 text-base font-semibold text-fg-primary">Record {isScenes ? 'scene / cue' : 'chase / step'}</h2>
      </header>

      {/* What will be recorded */}
      <div className="flex flex-col gap-2 border-b border-line-subtle px-4 py-3">
        <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Contents</div>
        <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2', empty ? 'bg-warning/10' : cap.source === 'programmer' ? 'bg-accent/10' : 'bg-surface-2')}>
          {empty ? <LuTriangleAlert size={16} aria-hidden className="shrink-0 text-warning-fg" /> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={cn('text-sm font-medium', empty ? 'text-warning-fg' : 'text-fg-primary')}>
              {empty ? 'Nothing to record' : cap.source === 'programmer' ? 'Programmer values' : 'Live output (programmer empty)'}
            </span>
            <span className="text-xs text-fg-tertiary">
              {empty
                ? 'Set levels in Fixtures or turn on an effect first.'
                : cap.source === 'programmer' ? 'Only the channels you touched are stored.' : 'Every channel above zero is stored.'}
            </span>
          </div>
          {!empty && (
            <div className="flex shrink-0 flex-col items-end font-mono text-xs tabular text-fg-secondary">
              <span>{cap.fixtureCount} fix</span>
              <span>{cap.channelCount} ch</span>
            </div>
          )}
        </div>
        {selectionCount > 0 && (
          <Checkbox
            checked={selectedOnly}
            onChange={setSelectedOnly}
            label={`Selected fixtures only (${selectionCount})`}
          />
        )}
      </div>

      {/* Target */}
      <div role="radiogroup" aria-label="Record into" className="flex flex-col gap-1.5 px-4 py-3">
        <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Record into</div>
        <TargetOption
          icon={LuCirclePlus}
          checked={target === 'new'}
          onSelect={() => update({ target: 'new' })}
          title={isScenes ? 'New scene' : 'New chase'}
          description={isScenes ? 'Creates a scene with this look as cue 1' : 'Creates a chase with this look as step 1'}
        />
        <TargetOption
          icon={LuListPlus}
          checked={target === 'add'}
          disabled={!canAdd}
          onSelect={() => update({ target: 'add' })}
          title={isScenes
            ? scene ? <>Add cue to <b className="font-semibold">{scene.name}</b></> : 'Add cue to selected scene'
            : chase ? <>Add step to <b className="font-semibold">{chase.name}</b></> : 'Add step to selected chase'}
          description={isScenes
            ? scene ? `Becomes cue ${(scene.cues[scene.cues.length - 1]?.number ?? 0) + 1}, after the last cue` : 'Select a scene first'
            : chase ? `Becomes step ${chase.steps.length + 1}` : 'Select a chase first'}
        />
        <TargetOption
          icon={LuRefreshCw}
          checked={target === 'update'}
          disabled={!canUpdate}
          onSelect={() => update({ target: 'update' })}
          title={isScenes
            ? updateCue ? <>Update cue {updateCue.number} <span className="text-fg-tertiary">{updateCue.name}</span></> : 'Update a cue'
            : updateStep ? <>Update step {stepIndex + 1}</> : 'Update a step'}
          description={isScenes
            ? updateCue ? `${updateCue.values.length} ch now · ${cueIndex >= 0 ? 'selected cue' : 'cue on stage'}` : 'Select a cue in the cue list'
            : updateStep ? `${updateStep.values.length} ch now` : 'Select a step in the step list'}
        >
          {target === 'update' && (
            <SegmentedControl
              size="xs"
              aria-label="Update mode"
              value={prefs.updateMode}
              onChange={(v) => update({ updateMode: v })}
              items={[
                { value: 'merge' as const, label: 'Merge', title: 'Add / override channels, keep the others' },
                { value: 'replace' as const, label: 'Replace', title: 'The cue holds only the new values' }
              ]}
            />
          )}
        </TargetOption>
      </div>

      <div className="flex flex-col gap-2 border-t border-line-subtle px-4 py-3">
        {showName && (
          <TextInput
            ref={nameInput}
            size="sm"
            aria-label="Name"
            placeholder={defaultName}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        {isScenes && target === 'new' && (
          <Switch
            checked={prefs.includeEffects && cap.effects.length > 0}
            disabled={cap.effects.length === 0}
            onChange={(v) => update({ includeEffects: v })}
            label={<span className="inline-flex items-center gap-1.5"><LuSparkles size={14} aria-hidden className="text-fg-tertiary" />Include running effects</span>}
            description={cap.effects.length > 0 ? `${cap.effects.length} running: ${cap.effects.slice(0, 3).map((e) => e.name).join(', ')}${cap.effects.length > 3 ? '…' : ''}` : 'No effect is running'}
          />
        )}
        <Switch
          checked={prefs.clearAfter}
          onChange={(v) => update({ clearAfter: v })}
          label="Clear programmer after recording"
          description="REC + Clear: release your manual values once stored"
        />
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-line-subtle px-4 py-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" icon={LuCircleDot} disabled={empty} data-autofocus="">
          {target === 'new' ? (isScenes ? 'Record scene' : 'Record chase') : target === 'add' ? (isScenes ? 'Record cue' : 'Record step') : 'Update'}
        </Button>
      </footer>
    </form>
  )
}

function TargetOption({ icon: Icon, checked, disabled, onSelect, title, description, children }: {
  icon: IconType
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  title: React.ReactNode
  description: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2 transition-colors duration-fast',
        checked ? 'border-accent/70 bg-accent/10' : 'border-line hover:bg-surface-2',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        disabled={disabled}
        onClick={onSelect}
        className="flex min-h-control items-center gap-3 text-left outline-offset-2"
      >
        <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2', checked ? 'border-accent' : 'border-line-strong')}>
          {checked && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>
        <Icon size={16} aria-hidden className={cn('shrink-0', checked ? 'text-accent-fg' : 'text-fg-tertiary')} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-fg-primary">{title}</span>
          <span className="truncate text-xs text-fg-tertiary">{description}</span>
        </span>
      </button>
      {children && <div className="pl-[52px]">{children}</div>}
    </div>
  )
}
