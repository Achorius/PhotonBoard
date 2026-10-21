// ============================================================
// PhotonBoard — Remote API Client
// When running in a browser (no Electron), this replaces the
// preload IPC bridge with a WebSocket connection to the Pi.
// Same interface as window.photonboard (PhotonBoardAPI) — transparent to the app.
//
// Access PIN: taken from `?pin=` in the page URL (then remembered in
// localStorage) and sent on the WebSocket URL. When the Pi refuses it
// (close code 4401) we dispatch `photonboard:auth-required` on window and
// stop reconnecting until window.photonboard.remote.authenticate(pin).
// ============================================================

import type {
  PhotonBoardAPI,
  RemoteConnectionState,
  ShowLoadResult,
  ShowSaveResult
} from '../../shared/photonboard-api'

type PendingRequest = {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: ReturnType<typeof setTimeout>
}

/** Close code the Pi uses for a missing/wrong PIN */
const WS_CLOSE_AUTH_FAILED = 4401
const PIN_STORAGE_KEY = 'photonboard.remotePin'
const DEFAULT_TIMEOUT_MS = 15_000
/** Saves wait for the Pi renderer to answer, uploads carry a whole show */
const SLOW_TIMEOUT_MS = 45_000
const CONNECT_WAIT_MS = 20_000
const RECONNECT_DELAYS_MS = [1000, 2000, 3000, 5000]

let ws: WebSocket | null = null
const pending: Map<string, PendingRequest> = new Map()
const eventHandlers: Map<string, Set<(...args: any[]) => void>> = new Map()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0

// State listeners for remote sync (Pi → Mac)
const stateListeners: Set<(data: any) => void> = new Set()

// Connection state
let connectionState: RemoteConnectionState = 'connecting'
const connectionListeners: Set<(state: RemoteConnectionState) => void> = new Set()
/** True after a 4401: no auto-reconnect until authenticate() */
let authBlocked = false
let pin: string | null = null

// Connection waiters — resolved when the Pi admits us ('ready'), rejected on auth failure
let connectionWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
// authenticate() callers waiting for the outcome
let authWaiters: ((ok: boolean) => void)[] = []

// ---- PIN storage (localStorage can throw: private mode, disabled storage) ----

function loadStoredPin(): string | null {
  try { return window.localStorage.getItem(PIN_STORAGE_KEY) } catch { return null }
}

function storePin(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(PIN_STORAGE_KEY, value)
    else window.localStorage.removeItem(PIN_STORAGE_KEY)
  } catch { /* ignore */ }
}

/** `?pin=` in the page URL wins over the stored one; it is then removed from the address bar */
function initPin(): void {
  try {
    const url = new URL(window.location.href)
    const fromUrl = url.searchParams.get('pin')
    if (fromUrl) {
      pin = fromUrl
      storePin(fromUrl)
      url.searchParams.delete('pin')
      window.history.replaceState(window.history.state, '', url.toString())
      return
    }
  } catch { /* ignore */ }
  pin = loadStoredPin()
}

// ---- Connection state ----

function setConnectionState(next: RemoteConnectionState): void {
  if (connectionState === next) return
  connectionState = next
  for (const cb of connectionListeners) {
    try { cb(next) } catch (e) { console.error('[Remote] connection listener failed:', e) }
  }
}

function resolveAllWaiters(): void {
  const waiters = connectionWaiters
  connectionWaiters = []
  for (const w of waiters) w.resolve()
  const auth = authWaiters
  authWaiters = []
  for (const a of auth) a(true)
}

function rejectAllWaiters(error: Error): void {
  const waiters = connectionWaiters
  connectionWaiters = []
  for (const w of waiters) w.reject(error)
}

function rejectAllPending(error: Error): void {
  for (const [id, req] of pending) {
    clearTimeout(req.timer)
    req.reject(error)
    pending.delete(id)
  }
}

function waitForConnection(): Promise<void> {
  if (connectionState === 'open' && ws?.readyState === WebSocket.OPEN) return Promise.resolve()
  if (connectionState === 'auth-required') return Promise.reject(new Error('PhotonBoard requires a PIN'))
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: () => { clearTimeout(timer); resolve() },
      reject: (e: Error) => { clearTimeout(timer); reject(e) }
    }
    const timer = setTimeout(() => {
      connectionWaiters = connectionWaiters.filter(w => w !== waiter)
      reject(new Error('Not connected to PhotonBoard'))
    }, CONNECT_WAIT_MS)
    connectionWaiters.push(waiter)
  })
}

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.hostname || '127.0.0.1'
  const port = window.location.port || '9091'
  const query = pin ? `/?pin=${encodeURIComponent(pin)}` : '/'
  return `${protocol}://${host.includes(':') ? `[${host}]` : host}:${port}${query}`
}

function enterAuthRequired(reason: string): void {
  authBlocked = true
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  setConnectionState('auth-required')
  const error = new Error('PhotonBoard requires a PIN')
  rejectAllWaiters(error)
  rejectAllPending(error)
  const auth = authWaiters
  authWaiters = []
  for (const a of auth) a(false)
  try {
    window.dispatchEvent(new CustomEvent('photonboard:auth-required', { detail: { reason } }))
  } catch { /* very old browser */ }
}

function connect(): void {
  if (authBlocked) return
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return

  setConnectionState('connecting')
  let socket: WebSocket
  try {
    socket = new WebSocket(getWsUrl())
  } catch (e) {
    console.error('[Remote] Cannot open WebSocket:', e)
    setConnectionState('closed')
    scheduleReconnect()
    return
  }
  ws = socket

  socket.onopen = () => {
    console.log('[Remote] Connected to PhotonBoard')
    // Wait for { type: 'ready' } (sent once the PIN, if any, is accepted)
  }

  socket.onmessage = (event) => {
    if (ws !== socket) return
    let msg: any
    try {
      msg = JSON.parse(event.data)
    } catch {
      return // ignore parse errors
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'ready') {
      reconnectAttempt = 0
      setConnectionState('open')
      resolveAllWaiters()
    } else if (msg.type === 'auth-required') {
      if (pin) {
        socket.send(JSON.stringify({ type: 'auth', pin }))
      } else {
        enterAuthRequired('PIN required')
        socket.close(1000)
      }
    } else if (msg.type === 'result' && msg.id) {
      // Response to an invoke
      const req = pending.get(msg.id)
      if (req) {
        clearTimeout(req.timer)
        pending.delete(msg.id)
        if (typeof msg.error === 'string') req.reject(new Error(msg.error))
        else req.resolve(msg.data)
      }
    } else if (msg.type === 'event') {
      // Server-pushed event
      if (msg.channel === 'state') {
        // Notify all state listeners (for remote sync)
        for (const cb of stateListeners) {
          try { cb(msg.data) } catch (e) { console.error('[Remote] state listener failed:', e) }
        }
      }
      const handlers = eventHandlers.get(msg.channel)
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.data) } catch (e) { console.error('[Remote] event handler failed:', e) }
        }
      }
    }
  }

  socket.onclose = (event) => {
    if (ws !== socket) return
    ws = null
    if (event.code === WS_CLOSE_AUTH_FAILED) {
      console.warn('[Remote] PIN refused:', event.reason)
      enterAuthRequired(event.reason || 'PIN required')
      return
    }
    if (authBlocked) return
    console.log('[Remote] Disconnected, reconnecting...')
    setConnectionState('closed')
    rejectAllPending(new Error('Connection to PhotonBoard lost'))
    scheduleReconnect()
  }

  socket.onerror = () => {
    // onclose will fire after this
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer || authBlocked) return
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]
  reconnectAttempt++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

/** Retry with a (new) PIN. Resolves true once the Pi admits us, false if refused. */
function authenticate(newPin: string): Promise<boolean> {
  pin = typeof newPin === 'string' && newPin.trim() ? newPin.trim() : null
  storePin(pin)
  authBlocked = false
  reconnectAttempt = 0
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  const result = new Promise<boolean>((resolve) => { authWaiters.push(resolve) })
  const old = ws
  ws = null
  if (old) {
    old.onclose = null
    try { old.close(1000) } catch { /* ignore */ }
  }
  connect()
  return result
}

function on(channel: string, callback: (...args: any[]) => void): () => void {
  if (!eventHandlers.has(channel)) eventHandlers.set(channel, new Set())
  eventHandlers.get(channel)!.add(callback)
  return () => { eventHandlers.get(channel)?.delete(callback) }
}

async function invokeWithTimeout(timeoutMs: number, channel: string, ...args: any[]): Promise<any> {
  await waitForConnection()
  return new Promise((resolve, reject) => {
    const socket = ws
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to PhotonBoard'))
      return
    }
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`[Remote] Timeout: ${channel}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      socket.send(JSON.stringify({ id, type: 'invoke', channel, args }))
    } catch (e) {
      clearTimeout(timer)
      pending.delete(id)
      reject(e)
    }
  })
}

function invoke(channel: string, ...args: any[]): Promise<any> {
  return invokeWithTimeout(DEFAULT_TIMEOUT_MS, channel, ...args)
}

function send(channel: string, ...args: any[]): void {
  if (ws?.readyState === WebSocket.OPEN && connectionState === 'open') {
    ws.send(JSON.stringify({ type: 'send', channel, args }))
  }
}

/**
 * Send a high-level command to the Pi's renderer.
 * Same protocol as stage window commands (go-cuelist, stop-cuelist, etc.)
 */
function sendCommand(type: string, payload?: unknown): void {
  send('stage:command', { type, payload })
}

const remoteOnly = (): Promise<never> =>
  Promise.reject(new Error('Remote access settings can only be changed on the PhotonBoard console itself'))

// ---- Build the same API shape as the Electron preload ----

export function createRemoteAPI(): PhotonBoardAPI {
  return {
    // Raw DMX writes would bypass the console's mixer: a remote never sends
    // them (programmer / masters go through commands)
    dmx: {
      setChannel: () => {},
      setChannels: () => {},
      getValues: (universe) =>
        invoke('dmx:get-values', universe),
      blackout: () => {}
    },

    artnet: {
      configure: (configs) =>
        invoke('artnet:configure', configs),
      getStatus: () =>
        invoke('artnet:get-status')
    },

    dmxOutputs: {
      getConfig: () =>
        invoke('dmx-outputs:get-config'),
      configure: (config) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'dmx-outputs:configure', config),
      getStatus: () =>
        invoke('dmx-outputs:get-status'),
      scanUsb: () =>
        invoke('dmx-outputs:scan-usb')
    },

    show: {
      new: () =>
        invoke('show:new'),
      // The Pi saves ITS OWN show (single source of truth); our copy only supplies the name
      save: (show, opts): Promise<ShowSaveResult> =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'show:save', show, opts ?? {}),
      saveAs: (show, opts): Promise<ShowSaveResult> =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'show:save-as', show, opts ?? {}),
      load: (): Promise<ShowLoadResult> =>
        invoke('show:load'),
      list: () =>
        invoke('show:list'),
      loadByName: (name, opts) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'show:load-by-name', name, opts ?? {}),
      getRecent: () =>
        invoke('show:get-recent'),
      loadLast: () =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'show:load-last'),
      getPath: () =>
        invoke('show:get-path'),
      reveal: () =>
        invoke('show:reveal'),
      /** Upload a .pbshow file from the browser to the Pi (the Pi adopts it) */
      upload: (content, filename, opts) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'remote:upload-show', content, filename, opts ?? {}),
      /** The console's current (possibly unsaved) show, or some sections of it */
      getCurrent: (opts) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'show:get-current', opts ?? {})
    },

    fixtures: {
      scan: () =>
        invoke('fixtures:scan'),
      getAll: async () => {
        const json = await invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:get-all')
        return JSON.parse(json)
      },
      import: () =>
        invoke('fixtures:import'),
      oflSearch: (query) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:ofl-search', query),
      oflDownload: (manufacturerKey, fixtureKey) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:ofl-download', manufacturerKey, fixtureKey),
      save: (fixture) =>
        invoke('fixtures:save', fixture),
      delete: (fixtureId) =>
        invoke('fixtures:delete', fixtureId),
      // Offline fixture catalog on the console (no internet needed on either side)
      catalogInfo: () =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:catalog-info'),
      catalogSearch: (query) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:catalog-search', query),
      catalogGet: (id) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:catalog-get', id),
      catalogInstall: (id) =>
        invokeWithTimeout(SLOW_TIMEOUT_MS, 'fixtures:catalog-install', id)
    },

    onMenuEvent: () => {
      // Menu events don't exist in browser — noop
      return () => {}
    },

    app: {
      getVersion: () =>
        invoke('app:get-version'),
      quit: () => { /* the remote UI never quits the Pi */ }
    },

    // USB sticks of the Pi: list and eject (open / save copy happen on the console)
    removable: {
      list: (refresh) =>
        invoke('removable:list', !!refresh),
      onChange: () => () => { /* the remote lists on demand */ },
      importShow: async () => ({ success: false, error: 'Open the show from the USB stick on the console' }),
      browse: async () => ({ success: false, error: 'Open the show from the USB stick on the console' }),
      saveCopy: async () => ({ success: false, error: 'Save to the USB stick on the console' }),
      eject: (drivePath) =>
        invoke('removable:eject', drivePath)
    },

    stage: {
      open: () => { /* no stage window in remote mode */ },
      close: () => {},
      sendState: () => { /* remote clients never push state to the Pi */ },
      onCommand: (callback) => on('command', callback),
      onRequestState: () => () => { /* not needed in remote mode */ }
    },

    api: {
      sendState: () => { /* remote clients never push state to the Pi */ },
      onRequestState: (callback) => on('request-state', () => callback())
    },

    // ---- Remote-specific extensions ----
    remote: {
      /** True when running in remote/browser mode */
      isRemote: true,
      getSettings: remoteOnly,
      setSettings: remoteOnly,
      getStatus: () =>
        invoke('remote:get-status'),
      /** Send a command to the Pi's renderer (go-cuelist, stop-cuelist, etc.) */
      sendCommand,
      /** Register a listener for Pi state broadcasts */
      onState: (callback) => {
        stateListeners.add(callback)
        return () => { stateListeners.delete(callback) }
      },
      authenticate,
      onConnectionChange: (callback) => {
        connectionListeners.add(callback)
        try { callback(connectionState) } catch (e) { console.error('[Remote] connection listener failed:', e) }
        return () => { connectionListeners.delete(callback) }
      },
      getConnectionState: () => connectionState,
      replyToMain: () => { /* console only */ }
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
  initPin()
  ;(window as any).photonboard = createRemoteAPI()
  connect()
  return true
}
