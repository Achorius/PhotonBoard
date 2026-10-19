import { confirm } from '@renderer/components/ui'
import { useMidiStore } from '@renderer/stores/midi-store'

/** Delete a mapping after confirmation. Resolves true when deleted. */
export async function deleteMapping(id: string): Promise<boolean> {
  const m = useMidiStore.getState().mappings.find((x) => x.id === id)
  if (!m) return false
  const ok = await confirm({
    title: `Delete mapping “${m.name}”?`,
    message: 'The control on your MIDI device will no longer do anything here.',
    confirmLabel: 'Delete mapping',
    tone: 'danger'
  })
  if (ok) useMidiStore.getState().removeMapping(id)
  return ok
}
