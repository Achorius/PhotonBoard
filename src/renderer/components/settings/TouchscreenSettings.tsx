// ============================================================
// Settings › Display › Touchscreens (Linux console only).
// The whole touch setup, doable with touch alone (a mouse may not be
// there): what is detected (panels for screens), a to-scale diagram of
// the screens with the panel each one drives, the assignment assistant
// (an overlay on every screen: "touch THIS screen"), per panel the screen,
// orientation, invert and calibration, a touch test, and the diagnostic
// report (photo / USB stick). Changes apply at once (main: touch-wizards).
// Every control is 52 px: this section is what an operator whose
// touchscreen is mis-mapped has to reach.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import {
  LuCopy, LuCrosshair, LuHand, LuPointer, LuRefreshCw, LuRotateCcw, LuStethoscope, LuTriangleAlert, LuUndo2, LuUsb, LuWandSparkles, LuCheck, LuInfo
} from 'react-icons/lu'
import type {
  RemovableDrive, TouchIdentifyResult, TouchPanel, TouchPanelSettings, TouchReport, TouchRotation, TouchSetupInfo, TouchSetupResult
} from '@shared/photonboard-api'
import { Badge, Button, Modal, SegmentedControl, Spinner, ToggleButton, cn, confirm, toast } from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { useUsbStore } from '@renderer/lib/usb-sticks'
import { Notice, SettingsCard } from './settings-ui'
import { diagramRects, isWarningLine, panelSettings, screenNumber, touchReportFileName } from './touch-report'

/** Comfortable finger targets in compact density too (52 px like touch control-lg) */
const TOUCH_BUTTON = 'h-[52px] min-w-[52px] px-5'
/** SegmentedControl at 52 px (48 px items + its 2 px padding) */
const TOUCH_SEGMENTS = '[&_button]:h-12 [&_button]:min-w-[52px] [&_button]:px-4'

/** Shown on the Linux console only (never on the web remote) */
export function touchDiagnosticsAvailable(): boolean {
  const app = getBridge()?.app
  return !isRemoteMode() && app?.platform === 'linux' && (typeof app.touchReport === 'function' || !!getBridge()?.touchSetup)
}

type Busy = 'identify' | 'test' | 'save' | 'reset' | `calibrate:${string}` | null

const ROTATIONS: TouchRotation[] = [0, 90, 180, 270]

export function TouchscreensCard() {
  const t = useT()
  const setup = getBridge()?.touchSetup
  const [info, setInfo] = useState<TouchSetupInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [summary, setSummary] = useState<TouchIdentifyResult | null>(null)

  const refresh = useCallback(async () => {
    if (!setup) return
    setLoading(true)
    try { setInfo(await setup.list()) } catch { /* the section stays as it was */ } finally { setLoading(false) }
  }, [setup])

  useEffect(() => { void refresh() }, [refresh])

  /** Run one setup call; the fresh setup it returns replaces the shown one */
  const act = async <R extends object>(kind: Busy, call: () => Promise<R>): Promise<R | null> => {
    if (busy) return null
    setBusy(kind)
    try {
      const r = await call()
      if ("info" in r && r.info) setInfo(r.info as TouchSetupInfo)
      return r
    } catch (e) {
      toast.error(translate('settings.display.touch.applyFailed', { error: e instanceof Error ? e.message : String(e) }))
      return null
    } finally {
      setBusy(null)
    }
  }

  const applied = (r: TouchSetupResult | null, done: string) => {
    if (!r) return
    if (r.ok) toast.success(done)
    else toast.error(translate('settings.display.touch.applyFailed', { error: r.error ?? translate('errors.unknown') }))
  }

  const savePanel = async (panel: TouchPanel, change: Partial<TouchPanelSettings>) => {
    if (!setup) return
    const r = await act('save', () => setup.save({ panels: { [panel.key]: { ...panelSettings(panel), ...change } } }))
    applied(r, translate('settings.display.touch.applied'))
  }

  const identify = async () => {
    if (!setup) return
    setSummary(null)
    const r = await act('identify', () => setup.identify())
    if (!r) return
    if (r.ok) setSummary(r)
    else if (r.canceled) toast.info(translate('settings.display.touch.canceled'))
    else if (r.reason === 'no-access') toast.error(translate('settings.display.touch.noAccess', { error: r.error ?? '' }))
    else if (r.reason === 'busy') toast.error(translate('settings.display.touch.busy'))
    else if (r.reason !== 'no-panels') toast.error(translate('settings.display.touch.applyFailed', { error: r.error ?? r.reason ?? translate('errors.unknown') }))
  }

  const calibrate = async (panel: TouchPanel) => {
    if (!setup) return
    const r = await act(`calibrate:${panel.key}`, () => setup.calibrate(panel.port))
    if (!r) return
    if (r.ok) toast.success(translate('settings.display.touch.calibrateSaved', { px: r.errorPx ?? 0 }))
    else if (r.canceled) toast.info(translate('settings.display.touch.calibrateCanceled'))
    else if (r.reason === 'no-output') toast.error(translate('settings.display.touch.calibrateNoOutput'))
    else if (r.reason === 'busy') toast.error(translate('settings.display.touch.busy'))
    else toast.error(translate('settings.display.touch.applyFailed', { error: r.error ?? r.reason ?? translate('errors.unknown') }))
  }

  const test = async () => {
    if (!setup) return
    const r = await act('test', () => setup.test())
    if (!r) return
    if (!r.ok) { toast.error(translate(r.reason === 'busy' ? 'settings.display.touch.busy' : 'settings.display.touch.applyFailed', { error: r.error ?? r.reason ?? '' })); return }
    const outputs = info?.outputs ?? []
    const parts = Object.entries(r.touches).map(([name, count]) => translate('settings.display.touch.testScreen', { screen: translate('settings.display.touch.screen', { n: screenNumber(outputs, name) }), name, count }))
    toast.info(translate('settings.display.touch.testDone', { summary: parts.join(' · ') }))
  }

  const resetPanel = async (panel: TouchPanel) => {
    if (!setup) return
    applied(await act('reset', () => setup.reset(panel.key)), translate('settings.display.touch.resetDone'))
  }

  const resetAll = async () => {
    if (!setup) return
    const ok = await confirm({ title: translate('settings.display.touch.resetAllConfirm'), message: translate('settings.display.touch.resetAllMessage'), confirmLabel: translate('settings.display.touch.resetAll') })
    if (ok) applied(await act('reset', () => setup.reset()), translate('settings.display.touch.resetDone'))
  }

  const supported = !!info?.supported
  const panels = info?.panels ?? []
  const outputs = info?.outputs ?? []
  const wizard = busy === 'identify' || busy === 'test' || (busy?.startsWith('calibrate:') ?? false)

  return (
    <SettingsCard
      icon={LuPointer}
      title={t('settings.display.touch.title')}
      actions={setup && (
        <Button size="lg" variant="ghost" icon={LuRefreshCw} className={TOUCH_BUTTON} loading={loading} disabled={busy !== null} onClick={() => { void refresh() }} data-touch-refresh="">
          {t('settings.display.touch.refresh')}
        </Button>
      )}
    >
      <div className="flex flex-col gap-4 px-4 py-4" data-touch-setup="">
        <p className="text-sm text-fg-secondary">{t('settings.display.touch.description')}</p>

        {setup && !info && <div className="flex items-center gap-2 text-sm text-fg-secondary"><Spinner size={16} /></div>}

        {info && !supported && (
          <Notice tone="warning" icon={LuTriangleAlert}>
            {info.reason === 'wayland'
              ? t('settings.display.touch.unsupportedWayland')
              : info.reason === 'no-x'
                ? t('settings.display.touch.unsupportedNoX', { error: info.error ?? '' })
                : t('settings.display.touch.unsupportedError', { error: info.error ?? info.reason ?? '' })}
          </Notice>
        )}

        {info && supported && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-base font-semibold text-fg-primary" data-touch-status="">
                {t('settings.display.touch.panelCount', { count: panels.length })} {t('settings.display.touch.forScreens', { count: outputs.length })}
              </p>
              {panels.length === 0 && <Notice tone="warning" icon={LuTriangleAlert}><span data-touch-warning="">{t('settings.display.touch.noPanels')}</span></Notice>}
              {panels.length > 0 && panels.length < outputs.length && (
                <Notice tone="info" icon={LuInfo}><span data-touch-warning="">{t('settings.display.touch.fewerPanels')}</span></Notice>
              )}
            </div>

            <ScreenDiagram info={info} />

            {summary && <IdentifySummary info={info} result={summary} onClose={() => setSummary(null)} />}

            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                variant="primary"
                icon={LuWandSparkles}
                className={TOUCH_BUTTON}
                loading={busy === 'identify'}
                disabled={busy !== null || panels.length === 0}
                onClick={() => { void identify() }}
                data-touch-identify=""
              >
                {t('settings.display.touch.assistant')}
              </Button>
              <Button size="lg" icon={LuHand} className={TOUCH_BUTTON} loading={busy === 'test'} disabled={busy !== null || outputs.length === 0} onClick={() => { void test() }} data-touch-test="">
                {t('settings.display.touch.test')}
              </Button>
            </div>

            {wizard && (
              <Notice tone="info" icon={LuInfo}>
                {busy === 'identify' ? t('settings.display.touch.assistantRunning') : busy === 'test' ? t('settings.display.touch.testRunning') : t('settings.display.touch.calibrateRunning')}
              </Notice>
            )}

            {panels.map((p) => (
              <PanelRow
                key={p.key}
                panel={p}
                info={info}
                busy={busy}
                onChange={(change) => { void savePanel(p, change) }}
                onCalibrate={() => { void calibrate(p) }}
                onReset={() => { void resetPanel(p) }}
              />
            ))}
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle pt-4">
          <TouchDiagnosticButton disabled={wizard} />
          {setup && supported && info?.saved && (
            <Button size="lg" variant="ghost" icon={LuUndo2} className={TOUCH_BUTTON} disabled={busy !== null} loading={busy === 'reset'} onClick={() => { void resetAll() }} data-touch-reset-all="">
              {t('settings.display.touch.resetAll')}
            </Button>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}

/** The screens to scale, as xrandr lays them out, each with its touch panel(s) */
function ScreenDiagram({ info }: { info: TouchSetupInfo }) {
  const t = useT()
  const rects = diagramRects(info.outputs, info.desktop)
  if (!rects.length) return null
  const ratio = info.desktop.width / Math.max(1, info.desktop.height)
  return (
    <div className="flex justify-center rounded-lg bg-surface-0 p-4 ring-1 ring-inset ring-line" role="img" aria-label={t('settings.display.touch.diagramAria')}>
      <div className="relative w-full" style={{ aspectRatio: String(ratio), maxWidth: `${Math.round(200 * ratio)}px` }} data-touch-diagram="">
        {rects.map((r, i) => {
          const assigned = info.panels.filter((p) => p.output === r.name)
          return (
            <div
              key={r.name}
              className={cn(
                'absolute flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md p-2 text-center ring-2 ring-inset',
                assigned.length ? 'bg-accent/10 ring-accent/70' : 'bg-surface-2 ring-line-strong'
              )}
              style={{ left: `calc(${r.left}% + 3px)`, top: `calc(${r.top}% + 3px)`, width: `calc(${r.width}% - 6px)`, height: `calc(${r.height}% - 6px)` }}
              data-touch-screen={r.name}
              data-touch-panels={assigned.length}
            >
              <span className="text-sm font-semibold text-fg-primary">{t('settings.display.touch.screenLabel', { n: i + 1, name: r.name })}</span>
              {assigned.length
                ? assigned.map((p) => (
                    <Badge key={p.key} tone="accent" icon={LuPointer}>
                      <span data-touch-chip="">{p.name}{p.automatic ? ` · ${t('settings.display.touch.automatic')}` : ''}</span>
                    </Badge>
                  ))
                : <span className="text-xs text-fg-tertiary" data-touch-chip="none">{t('settings.display.touch.noTouch')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IdentifySummary({ info, result, onClose }: { info: TouchSetupInfo; result: TouchIdentifyResult; onClose: () => void }) {
  const t = useT()
  const name = (key: string) => (result.info ?? info).panels.find((p) => p.key === key)?.name ?? key
  return (
    <Notice tone="info" icon={LuCheck}>
      <div className="flex flex-col gap-1.5" data-touch-summary="">
        <span className="text-sm font-semibold text-fg-primary">{t('settings.display.touch.summaryTitle')}</span>
        <ul className="flex flex-col gap-0.5 text-sm">
          {result.assignments.map((a) => (
            <li key={a.output}>
              {t('settings.display.touch.screenLabel', { n: screenNumber(info.outputs, a.output), name: a.output })} → {a.panel ? name(a.panel) : t('settings.display.touch.summaryNone')}
            </li>
          ))}
        </ul>
        <span>{t('settings.display.touch.summaryHint')}</span>
        <div><Button size="lg" variant="ghost" className={TOUCH_BUTTON} onClick={onClose}>{t('common.close')}</Button></div>
      </div>
    </Notice>
  )
}

function PanelRow({ panel, info, busy, onChange, onCalibrate, onReset }: {
  panel: TouchPanel
  info: TouchSetupInfo
  busy: Busy
  onChange: (change: Partial<TouchPanelSettings>) => void
  onCalibrate: () => void
  onReset: () => void
}) {
  const t = useT()
  const s = panelSettings(panel)
  const disabled = busy !== null
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-surface-0/60 p-4 ring-1 ring-inset ring-line" data-touch-panel={panel.port}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LuPointer size={16} aria-hidden className="text-fg-tertiary" />
        <span className="text-sm font-semibold text-fg-primary">{panel.name}</span>
        <span className="text-xs text-fg-tertiary">{t('settings.display.touch.panelPort', { port: panel.port })} · <span className="font-mono">{t('settings.display.touch.panelIds', { ids: panel.ids.join(', ') })}</span></span>
        {panel.automatic && <Badge>{t('settings.display.touch.automatic')}</Badge>}
        <Badge tone={s.calibration ? 'go' : 'neutral'}>{s.calibration ? t('settings.display.touch.calibrated') : t('settings.display.touch.notCalibrated')}</Badge>
      </header>

      <Field label={t('settings.display.touch.screenRow')} hint={t('settings.display.touch.screenRowHint')}>
        <SegmentedControl<string>
          aria-label={t('settings.display.touch.screenRow')}
          size="md"
          className={TOUCH_SEGMENTS}
          value={panel.output ?? ''}
          onChange={(output) => { if (output !== panel.output || panel.automatic) onChange({ output }) }}
          items={info.outputs.map((o, i) => ({ value: o.name, label: t('settings.display.touch.screen', { n: i + 1 }), title: o.name, disabled, 'data-touch-output': o.name }))}
        />
      </Field>

      <Field label={t('settings.display.touch.orientation')} hint={t('settings.display.touch.orientationHint')}>
        <SegmentedControl<TouchRotation>
          aria-label={t('settings.display.touch.orientation')}
          size="md"
          className={TOUCH_SEGMENTS}
          value={s.rotation}
          onChange={(rotation) => onChange({ rotation })}
          items={ROTATIONS.map((r) => ({ value: r, label: t(`settings.display.touch.rotation.r${r}`), disabled, 'data-touch-rotation': r }))}
        />
        <ToggleButton size="lg" className={TOUCH_BUTTON} pressed={s.invertX} disabled={disabled} onPressedChange={(invertX) => onChange({ invertX })} data-touch-invert="x">
          {t('settings.display.touch.invertX')}
        </ToggleButton>
        <ToggleButton size="lg" className={TOUCH_BUTTON} pressed={s.invertY} disabled={disabled} onPressedChange={(invertY) => onChange({ invertY })} data-touch-invert="y">
          {t('settings.display.touch.invertY')}
        </ToggleButton>
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" icon={LuCrosshair} className={TOUCH_BUTTON} disabled={disabled || !panel.output} loading={busy === `calibrate:${panel.key}`} onClick={onCalibrate} data-touch-calibrate={panel.port}>
          {t('settings.display.touch.calibrate')}
        </Button>
        <Button size="lg" variant="ghost" icon={LuRotateCcw} className={TOUCH_BUTTON} disabled={disabled || !panel.saved} onClick={onReset} data-touch-reset={panel.port}>
          {t('settings.display.touch.resetPanel')}
        </Button>
      </div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col">
        <span className="text-sm text-fg-primary">{label}</span>
        {hint && <span className="text-xs text-fg-tertiary">{hint}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------
// Diagnostic report (helper --report): dialog, copy, save to USB stick
// ---------------------------------------------------------------

function TouchDiagnosticButton({ disabled }: { disabled: boolean }) {
  const t = useT()
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<TouchReport | null>(null)
  const [open, setOpen] = useState(false)
  const app = getBridge()?.app
  if (typeof app?.touchReport !== 'function') return null

  const run = async () => {
    if (running || !app?.touchReport) return
    setRunning(true)
    setReport(null)
    setOpen(true)
    try {
      setReport(await app.touchReport())
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      setReport({ supported: true, ok: false, text: `⚠ ${translate('settings.display.touch.failed', { error })}` })
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <Button size="lg" icon={LuStethoscope} className={TOUCH_BUTTON} loading={running} disabled={running || disabled} onClick={() => { void run() }} data-touch-run="">
        {t('settings.display.touch.run')}
      </Button>
      <TouchReportDialog open={open} busy={running} report={report} onClose={() => setOpen(false)} />
    </>
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

function TouchReportDialog({ open, busy, report, onClose }: { open: boolean; busy: boolean; report: TouchReport | null; onClose: () => void }) {
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
      dismissible={!busy}
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
          <Button size="lg" variant="primary" className={TOUCH_BUTTON} disabled={busy} onClick={onClose} data-touch-close="">
            {t('common.close')}
          </Button>
        </div>
      }
    >
      {!report ? (
        <div className="flex min-h-[200px] items-center justify-center gap-3 text-sm text-fg-secondary">
          <Spinner size={18} />
          {t('settings.display.touch.running')}
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
