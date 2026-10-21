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
import type { ImportOptions, ImportResult, ImportWarning, InterchangeFormatInfo } from './interchange'

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
  /** Remote upload refused: a show with that name exists (retry with overwrite:true) */
  exists?: boolean
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

/** A game controller as the operating system sees it (Linux diagnostics) */
export interface SystemGameController {
  name: string
  /** joydev node (js0…) — what Chromium reads gamepads from on Linux; null = none */
  js: string | null
  /** evdev node (event5…) */
  event: string | null
  jsReadable: boolean
  eventReadable: boolean
}

export interface GameControllerDiagnostics {
  /** false = no diagnostics on this system (not Linux) */
  supported: boolean
  controllers: SystemGameController[]
  /** joydev kernel module present (null = unknown) */
  joydev: boolean | null
}

/** A show file on a USB stick */
export interface RemovableShow {
  /** File name without .pbshow */
  name: string
  path: string
  /** Path relative to the drive ("Show.pbshow", "Shows/Show.pbshow") */
  relPath: string
  modifiedAt: number
}

/** A mounted USB stick / removable drive */
export interface RemovableDrive {
  /** Volume label (mount folder name) */
  name: string
  /** Mount point */
  path: string
  /** .pbshow files, top level and one folder deep, newest first */
  shows: RemovableShow[]
  canEject: boolean
}

/** Hardware-strobe-less intensity channels chopped by the output engine (per universe) */
export interface StrobeChop {
  /** Flash rate in Hz */
  rate: number
  /** universe → channels (0-511) set to 0 during the dark half-periods */
  channels: Record<number, number[]>
}

/** Formats the console reads / writes (interchange) */
export interface InterchangeFormatList {
  importers: InterchangeFormatInfo[]
  exporters: InterchangeFormatInfo[]
  /** Closed formats recognised (the wizard explains how to export them) */
  recognised: { key: string; app: string; extensions: string[] }[]
}

/** An import result with the file it came from (re-run with options: CSV column mapping) */
export type InterchangeImportResult = ImportResult & { fileName?: string; path?: string }

export interface InterchangeImportRequest {
  /** Electron: import this file; omitted = open dialog */
  path?: string
  /** Open dialog: start in this folder (a USB stick) */
  startDir?: string
  format?: string
  options?: ImportOptions
}

export interface InterchangeExportRequest {
  format: string
  show: ShowFile
  /** Definitions of every fixture type the show uses */
  fixtures: FixtureDefinition[]
}

export interface InterchangeExportResult {
  success: boolean
  canceled?: boolean
  error?: string
  errorCode?: string
  /** Electron: where the file was written */
  path?: string
  /** Remote: suggested file name and content (base64) for the browser download */
  fileName?: string
  data?: string
  warnings?: ImportWarning[]
}

export interface PhotonBoardAPI {
  dmx: {
    setChannel(universe: number, channel: number, value: number): void
    setChannels(universe: number, channels: Record<number, number>): void
    getValues(universe: number): Promise<number[]>
    blackout(): void
    /**
     * Strobe chop done by the output engine, in step with its frames (even
     * flashes): null = off. Optional (remote bridge: the console renders).
     */
    setStrobeChop?(chop: StrobeChop | null): void
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
    /** Game controllers the OS sees (Follow panel diagnostics). Optional (remote, older bridges). */
    gameControllers?(): Promise<GameControllerDiagnostics>
  }

  /**
   * USB sticks (console only; the web remote can list and eject). Optional:
   * older bridges / systems without removable drives support.
   */
  removable?: {
    /** Mounted drives with their shows; `refresh` rescans the shows */
    list(refresh?: boolean): Promise<RemovableDrive[]>
    /** Drives plugged / removed / their shows changed */
    onChange(callback: (drives: RemovableDrive[]) => void): Unsubscribe
    /**
     * Copy a show from a stick into the shows folder and open it (the stick
     * can then be removed). `exists` when a show of that name is there and
     * `overwrite` is not set.
     */
    importShow(path: string, opts?: { overwrite?: boolean }): Promise<ShowLoadResult>
    /** The open dialog, starting on the stick; the chosen show is imported */
    browse(drivePath?: string): Promise<ShowLoadResult>
    /** Write a copy of a show to a stick (never changes the current file) */
    saveCopy(drivePath: string, show: ShowFile, opts?: { overwrite?: boolean }): Promise<ShowSaveResult>
    /** Flush and unmount: the stick can be pulled out */
    eject(drivePath: string): Promise<SimpleResult>
  }

  /**
   * Import / export of other software's files (MVR, GDTF, QLC+, grandMA XML,
   * USITT ASCII, CSV, .pbshow…). Optional: older bridges.
   */
  interchange?: {
    formats(): Promise<InterchangeFormatList>
    /** Electron: import `path`, or ask with the open dialog. Remote: unsupported (use importData). */
    importFile(req?: InterchangeImportRequest): Promise<InterchangeImportResult>
    /** Import file bytes read by the UI (browser upload / drop) */
    importData(fileName: string, data: Uint8Array, opts?: { format?: string; options?: ImportOptions }): Promise<InterchangeImportResult>
    /** Electron: save dialog + write. Remote: returns the bytes for a browser download. */
    exportShow(req: InterchangeExportRequest): Promise<InterchangeExportResult>
    /** Electron only: path of a dropped file (null when unknown) */
    pathForFile?(file: File): string | null
    /** Largest file importData accepts on this bridge (bytes) */
    maxDataSize: number
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
