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
        if (alive) setError(e instanceof Error ? e.message : 'Status unavailable')
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
    toast.success('Copied to the clipboard', { description: text })
  } catch {
    toast.error('Could not copy', { description: text })
  }
}

function randomPin(): string {
  const digits = new Uint32Array(6)
  crypto.getRandomValues(digits)
  return Array.from(digits, (d) => String(d % 10)).join('')
}

function ServerState({ server, label }: { server: RemoteServerStatus | undefined; label: string }) {
  if (!server) return <span className="flex items-center gap-1.5 text-xs text-fg-tertiary"><Spinner size={12} /> Checking…</span>
  if (!server.listening) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger-fg">
        <StatusDot tone="danger" label={`${label} not running`} />
        Not running{server.error ? ` — ${server.error}` : ''}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
      <StatusDot tone="go" label={`${label} running`} />
      Port <span className="font-mono tabular">{server.port}</span>
      <span className="text-fg-tertiary">·</span>
      <span className="tabular">{server.clients}</span> connected
    </span>
  )
}

export function RemoteAccessSettings() {
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
      title="Remote access"
      description="Control this console from a phone or tablet browser on the same network, or from Bitfocus Companion."
    >
      {error && !status && <Notice tone="danger">Could not read the remote servers' status: {error}</Notice>}

      <SettingsCard
        icon={LuSmartphone}
        title="Web remote"
        status={<ServerState server={status?.web} label="Web remote" />}
        subtitle="Phones open the Stage view (scenes, Grand Master, blackout); tablets can switch to the full console."
      >
        {!status ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-fg-tertiary"><Spinner size={16} /> Looking for network addresses…</div>
        ) : urls.length === 0 ? (
          <EmptyState
            size="sm"
            icon={LuWifiOff}
            title="No network connection"
            description="Connect this console to a network (Ethernet or Wi-Fi). The remote address and QR code appear here as soon as it has an IP address."
          />
        ) : (
          <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center gap-2">
              <QrCode value={qrValue} size={184} label={`QR code to open ${current} on a phone`} />
              <span className="flex items-center gap-1.5 text-xs text-fg-tertiary"><LuQrCode size={12} aria-hidden /> Scan with the phone camera</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Remote address">
                <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">
                  {urls.length > 1 ? 'Addresses — pick the network the phone is on' : 'Address'}
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
                      <IconButton icon={LuCopy} label={`Copy ${url}`} size="sm" onClick={() => { void copyText(url) }} />
                    </div>
                  )
                })}
              </div>
              {pinActive && (
                <Switch
                  checked={includePin}
                  onChange={setIncludePin}
                  label="Put the PIN in the QR code"
                  description="Phones connect without typing it. Anyone who sees the code can use the console."
                />
              )}
              {!remote && !pinActive && (
                <Notice tone="warning" icon={LuShieldCheck}>
                  Anyone on this network can control the console. Set a PIN below for shows on shared or public Wi-Fi.
                </Notice>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      {remote ? (
        <SettingsCard icon={LuKeyRound} title="Access PIN">
          <SettingRow label="PIN settings live on the console" description="Open Settings → Remote access on the console to set or change the PIN." />
        </SettingsCard>
      ) : (
        <PinCard settings={settings} onSaved={setSettings} />
      )}

      <SettingsCard
        icon={LuPlug}
        title="Companion & API"
        status={<ServerState server={status?.api} label="API" />}
        subtitle="WebSocket API for Bitfocus Companion (Stream Deck), OSC bridges and custom controllers."
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Companion connection</span>
            <div className="flex flex-wrap gap-2">
              {addresses.length === 0 ? (
                <span className="text-sm text-fg-tertiary">Host: this console's IP address · Port <span className="font-mono">{apiPort}</span></span>
              ) : addresses.map((a) => (
                <span key={a} className="flex h-control-sm items-center gap-1 rounded-md bg-surface-2 pl-2.5 pr-0.5 ring-1 ring-inset ring-line">
                  <span className="font-mono text-xs text-fg-primary">{a}:{apiPort}</span>
                  <IconButton icon={LuCopy} label={`Copy ${a}:${apiPort}`} size="xs" onClick={() => { void copyText(`ws://${a}:${apiPort}`) }} />
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-fg-tertiary">
            In Companion, add the <span className="text-fg-secondary">PhotonBoard</span> module (companion-module-photonboard), enter this host and port
            {pinActive ? ', and the PIN.' : '.'} Buttons can fire scenes, chases, masters and the timeline; feedbacks follow the console state.
          </p>
        </div>
      </SettingsCard>
    </SettingsPage>
  )
}

function PinCard({ settings, onSaved }: { settings: RemoteSettings | null; onSaved: (s: RemoteSettings) => void }) {
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
      <SettingsCard icon={LuKeyRound} title="Access PIN">
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-fg-tertiary"><Spinner size={16} /> Loading…</div>
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
        setError(res.error ?? 'The PIN could not be saved')
        toast.error('PIN not saved', { description: res.error })
        return
      }
      onSaved(res.settings ?? next)
      toast.success(enabled ? 'PIN saved — remotes must enter it to connect' : 'PIN turned off')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setError(msg)
      toast.error('PIN not saved', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      icon={LuKeyRound}
      title="Access PIN"
      status={settings.pinEnabled ? <Badge size="xs" tone="go" icon={LuShieldCheck}>Protected</Badge> : <Badge size="xs" tone="warning">Open</Badge>}
      subtitle="Applies to the web remote and the Companion API."
    >
      <SettingRow label="Require a PIN" description="Remotes and Companion must send the PIN before they can control the console.">
        <Switch checked={enabled} onChange={(on) => { setEnabled(on); setError(null); if (on && !pin) { setPin(randomPin()); setReveal(true) } }} aria-label="Require a PIN" />
      </SettingRow>
      {enabled && (
        <SettingRow label="PIN" description="4 to 16 letters or digits." htmlFor="settings-remote-pin">
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
              <IconButton icon={reveal ? LuEyeOff : LuEye} label={reveal ? 'Hide PIN' : 'Show PIN'} size="xs" onClick={() => setReveal((r) => !r)} />
            }
          />
          </div>
          <Button variant="ghost" icon={LuDices} onClick={() => { setPin(randomPin()); setReveal(true) }}>Generate</Button>
        </SettingRow>
      )}
      {(changed || error) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle bg-surface-2/50 px-4 py-3">
          <span className={cn('min-w-0 flex-1 text-xs', error ? 'text-danger-fg' : 'text-fg-tertiary')}>
            {error ?? (pinInvalid ? 'The PIN must be 4 to 16 letters or digits.' : 'Saving disconnects every remote and Companion; they reconnect with the new PIN.')}
          </span>
          <Button variant="ghost" onClick={reset} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={pinInvalid || !changed} onClick={() => { void save() }}>Save PIN</Button>
        </div>
      )}
    </SettingsCard>
  )
}
