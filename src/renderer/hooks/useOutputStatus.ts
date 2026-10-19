// ============================================================
// DMX output health, polled once per second while at least one
// component shows it (top bar, status bar). One shared poll.
// ============================================================

import { useEffect, useState } from 'react'
import type { DmxOutputsStatus, DmxOutputStatus } from '@shared/types'
import { getBridge } from '@renderer/lib/runtime'

const POLL_MS = 1000

let current: DmxOutputsStatus | null = null
const listeners = new Set<(s: DmxOutputsStatus | null) => void>()
let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

async function poll(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const next = await getBridge()?.dmxOutputs.getStatus()
    if (next && JSON.stringify(next.outputs) !== JSON.stringify(current?.outputs)) {
      current = next
      for (const l of listeners) l(current)
    }
  } catch {
    // Main not ready / remote disconnected: keep the last known status
  } finally {
    inFlight = false
  }
}

export function useOutputStatus(): DmxOutputsStatus | null {
  const [status, setStatus] = useState(current)
  useEffect(() => {
    listeners.add(setStatus)
    if (!timer) {
      void poll()
      timer = setInterval(() => { void poll() }, POLL_MS)
    }
    return () => {
      listeners.delete(setStatus)
      if (listeners.size === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [])
  return status
}

export type OutputHealth = 'ok' | 'degraded' | 'error' | 'none' | 'unknown'

/** Overall health of the enabled outputs */
export function outputHealth(status: DmxOutputsStatus | null): { health: OutputHealth; active: DmxOutputStatus[] } {
  if (!status) return { health: 'unknown', active: [] }
  const active = status.outputs.filter((o) => o.enabled && o.state !== 'disabled')
  if (active.length === 0) return { health: 'none', active }
  if (active.some((o) => o.state === 'error' || o.state === 'invalid')) return { health: 'error', active }
  if (active.some((o) => o.state === 'connecting')) return { health: 'degraded', active }
  return { health: 'ok', active }
}
