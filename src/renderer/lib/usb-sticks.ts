// ============================================================
// PhotonBoard — USB sticks in the console UI
//
// The drives come from main (removable-drives.ts, watched every 2 s).
// A stick with shows plugged in → toast "USB stick detected — N shows"
// with an Open action (the USB modal). Opening a show from a stick
// COPIES it into the shows folder first, so the stick can be pulled out
// and Save keeps writing to the console. "Save a copy" writes the
// current show to the stick without changing the current file; Eject
// flushes and unmounts.
// ============================================================

import { create } from 'zustand'
import type { RemovableDrive } from '@shared/photonboard-api'
import { getBridge, isRemoteMode } from './runtime'
import { adoptShowLoadResult, collectShowData, hasUnsavedChanges } from './show-io'
import { showToast } from '@renderer/stores/toast-store'
import { t } from '@renderer/i18n'

interface UsbState {
  drives: RemovableDrive[]
  /** The USB modal is open */
  modalOpen: boolean
}

export const useUsbStore = create<UsbState>(() => ({ drives: [], modalOpen: false }))

export function openUsbModal(): void {
  useUsbStore.setState({ modalOpen: true })
  void refreshUsbDrives()
}

export function closeUsbModal(): void {
  useUsbStore.setState({ modalOpen: false })
}

/** Drives that were not there before (just plugged in) */
export function newDrives(prev: readonly RemovableDrive[], next: readonly RemovableDrive[]): RemovableDrive[] {
  const known = new Set(prev.map((d) => d.path))
  return next.filter((d) => !known.has(d.path))
}

function announce(drives: RemovableDrive[]): void {
  for (const d of drives) {
    const count = d.shows.length
    showToast('info', t('file.usb.detected', { name: d.name }), {
      id: `usb:${d.path}`,
      description: count > 0 ? t('file.usb.detectedShows', { count }) : t('file.usb.detectedNoShow'),
      duration: 8000,
      action: count > 0
        ? { label: t('file.usb.open'), onClick: openUsbModal }
        : { label: t('file.usb.saveCopy'), onClick: () => { void saveCopyToUsb(d.path) } }
    })
  }
}

let installed = false

/** Console: follow the sticks (initial list, then main's change events). Returns the unsubscribe. */
export function installUsbWatch(): () => void {
  const api = getBridge()?.removable
  if (!api || installed) return () => {}
  installed = true
  let first = true
  const apply = (drives: RemovableDrive[]) => {
    const prev = useUsbStore.getState().drives
    useUsbStore.setState({ drives })
    // The sticks already there at start-up are not "inserted"
    if (!first) announce(newDrives(prev, drives))
  }
  const off = api.onChange((drives) => { apply(drives); first = false })
  api.list().then((drives) => { apply(drives); first = false }).catch(() => { first = false })
  return () => { off(); installed = false }
}

export async function refreshUsbDrives(): Promise<RemovableDrive[]> {
  const api = getBridge()?.removable
  if (!api) return []
  try {
    const drives = await api.list(true)
    useUsbStore.setState({ drives })
    return drives
  } catch {
    return useUsbStore.getState().drives
  }
}

type Confirm = (opts: { title: string; message: string; confirmLabel: string; tone?: 'danger' }) => Promise<boolean>
type ResolveUnsaved = (message: string) => Promise<boolean>

/**
 * Open a show from a stick: unsaved changes asked first, a show of the same
 * name in the shows folder asked before it is replaced.
 */
export async function openShowFromUsb(path: string, deps: { resolveUnsaved: ResolveUnsaved; confirm: Confirm }): Promise<boolean> {
  const api = getBridge()?.removable
  if (!api) return false
  const name = path.split(/[\\/]/).pop()?.replace(/\.pbshow$/i, '') ?? ''
  if (hasUnsavedChanges() && !(await deps.resolveUnsaved(t('file.unsaved.openNamed', { name })))) return false
  let result = await api.importShow(path)
  if (!result.success && result.exists) {
    const ok = await deps.confirm({ title: t('file.usb.replaceTitle', { name }), message: t('file.usb.replaceMessage'), confirmLabel: t('file.replace.action'), tone: 'danger' })
    if (!ok) return false
    result = await api.importShow(path, { overwrite: true })
  }
  const done = await adoptShowLoadResult(result, 'open')
  if (done.status === 'ok') closeUsbModal()
  return done.status === 'ok'
}

/** The OS open dialog, starting on the stick */
export async function browseUsb(drivePath: string | undefined, deps: { resolveUnsaved: ResolveUnsaved; confirm: Confirm }): Promise<boolean> {
  const api = getBridge()?.removable
  if (!api) return false
  if (hasUnsavedChanges() && !(await deps.resolveUnsaved(t('file.unsaved.openShow')))) return false
  let result = await api.browse(drivePath)
  if (!result.success && result.exists && result.path) {
    const name = result.path.split(/[\\/]/).pop()?.replace(/\.pbshow$/i, '') ?? ''
    const ok = await deps.confirm({ title: t('file.usb.replaceTitle', { name }), message: t('file.usb.replaceMessage'), confirmLabel: t('file.replace.action'), tone: 'danger' })
    if (!ok) return false
    result = await api.importShow(result.path, { overwrite: true })
  }
  const done = await adoptShowLoadResult(result, 'open')
  if (done.status === 'ok') closeUsbModal()
  return done.status === 'ok'
}

/** Write a copy of the current show to a stick (first stick when none given) */
export async function saveCopyToUsb(drivePath?: string, confirm?: Confirm): Promise<boolean> {
  const api = getBridge()?.removable
  if (!api || isRemoteMode()) return false
  const drives = useUsbStore.getState().drives.length ? useUsbStore.getState().drives : await refreshUsbDrives()
  const drive = drives.find((d) => d.path === drivePath) ?? drives[0]
  if (!drive) {
    showToast('warning', t('file.usb.none'))
    return false
  }
  const show = collectShowData()
  let result = await api.saveCopy(drive.path, show)
  if (!result.success && result.exists) {
    const ok = confirm
      ? await confirm({ title: t('file.usb.replaceCopyTitle', { name: show.name }), message: t('file.usb.replaceCopyMessage', { drive: drive.name }), confirmLabel: t('file.replace.action'), tone: 'danger' })
      : true
    if (!ok) return false
    result = await api.saveCopy(drive.path, show, { overwrite: true })
  }
  if (result.success) {
    showToast('success', t('file.usb.copied', { name: show.name, drive: drive.name }), {
      action: { label: t('file.usb.eject'), onClick: () => { void ejectUsb(drive.path) } }
    })
    void refreshUsbDrives()
    return true
  }
  showToast('error', t('file.usb.copyFailed', { error: result.error ?? '' }))
  return false
}

/** Flush and unmount a stick */
export async function ejectUsb(drivePath?: string): Promise<boolean> {
  const api = getBridge()?.removable
  if (!api) return false
  const drives = useUsbStore.getState().drives
  const drive = drives.find((d) => d.path === drivePath) ?? drives[0]
  if (!drive) {
    showToast('warning', t('file.usb.none'))
    return false
  }
  showToast('info', t('file.usb.ejecting', { name: drive.name }), { id: `usb-eject:${drive.path}`, duration: 0 })
  const result = await api.eject(drive.path).catch((e) => ({ success: false, error: String(e) }))
  if (result.success) {
    showToast('success', t('file.usb.ejected', { name: drive.name }), { id: `usb-eject:${drive.path}` })
    useUsbStore.setState((s) => ({ drives: s.drives.filter((d) => d.path !== drive.path) }))
    return true
  }
  showToast('error', t('file.usb.ejectFailed', { name: drive.name, error: result.error ?? '' }), { id: `usb-eject:${drive.path}` })
  return false
}
