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
import { t } from '@renderer/i18n'

/**
 * Unsaved changes: Save / Don't save / Cancel. `message` says what is about
 * to happen (translated by the caller). Resolves true when it is fine to continue.
 */
async function resolveUnsaved(message: string): Promise<boolean> {
  if (!hasUnsavedChanges()) return true
  const name = useUiStore.getState().showName
  const choice = await ask({
    title: t('file.unsaved.title', { name }),
    message,
    actions: [
      { id: 'cancel', label: t('common.cancel'), variant: 'ghost' },
      { id: 'discard', label: t('file.unsaved.dontSave'), variant: 'secondary' },
      { id: 'save', label: t('file.unsaved.save'), variant: 'primary' }
    ]
  })
  if (choice === 'discard') return true
  if (choice !== 'save') return false
  return requestSave()
}

export async function requestNewShow(): Promise<void> {
  if (!(await resolveUnsaved(t('file.unsaved.newShow')))) return
  await newShow()
}

export async function requestOpenShow(): Promise<void> {
  if (!(await resolveUnsaved(t('file.unsaved.openShow')))) return
  await openShow()
}

export async function requestOpenShowByName(name: string): Promise<void> {
  if (!(await resolveUnsaved(t('file.unsaved.openNamed', { name })))) return
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
    title: t('file.saveAsDialog.title'),
    label: t('file.saveAsDialog.label'),
    defaultValue: useUiStore.getState().showName,
    confirmLabel: t('common.save'),
    validate: (v) => (/[\\/:*?"<>|]/.test(v) ? t('file.saveAsDialog.invalidName') : null)
  })
  if (!name) return false
  const existing = await listShows()
  let overwrite = false
  if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) {
    overwrite = await confirm({
      title: t('file.replace.title', { name }),
      message: t('file.replace.message'),
      confirmLabel: t('file.replace.action'),
      tone: 'danger'
    })
    if (!overwrite) return false
  }
  return (await saveShow({ saveAs: true, name, overwrite })).status === 'ok'
}

/** Remote: send a .pbshow from this device to the console (it becomes the current show). */
export async function requestUploadShow(file: File): Promise<void> {
  if (!(await resolveUnsaved(t('file.unsaved.replaceConsole')))) return
  const result = await uploadShowFile(file)
  // main answers in English: "A show named … already exists"
  if (result.status === 'error' && result.error?.includes('already exists')) {
    const ok = await confirm({
      title: t('file.replace.consoleTitle'),
      message: t('file.replace.message'),
      confirmLabel: t('file.replace.action'),
      tone: 'danger'
    })
    if (ok) await uploadShowFile(file, { overwrite: true })
  }
}

export async function requestQuit(): Promise<void> {
  if (!(await resolveUnsaved(t('file.unsaved.quit')))) return
  getBridge()?.app.quit()
}
