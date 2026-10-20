// "Learn" button: pick what to control, then move a control on the device.
// While learning it becomes the cancel button.

import type React from 'react'
import { LuChevronDown, LuPiano, LuX } from 'react-icons/lu'
import { Button, DropdownMenu, type ButtonProps, type MenuEntry } from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import { useMidiStore } from '@renderer/stores/midi-store'
import type { MidiTargetType } from '@shared/types'
import { TARGETS, refItems, targetDescription, targetLabel, useNameIndex, type NameIndex } from './midi-model'

function learn(type: MidiTargetType, label: string, id?: string): void {
  useMidiStore.getState().startLearn({ type, id, label })
}

function simple(type: MidiTargetType): MenuEntry {
  const label = targetLabel(type)
  return { label, icon: TARGETS[type].icon, description: targetDescription(type), onSelect: () => learn(type, label) }
}

function withItems(type: MidiTargetType, index: NameIndex): MenuEntry {
  const meta = TARGETS[type]
  const items = meta.ref ? refItems(index, meta.ref) : []
  const label = targetLabel(type)
  return {
    label,
    icon: meta.icon,
    disabled: items.length === 0,
    description: items.length === 0 ? t('midi.learnMenu.nothingToMap') : undefined,
    submenu: items.map((it) => ({ label: it.name, onSelect: () => learn(type, `${label} · ${it.name}`, it.id) }))
  }
}

export function learnMenuItems(index: NameIndex): MenuEntry[] {
  return [
    { type: 'label', label: t('midi.learnMenu.masters') },
    simple('master'), simple('blackout'), simple('blinder'), simple('strobe'), simple('tap_tempo'), simple('reset'),
    { type: 'label', label: t('midi.learnMenu.playback') },
    withItems('cuelist_go', index), withItems('cuelist_fader', index), withItems('flash', index),
    withItems('chase_toggle', index), withItems('chase_bpm', index), withItems('effect_toggle', index),
    { type: 'label', label: t('common.timeline') },
    simple('timeline_play'), simple('timeline_stop'), simple('timeline_rewind'),
    withItems('timeline_goto_marker', index), withItems('timeline_goto_zone', index),
    { type: 'separator' },
    { label: t('midi.learnMenu.fixtureChannel'), icon: TARGETS.channel.icon, disabled: true, description: t('midi.learnMenu.fixtureChannelHint') }
  ]
}

export function LearnButton({ size = 'md', label }: { size?: ButtonProps['size']; label?: React.ReactNode }) {
  const t = useT()
  const isLearning = useMidiStore((s) => s.isLearning)
  const index = useNameIndex()
  if (isLearning) {
    return (
      <Button data-midi-learn size={size} tone="midi" active icon={LuX} onClick={() => useMidiStore.getState().cancelLearn()}>
        {t('midi.learn.cancel')}
      </Button>
    )
  }
  return (
    <DropdownMenu
      placement="bottom-end"
      items={() => learnMenuItems(index)}
      trigger={(p) => (
        <Button {...p} data-midi-learn size={size} variant="secondary" tone="midi" icon={LuPiano} iconRight={LuChevronDown} className="text-midi-fg">
          {label ?? t('midi.learn.button')}
        </Button>
      )}
    />
  )
}
