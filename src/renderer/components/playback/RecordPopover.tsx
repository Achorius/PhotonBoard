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
import { formatList, useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import {
  capture, captureSummary, clearProgrammerAfterRecord, recordAddCue, recordAddStep, recordNewChase, recordNewScene, recordUpdateCue, recordUpdateStep,
  type Capture
} from './record'
import { formatCueNumber } from './actions'

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
  const t = useT()
  return (
    <Popover
      open={props.open}
      onClose={props.onClose}
      anchor={props.anchor}
      placement="bottom-end"
      className="w-[400px] max-w-[calc(100vw-24px)] [[data-density=touch]_&]:w-[460px]"
      aria-label={t('common.record')}
    >
      {props.open && <RecordForm {...props} />}
    </Popover>
  )
}

function RecordForm({ onClose, pane, selectedCueId, selectedStepId, onRecordedCue }: RecordPopoverProps) {
  const t = useT()
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
    const timer = setInterval(() => {
      const next = capture(selectedOnly)
      setCap((cur) => (cur.channelCount === next.channelCount && cur.fixtureCount === next.fixtureCount && cur.source === next.source && cur.effects.length === next.effects.length ? cur : next))
    }, 300)
    return () => clearInterval(timer)
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
        message = t('scenes.toast.sceneRecorded', { name: cl?.name ?? '' })
      } else if (target === 'add' && scene) {
        const cueId = recordAddCue(scene.id, fresh, name)
        if (cueId) onRecordedCue?.(cueId)
        message = t('scenes.toast.cueAdded', { number: scene.cues.length + 1, name: scene.name })
      } else if (target === 'update' && scene && updateCue) {
        recordUpdateCue(scene.id, updateCue.id, fresh, prefs.updateMode)
        message = t(prefs.updateMode === 'merge' ? 'scenes.toast.cueUpdated' : 'scenes.toast.cueReplaced', { number: formatCueNumber(updateCue.number) })
      }
    } else {
      if (target === 'new') {
        const id = recordNewChase(fresh, name)
        message = t('scenes.toast.chaseRecorded', { name: usePlaybackStore.getState().chases.find((c) => c.id === id)?.name ?? '' })
      } else if (target === 'add' && chase) {
        recordAddStep(chase.id, fresh)
        message = t('scenes.toast.stepAdded', { n: chase.steps.length + 1, name: chase.name })
      } else if (target === 'update' && chase && updateStep) {
        recordUpdateStep(chase.id, updateStep.id, fresh, prefs.updateMode)
        message = t(prefs.updateMode === 'merge' ? 'scenes.toast.stepUpdated' : 'scenes.toast.stepReplaced', { n: stepIndex + 1 })
      }
    }
    const cleared = prefs.clearAfter && fresh.source === 'programmer'
    if (cleared) clearProgrammerAfterRecord()
    toast.success(message || t('scenes.toast.recorded'), {
      description: cleared ? t('scenes.toast.summaryCleared', { summary: captureSummary(fresh) }) : captureSummary(fresh)
    })
    onClose()
  }

  const isScenes = pane === 'scenes'
  const showName = target !== 'update'
  const defaultName = isScenes
    ? target === 'new' ? t('scenes.record.sceneNamePlaceholder') : t('scenes.defaults.cueName', { n: (scene?.cues.length ?? 0) + 1 })
    : t('scenes.record.chaseNamePlaceholder')

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => { e.preventDefault(); doRecord() }}
    >
      <header className="flex items-center gap-2 border-b border-line-subtle px-4 py-3">
        <LuCircleDot size={16} aria-hidden className="text-accent-fg" />
        <h2 className="flex-1 text-base font-semibold text-fg-primary">{isScenes ? t('scenes.record.titleScenes') : t('scenes.record.titleChases')}</h2>
      </header>

      {/* What will be recorded */}
      <div className="flex flex-col gap-2 border-b border-line-subtle px-4 py-3">
        <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('scenes.record.contents')}</div>
        <div className={cn('flex items-center gap-3 rounded-lg px-3 py-2', empty ? 'bg-warning/10' : cap.source === 'programmer' ? 'bg-accent/10' : 'bg-surface-2')}>
          {empty ? <LuTriangleAlert size={16} aria-hidden className="shrink-0 text-warning-fg" /> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className={cn('text-sm font-medium', empty ? 'text-warning-fg' : 'text-fg-primary')}>
              {empty ? t('scenes.record.nothing') : cap.source === 'programmer' ? t('scenes.record.sourceProgrammer') : t('scenes.record.sourceOutput')}
            </span>
            <span className="text-xs text-fg-tertiary">
              {empty
                ? t('scenes.record.nothingHintEffects')
                : cap.source === 'programmer' ? t('scenes.record.sourceProgrammerHint') : t('scenes.record.sourceOutputHint')}
            </span>
          </div>
          {!empty && (
            <div className="flex shrink-0 flex-col items-end font-mono text-xs tabular text-fg-secondary">
              <span>{t('scenes.record.fixturesShort', { count: cap.fixtureCount })}</span>
              <span>{t('units.channelsShortValue', { count: cap.channelCount })}</span>
            </div>
          )}
        </div>
        {selectionCount > 0 && (
          <Checkbox
            checked={selectedOnly}
            onChange={setSelectedOnly}
            label={t('scenes.record.selectedOnly', { count: selectionCount })}
          />
        )}
      </div>

      {/* Target */}
      <div role="radiogroup" aria-label={t('scenes.record.into')} className="flex flex-col gap-1.5 px-4 py-3">
        <div className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('scenes.record.into')}</div>
        <TargetOption
          icon={LuCirclePlus}
          checked={target === 'new'}
          onSelect={() => update({ target: 'new' })}
          title={isScenes ? t('scenes.record.newScene') : t('scenes.record.newChase')}
          description={isScenes ? t('scenes.record.newSceneHint') : t('scenes.record.newChaseHint')}
        />
        <TargetOption
          icon={LuListPlus}
          checked={target === 'add'}
          disabled={!canAdd}
          onSelect={() => update({ target: 'add' })}
          title={isScenes
            ? scene ? t.rich('scenes.record.addCueTo', { name: <b className="font-semibold">{scene.name}</b> }) : t('scenes.record.addCueSelected')
            : chase ? t.rich('scenes.record.addStepTo', { name: <b className="font-semibold">{chase.name}</b> }) : t('scenes.record.addStepSelected')}
          description={isScenes
            ? scene ? t('scenes.record.becomesCue', { number: formatCueNumber((scene.cues[scene.cues.length - 1]?.number ?? 0) + 1) }) : t('scenes.record.selectSceneFirst')
            : chase ? t('scenes.record.becomesStep', { n: chase.steps.length + 1 }) : t('scenes.record.selectChaseFirst')}
        />
        <TargetOption
          icon={LuRefreshCw}
          checked={target === 'update'}
          disabled={!canUpdate}
          onSelect={() => update({ target: 'update' })}
          title={isScenes
            ? updateCue
              ? t.rich('scenes.record.updateCueN', { number: formatCueNumber(updateCue.number), name: <span className="text-fg-tertiary">{updateCue.name}</span> })
              : t('scenes.record.updateACue')
            : updateStep ? t('scenes.record.updateStepN', { n: stepIndex + 1 }) : t('scenes.record.updateAStep')}
          description={isScenes
            ? updateCue
              ? t(cueIndex >= 0 ? 'scenes.record.updateCueSelected' : 'scenes.record.updateCueOnStage', { count: updateCue.values.length })
              : t('scenes.record.selectCueFirst')
            : updateStep ? t('scenes.record.channelsNow', { count: updateStep.values.length }) : t('scenes.record.selectStepFirst')}
        >
          {target === 'update' && (
            <SegmentedControl
              size="xs"
              aria-label={t('scenes.record.updateModeAria')}
              value={prefs.updateMode}
              onChange={(v) => update({ updateMode: v })}
              items={[
                { value: 'merge' as const, label: t('scenes.update.merge'), title: t('scenes.update.mergeTitle') },
                { value: 'replace' as const, label: t('scenes.update.replace'), title: isScenes ? t('scenes.update.replaceCueDescription') : t('scenes.update.replaceStepDescription') }
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
            aria-label={t('common.name')}
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
            label={<span className="inline-flex items-center gap-1.5"><LuSparkles size={14} aria-hidden className="text-fg-tertiary" />{t('scenes.record.includeEffects')}</span>}
            description={cap.effects.length > 0
              ? t('scenes.record.runningEffects', {
                count: cap.effects.length,
                names: cap.effects.length > 3 ? `${cap.effects.slice(0, 3).map((e) => e.name).join(', ')}…` : formatList(cap.effects.map((e) => e.name))
              })
              : t('scenes.record.noEffectRunning')}
          />
        )}
        <Switch
          checked={prefs.clearAfter}
          onChange={(v) => update({ clearAfter: v })}
          label={t('scenes.record.clearAfter')}
          description={t('scenes.record.clearAfterHint')}
        />
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-line-subtle px-4 py-3">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" icon={LuCircleDot} disabled={empty} data-autofocus="">
          {target === 'new'
            ? (isScenes ? t('scenes.list.recordScene') : t('scenes.chaseList.recordChase'))
            : target === 'add' ? (isScenes ? t('scenes.record.recordCue') : t('scenes.record.recordStep')) : t('common.update')}
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
