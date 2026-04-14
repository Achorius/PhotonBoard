// ============================================================
// PhotonBoard — Remote API Client
// When running in a browser (no Electron), this replaces the
// preload IPC bridge with a WebSocket connection to the Pi.
// Same interface as window.photonboard — transparent to the app.
// ============================================================

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: ReturnType<typeof setTimeout>
}

let ws: WebSocket | null = null
let pending: Map<string, PendingRequest> = new Map()
let eventHandlers: Map<string, Set<(...args: any[]) => void>> = new Map()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let connectionReady: Promise<void>
let resolveReady: () => void

function resetReadyPromise(): void {
  connectionReady = new Promise(r => { resolveReady = r })
}
resetReadyPromise()

function getWsUrl(): string {
  const host = window.location.hostname || '127.0.0.1'
  const port = window.location.port || '9091'
  return `ws://${host}:${port}`
}

function connect(): void {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return
  resetReadyPromise()

  ws = new WebSocket(getWsUrl())

  ws.onopen = () => {
    console.log('[Remote] Connected to PhotonBoard')
    resolveReady()
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)

      if (msg.type === 'result' && msg.id) {
        // Response to an invoke
        const req = pending.get(msg.id)
        if (req) {
          clearTimeout(req.timer)
          pending.delete(msg.id)
          req.resolve(msg.data)
        }
      } else if (msg.type === 'event') {
        // Server-pushed event
        const handlers = eventHandlers.get(msg.channel)
        if (handlers) {
          for (const h of handlers) h(msg.data)
        }
      }
    } catch { /* ignore parse errors */ }
  }

  ws.onclose = () => {
    console.log('[Remote] Disconnected, reconnecting...')
    scheduleReconnect()
  }

  ws.onerror = () => {
    // onclose will fire after this
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 3000)
}

function on(channel: string, callback: (...args: any[]) => void): () => void {
  if (!eventHandlers.has(channel)) eventHandlers.set(channel, new Set())
  eventHandlers.get(channel)!.add(callback)
  return () => { eventHandlers.get(channel)?.delete(callback) }
}

async function invoke(channel: string, ...args: any[]): Promise<any> {
  await connectionReady
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`[Remote] Timeout: ${channel}`))
    }, 15000)
    pending.set(id, { resolve, reject, timer })
    ws!.send(JSON.stringify({ id, type: 'invoke', channel, args }))
  })
}

function send(channel: string, ...args: any[]): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'send', channel, args }))
  }
}

// ---- Build the same API shape as the Electron preload ----

export function createRemoteAPI() {
  return {
    dmx: {
      setChannel: (universe: number, channel: number, value: number) =>
        send('dmx:set-channel', universe, channel, value),
      setChannels: (universe: number, channels: Record<number, number>) =>
        send('dmx:set-channels', universe, channels),
      getValues: (universe: number): Promise<number[]> =>
        invoke('dmx:get-values', universe),
      blackout: () =>
        send('dmx:blackout')
    },

    artnet: {
      configure: (configs: any[]): Promise<boolean> =>
        invoke('artnet:configure', configs),
      getStatus: (): Promise<any> =>
        invoke('artnet:get-status')
    },

    dmxOutputs: {
      configure: (configs: any[]): Promise<boolean> =>
        invoke('dmx-outputs:configure', configs),
      getStatus: (): Promise<any> =>
        invoke('dmx-outputs:get-status'),
      scanUsb: (): Promise<any[]> =>
        invoke('dmx-outputs:scan-usb')
    },

    show: {
      new: (): Promise<any> =>
        invoke('show:new'),
      save: (show: any): Promise<any> =>
        invoke('show:save', JSON.stringify(show)),
      load: (): Promise<any> =>
        invoke('show:load'),
      saveAs: (show: any): Promise<any> =>
        invoke('show:save-as', JSON.stringify(show)),
      getRecent: (): Promise<string[]> =>
        invoke('show:get-recent'),
      loadLast: (): Promise<any> =>
        invoke('show:load-last'),
      getPath: (): Promise<string | null> =>
        invoke('show:get-path'),
      reveal: (): Promise<boolean> =>
        invoke('show:reveal')
    },

    fixtures: {
      scan: (): Promise<any[]> =>
        invoke('fixtures:scan'),
      getAll: async (): Promise<any[]> => {
        const json = await invoke('fixtures:get-all')
        return JSON.parse(json)
      },
      import: (): Promise<any[] | null> =>
        invoke('fixtures:import'),
      oflSearch: (query: string): Promise<any[]> =>
        invoke('fixtures:ofl-search', query),
      oflDownload: (manufacturerKey: string, fixtureKey: string): Promise<any> =>
        invoke('fixtures:ofl-download', manufacturerKey, fixtureKey),
      save: (fixture: any): Promise<any> =>
        invoke('fixtures:save', JSON.stringify(fixture)),
      delete: (fixtureId: string): Promise<any> =>
        invoke('fixtures:delete', fixtureId)
    },

    onMenuEvent: (_channel: string, _callback: () => void) => {
      // Menu events don't exist in browser — noop
      return () => {}
    },

    app: {
      getVersion: (): Promise<string> =>
        invoke('app:get-version')
    },

    stage: {
      open: () => { /* no stage window in remote mode */ },
      close: () => {},
      sendState: (state: any) => send('api:state', state),
      onCommand: (callback: (command: any) => void) => {
        on('command', callback)
      },
      onRequestState: (_callback: () => void) => {
        // Not needed in remote mode
      }
    },

    api: {
      sendState: (state: any) => send('api:state', state),
      onRequestState: (callback: () => void) => {
        on('request-state', callback)
      }
    }
  }
}

/**
 * Install the remote API as window.photonboard if we're in a browser.
 * Call this before the React app mounts.
 */
export function installRemoteAPI(): boolean {
  if ((window as any).photonboard) {
    // Already have Electron preload — don't override
    return false
  }

  console.log('[Remote] No Electron preload detected — using WebSocket bridge')
  ;(window as any).photonboard = createRemoteAPI()
  connect()
  return true
}
