import { t } from '@renderer/i18n'
import { formatShortcut } from '@renderer/components/ui/Kbd'
import { deleteWithUndo, type ConfirmDeleteOptions } from '@renderer/lib/selection-actions'
import { useMidiStore } from '@renderer/stores/midi-store'
import type { MidiMapping } from '@shared/types'

/** Noun phrase for the confirm dialog / Undo toast (en 'mapping “Fader 1”', fr 'le mapping « Fader 1 »') */
export function mappingLabel(m: Pick<MidiMapping, 'name'>): string {
  return t('midi.selection.mapping', { name: m.name })
}

/** Confirm dialog of a mapping deletion (trash buttons and the Delete key alike) */
export function deleteConfirmOptions(): ConfirmDeleteOptions {
  return { message: t('midi.delete.message', { keys: formatShortcut('Mod+Z') }), confirmLabel: t('midi.delete.confirm') }
}

/** Delete a mapping: confirm, one undo step, Undo toast. Resolves true when deleted. */
export async function deleteMapping(id: string): Promise<boolean> {
  const m = useMidiStore.getState().mappings.find((x) => x.id === id)
  if (!m) return false
  return deleteWithUndo({
    label: mappingLabel(m),
    run: () => useMidiStore.getState().removeMapping(id),
    confirm: deleteConfirmOptions()
  })
}

/**
 * Copy a mapping onto the next free source number (same device, type and
 * channel) so the copy never fires together with the original — ready to
 * point at another target or to re-learn. Returns the new mapping's id.
 */
export function duplicateMapping(id: string): string | null {
  const { mappings, addMapping } = useMidiStore.getState()
  const m = mappings.find((x) => x.id === id)
  if (!m) return null
  const taken = new Set(
    mappings
      .filter((o) => o.source.type === m.source.type && o.source.channel === m.source.channel && (o.source.deviceName ?? '') === (m.source.deviceName ?? ''))
      .map((o) => o.source.number)
  )
  let number = m.source.number
  for (let i = 1; i <= 128; i++) {
    const n = (m.source.number + i) % 128
    if (!taken.has(n)) { number = n; break }
  }
  // (the store gives the copy a new id)
  addMapping({
    ...m,
    name: t('midi.selection.copyName', { name: m.name }),
    source: { ...m.source, number },
    target: { ...m.target },
    options: { ...m.options }
  })
  const after = useMidiStore.getState().mappings
  return after[after.length - 1]?.id ?? null
}
