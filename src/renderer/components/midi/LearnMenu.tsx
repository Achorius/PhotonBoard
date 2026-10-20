// "Learn" button: pick what to control, then move a control on the device.
// While learning it becomes the cancel button.

import type React from 'react'
import { LuChevronDown, LuPiano, LuX } from 'react-icons/lu'
import { Button, DropdownMenu, type ButtonProps, type MenuEntry } from '@renderer/components/ui'
import { useMidiStore } from '@renderer/stores/midi-store'
import type { MidiTargetType } from '@shared/types'
import { TARGETS, refItems, useNameIndex, type NameIndex } from './midi-model'

function learn(type: MidiTargetType, label: string, id?: string): void {
  useMidiStore.getState().startLearn({ type, id, label })
}

function simple(type: MidiTargetType): MenuEntry {
  const meta = TARGETS[type]
  return { label: meta.label, icon: meta.icon, description: meta.description, onSelect: () => learn(type, meta.label) }
}

function withItems(type: MidiTargetType, index: NameIndex): MenuEntry {
  const meta = TARGETS[type]
  const items = meta.ref ? refItems(index, meta.ref) : []
  return {
    label: meta.label,
    icon: meta.icon,
    disabled: items.length === 0,
    description: items.length === 0 ? 'Nothing to map yet' : undefined,
    submenu: items.map((it) => ({ label: it.name, onSelect: () => learn(type, `${meta.label} · ${it.name}`, it.id) }))
  }
}

export function learnMenuItems(index: NameIndex): MenuEntry[] {
  return [
    { type: 'label', label: 'Masters' },
    simple('master'), simple('blackout'), simple('blinder'), simple('strobe'), simple('tap_tempo'), simple('reset'),
    { type: 'label', label: 'Scenes & chases' },
    withItems('cuelist_go', index), withItems('cuelist_fader', index), withItems('flash', index),
    withItems('chase_toggle', index), withItems('chase_bpm', index), withItems('effect_toggle', index),
    { type: 'label', label: 'Timeline' },
    simple('timeline_play'), simple('timeline_stop'), simple('timeline_rewind'),
    withItems('timeline_goto_marker', index), withItems('timeline_goto_zone', index),
    { type: 'separator' },
    { label: 'Fixture channel…', icon: TARGETS.channel.icon, disabled: true, description: 'Right-click (long-press) a fader in Fixtures' }
  ]
}

export function LearnButton({ size = 'md', label = 'Learn' }: { size?: ButtonProps['size']; label?: React.ReactNode }) {
  const isLearning = useMidiStore((s) => s.isLearning)
  const index = useNameIndex()
  if (isLearning) {
    return (
      <Button data-midi-learn size={size} tone="midi" active icon={LuX} onClick={() => useMidiStore.getState().cancelLearn()}>
        Cancel learn
      </Button>
    )
  }
  return (
    <DropdownMenu
      placement="bottom-end"
      items={() => learnMenuItems(index)}
      trigger={(p) => (
        <Button {...p} data-midi-learn size={size} variant="secondary" tone="midi" icon={LuPiano} iconRight={LuChevronDown} className="text-midi-fg">
          {label}
        </Button>
      )}
    />
  )
}
