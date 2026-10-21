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
  openDemoShow,
  openShow,
  openShowByName,
  saveShow,
  uploadShowFile
} from '@renderer/lib/show-io'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { browseUsb, openShowFromUsb, saveCopyToUsb } from '@renderer/lib/usb-sticks'
import { useUiStore } from '@renderer/stores/ui-store'
import { t } from '@renderer/i18n'
// Circular on purpose (the import flow asks to save through resolveUnsaved): only called at run time
import { requestExport as startExport, requestImport as startImport } from '@renderer/components/interchange/interchange-actions'

/**
 * Unsaved changes: Save / Don't save / Cancel. `message` says what is about
 * to happen (translated by the caller). Resolves true when it is fine to continue.
 */
export async function resolveUnsaved(message: string): Promise<boolean> {
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

/** File › Open a demo… → a demo show (lib/demos), after the unsaved-changes question */
export async function requestOpenDemo(id: string, name: string): Promise<boolean> {
  if (!(await resolveUnsaved(t('file.unsaved.openDemo', { name })))) return false
  return (await openDemoShow(id, name)).status === 'ok'
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
  // A show with that name exists on the console: ask, then overwrite
  if (result.status === 'error' && result.exists) {
    const ok = await confirm({
      title: t('file.replace.consoleTitle'),
      message: t('file.replace.message'),
      confirmLabel: t('file.replace.action'),
      tone: 'danger'
    })
    if (ok) await uploadShowFile(file, { overwrite: true })
  }
}

// ---- Import / export of other software's files (components/interchange) ----

/** File › Import…: any supported file (wizard: preview, options, merge or new show) */
export function requestImport(opts: { startDir?: string } = {}): Promise<void> {
  return startImport(opts)
}

/** File › Export…: the show to an open format */
export function requestExport(): void {
  startExport()
}

export async function requestQuit(): Promise<void> {
  if (!(await resolveUnsaved(t('file.unsaved.quit')))) return
  getBridge()?.app.quit()
}

// ---- USB sticks (lib/usb-sticks) ----

const usbDeps = { resolveUnsaved, confirm }

export function requestOpenFromUsb(path: string): Promise<boolean> {
  return openShowFromUsb(path, usbDeps)
}

export function requestBrowseUsb(drivePath?: string): Promise<boolean> {
  return browseUsb(drivePath, usbDeps)
}

export function requestSaveCopyToUsb(drivePath?: string): Promise<boolean> {
  return saveCopyToUsb(drivePath, confirm)
}
