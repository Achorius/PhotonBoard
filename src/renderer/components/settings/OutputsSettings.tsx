// ============================================================
// Settings → Outputs: machine DMX output configuration (Art-Net
// nodes + USB DMX adapters). Owned by main (outputs.json, not the
// show): edited as a draft, validated and applied as a whole with
// dmxOutputs.configure(). Live state comes from the shared 1 Hz
// output-status poll.
// ============================================================

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  LuCircleAlert, LuNetwork, LuPlus, LuRadioTower, LuRefreshCw, LuRotateCcw, LuTrash2, LuTriangleAlert, LuUsb
} from 'react-icons/lu'
import type { ArtNetConfig, DmxOutputStatus, DmxOutputsConfig, SerialPortInfo, UsbDmxConfig, UsbDmxDriver } from '@shared/types'
import { MAX_UNIVERSES } from '@shared/types'
import {
  Badge, Button, EmptyState, Field, IconButton, NumberField, Select, Spinner, StatusDot, Switch, TextInput,
  cn, confirm, toast, type Tone
} from '@renderer/components/ui'
import { useOutputStatus } from '@renderer/hooks/useOutputStatus'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { Notice, SettingsCard, SettingsPage } from './settings-ui'
import { StrobeSettingsCard } from './StrobeSettings'
import { t as translate, useT } from '@renderer/i18n'

const ARTNET_PORT = 6454
const BROADCAST = '255.255.255.255'

const USB_DRIVERS: { value: UsbDmxDriver; label: string }[] = [
  { value: 'enttec-open-dmx', label: 'ENTTEC Open DMX USB' },
  { value: 'enttec-pro', label: 'ENTTEC DMX USB Pro' },
  { value: 'eurolite', label: 'Eurolite USB-DMX512 (Open DMX)' },
  { value: 'eurolite-pro', label: 'Eurolite USB-DMX512 PRO' },
  { value: 'showtec', label: 'Showtec Quick DMX' },
  { value: 'beamz', label: 'Beamz DMX60 / DMX70' },
  { value: 'velleman', label: 'Velleman VM116 / K8062' },
  { value: 'stairville', label: 'Stairville USB-DMX' },
  { value: 'udmx', label: 'uDMX / Anyma / clone' },
  { value: 'generic-ftdi', label: 'Generic FTDI (Open DMX)' } // label translated at render (settings.outputs.genericFtdi)
]
const PRO_DRIVERS = new Set<UsbDmxDriver>(['enttec-pro', 'eurolite-pro'])

/** Options built at render: labels follow the UI language */
const universeOptions = () => Array.from({ length: MAX_UNIVERSES }, (_, u) => ({ value: String(u), label: translate('common.universeN', { n: u + 1 }) }))
const usbDriverOptions = () => USB_DRIVERS.map((d) => (d.value === 'generic-ftdi' ? { ...d, label: translate('settings.outputs.genericFtdi') } : d))

const STATE_TONE: Record<DmxOutputStatus['state'], Tone> = { ok: 'go', connecting: 'warning', error: 'danger', invalid: 'danger', disabled: 'neutral' }
const stateLabel = (state: DmxOutputStatus['state']) => translate(`settings.outputs.state.${state}`)

// ---- Draft model (a local key per row; ids come from main) ----

type DraftArtnet = ArtNetConfig & { key: string }
type DraftUsb = UsbDmxConfig & { key: string }
interface Draft { artnet: DraftArtnet[]; usb: DraftUsb[] }

let keySeq = 0
const nextKey = () => `row-${++keySeq}`

function toDraft(cfg: DmxOutputsConfig): Draft {
  return {
    artnet: cfg.artnet.map((a) => ({ ...a, key: a.id ?? nextKey() })),
    usb: cfg.usb.map((u) => ({ ...u, key: u.id ?? nextKey() }))
  }
}

/** The config to send (no UI keys, no empty labels) */
function fromDraft(d: Draft): DmxOutputsConfig {
  return {
    artnet: d.artnet.map(({ key: _k, ...a }) => {
      const out: ArtNetConfig = { ...a, enabled: a.enabled !== false }
      if (!out.label?.trim()) delete out.label
      else out.label = out.label.trim()
      return out
    }),
    usb: d.usb.map(({ key: _k, ...u }) => {
      const out: UsbDmxConfig = { ...u, enabled: u.enabled !== false }
      if (!out.label?.trim()) delete out.label
      else out.label = out.label.trim()
      if (!out.serialNumber) delete out.serialNumber
      return out
    })
  }
}

/** Comparable form (defaults filled the way main fills them) */
function canonical(cfg: DmxOutputsConfig | null): string {
  if (!cfg) return ''
  const norm = fromDraft(toDraft(cfg))
  return JSON.stringify({
    artnet: norm.artnet.map((a) => ({ ...a, artnetUniverse: a.artnetUniverse ?? a.universe })),
    usb: norm.usb
  })
}

// ---- Light client-side validation (main validates again, strictly) ----

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOST_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

function hostError(host: string): string | null {
  const h = host.trim()
  if (!h) return translate('settings.outputs.errors.hostRequired')
  if (/^[\d.]+$/.test(h)) {
    const m = IPV4_RE.exec(h)
    if (!m || m.slice(1).some((o) => Number(o) > 255)) return translate('settings.outputs.errors.badIp')
    return null
  }
  return h.replace(/\.$/, '').split('.').every((l) => HOST_LABEL_RE.test(l)) ? null : translate('settings.outputs.errors.badHost')
}

interface DraftErrors { [key: string]: { host?: string; port?: string } }

function validate(d: Draft): { errors: DraftErrors; count: number } {
  const errors: DraftErrors = {}
  let count = 0
  for (const a of d.artnet) {
    const host = hostError(a.host)
    if (host) { errors[a.key] = { ...errors[a.key], host }; count++ }
  }
  const used = new Map<string, string>()
  for (const u of d.usb) {
    if (!u.portPath) { errors[u.key] = { port: translate('settings.outputs.errors.choosePort') }; count++; continue }
    if (u.enabled === false) continue
    if (used.has(u.portPath)) { errors[u.key] = { port: translate('settings.outputs.errors.portInUse') }; count++ }
    used.set(u.portPath, u.key)
  }
  return { errors, count }
}

function portAddress(net: number, subnet: number, universe: number): number {
  return (net << 8) | (subnet << 4) | universe
}

function guessDriver(port: SerialPortInfo | undefined): UsbDmxDriver {
  const text = `${port?.manufacturer ?? ''} ${port?.friendlyName ?? ''}`.toLowerCase()
  if (text.includes('pro')) return 'enttec-pro'
  return 'enttec-open-dmx'
}

// ---------------------------------------------------------------

export function OutputsSettings() {
  if (isRemoteMode()) return <RemoteOutputsOverview />
  return <OutputsEditor />
}

function OutputsEditor() {
  const t = useT()
  const status = useOutputStatus()
  const [applied, setApplied] = useState<DmxOutputsConfig | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const cfg = await getBridge()!.dmxOutputs.getConfig()
      setApplied(cfg)
      setDraft(toDraft(cfg))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : translate('settings.outputs.readFailed'))
    }
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setPorts(await getBridge()!.dmxOutputs.scanUsb())
    } catch (e) {
      toast.error(translate('settings.outputs.scanFailed'), { description: e instanceof Error ? e.message : undefined })
    } finally {
      setScanning(false)
      setScanned(true)
    }
  }, [])

  useEffect(() => { void load(); void scan() }, [load, scan])

  const statusById = useMemo(() => new Map((status?.outputs ?? []).map((o) => [o.id, o])), [status])
  const dirty = !!draft && canonical(fromDraft(draft)) !== canonical(applied)
  // `t` in the deps: messages follow the UI language
  const { errors, count: errorCount } = useMemo(() => (draft ? validate(draft) : { errors: {}, count: 0 }), [draft, t])

  const update = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((d) => (d ? fn(d) : d))
    setApplyError(null)
  }, [])

  const patchArtnet = useCallback((key: string, patch: Partial<ArtNetConfig>) => {
    update((d) => ({ ...d, artnet: d.artnet.map((a) => (a.key === key ? { ...a, ...patch } : a)) }))
  }, [update])
  const patchUsb = useCallback((key: string, patch: Partial<UsbDmxConfig>) => {
    update((d) => ({ ...d, usb: d.usb.map((u) => (u.key === key ? { ...u, ...patch } : u)) }))
  }, [update])

  const removeRow = useCallback(async (kind: 'artnet' | 'usb', key: string, name: string, live: boolean) => {
    if (live) {
      const ok = await confirm({
        title: translate('settings.outputs.removeTitle', { name }),
        message: translate('settings.outputs.removeMessage'),
        confirmLabel: translate('settings.outputs.removeAction'),
        tone: 'danger'
      })
      if (!ok) return
    }
    update((d) => ({ ...d, [kind]: (d[kind] as { key: string }[]).filter((r) => r.key !== key) }) as Draft)
  }, [update])

  const addArtnet = () => {
    update((d) => {
      const used = new Set(d.artnet.map((a) => a.universe))
      let universe = 0
      while (used.has(universe) && universe < MAX_UNIVERSES - 1) universe++
      return {
        ...d,
        artnet: [...d.artnet, { key: nextKey(), enabled: true, host: BROADCAST, port: ARTNET_PORT, universe, net: 0, subnet: 0, artnetUniverse: universe % 16 }]
      }
    })
  }

  const addUsb = () => {
    update((d) => {
      const taken = new Set(d.usb.map((u) => u.portPath))
      const port = ports.find((p) => !taken.has(p.path))
      const usedU = new Set(d.usb.map((u) => u.universe))
      let universe = 0
      while (usedU.has(universe) && universe < MAX_UNIVERSES - 1) universe++
      const row: DraftUsb = { key: nextKey(), enabled: true, driver: guessDriver(port), portPath: port?.path ?? '', universe }
      if (port?.serialNumber) row.serialNumber = port.serialNumber
      return { ...d, usb: [...d.usb, row] }
    })
  }

  const discard = () => {
    if (applied) setDraft(toDraft(applied))
    setApplyError(null)
  }

  const apply = async () => {
    if (!draft || applying) return
    setApplying(true)
    setApplyError(null)
    try {
      const result = await getBridge()!.dmxOutputs.configure(fromDraft(draft))
      if (!result.success) {
        const error = result.error || translate('settings.outputs.refused')
        setApplyError(error)
        toast.error(translate('settings.outputs.notApplied'), { description: error })
        return
      }
      const cfg = result.config ?? fromDraft(draft)
      setApplied(cfg)
      setDraft(toDraft(cfg))
      if (result.warning) toast.warning(translate('settings.outputs.appliedWarning'), { description: result.warning })
      else toast.success(translate('settings.outputs.applied'))
    } catch (e) {
      const error = e instanceof Error ? e.message : translate('errors.unknown')
      setApplyError(error)
      toast.error(translate('settings.outputs.notApplied'), { description: error })
    } finally {
      setApplying(false)
    }
  }

  const usbUnavailable = status ? !status.usbAvailable : false

  return (
    <>
      <SettingsPage
        title={t('settings.outputs.title')}
        description={t('settings.outputs.description')}
      >
        {loadError && (
          <Notice tone="danger" icon={LuCircleAlert}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1">{loadError}</span>
              <Button size="sm" icon={LuRefreshCw} onClick={() => { void load() }}>{t('common.retry')}</Button>
            </div>
          </Notice>
        )}
        {!draft && !loadError && (
          <div className="flex items-center gap-2 py-8 text-sm text-fg-tertiary"><Spinner size={16} /> {t('settings.outputs.reading')}</div>
        )}
        {draft && (
          <>
            <SettingsCard
              icon={LuNetwork}
              title={t('settings.outputs.artnet')}
              status={<Badge size="xs">{draft.artnet.length}</Badge>}
              subtitle={t('settings.outputs.artnetSubtitle')}
              actions={draft.artnet.length > 0 && <Button size="sm" icon={LuPlus} onClick={addArtnet}>{t('settings.outputs.addNode')}</Button>}
            >
              {draft.artnet.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={LuNetwork}
                  title={t('settings.outputs.noArtnet')}
                  description={t('settings.outputs.noArtnetDescription')}
                  action={<Button variant="primary" size="sm" icon={LuPlus} onClick={addArtnet}>{t('settings.outputs.addArtnetNode')}</Button>}
                />
              ) : draft.artnet.map((a, i) => (
                <ArtnetRow
                  key={a.key}
                  entry={a}
                  index={i}
                  status={a.id ? statusById.get(a.id) : undefined}
                  applied={!!a.id && !!applied?.artnet.some((x) => x.id === a.id)}
                  error={errors[a.key]?.host}
                  onPatch={patchArtnet}
                  onRemove={removeRow}
                />
              ))}
            </SettingsCard>

            <SettingsCard
              icon={LuUsb}
              title={t('settings.outputs.usb')}
              status={<Badge size="xs">{draft.usb.length}</Badge>}
              subtitle={
                ports.length > 0
                  ? t('settings.outputs.portsDetected', { count: ports.length, ports: ports.map((p) => p.path).join(', ') })
                  : scanned ? t('settings.outputs.noPort') : t('settings.outputs.lookingForPorts')
              }
              actions={
                <>
                  <Button size="sm" variant="ghost" icon={LuRefreshCw} loading={scanning} onClick={() => { void scan() }}>{t('settings.outputs.rescanPorts')}</Button>
                  {draft.usb.length > 0 && <Button size="sm" icon={LuPlus} onClick={addUsb}>{t('settings.outputs.addAdapter')}</Button>}
                </>
              }
            >
              {usbUnavailable && (
                <div className="px-4 pt-3">
                  <Notice tone="warning" icon={LuTriangleAlert}>
                    {t('settings.outputs.usbUnavailable')}
                  </Notice>
                </div>
              )}
              {draft.usb.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={LuUsb}
                  title={t('settings.outputs.noUsb')}
                  description={t('settings.outputs.noUsbDescription')}
                  action={<Button variant="primary" size="sm" icon={LuPlus} onClick={addUsb} disabled={usbUnavailable}>{t('settings.outputs.addUsbAdapter')}</Button>}
                />
              ) : draft.usb.map((u, i) => (
                <UsbRow
                  key={u.key}
                  entry={u}
                  index={i}
                  ports={ports}
                  scanning={scanning}
                  status={u.id ? statusById.get(u.id) : undefined}
                  applied={!!u.id && !!applied?.usb.some((x) => x.id === u.id)}
                  error={errors[u.key]?.port}
                  onPatch={patchUsb}
                  onRemove={removeRow}
                  onRescan={scan}
                />
              ))}
            </SettingsCard>
            <StrobeSettingsCard />
            {/* Room for the sticky apply bar */}
            {dirty && <div aria-hidden className="h-16" />}
          </>
        )}
      </SettingsPage>

      {dirty && (
        <div className="sticky bottom-0 z-10 border-t border-line bg-surface-overlay/95 shadow-popover backdrop-blur">
          <div className="mx-auto flex w-full max-w-[960px] flex-wrap items-center gap-3 px-4 py-2.5 [[data-density=touch]_&]:px-6">
            <StatusDot tone={applyError || errorCount ? 'danger' : 'accent'} size="md" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-fg-primary">
                {errorCount > 0 ? t('settings.outputs.fixProblems', { count: errorCount }) : t('settings.outputs.notAppliedYet')}
              </span>
              {applyError
                ? <span className="text-xs text-danger-fg">{applyError}</span>
                : <span className="text-xs text-fg-tertiary">{t('settings.outputs.keepsGoing')}</span>}
            </div>
            <Button variant="ghost" icon={LuRotateCcw} onClick={discard} disabled={applying}>{t('common.discard')}</Button>
            <Button variant="primary" loading={applying} disabled={errorCount > 0} onClick={() => { void apply() }}>{t('settings.outputs.applyOutputs')}</Button>
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------
// Rows
// ---------------------------------------------------------------

function OutputState({ status, applied, enabled }: { status?: DmxOutputStatus; applied: boolean; enabled: boolean }) {
  const t = useT()
  if (!applied) return <Badge size="xs" tone="accent">{t('settings.outputs.newNotApplied')}</Badge>
  if (!enabled) return <span className="flex items-center gap-1.5 text-xs text-fg-tertiary"><StatusDot tone="neutral" />{t('settings.outputs.state.disabled')}</span>
  if (!status) return <span className="flex items-center gap-1.5 text-xs text-fg-tertiary"><StatusDot tone="neutral" />{t('settings.outputs.noStatus')}</span>
  return (
    <span className="flex items-center gap-2 text-xs text-fg-secondary">
      <StatusDot tone={STATE_TONE[status.state]} pulse={status.state === 'error'} label={stateLabel(status.state)} />
      {stateLabel(status.state)}
      {status.state === 'ok' && <span className="font-mono text-2xs tabular text-fg-tertiary">{t('units.fpsValue', { value: Math.round(status.fps) })}</span>}
    </span>
  )
}

function RowHeader({ icon: Icon, enabled, onEnabled, label, placeholder, onLabel, state, onRemove, removeLabel }: {
  icon: typeof LuNetwork
  enabled: boolean
  onEnabled: (on: boolean) => void
  label: string
  placeholder: string
  onLabel: (v: string) => void
  state: React.ReactNode
  onRemove: () => void
  removeLabel: string
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Switch checked={enabled} onChange={onEnabled} aria-label={enabled ? t('settings.outputs.disableOutput', { name: label || placeholder }) : t('settings.outputs.enableOutput', { name: label || placeholder })} />
      <Icon size={16} aria-hidden className={cn('shrink-0', enabled ? 'text-fg-secondary' : 'text-fg-disabled')} />
      <TextInput
        aria-label={t('settings.outputs.outputName')}
        value={label}
        placeholder={placeholder}
        maxLength={64}
        onChange={(e) => onLabel(e.target.value)}
        className="w-auto min-w-[160px] max-w-[280px] flex-1 border-transparent bg-transparent font-medium hover:border-line-strong"
      />
      <div className="ml-auto flex items-center gap-2">
        {state}
        <IconButton icon={LuTrash2} label={removeLabel} onClick={onRemove} className="hover:text-danger-fg" />
      </div>
    </div>
  )
}

const ArtnetRow = memo(function ArtnetRow({ entry: a, index, status, applied, error, onPatch, onRemove }: {
  entry: DraftArtnet
  index: number
  status?: DmxOutputStatus
  applied: boolean
  error?: string
  onPatch: (key: string, patch: Partial<ArtNetConfig>) => void
  onRemove: (kind: 'artnet', key: string, name: string, live: boolean) => void
}) {
  const t = useT()
  const enabled = a.enabled !== false
  const name = a.label || `Art-Net ${index + 1}`
  const artUni = a.artnetUniverse ?? a.universe % 16
  const isBroadcast = a.host.trim() === BROADCAST
  const showError = applied && enabled && status?.lastError && status.state !== 'ok'
  return (
    <div className={cn('flex flex-col gap-3 border-b border-line-subtle px-4 py-3 last:border-b-0', !enabled && 'bg-surface-0/40')}>
      <RowHeader
        icon={LuRadioTower}
        enabled={enabled}
        onEnabled={(on) => onPatch(a.key, { enabled: on })}
        label={a.label ?? ''}
        placeholder={`Art-Net ${index + 1}`}
        onLabel={(v) => onPatch(a.key, { label: v })}
        state={<OutputState status={status} applied={applied} enabled={enabled} />}
        onRemove={() => onRemove('artnet', a.key, name, applied)}
        removeLabel={t('settings.outputs.removeOutput', { name })}
      />
      <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_150px_minmax(0,1.4fr)]', !enabled && 'opacity-60')}>
        <Field layout="stacked" label={t('settings.outputs.destination')} error={error} hint={!error ? (isBroadcast ? t('settings.outputs.broadcastHint') : t('settings.outputs.unicastHint')) : undefined}>
          {(id) => (
            <TextInput
              id={id}
              mono
              value={a.host}
              invalid={!!error}
              placeholder={BROADCAST}
              onChange={(e) => onPatch(a.key, { host: e.target.value.trim() })}
              trailing={!isBroadcast && (
                <button
                  type="button"
                  onClick={() => onPatch(a.key, { host: BROADCAST })}
                  className="-mr-1 shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.04em] text-fg-tertiary hover:bg-surface-3 hover:text-fg-primary"
                >
                  {t('settings.outputs.broadcast')}
                </button>
              )}
            />
          )}
        </Field>
        <Field layout="stacked" label={t('settings.outputs.sourceUniverse')} hint={t('settings.outputs.sourceUniverseHint')}>
          {(id) => (
            <Select
              id={id}
              value={String(a.universe)}
              options={universeOptions()}
              onChange={(v) => {
                const universe = Number(v)
                // Keep the Art-Net universe in step while it mirrors the source
                const follow = (a.artnetUniverse ?? a.universe % 16) === a.universe % 16
                onPatch(a.key, follow ? { universe, artnetUniverse: universe % 16 } : { universe })
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-secondary">{t('settings.outputs.artnetAddress')}</span>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label={t('settings.outputs.net')} aria-label={t('settings.outputs.netAria')} value={a.net} min={0} max={127} onChange={(v) => onPatch(a.key, { net: Math.round(v) })} />
            <NumberField label={t('settings.outputs.sub')} aria-label={t('settings.outputs.subAria')} value={a.subnet} min={0} max={15} onChange={(v) => onPatch(a.key, { subnet: Math.round(v) })} />
            <NumberField label={t('settings.outputs.uni')} aria-label={t('settings.outputs.uniAria')} value={artUni} min={0} max={15} onChange={(v) => onPatch(a.key, { artnetUniverse: Math.round(v) })} />
          </div>
          <span className="text-xs text-fg-tertiary">
            {t.rich('settings.outputs.portAddress', { value: <span className="font-mono tabular text-fg-secondary">{portAddress(a.net, a.subnet, artUni)}</span> })}
            {a.port !== ARTNET_PORT && <> · {t.rich('settings.outputs.udpPort', { port: <span className="font-mono tabular">{a.port}</span> })}</>}
          </span>
        </div>
      </div>
      {showError && (
        <Notice tone="danger" icon={LuCircleAlert}>{status!.lastError}</Notice>
      )}
    </div>
  )
})

const UsbRow = memo(function UsbRow({ entry: u, index, ports, scanning, status, applied, error, onPatch, onRemove, onRescan }: {
  entry: DraftUsb
  index: number
  ports: SerialPortInfo[]
  scanning: boolean
  status?: DmxOutputStatus
  applied: boolean
  error?: string
  onPatch: (key: string, patch: Partial<UsbDmxConfig>) => void
  onRemove: (kind: 'usb', key: string, name: string, live: boolean) => void
  onRescan: () => void
}) {
  const t = useT()
  const enabled = u.enabled !== false
  const name = u.label || `USB DMX ${index + 1}`
  const portMissing = !!u.portPath && !ports.some((p) => p.path === u.portPath)
  const portOptions = [
    { value: '', label: ports.length ? t('settings.outputs.choosePort') : t('settings.outputs.noPortDetected'), disabled: true },
    ...(portMissing ? [{ value: u.portPath, label: t('settings.outputs.portNotConnected', { port: u.portPath }) }] : []),
    ...ports.map((p) => ({
      value: p.path,
      label: [p.path, p.manufacturer || p.friendlyName, p.serialNumber ? t('settings.outputs.serialNumber', { value: p.serialNumber }) : ''].filter(Boolean).join(' · ')
    }))
  ]
  const showError = applied && enabled && status?.lastError && status.state !== 'ok'
  return (
    <div className={cn('flex flex-col gap-3 border-b border-line-subtle px-4 py-3 last:border-b-0', !enabled && 'bg-surface-0/40')}>
      <RowHeader
        icon={LuUsb}
        enabled={enabled}
        onEnabled={(on) => onPatch(u.key, { enabled: on })}
        label={u.label ?? ''}
        placeholder={`USB DMX ${index + 1}`}
        onLabel={(v) => onPatch(u.key, { label: v })}
        state={<OutputState status={status} applied={applied} enabled={enabled} />}
        onRemove={() => onRemove('usb', u.key, name, applied)}
        removeLabel={t('settings.outputs.removeOutput', { name })}
      />
      <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_150px]', !enabled && 'opacity-60')}>
        <Field
          layout="stacked"
          label={t('settings.outputs.serialPort')}
          error={error}
          hint={!error ? (portMissing ? t('settings.outputs.portUnplugged') : t('settings.outputs.portOwn')) : undefined}
        >
          {(id) => (
            <div className="flex gap-2">
              <Select
                id={id}
                className="flex-1"
                value={u.portPath}
                options={portOptions}
                onChange={(path) => {
                  const port = ports.find((p) => p.path === path)
                  onPatch(u.key, { portPath: path, serialNumber: port?.serialNumber })
                }}
              />
              <IconButton icon={LuRefreshCw} label={t('settings.outputs.rescanSerial')} variant="secondary" loading={scanning} onClick={onRescan} />
            </div>
          )}
        </Field>
        <Field layout="stacked" label={t('settings.outputs.adapterType')} hint={PRO_DRIVERS.has(u.driver) ? t('settings.outputs.proProtocol') : t('settings.outputs.openProtocol')}>
          {(id) => (
            <Select id={id} value={u.driver} options={usbDriverOptions()} onChange={(driver) => onPatch(u.key, { driver })} />
          )}
        </Field>
        <Field layout="stacked" label={t('settings.outputs.sourceUniverse')}>
          {(id) => (
            <Select id={id} value={String(u.universe)} options={universeOptions()} onChange={(v) => onPatch(u.key, { universe: Number(v) })} />
          )}
        </Field>
      </div>
      {showError && <Notice tone="danger" icon={LuCircleAlert}>{status!.lastError}</Notice>}
    </div>
  )
})

// ---------------------------------------------------------------
// Remote (browser): read-only overview
// ---------------------------------------------------------------

function RemoteOutputsOverview() {
  const t = useT()
  const status = useOutputStatus()
  const outputs = status?.outputs ?? []
  return (
    <SettingsPage title={t('settings.outputs.title')} description={t('settings.outputs.remoteDescription')}>
      <SettingsCard icon={LuNetwork} title={t('settings.outputs.remoteTitle')} status={<Badge size="xs">{outputs.length}</Badge>}>
        {!status ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-fg-tertiary"><Spinner size={16} /> {t('settings.outputs.readingStatus')}</div>
        ) : outputs.length === 0 ? (
          <EmptyState size="sm" icon={LuNetwork} title={t('settings.outputs.noneConfigured')} description={t('settings.outputs.noneConfiguredDescription')} />
        ) : outputs.map((o) => (
          <div key={o.id} className="flex min-h-row items-center gap-3 border-b border-line-subtle px-4 py-2 last:border-b-0">
            {o.type === 'artnet' ? <LuRadioTower size={16} aria-hidden className="text-fg-tertiary" /> : <LuUsb size={16} aria-hidden className="text-fg-tertiary" />}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-fg-primary">{o.label}</span>
              <span className="truncate font-mono text-2xs text-fg-tertiary">{o.target}</span>
              {o.lastError && o.state !== 'ok' && <span className="text-xs text-danger-fg">{o.lastError}</span>}
            </div>
            <Badge size="xs" mono>{t('units.universeShort', { n: o.sourceUniverse + 1 })}</Badge>
            <OutputState status={o} applied enabled={o.enabled} />
          </div>
        ))}
      </SettingsCard>
      <StrobeSettingsCard />
    </SettingsPage>
  )
}
