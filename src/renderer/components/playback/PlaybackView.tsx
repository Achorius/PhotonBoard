// ============================================================
// PlaybackView — "Scenes & chases" workspace.
//   Header: Scenes / Chases switch, programmer status, Record…
//   Left:   scene (or chase) list — select, quick GO / Stop
//   Right:  editor of the selected scene (cue list, effects,
//           settings, big playback controls) or chase (steps).
// Keyboard: Space = GO selected scene / start-stop selected chase
// (global shortcut), ↑ ↓ in the list move the selection; Delete /
// Backspace, Mod+D, F2 / Enter act on the selected scene or chase
// (the cue / step tables register their own, innermost, actions).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { LuCircleDot, LuClapperboard, LuListMusic, LuMousePointerClick } from 'react-icons/lu'
import { Button, EmptyState, ResizeHandle, SegmentedControl, cn, usePopover, useResizable } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { recordFromProgrammer } from '@renderer/lib/programmer-utils'
import { summaryCounts, useConsoleProgrammer } from '@renderer/lib/console-programmer'
import { isRemoteMode } from '@renderer/lib/runtime'
import { useSelectionActions } from '@renderer/lib/selection-actions'
import { SceneList } from './SceneList'
import { SceneDetail } from './SceneDetail'
import { ChaseDetail, ChaseList } from './ChasePane'
import { RecordPopover } from './RecordPopover'
import { countFixtures } from './record'
import { useExecutorSlots } from './scene-meta'
import { chaseSelectionActions, sceneSelectionActions } from './actions'

type Pane = 'scenes' | 'chases'

export function PlaybackView() {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const pane = usePlaybackStore((s) => s.editorPane)
  const sceneCount = usePlaybackStore((s) => s.cuelists.length)
  const chaseCount = usePlaybackStore((s) => s.chases.length)
  const touch = useUiStore((s) => s.density === 'touch')
  const pendingCuelistId = useUiStore((s) => s.pendingCuelistId)
  const rec = usePopover()
  const side = useResizable({ initial: touch ? 360 : 320, min: 260, max: 520, storageKey: touch ? 'scenes.list.touch' : 'scenes.list' })
  // Selected cue / step belong to one scene / chase
  const [cueSel, setCueSel] = useState<{ owner: string; id: string } | null>(null)
  const [stepSel, setStepSel] = useState<{ owner: string; id: string } | null>(null)

  // "Edit in Scenes" from the executor bar / timeline
  useEffect(() => {
    if (!pendingCuelistId) return
    const pb = usePlaybackStore.getState()
    pb.setEditorPane('scenes')
    pb.selectCuelist(pendingCuelistId)
    useUiStore.setState({ pendingCuelistId: null })
  }, [pendingCuelistId])

  // Keep a valid selection (first item) so Space and the editor always have a target
  const selectedCuelistId = usePlaybackStore((s) => (s.cuelists.some((c) => c.id === s.selectedCuelistId) ? s.selectedCuelistId : s.cuelists[0]?.id ?? null))
  const selectedChaseId = usePlaybackStore((s) => (s.chases.some((c) => c.id === s.selectedChaseId) ? s.selectedChaseId : s.chases[0]?.id ?? null))
  useEffect(() => {
    const pb = usePlaybackStore.getState()
    if (pb.selectedCuelistId !== selectedCuelistId) pb.selectCuelist(selectedCuelistId)
    if (pb.selectedChaseId !== selectedChaseId) pb.selectChase(selectedChaseId)
  }, [selectedCuelistId, selectedChaseId])

  const selectedCueId = cueSel && cueSel.owner === selectedCuelistId ? cueSel.id : null
  const selectedStepId = stepSel && stepSel.owner === selectedChaseId ? stepSel.id : null


  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-surface-1">
      <ViewSelection scope={rootRef} pane={pane} cuelistId={selectedCuelistId} chaseId={selectedChaseId} />
      <header className="flex h-control-lg shrink-0 items-center gap-3 border-b border-line px-3">
        <SegmentedControl<Pane>
          size="sm"
          aria-label={t('scenes.view.paneAria')}
          value={pane}
          onChange={(p) => usePlaybackStore.getState().setEditorPane(p)}
          items={[
            { value: 'scenes', icon: LuClapperboard, label: t('common.scenes'), title: t('common.sceneCount', { count: sceneCount }), 'data-pane': 'scenes' },
            { value: 'chases', icon: LuListMusic, label: t('common.chases'), title: t('common.chaseCount', { count: chaseCount }), 'data-pane': 'chases' }
          ]}
        />
        <div className="flex-1" />
        <ProgrammerStatus />
        <Button
          ref={rec.anchorRef}
          {...rec.triggerProps}
          variant="primary"
          icon={LuCircleDot}
          active={rec.open}
          onClick={rec.toggle}
          tooltip={pane === 'scenes' ? t('scenes.view.recordSceneTooltip') : t('scenes.view.recordChaseTooltip')}
          data-record-button=""
        >
          {t('scenes.view.record')}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside style={{ width: side.size }} className="flex min-h-0 shrink-0 flex-col border-r border-line">
          {pane === 'scenes'
            ? <SceneList selectedId={selectedCuelistId} onRecord={() => rec.setOpen(true)} />
            : <ChaseList selectedId={selectedChaseId} onRecord={() => rec.setOpen(true)} />}
        </aside>
        <ResizeHandle {...side.handleProps} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {pane === 'scenes'
            ? <SelectedScene id={selectedCuelistId} selectedCueId={selectedCueId} onSelectCue={(id) => setCueSel(id && selectedCuelistId ? { owner: selectedCuelistId, id } : null)} />
            : <SelectedChase id={selectedChaseId} selectedStepId={selectedStepId} onSelectStep={(id) => setStepSel(id && selectedChaseId ? { owner: selectedChaseId, id } : null)} />}
        </div>
      </div>

      <RecordPopover
        {...rec.props}
        pane={pane}
        selectedCueId={selectedCueId}
        selectedStepId={selectedStepId}
        onRecordedCue={(id) => {
          const owner = usePlaybackStore.getState().selectedCuelistId
          if (owner) setCueSel({ owner, id })
        }}
      />
    </div>
  )
}

/**
 * Delete / Backspace, Mod+D, F2 / Enter on the selected scene (or chase) from
 * anywhere in the view. A leaf: re-renders alone when that item changes.
 */
function ViewSelection({ scope, pane, cuelistId, chaseId }: {
  scope: React.RefObject<HTMLDivElement | null>
  pane: Pane
  cuelistId: string | null
  chaseId: string | null
}) {
  const scene = usePlaybackStore((s) => (pane === 'scenes' && cuelistId ? s.cuelists.find((c) => c.id === cuelistId) : undefined))
  const chase = usePlaybackStore((s) => (pane === 'chases' && chaseId ? s.chases.find((c) => c.id === chaseId) : undefined))
  useSelectionActions(scene ? sceneSelectionActions(scene) : chase ? chaseSelectionActions(chase) : null, { scope })
  return null
}

function SelectedScene({ id, selectedCueId, onSelectCue }: { id: string | null; selectedCueId: string | null; onSelectCue: (id: string | null) => void }) {
  const t = useT()
  const cuelist = usePlaybackStore((s) => (id ? s.cuelists.find((c) => c.id === id) : undefined))
  const number = usePlaybackStore((s) => s.cuelists.findIndex((c) => c.id === id) + 1)
  const slots = useExecutorSlots()
  if (!cuelist) {
    return (
      <EmptyState
        icon={LuMousePointerClick}
        title={t('scenes.view.noSceneTitle')}
        description={t('scenes.view.noSceneText')}
      />
    )
  }
  return <SceneDetail cuelist={cuelist} number={number} slot={slots.get(cuelist.id)} selectedCueId={selectedCueId} onSelectCue={onSelectCue} />
}

function SelectedChase({ id, selectedStepId, onSelectStep }: { id: string | null; selectedStepId: string | null; onSelectStep: (id: string | null) => void }) {
  const t = useT()
  const chase = usePlaybackStore((s) => (id ? s.chases.find((c) => c.id === id) : undefined))
  const number = usePlaybackStore((s) => s.chases.findIndex((c) => c.id === id) + 1)
  if (!chase) {
    return (
      <EmptyState
        icon={LuMousePointerClick}
        title={t('scenes.view.noChaseTitle')}
        description={t('scenes.view.noChaseText')}
      />
    )
  }
  return <ChaseDetail key={chase.id} chase={chase} number={number} selectedStepId={selectedStepId} onSelectStep={onSelectStep} />
}

/** What Record would store: polled at 4 Hz, re-renders only when the counts change */
function ProgrammerStatus() {
  const t = useT()
  const [counts, setCounts] = useState<{ fixtures: number; channels: number }>({ fixtures: 0, channels: 0 })
  useEffect(() => {
    const poll = () => {
      let fixtures: number
      let channels: number
      if (isRemoteMode()) {
        // Record uses the CONSOLE's programmer: show that one
        const c = summaryCounts(useConsoleProgrammer.getState())
        fixtures = c.fixtureCount
        channels = c.channelCount
      } else {
        const values = recordFromProgrammer()
        fixtures = countFixtures(values)
        channels = values.length
      }
      setCounts((cur) => (cur.fixtures === fixtures && cur.channels === channels ? cur : { fixtures, channels }))
    }
    poll()
    const timer = setInterval(poll, 250)
    return () => clearInterval(timer)
  }, [])
  const active = counts.channels > 0
  return (
    <span
      className={cn(
        'hidden h-control-sm items-center gap-2 rounded-full px-3 text-xs md:inline-flex',
        active ? 'bg-accent/15 text-accent-fg' : 'bg-surface-2 text-fg-tertiary'
      )}
      title={active ? t('scenes.programmer.activeTooltip') : t('scenes.programmer.emptyTooltip')}
    >
      <span aria-hidden className={cn('h-2 w-2 rounded-full', active ? 'bg-accent' : 'bg-surface-5')} />
      {active ? (
        <>
          <span className="font-medium">{t('common.programmer')}</span>
          <span className="font-mono tabular">{t('scenes.programmer.counts', { fixtures: counts.fixtures, channels: counts.channels })}</span>
        </>
      ) : (
        <span>{t('scenes.programmer.empty')}</span>
      )}
    </span>
  )
}
