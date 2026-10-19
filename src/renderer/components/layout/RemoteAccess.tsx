// Remote (browser) only: PIN prompt when the console refuses the
// connection, and a banner while the connection is down.

import { useEffect, useState } from 'react'
import { LuKeyRound, LuWifiOff } from 'react-icons/lu'
import { Button, Modal, Spinner, TextInput } from '@renderer/components/ui'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'
import { loadLastShow } from '@renderer/lib/show-io'
import { useRemoteConnection } from '@renderer/hooks/useRemoteConnection'

/** Grace period before showing "reconnecting" (normal start-up, brief network blips) */
const BANNER_DELAY_MS = 1500

export function RemoteAccess() {
  if (!isRemoteMode()) return null
  return (
    <>
      <PinDialog />
      <ConnectionBanner />
    </>
  )
}

function PinDialog() {
  const state = useRemoteConnection()
  const [requested, setRequested] = useState(state === 'auth-required')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onAuth = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason
      setRequested(true)
      if (reason && reason !== 'PIN required') setError(reason)
    }
    window.addEventListener('photonboard:auth-required', onAuth)
    return () => window.removeEventListener('photonboard:auth-required', onAuth)
  }, [])

  useEffect(() => {
    if (state === 'auth-required') setRequested(true)
    if (state === 'open') { setRequested(false); setError(null); setPin('') }
  }, [state])

  const submit = async () => {
    if (!pin.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const ok = await getBridge()?.remote.authenticate(pin.trim())
      if (!ok) setError('Wrong PIN — check the PIN shown in the console Settings.')
      // The start-up show load was refused without the PIN: fetch it now
      else void loadLastShow()
    } catch {
      setError('Could not reach the console.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={requested && state !== 'open'}
      onClose={() => {}}
      dismissible={false}
      size="sm"
      title="Enter the console PIN"
      description="This PhotonBoard console is protected. The PIN is in Settings → Remote access on the console."
      footer={<Button variant="primary" loading={busy} onClick={() => { void submit() }}>Connect</Button>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="flex flex-col gap-2">
        <TextInput
          data-autofocus=""
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          icon={LuKeyRound}
          size="lg"
          aria-label="PIN"
          placeholder="PIN"
          value={pin}
          invalid={!!error}
          onChange={(e) => setPin(e.target.value)}
          mono
        />
        {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}
      </form>
    </Modal>
  )
}

function ConnectionBanner() {
  const state = useRemoteConnection()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (state === 'open' || state === 'auth-required') { setVisible(false); return }
    const t = setTimeout(() => setVisible(true), BANNER_DELAY_MS)
    return () => clearTimeout(t)
  }, [state])
  if (!visible) return null
  return (
    <div role="alert" className="flex h-control-sm shrink-0 items-center justify-center gap-2 bg-warning px-3 text-xs font-semibold text-on-warning">
      <LuWifiOff size={14} aria-hidden />
      Connection to the console lost — reconnecting
      <Spinner size={12} />
    </div>
  )
}
