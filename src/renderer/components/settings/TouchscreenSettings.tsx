// ============================================================
// Settings › Display › Touchscreens (Linux console only).
// Runs the touch helper through main (system:touch-report / -remap)
// and shows its plain-text report in a dialog the operator can
// photograph, copy, or save to a USB stick. Every control here is
// touch-sized whatever the density: this card is what an operator
// whose touchscreen does not work reaches with a mouse.
// ============================================================

import { useState } from 'react'
import { LuCopy, LuPointer, LuRefreshCw, LuStethoscope, LuUsb } from 'react-icons/lu'
import type { RemovableDrive, TouchReport } from '@shared/photonboard-api'
import { Button, Modal, Spinner, cn, toast } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { useUsbStore } from '@renderer/lib/usb-sticks'
import { SettingsCard } from './settings-ui'
import { isWarningLine, touchReportFileName } from './touch-report'

/** Comfortable finger targets in compact density too (52 px like touch control-lg) */
const TOUCH_BUTTON = 'h-[52px] min-w-[52px] px-5'

/** Shown on the Linux console only (never on the web remote) */
export function touchDiagnosticsAvailable(): boolean {
  const app = getBridge()?.app
  return !isRemoteMode() && app?.platform === 'linux' && typeof app.touchReport === 'function'
}

type Busy = 'report' | 'remap' | null

export function TouchscreensCard() {
  const t = useT()
  const [busy, setBusy] = useState<Busy>(null)
  const [report, setReport] = useState<TouchReport | null>(null)
  const [open, setOpen] = useState(false)

  const run = async (mode: 'report' | 'remap') => {
    const app = getBridge()?.app
    const call = mode === 'remap' ? app?.touchRemap : app?.touchReport
    if (!call || busy) return
    setBusy(mode)
    setReport(null)
    setOpen(true)
    try {
      const r = await call()
      setReport(r)
      if (mode === 'remap') {
        if (r.remapOk) toast.success(translate('settings.display.touch.remapDone'))
        else toast.error(translate('settings.display.touch.remapFailed'))
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      setReport({ supported: true, ok: false, text: `⚠ ${translate('settings.display.touch.failed', { error })}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsCard icon={LuPointer} title={t('settings.display.touch.title')}>
      <div className="flex flex-col gap-3 px-4 py-3" data-touch-diagnostics>
        <p className="text-sm text-fg-secondary">{t('settings.display.touch.description')}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            variant="primary"
            icon={LuStethoscope}
            className={TOUCH_BUTTON}
            loading={busy === 'report'}
            disabled={busy !== null}
            onClick={() => { void run('report') }}
            data-touch-run=""
          >
            {t('settings.display.touch.run')}
          </Button>
          <Button
            size="lg"
            icon={LuRefreshCw}
            className={TOUCH_BUTTON}
            loading={busy === 'remap'}
            disabled={busy !== null}
            onClick={() => { void run('remap') }}
            data-touch-remap=""
          >
            {t('settings.display.touch.remap')}
          </Button>
        </div>
      </div>
      <TouchReportDialog open={open} busy={busy} report={report} onClose={() => setOpen(false)} />
    </SettingsCard>
  )
}

async function copyText(text: string): Promise<void> {
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    // Electron may refuse the async clipboard: the selection fallback works
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    area.remove()
  }
  if (ok) toast.success(translate('errors.copied'))
  else toast.error(translate('errors.copyFailed'))
}

async function saveToDrive(drive: RemovableDrive, text: string): Promise<void> {
  const save = getBridge()?.removable?.saveText
  if (!save) return
  const file = touchReportFileName()
  try {
    const r = await save(drive.path, file, text)
    if (r.success) toast.success(translate('settings.display.touch.saved', { drive: drive.name, file }))
    else toast.error(translate('settings.display.touch.saveFailed', { error: r.error ?? translate('errors.unknown') }))
  } catch (e) {
    toast.error(translate('settings.display.touch.saveFailed', { error: e instanceof Error ? e.message : String(e) }))
  }
}

function TouchReportDialog({ open, busy, report, onClose }: { open: boolean; busy: Busy; report: TouchReport | null; onClose: () => void }) {
  const t = useT()
  const drives = useUsbStore((s) => s.drives)
  const [saving, setSaving] = useState<string | null>(null)
  const canSave = !!getBridge()?.removable?.saveText
  const text = report?.text ?? ''

  const save = async (drive: RemovableDrive) => {
    setSaving(drive.path)
    try { await saveToDrive(drive, text) } finally { setSaving(null) }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={busy === null}
      size="xl"
      title={t('settings.display.touch.dialogTitle')}
      description={t('settings.display.touch.dialogDescription')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-3">
          {canSave && drives.length === 0 && report && (
            <span className="mr-auto text-sm text-fg-tertiary">{t('settings.display.touch.noUsb')}</span>
          )}
          <Button size="lg" icon={LuCopy} className={TOUCH_BUTTON} disabled={!report} onClick={() => { void copyText(text) }} data-touch-copy="">
            {t('common.copy')}
          </Button>
          {canSave && drives.map((d) => (
            <Button
              key={d.path}
              size="lg"
              icon={LuUsb}
              className={TOUCH_BUTTON}
              disabled={!report || saving !== null}
              loading={saving === d.path}
              onClick={() => { void save(d) }}
              data-touch-save=""
            >
              {drives.length === 1 ? t('settings.display.touch.saveUsb') : t('settings.display.touch.saveUsbNamed', { name: d.name })}
            </Button>
          ))}
          <Button size="lg" variant="primary" className={TOUCH_BUTTON} disabled={busy !== null} onClick={onClose} data-touch-close="">
            {t('common.close')}
          </Button>
        </div>
      }
    >
      {!report ? (
        <div className="flex min-h-[200px] items-center justify-center gap-3 text-sm text-fg-secondary">
          <Spinner size={18} />
          {busy === 'remap' ? t('settings.display.touch.remapping') : t('settings.display.touch.running')}
        </div>
      ) : (
        <pre
          className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-0 p-3 font-mono text-xs leading-relaxed text-fg-primary [font-variant-ligatures:none] ring-1 ring-inset ring-line [[data-density=touch]_&]:text-sm"
          data-touch-report=""
        >
          {text.split('\n').map((line, i) => (
            <span key={i} className={cn('block min-h-[1lh]', isWarningLine(line) && 'rounded-sm bg-warning/10 font-semibold text-warning-fg')} data-warning={isWarningLine(line) || undefined}>
              {line}
            </span>
          ))}
        </pre>
      )}
    </Modal>
  )
}
