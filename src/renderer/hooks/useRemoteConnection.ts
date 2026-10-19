import { useEffect, useState } from 'react'
import type { RemoteConnectionState } from '@shared/photonboard-api'
import { getBridge, isRemoteMode } from '@renderer/lib/runtime'

/** Remote (browser) only: WebSocket state to the console. Always 'open' in Electron. */
export function useRemoteConnection(): RemoteConnectionState {
  const [state, setState] = useState<RemoteConnectionState>(() =>
    isRemoteMode() ? getBridge()?.remote.getConnectionState() ?? 'connecting' : 'open'
  )
  useEffect(() => {
    if (!isRemoteMode()) return
    const off = getBridge()?.remote.onConnectionChange(setState)
    return () => { if (typeof off === 'function') off() }
  }, [])
  return state
}
