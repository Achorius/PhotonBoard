// Preset tile menus and the "Store here" flow — shared by the Pools view
// and the programmer's preset rows.

import { LuHash, LuPalette, LuPencil, LuPlay, LuRefreshCw, LuSave, LuTrash2 } from 'react-icons/lu'
import type { Preset, PresetScope, PresetType } from '@shared/types'
import { ask, type MenuEntry } from '@renderer/components/ui'
import { t } from '@renderer/i18n'
import { findPreset } from '@renderer/stores/pool-store'
import {
  applyPresetToSelection, deletePreset, presetLabel, recolourPreset, renamePreset, renumberPreset, storePresetAt, updatePresetFromProgrammer
} from './pool-actions'
import { askLabel, askNumber, pickColour } from './PoolDialogs'
import { presetRef, presetSize } from './pool-model'

const SCOPES: PresetScope[] = ['selective', 'global', 'universal']

/**
 * Store the programmer into preset `type`.`number`; a slot that already
 * holds values asks Merge / Overwrite first.
 */
export async function storePresetHere(type: PresetType, number: number, scope?: PresetScope): Promise<string | null> {
  const existing = findPreset(type, number)
  let mode: 'merge' | 'overwrite' = 'merge'
  if (existing && presetSize(existing) > 0) {
    const choice = await ask<'cancel' | 'overwrite' | 'merge'>({
      title: t('pro.pools.ask.storeTitle', { ref: presetRef(existing) }),
      message: t('pro.pools.ask.storeMessage'),
      actions: [
        { id: 'cancel', label: t('common.cancel'), variant: 'ghost' },
        { id: 'overwrite', label: t('pro.pools.menu.overwrite') },
        { id: 'merge', label: t('pro.pools.menu.merge'), variant: 'primary' }
      ]
    })
    if (!choice || choice === 'cancel') return null
    mode = choice
  }
  return storePresetAt(type, number, { scope, mode })
}

function storeSubmenu(type: PresetType, number: number, current?: PresetScope): MenuEntry[] {
  return SCOPES.map((scope) => ({
    label: t(`pro.pools.scope.${scope}`),
    description: t(`pro.pools.scope.${scope}Hint`),
    checked: current ? (current === scope) : undefined,
    onSelect: () => { void storePresetHere(type, number, scope) }
  }))
}

/** Menu of a preset slot (empty when `preset` is null) */
export function presetMenu(type: PresetType, number: number, preset: Preset | null): MenuEntry[] {
  const store: MenuEntry = { label: t('pro.pools.menu.store'), icon: LuSave, description: t('pro.pools.menu.storeHint'), submenu: storeSubmenu(type, number, preset?.scope ?? (preset ? 'selective' : undefined)) }
  if (!preset) return [store]
  const what = presetLabel(preset)
  return [
    { label: t('pro.pools.menu.apply'), icon: LuPlay, onSelect: () => { applyPresetToSelection(preset.id) } },
    { type: 'separator' },
    store,
    { label: t('pro.pools.menu.update'), icon: LuRefreshCw, description: t('pro.pools.menu.updateHint'), onSelect: () => { updatePresetFromProgrammer(preset.id) } },
    { type: 'separator' },
    { label: t('pro.pools.menu.label'), icon: LuPencil, onSelect: () => { void askLabel(what, preset.name).then((n) => { if (n !== null) renamePreset(preset.id, n) }) } },
    { label: t('pro.pools.menu.colour'), icon: LuPalette, onSelect: () => { void pickColour(t('pro.pools.dialog.colourTitle', { what }), preset.color).then((c) => { if (c !== undefined) recolourPreset(preset.id, c ?? undefined) }) } },
    { label: t('pro.pools.menu.renumber'), icon: LuHash, onSelect: () => { void askNumber(what, preset.number).then((n) => { if (n !== null) renumberPreset(preset.id, n) }) } },
    { type: 'separator' },
    { label: t('pro.pools.menu.delete'), icon: LuTrash2, danger: true, onSelect: () => { void deletePreset(preset.id) } }
  ]
}

