// ============================================================
// Scene settings: name, colour (executor column), priority, loop,
// level, executor button mode, MIDI, cue-wide actions; in the Pro
// view an "Advanced" section (tracking, MIB, rate, priority mode,
// speed master).
// ============================================================

import { LuCopy, LuHand, LuListOrdered, LuPiano, LuTimer, LuTrash2, LuX } from 'react-icons/lu'
import type { Cuelist } from '@shared/types'
import {
  Badge, Button, Field, NumberField, SWATCH_COLORS, Section, SegmentedControl, Slider, Switch, SwatchPicker, TextInput, formatPercent
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useExecutorStore, type SceneMode } from '@renderer/stores/executor-store'
import { useMidiStore } from '@renderer/stores/midi-store'
import { deleteWithUndo } from '@renderer/lib/selection-actions'
import { MODE_LABEL, describeMidiSource, formatMidiSource, formatSlot, modeHint, setSceneMode, startSceneLearn, type ExecutorSlot } from './scene-meta'
import { deleteScene, duplicateScene } from './actions'
import { SceneAdvanced } from './SceneAdvanced'
import { useUiStore } from '@renderer/stores/ui-store'

export function SceneSettings({ cuelist: cl, slot, learning }: {
  cuelist: Cuelist
  slot: ExecutorSlot | undefined
  learning: boolean
}) {
  const t = useT()
  const pb = usePlaybackStore.getState
  const proMode = useUiStore((s) => s.proMode)
  const mapping = useMidiStore((s) => s.mappings.find((m) => m.target.type === 'cuelist_go' && m.target.id === cl.id))
  const allFollow = cl.cues.length > 0 && cl.cues.every((c) => c.followTime !== null)
  const noneFollow = cl.cues.every((c) => c.followTime === null)

  return (
    <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
      <div className="flex flex-col">
        <Section title={t('common.scene')}>
          <Field label={t('common.name')}>
            {(id) => <TextInput id={id} size="sm" value={cl.name} onChange={(e) => pb().renameCuelist(cl.id, e.target.value)} />}
          </Field>
          <Field
            label={t('common.color')}
            hint={slot
              ? slot.title ? t('scenes.settings.colorHintNamed', { col: slot.col + 1, title: slot.title }) : t('scenes.settings.colorHint', { col: slot.col + 1 })
              : t('scenes.settings.colorHintNoSlot')}
          >
            <SwatchPicker
              colors={SWATCH_COLORS}
              value={slot?.color}
              columns={6}
              size="sm"
              onChange={(c) => { if (slot) useExecutorStore.getState().setColumnColor(slot.col, c) }}
              className={slot ? undefined : 'pointer-events-none opacity-40'}
            />
          </Field>
          <Field label={t('scenes.priority')} hint={t('scenes.settings.priorityHint')}>
            {(id) => (
              <div id={id} className="w-[120px]">
                <NumberField size="sm" value={cl.priority} onChange={(v) => pb().setCuelistPriority(cl.id, v)} min={0} max={100} step={1} aria-label={t('scenes.priority')} />
              </div>
            )}
          </Field>
          <Field label={t('scenes.level')}>
            <Slider
              aria-label={t('scenes.detail.levelAria')}
              value={cl.faderLevel}
              onChange={(v) => pb().setCuelistFader(cl.id, v)}
              defaultValue={255}
              showValue={(v) => formatPercent(v)}
            />
          </Field>
          <Switch
            checked={cl.isLooping}
            onChange={(v) => pb().setCuelistLooping(cl.id, v)}
            label={t('scenes.loop')}
            description={t('scenes.settings.loopDescription')}
          />
        </Section>
        <Section title={t('common.cues')}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={LuTimer} disabled={cl.cues.length === 0 || allFollow} onClick={() => { for (const c of cl.cues) if (c.followTime === null) pb().updateCue(cl.id, c.id, { followTime: 0 }) }}>
              {t('scenes.settings.autoFollowAll')}
            </Button>
            <Button size="sm" icon={LuHand} disabled={cl.cues.length === 0 || noneFollow} onClick={() => { for (const c of cl.cues) if (c.followTime !== null) pb().updateCue(cl.id, c.id, { followTime: null }) }}>
              {t('scenes.settings.manualAll')}
            </Button>
            <Button
              size="sm"
              icon={LuListOrdered}
              disabled={cl.cues.length === 0 || cl.cues.every((c, i) => c.number === i + 1)}
              tooltip={t('scenes.settings.renumberTooltip')}
              onClick={() => cl.cues.forEach((c, i) => { if (c.number !== i + 1) pb().updateCue(cl.id, c.id, { number: i + 1 }) })}
            >
              {t('scenes.settings.renumber')}
            </Button>
          </div>
        </Section>
        {proMode && <SceneAdvanced cuelist={cl} />}
      </div>
      <div className="flex flex-col">
        <Section title={t('scenes.settings.executor')}>
          {slot ? (
            <>
              <Field label={t('scenes.settings.slot')}>
                <span className="font-mono text-sm tabular text-fg-primary">
                  {t('scenes.slotShort', { slot: formatSlot(slot) })}{' '}
                  <span className="font-sans text-xs text-fg-tertiary">{t('scenes.settings.slotPosition', { col: slot.col + 1, row: slot.row + 1 })}</span>
                </span>
              </Field>
              <Field label={t('scenes.settings.button')} hint={modeHint(slot.mode)}>
                <SegmentedControl<SceneMode>
                  size="sm"
                  aria-label={t('scenes.settings.buttonModeAria')}
                  value={slot.mode}
                  onChange={(m) => setSceneMode(cl.id, slot, m)}
                  items={(['toggle', 'trigger', 'flash'] as SceneMode[]).map((m) => ({ value: m, label: MODE_LABEL[m], title: modeHint(m) }))}
                />
              </Field>
            </>
          ) : (
            <p className="text-xs text-fg-tertiary">{t('scenes.settings.noSlot')}</p>
          )}
        </Section>
        <Section title={t('scenes.settings.midi')}>
          <div className="flex flex-wrap items-center gap-2">
            {learning ? (
              <Badge tone="midi" variant="solid" className="animate-pulse">{t('scenes.midi.waiting')}</Badge>
            ) : mapping ? (
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone="midi" mono>{formatMidiSource(mapping)}</Badge>
                <span className="truncate text-xs text-fg-tertiary">{describeMidiSource(mapping)}</span>
              </span>
            ) : (
              <span className="text-xs text-fg-tertiary">{t('scenes.midi.none')}</span>
            )}
            <div className="ml-auto flex gap-2">
              {learning ? (
                <Button size="sm" icon={LuX} onClick={() => useMidiStore.getState().cancelLearn()}>{t('common.cancel')}</Button>
              ) : (
                <Button size="sm" icon={LuPiano} onClick={() => startSceneLearn(cl, slot?.mode ?? 'toggle')}>{mapping ? t('scenes.midi.relearn') : t('common.midiLearn')}</Button>
              )}
              {mapping && !learning && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={LuTrash2}
                  onClick={() => void deleteWithUndo({
                    label: t('scenes.selection.midiMapping', { source: formatMidiSource(mapping), name: cl.name }),
                    confirm: { confirmLabel: t('scenes.midi.removeAction') },
                    run: () => useMidiStore.getState().removeMapping(mapping.id)
                  })}
                >
                  {t('common.remove')}
                </Button>
              )}
            </div>
          </div>
        </Section>
        <Section title={t('scenes.detail.actions')}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={LuCopy} shortcut="Mod+D" onClick={() => { duplicateScene(cl) }}>{t('scenes.detail.duplicate')}</Button>
            <Button size="sm" variant="danger-outline" icon={LuTrash2} shortcut="Backspace" onClick={() => void deleteScene(cl)}>{t('scenes.detail.deleteEllipsis')}</Button>
          </div>
        </Section>
      </div>
    </div>
  )
}
