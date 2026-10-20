// ============================================================
// Settings → Remote access: web-remote URLs + QR code, access PIN,
// Companion / WebSocket API info. PIN settings are machine config
// (Electron only); the server status is polled every 2 s.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LuCopy, LuDices, LuEye, LuEyeOff, LuKeyRound, LuPlug, LuQrCode, LuShieldCheck, LuSmartphone, LuWifiOff
} from 'react-icons/lu'
import type { RemoteServerStatus, RemoteSettings, RemoteStatus } from '@shared/photonboard-api'
import {
  Badge, Button, EmptyState, IconButton, Spinner, StatusDot, Switch, TextInput, cn, toast
} from '@renderer/components/ui'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { QrCode } from './QrCode'
import { Notice, SettingRow, SettingsCard, SettingsPage } from './settings-ui'
import { t as translate, useT } from '@renderer/i18n'

const STATUS_POLL_MS = 2000
const PIN_RE = /^[A-Za-z0-9]{4,16}$/

function useRemoteStatus(): { status: RemoteStatus | null; error: string | null } {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let last = ''
    const poll = async () => {
      try {
        const next = await getBridge()?.remote.getStatus()
        if (!alive || !next) return
        const json = JSON.stringify(next)
        if (json !== last) { last = json; setStatus(next) }
        setError(null)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : translate('settings.remoteAccess.statusUnavailable'))
      }
    }
    void poll()
    const t = setInterval(() => { void poll() }, STATUS_POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return { status, error }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(translate('errors.copied'), { description: text })
  } catch {
    toast.error(translate('errors.copyFailed'), { description: text })
  }
}

function randomPin(): string {
  const digits = new Uint32Array(6)
  crypto.getRandomValues(digits)
  return Array.from(digits, (d) => String(d % 10)).join('')
}

function ServerState({ server, label }: { server: RemoteServerStatus | undefined; label: string }) {
  const t = useT()
  if (!server) return <span className="flex items-center gap-1.5 text-xs text-fg-tertiary"><Spinner size={12} /> {t('settings.remoteAccess.checking')}</span>
  if (!server.listening) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger-fg">
        <StatusDot tone="danger" label={t('settings.remoteAccess.serverNotRunning', { label })} />
        {server.error ? t('settings.remoteAccess.notRunningError', { error: server.error }) : t('settings.remoteAccess.notRunning')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
      <StatusDot tone="go" label={t('settings.remoteAccess.serverRunning', { label })} />
      {t.rich('settings.remoteAccess.port', { port: <span className="font-mono tabular">{server.port}</span> })}
      <span className="text-fg-tertiary">·</span>
      {t.rich('settings.remoteAccess.clients', { count: <span className="tabular">{server.clients}</span> }, server.clients)}
    </span>
  )
}

export function RemoteAccessSettings() {
  const t = useT()
  const { status, error } = useRemoteStatus()
  const remote = isRemoteMode()
  const [settings, setSettings] = useState<RemoteSettings | null>(null)
  const [selected, setSelected] = useState(0)
  const [includePin, setIncludePin] = useState(false)

  useEffect(() => {
    if (remote) return
    getBridge()?.remote.getSettings().then(setSettings).catch(() => setSettings({ pinEnabled: false, pin: '' }))
  }, [remote])

  const addresses = status?.addresses ?? []
  const webPort = status?.web.port ?? 9091
  const apiPort = status?.api.port ?? 9090
  const urls = useMemo(() => addresses.map((a) => `http://${a}:${webPort}`), [addresses, webPort])
  const current = urls[Math.min(selected, urls.length - 1)]
  const pinActive = !!settings?.pinEnabled && !!settings.pin
  const qrValue = current ? (includePin && pinActive ? `${current}/?pin=${encodeURIComponent(settings!.pin)}` : current) : ''

  return (
    <SettingsPage
      title={t('settings.remoteAccess.title')}
      description={t('settings.remoteAccess.description')}
    >
      {error && !status && <Notice tone="danger">{t('settings.remoteAccess.statusError', { error })}</Notice>}

      <SettingsCard
        icon={LuSmartphone}
        title={t('settings.remoteAccess.webRemote')}
        status={<ServerState server={status?.web} label={t('settings.remoteAccess.webRemote')} />}
        subtitle={t('settings.remoteAccess.webRemoteSubtitle')}
      >
        {!status ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-fg-tertiary"><Spinner size={16} /> {t('settings.remoteAccess.lookingForAddresses')}</div>
        ) : urls.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuWifiOff}
            title={t('settings.remoteAccess.noNetwork')}
            description={t('settings.remoteAccess.noNetworkDescription')}
          />
        ) : (
          <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center gap-2">
              <QrCode value={qrValue} size={184} label={t('settings.remoteAccess.qrLabel', { url: current })} />
              <span className="flex items-center gap-1.5 text-xs text-fg-tertiary"><LuQrCode size={12} aria-hidden /> {t('settings.remoteAccess.scan')}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('settings.remoteAccess.addressAria')}>
                <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
                  {urls.length > 1 ? t('settings.remoteAccess.addresses') : t('settings.remoteAccess.address')}
                </span>
                {urls.map((url, i) => {
                  const active = url === current
                  return (
                    <div
                      key={url}
                      className={cn(
                        'flex min-h-control items-center gap-2 rounded-md border pl-3 pr-1 transition-colors duration-fast',
                        active ? 'border-info-fg/60 bg-info/10' : 'border-line bg-surface-2'
                      )}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelected(i)}
                        className="flex min-h-control min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', active ? 'bg-info-fg' : 'bg-fg-disabled')} aria-hidden />
                        <span className="truncate font-mono text-sm text-fg-primary">{url}</span>
                      </button>
                      <IconButton icon={LuCopy} label={t('settings.remoteAccess.copy', { value: url })} size="sm" onClick={() => { void copyText(url) }} />
                    </div>
                  )
                })}
              </div>
              {pinActive && (
                <Switch
                  checked={includePin}
                  onChange={setIncludePin}
                  label={t('settings.remoteAccess.pinInQr')}
                  description={t('settings.remoteAccess.pinInQrDescription')}
                />
              )}
              {!remote && !pinActive && (
                <Notice tone="warning" icon={LuShieldCheck}>
                  {t('settings.remoteAccess.openWarning')}
                </Notice>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      {remote ? (
        <SettingsCard icon={LuKeyRound} title={t('settings.remoteAccess.pinTitle')}>
          <SettingRow label={t('settings.remoteAccess.pinOnConsole')} description={t('settings.remoteAccess.pinOnConsoleDescription')} />
        </SettingsCard>
      ) : (
        <PinCard settings={settings} onSaved={setSettings} />
      )}

      <SettingsCard
        icon={LuPlug}
        title={t('settings.remoteAccess.companion')}
        status={<ServerState server={status?.api} label={t('settings.remoteAccess.api')} />}
        subtitle={t('settings.remoteAccess.companionSubtitle')}
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('settings.remoteAccess.companionConnection')}</span>
            <div className="flex flex-wrap gap-2">
              {addresses.length === 0 ? (
                <span className="text-sm text-fg-tertiary">{t.rich('settings.remoteAccess.companionHost', { port: <span className="font-mono">{apiPort}</span> })}</span>
              ) : addresses.map((a) => (
                <span key={a} className="flex h-control-sm items-center gap-1 rounded-md bg-surface-2 pl-2.5 pr-0.5 ring-1 ring-inset ring-line">
                  <span className="font-mono text-xs text-fg-primary">{a}:{apiPort}</span>
                  <IconButton icon={LuCopy} label={t('settings.remoteAccess.copy', { value: `${a}:${apiPort}` })} size="xs" onClick={() => { void copyText(`ws://${a}:${apiPort}`) }} />
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-fg-tertiary">
            {t.rich('settings.remoteAccess.companionHelp', {
              module: <span className="text-fg-secondary">PhotonBoard</span>,
              pin: pinActive ? t('settings.remoteAccess.companionHelpPin') : t('settings.remoteAccess.companionHelpNoPin')
            })}
          </p>
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}

function PinCard({ settings, onSaved }: { settings: RemoteSettings | null; onSaved: (s: RemoteSettings) => void }) {
  const t = useT()
  const [enabled, setEnabled] = useState(false)
  const [pin, setPin] = useState('')
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    if (!settings) return
    setEnabled(settings.pinEnabled)
    setPin(settings.pin)
    setError(null)
  }, [settings])
  useEffect(reset, [reset])

  if (!settings) {
    return (
      <SettingsCard icon={LuKeyRound} title={t('settings.remoteAccess.pinTitle')}>
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-fg-tertiary"><Spinner size={16} /> {t('settings.remoteAccess.loading')}</div>
      </SettingsCard>
    )
  }

  const changed = enabled !== settings.pinEnabled || (enabled && pin !== settings.pin)
  const pinInvalid = enabled && !PIN_RE.test(pin)

  const save = async () => {
    if (pinInvalid || saving) return
    setSaving(true)
    setError(null)
    try {
      const next: RemoteSettings = { pinEnabled: enabled, pin: enabled ? pin : settings.pin && PIN_RE.test(settings.pin) ? settings.pin : '' }
      const res = await getBridge()!.remote.setSettings(next)
      if (!res.success) {
        setError(res.error ?? translate('settings.remoteAccess.pinSaveFailed'))
        toast.error(translate('settings.remoteAccess.pinNotSaved'), { description: res.error })
        return
      }
      onSaved(res.settings ?? next)
      toast.success(enabled ? translate('settings.remoteAccess.pinSaved') : translate('settings.remoteAccess.pinOff'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : translate('errors.unknown')
      setError(msg)
      toast.error(translate('settings.remoteAccess.pinNotSaved'), { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      icon={LuKeyRound}
      title={t('settings.remoteAccess.pinTitle')}
      status={settings.pinEnabled ? <Badge size="xs" tone="go" icon={LuShieldCheck}>{t('settings.remoteAccess.protected')}</Badge> : <Badge size="xs" tone="warning">{t('settings.remoteAccess.open')}</Badge>}
      subtitle={t('settings.remoteAccess.pinSubtitle')}
    >
      <SettingRow label={t('settings.remoteAccess.requirePin')} description={t('settings.remoteAccess.requirePinDescription')}>
        <Switch checked={enabled} onChange={(on) => { setEnabled(on); setError(null); if (on && !pin) { setPin(randomPin()); setReveal(true) } }} aria-label={t('settings.remoteAccess.requirePin')} />
      </SettingRow>
      {enabled && (
        <SettingRow label={t('settings.remoteAccess.pin')} description={t('settings.remoteAccess.pinRule')} htmlFor="settings-remote-pin">
          <div className="w-[220px]">
          <TextInput
            id="settings-remote-pin"
            mono
            value={pin}
            maxLength={16}
            autoComplete="off"
            type={reveal ? 'text' : 'password'}
            invalid={pinInvalid && pin.length > 0}
            onChange={(e) => { setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '')); setError(null) }}
            trailing={
              <IconButton icon={reveal ? LuEyeOff : LuEye} label={reveal ? t('settings.remoteAccess.hidePin') : t('settings.remoteAccess.showPin')} size="xs" onClick={() => setReveal((r) => !r)} />
            }
          />
          </div>
          <Button variant="ghost" icon={LuDices} onClick={() => { setPin(randomPin()); setReveal(true) }}>{t('settings.remoteAccess.generate')}</Button>
        </SettingRow>
      )}
      {(changed || error) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle bg-surface-2/50 px-4 py-3">
          <span className={cn('min-w-0 flex-1 text-xs', error ? 'text-danger-fg' : 'text-fg-tertiary')}>
            {error ?? (pinInvalid ? t('settings.remoteAccess.pinInvalid') : t('settings.remoteAccess.pinDisconnects'))}
          </span>
          <Button variant="ghost" onClick={reset} disabled={saving}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={saving} disabled={pinInvalid || !changed} onClick={() => { void save() }}>{t('settings.remoteAccess.savePin')}</Button>
        </div>
      )}
    </SettingsCard>
  )
}
