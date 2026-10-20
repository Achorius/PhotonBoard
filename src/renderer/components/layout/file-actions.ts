// ============================================================
// File actions as the operator triggers them (File menu, keyboard,
// Electron menu): ask before discarding unsaved changes, ask for a
// name / overwrite confirmation on the remote. Results are reported
// by show-io through status toasts.
// ============================================================

import { ask, confirm, prompt } from '@renderer/components/ui'
import {
  hasUnsavedChanges,
  listShows,
  newShow,
  openShow,
  openShowByName,
  saveShow,
  uploadShowFile
} from '@renderer/lib/show-io'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { useUiStore } from '@renderer/stores/ui-store'

/**
 * Unsaved changes: Save / Don't save / Cancel.
 * Resolves true when it is fine to continue.
 */
async function resolveUnsaved(actionLabel: string): Promise<boolean> {
  if (!hasUnsavedChanges()) return true
  const name = useUiStore.getState().showName
  const choice = await ask({
    title: `Save changes to “${name}”?`,
    message: `Your changes will be lost if you ${actionLabel} without saving.`,
    actions: [
      { id: 'cancel', label: 'Cancel', variant: 'ghost' },
      { id: 'discard', label: "Don't save", variant: 'secondary' },
      { id: 'save', label: 'Save', variant: 'primary' }
    ]
  })
  if (choice === 'discard') return true
  if (choice !== 'save') return false
  return requestSave()
}

export async function requestNewShow(): Promise<void> {
  if (!(await resolveUnsaved('start a new show'))) return
  await newShow()
}

export async function requestOpenShow(): Promise<void> {
  if (!(await resolveUnsaved('open another show'))) return
  await openShow()
}

export async function requestOpenShowByName(name: string): Promise<void> {
  if (!(await resolveUnsaved(`open “${name}”`))) return
  await openShowByName(name)
}

/** Save; true when saved */
export async function requestSave(): Promise<boolean> {
  return (await saveShow()).status === 'ok'
}

/** Save As: Electron shows the OS dialog; the remote asks for a name. */
export async function requestSaveAs(): Promise<boolean> {
  if (!isRemoteMode()) return (await saveShow({ saveAs: true })).status === 'ok'
  const name = await prompt({
    title: 'Save show as',
    label: 'Show name',
    defaultValue: useUiStore.getState().showName,
    confirmLabel: 'Save',
    validate: (v) => (/[\\/:*?"<>|]/.test(v) ? 'A show name cannot contain \\ / : * ? " < > |' : null)
  })
  if (!name) return false
  const existing = await listShows()
  let overwrite = false
  if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) {
    overwrite = await confirm({
      title: `Replace “${name}”?`,
      message: 'A show with this name already exists on the console. Replacing it cannot be undone.',
      confirmLabel: 'Replace',
      tone: 'danger'
    })
    if (!overwrite) return false
  }
  return (await saveShow({ saveAs: true, name, overwrite })).status === 'ok'
}

/** Remote: send a .pbshow from this device to the console (it becomes the current show). */
export async function requestUploadShow(file: File): Promise<void> {
  if (!(await resolveUnsaved('replace the console show'))) return
  const result = await uploadShowFile(file)
  if (result.status === 'error' && result.error?.includes('already exists')) {
    const ok = await confirm({
      title: 'Replace the show on the console?',
      message: result.error,
      confirmLabel: 'Replace',
      tone: 'danger'
    })
    if (ok) await uploadShowFile(file, { overwrite: true })
  }
}

export async function requestQuit(): Promise<void> {
  if (!(await resolveUnsaved('quit'))) return
  getBridge()?.app.quit()
}
