// ============================================================
// PhotonBoard — window.photonboard contract
// Implemented twice: by the Electron preload (src/preload/index.ts)
// and by the browser WebSocket bridge (src/renderer/lib/remote-api.ts).
// Both must stay assignable to this interface.
// ============================================================

import type {
  ArtNetConfig,
  DmxOutputConfig,
  DmxOutputsConfig,
  DmxOutputsStatus,
  FixtureCatalogInfo,
  FixtureCatalogQuery,
  FixtureCatalogSearchResult,
  FixtureDefinition,
  OFLSearchResult,
  SerialPortInfo,
  ShowFile
} from './types'
import type { CurrentShowContent } from './remote-commands'

/** Every `on*` listener returns this; call it to remove the listener. */
export type Unsubscribe = () => void

/**
 * Result of every show load (dialog, by name, last show, upload).
 * - success:false + canceled:true  → the user closed the dialog (not an error)
 * - success:false + error          → human-readable reason (unreadable, invalid JSON, not a show…)
 * - success:false, no error        → loadLast only: there is no show to load (first run)
 * - success:true + warning         → loaded, but something deserves attention
 *                                     (e.g. recovered from the .bak backup)
 */
export interface ShowLoadResult {
  success: boolean
  show?: ShowFile
  path?: string
  error?: string
  warning?: string
  canceled?: boolean
}

/**
 * Result of every show save.
 * - success:false + canceled:true → dialog closed
 * - success:false + exists:true   → remote Save As refused to overwrite (retry with overwrite:true)
 */
export interface ShowSaveResult {
  success: boolean
  path?: string
  error?: string
  canceled?: boolean
  exists?: boolean
}

export interface ShowSaveOptions {
  /** Answer to a main → renderer 'save-show' command (see INTERNAL_COMMANDS) */
  requestId?: string
}

export interface ShowSaveAsOptions {
  /** Remote only: file name (without extension) to save under in the shows folder */
  name?: string
  /** Remote only: allow replacing an existing show of the same name */
  overwrite?: boolean
}

export interface ShowLoadByNameOptions {
  /**
   * Remote only: also make the Pi load this show (sets its current file and
   * relays 'apply-show' to the Pi renderer). Without it the load is read-only.
   */
  apply?: boolean
}

export interface ShowUploadOptions {
  overwrite?: boolean
}

export interface DmxOutputsConfigureResult {
  success: boolean
  /** Validation failure (nothing was changed) */
  error?: string
  /** Applied, but something deserves attention (e.g. outputs.json could not be written) */
  warning?: string
  /** The config now in effect (ids assigned, defaults filled in) */
  config?: DmxOutputsConfig
}

/** Machine remote-access settings (<userData>/config/remote.json) */
export interface RemoteSettings {
  pinEnabled: boolean
  pin: string
}

export interface RemoteSettingsResult {
  success: boolean
  error?: string
  settings?: RemoteSettings
}

export interface RemoteServerStatus {
  port: number
  listening: boolean
  error?: string
  clients: number
}

export interface RemoteStatus {
  web: RemoteServerStatus
  api: RemoteServerStatus
  addresses: string[]
}

export type RemoteConnectionState = 'connecting' | 'open' | 'closed' | 'auth-required'

export interface FixtureImportResult {
  success: boolean
  fixture?: FixtureDefinition
  error?: string
}

export interface SimpleResult {
  success: boolean
  error?: string
}

export interface PhotonBoardAPI {
  dmx: {
    setChannel(universe: number, channel: number, value: number): void
    setChannels(universe: number, channels: Record<number, number>): void
    getValues(universe: number): Promise<number[]>
    blackout(): void
  }

  /** Legacy: replaces ONLY the Art-Net part of the machine output config (persists). */
  artnet: {
    configure(configs: ArtNetConfig[]): Promise<boolean>
    getStatus(): Promise<{ connected: boolean; senders: { universe: number; host: string }[] }>
  }

  dmxOutputs: {
    /** Machine output config (Art-Net + USB lists) as persisted by main */
    getConfig(): Promise<DmxOutputsConfig>
    /**
     * Full replacement of both lists; validated strictly and persisted.
     * A legacy DmxOutputConfig[] is still accepted: it replaces the USB list, and
     * the Art-Net list only when it contains Art-Net entries.
     */
    configure(config: DmxOutputsConfig | DmxOutputConfig[]): Promise<DmxOutputsConfigureResult>
    getStatus(): Promise<DmxOutputsStatus>
    scanUsb(): Promise<SerialPortInfo[]>
  }

  show: {
    // property syntax: `new(): …` would declare a construct signature
    new: () => Promise<ShowFile>
    save(show: ShowFile, opts?: ShowSaveOptions): Promise<ShowSaveResult>
    saveAs(show: ShowFile, opts?: ShowSaveAsOptions): Promise<ShowSaveResult>
    /** Electron: open dialog. Remote: unsupported (use list() + loadByName()). */
    load(): Promise<ShowLoadResult>
    /** Show names (without extension) available in the shows folder(s) */
    list(): Promise<string[]>
    loadByName(name: string, opts?: ShowLoadByNameOptions): Promise<ShowLoadResult>
    getRecent(): Promise<string[]>
    loadLast(): Promise<ShowLoadResult>
    getPath(): Promise<string | null>
    reveal(): Promise<boolean>
    /** Remote only: upload a .pbshow from the browser; the Pi adopts it. */
    upload(content: string, filename: string, opts?: ShowUploadOptions): Promise<ShowLoadResult>
    /**
     * Remote only: the show the console is running RIGHT NOW (unsaved edits
     * included), or some sections of it. Electron: unsupported.
     */
    getCurrent(opts?: { origin?: string; sections?: string[] }): Promise<CurrentShowContent>
  }

  fixtures: {
    scan(): Promise<FixtureDefinition[]>
    getAll(): Promise<FixtureDefinition[]>
    import(): Promise<FixtureImportResult[] | null>
    oflSearch(query: string): Promise<OFLSearchResult[]>
    oflDownload(manufacturerKey: string, fixtureKey: string): Promise<FixtureDefinition>
    save(fixture: FixtureDefinition): Promise<SimpleResult>
    delete(fixtureId: string): Promise<SimpleResult>
    /**
     * Offline fixture catalog (Open Fixture Library + QLC+, shipped with the app,
     * no network): sources / licenses, counts, manufacturers, categories.
     */
    catalogInfo(): Promise<FixtureCatalogInfo>
    /** Search / browse the offline catalog (paged; `total` = all matches) */
    catalogSearch(query: FixtureCatalogQuery): Promise<FixtureCatalogSearchResult>
    /** Full definition of a catalog fixture, for preview — NOT added to the library. Null when unknown. */
    catalogGet(id: string): Promise<FixtureDefinition | null>
    /**
     * Copy a catalog fixture into the user library (like an OFL download) and
     * return it. Idempotent: an already installed definition is returned unchanged.
     */
    catalogInstall(id: string): Promise<FixtureDefinition>
  }

  /** Replaces (not accumulates) the handler for a menu channel */
  onMenuEvent(channel: string, callback: () => void): Unsubscribe

  app: {
    getVersion(): Promise<string>
    /** Quit the application (no-op in remote mode) */
    quit(): void
    /** UI language of the console ('fr' | 'en'): main localises its native menus. Optional (older bridges, remote). */
    setLanguage?(locale: string): void
  }

  stage: {
    open(): void
    close(): void
    sendState(state: unknown): void
    onCommand(callback: (command: { type: string; payload?: any }) => void): Unsubscribe
    onRequestState(callback: () => void): Unsubscribe
  }

  api: {
    sendState(state: unknown): void
    onRequestState(callback: () => void): Unsubscribe
  }

  remote: {
    /** True when running in a browser through the WebSocket bridge */
    isRemote: boolean
    /** Electron only — rejects in remote mode */
    getSettings(): Promise<RemoteSettings>
    /** Electron only — rejects in remote mode. Changing the PIN disconnects remote clients. */
    setSettings(settings: RemoteSettings): Promise<RemoteSettingsResult>
    /** Server health (ports, listening/errors, client counts, LAN addresses) */
    getStatus(): Promise<RemoteStatus>
    /** Remote only: send a command to the Pi renderer (no-op in Electron) */
    sendCommand(type: string, payload?: unknown): void
    /** Remote only: Pi state broadcasts (never fires in Electron) */
    onState(callback: (data: any) => void): Unsubscribe
    /** Remote only: retry the connection with this PIN; resolves true once accepted */
    authenticate(pin: string): Promise<boolean>
    /** Calls back immediately with the current state, then on every change */
    onConnectionChange(callback: (state: RemoteConnectionState) => void): Unsubscribe
    getConnectionState(): RemoteConnectionState
    /** Console only: answer a main → renderer request (collect-show-content, busy save) */
    replyToMain(requestId: string, data: unknown): void
  }
}
