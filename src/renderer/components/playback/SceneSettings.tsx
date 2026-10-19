// ============================================================
// Scene settings: name, colour (executor column), priority, loop,
// level, executor button mode, MIDI, cue-wide actions.
// ============================================================

import { LuCopy, LuHand, LuListOrdered, LuPiano, LuTimer, LuTrash2, LuX } from 'react-icons/lu'
import type { Cuelist } from '@shared/types'
import {
  Badge, Button, Field, NumberField, SWATCH_COLORS, Section, SegmentedControl, Slider, Switch, SwatchPicker, TextInput, confirm, formatPercent
} from '@renderer/components/ui'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useExecutorStore, type SceneMode } from '@renderer/stores/executor-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { MODE_HINT, MODE_LABEL, describeMidiSource, formatMidiSource, formatSlot, setSceneMode, startSceneLearn, type ExecutorSlot } from './scene-meta'

export function SceneSettings({ cuelist: cl, slot, learning, onDelete }: {
  cuelist: Cuelist
  slot: ExecutorSlot | undefined
  learning: boolean
  onDelete: () => void
}) {
  const pb = usePlaybackStore.getState
  const mapping = useMidiStore((s) => s.mappings.find((m) => m.target.type === 'cuelist_go' && m.target.id === cl.id))
  const allFollow = cl.cues.length > 0 && cl.cues.every((c) => c.followTime !== null)
  const noneFollow = cl.cues.every((c) => c.followTime === null)

  return (
    <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
      <div className="flex flex-col">
        <Section title="Scene">
          <Field label="Name">
            {(id) => <TextInput id={id} size="sm" value={cl.name} onChange={(e) => pb().renameCuelist(cl.id, e.target.value)} />}
          </Field>
          <Field label="Colour" hint={slot ? `Executor column ${slot.col + 1}${slot.title ? ` “${slot.title}”` : ''} — shared by its scenes` : 'Shown once the scene has an executor slot'}>
            <SwatchPicker
              colors={SWATCH_COLORS}
              value={slot?.color}
              columns={6}
              size="sm"
              onChange={(c) => { if (slot) useExecutorStore.getState().setColumnColor(slot.col, c) }}
              className={slot ? undefined : 'pointer-events-none opacity-40'}
            />
          </Field>
          <Field label="Priority" hint="Higher wins on channels shared with other scenes">
            {(id) => (
              <div id={id} className="w-[120px]">
                <NumberField size="sm" value={cl.priority} onChange={(v) => pb().setCuelistPriority(cl.id, v)} min={0} max={100} step={1} aria-label="Priority" />
              </div>
            )}
          </Field>
          <Field label="Level">
            <Slider
              aria-label="Scene level"
              value={cl.faderLevel}
              onChange={(v) => pb().setCuelistFader(cl.id, v)}
              defaultValue={255}
              showValue={(v) => formatPercent(v)}
            />
          </Field>
          <Switch
            checked={cl.isLooping}
            onChange={(v) => pb().setCuelistLooping(cl.id, v)}
            label="Loop"
            description="After the last cue, auto-follow continues with cue 1"
          />
        </Section>
        <Section title="Cues">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={LuTimer} disabled={cl.cues.length === 0 || allFollow} onClick={() => { for (const c of cl.cues) if (c.followTime === null) pb().updateCue(cl.id, c.id, { followTime: 0 }) }}>
              Auto-follow all
            </Button>
            <Button size="sm" icon={LuHand} disabled={cl.cues.length === 0 || noneFollow} onClick={() => { for (const c of cl.cues) if (c.followTime !== null) pb().updateCue(cl.id, c.id, { followTime: null }) }}>
              Manual GO for all
            </Button>
            <Button
              size="sm"
              icon={LuListOrdered}
              disabled={cl.cues.length === 0 || cl.cues.every((c, i) => c.number === i + 1)}
              tooltip="Number the cues 1, 2, 3… in list order"
              onClick={() => cl.cues.forEach((c, i) => { if (c.number !== i + 1) pb().updateCue(cl.id, c.id, { number: i + 1 }) })}
            >
              Renumber
            </Button>
          </div>
        </Section>
      </div>
      <div className="flex flex-col">
        <Section title="Executor">
          {slot ? (
            <>
              <Field label="Slot">
                <span className="font-mono text-sm tabular text-fg-primary">EX {formatSlot(slot)} <span className="font-sans text-xs text-fg-tertiary">column {slot.col + 1}, row {slot.row + 1}</span></span>
              </Field>
              <Field label="Button" hint={MODE_HINT[slot.mode]}>
                <SegmentedControl<SceneMode>
                  size="sm"
                  aria-label="Executor button mode"
                  value={slot.mode}
                  onChange={(m) => setSceneMode(cl.id, slot, m)}
                  items={(['toggle', 'trigger', 'flash'] as SceneMode[]).map((m) => ({ value: m, label: MODE_LABEL[m], title: MODE_HINT[m] }))}
                />
              </Field>
            </>
          ) : (
            <p className="text-xs text-fg-tertiary">Not on the executor bar — all 32 slots are in use. Free a slot to give this scene a button.</p>
          )}
        </Section>
        <Section title="MIDI">
          <div className="flex flex-wrap items-center gap-2">
            {learning ? (
              <Badge tone="midi" variant="solid" className="animate-pulse">Waiting for a MIDI key or pad…</Badge>
            ) : mapping ? (
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone="midi" mono>{formatMidiSource(mapping)}</Badge>
                <span className="truncate text-xs text-fg-tertiary">{describeMidiSource(mapping)}</span>
              </span>
            ) : (
              <span className="text-xs text-fg-tertiary">No MIDI trigger</span>
            )}
            <div className="ml-auto flex gap-2">
              {learning ? (
                <Button size="sm" icon={LuX} onClick={() => useMidiStore.getState().cancelLearn()}>Cancel</Button>
              ) : (
                <Button size="sm" icon={LuPiano} onClick={() => startSceneLearn(cl, slot?.mode ?? 'toggle')}>{mapping ? 'Re-learn' : 'MIDI learn'}</Button>
              )}
              {mapping && !learning && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={LuTrash2}
                  onClick={async () => {
                    const ok = await confirm({ title: `Remove MIDI ${formatMidiSource(mapping)} from “${cl.name}”?`, confirmLabel: 'Remove mapping', tone: 'danger' })
                    if (ok) useMidiStore.getState().removeMapping(mapping.id)
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </Section>
        <Section title="Scene actions">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={LuCopy} onClick={() => { const id = pb().duplicateCuelist(cl.id); if (id) pb().selectCuelist(id) }}>Duplicate scene</Button>
            <Button size="sm" variant="danger-outline" icon={LuTrash2} onClick={onDelete}>Delete scene…</Button>
          </div>
        </Section>
      </div>
    </div>
  )
}
