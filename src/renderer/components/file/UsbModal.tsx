// USB sticks: the shows on each stick (open = copy to the console, then
// open), browse the stick, save a copy of the current show, eject.

import { LuFile, LuFileInput, LuFolderOpen, LuSave, LuUsb } from 'react-icons/lu'
import { Button, EmptyState, Modal } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { closeUsbModal, ejectUsb, useUsbStore } from '@renderer/lib/usb-sticks'
import { requestBrowseUsb, requestImport, requestOpenFromUsb, requestSaveCopyToUsb } from '@renderer/components/layout/file-actions'
import type { RemovableDrive } from '@shared/photonboard-api'

export function UsbModal() {
  const t = useT()
  const open = useUsbStore((s) => s.modalOpen)
  const drives = useUsbStore((s) => s.drives)
  if (!open) return null
  return (
    <Modal open onClose={closeUsbModal} title={t('file.usb.title')} description={t('file.usb.openHint')} size="lg">
      <div className="flex flex-col gap-3" data-usb-modal>
        {drives.length === 0
          ? <EmptyState size="sm" icon={LuUsb} title={t('file.usb.none')} description={t('file.usb.noneHint')} />
          : drives.map((d) => <DriveCard key={d.path} drive={d} />)}
      </div>
    </Modal>
  )
}

function DriveCard({ drive }: { drive: RemovableDrive }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3" data-usb-drive={drive.name}>
      <div className="flex flex-wrap items-center gap-2">
        <LuUsb size={16} aria-hidden className="text-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary" title={drive.path}>{drive.name}</span>
        <Button size="sm" variant="secondary" icon={LuFolderOpen} onClick={() => { void requestBrowseUsb(drive.path) }}>{t('file.usb.browse')}</Button>
        <Button size="sm" variant="secondary" icon={LuFileInput} onClick={() => { closeUsbModal(); void requestImport({ startDir: drive.path }) }} data-usb-import>{t('interchange.menu.importFromStick')}</Button>
        <Button size="sm" variant="secondary" icon={LuSave} onClick={() => { void requestSaveCopyToUsb(drive.path) }}>{t('file.usb.saveCopy')}</Button>
        {drive.canEject && <Button size="sm" variant="secondary" onClick={() => { void ejectUsb(drive.path) }}>{t('file.usb.eject')}</Button>}
      </div>
      {drive.shows.length === 0
        ? <p className="text-xs text-fg-tertiary">{t('file.usb.noShows')}</p>
        : (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-md bg-surface-1">
            {drive.shows.map((s) => (
              <li key={s.path} className="flex items-center gap-2 px-2.5 py-1.5">
                <LuFile size={14} aria-hidden className="shrink-0 text-fg-tertiary" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-fg-primary">{s.name}</span>
                  <span className="truncate font-mono text-2xs text-fg-tertiary">
                    {s.relPath} · {t('file.usb.modified', { date: new Date(s.modifiedAt).toLocaleString() })}
                  </span>
                </div>
                <Button size="sm" variant="primary" data-usb-open={s.name} onClick={() => { void requestOpenFromUsb(s.path) }}>{t('file.usb.open')}</Button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
