// ============================================================
// PhotonBoard — Remote (web UI) IPC handlers
// What a browser connected to :9091 may do, with every argument
// validated. Kept free of electron imports so it can be unit-tested.
//
// Show files and the single source of truth:
//   The Pi renderer's in-memory show is the truth. Remote clients
//   never change the Pi's current file / recent list, except:
//   - Save / Save As: main asks the Pi renderer to save ITS state
//     (PiSaveCoordinator, 'save-show' command) to the chosen path;
//   - Upload, and loadByName with {apply:true}: the file becomes the
//     Pi's current show and the Pi renderer adopts it ('apply-show').
// ============================================================

import { existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/types'
import type { DmxEngine } from './dmx-engine'
import type { DmxOutputManager } from './dmx-output-manager'
import type { ShowFileManager } from './show-file'
import type { OFLService } from './ofl-service'
import { isOflKey } from './ofl-service'
import type { PiSaveCoordinator } from './pi-save-coordinator'
import { installCatalogFixture, isCatalogId, sanitizeCatalogQuery, type FixtureCatalog } from './fixture-catalog'
import { MAX_SHOW_FILE_SIZE, checkShowObject, parseShowFileContent, sanitizeShowName } from './show-validation'
import { isWebRemoteCommandType } from '../shared/remote-commands'
import type { ShowFile } from '../shared/types'
import type { ShowLoadResult, ShowSaveResult, RemoteStatus } from '../shared/photonboard-api'
import { mt } from './messages'

export interface RemoteInvokeDeps {
  dmxEngine: DmxEngine
  outputManager: DmxOutputManager
  showManager: ShowFileManager
  oflService: OFLService
  /** Offline fixture catalog; absent: the catalog channels report it as unavailable */
  fixtureCatalog?: FixtureCatalog
  piSave: PiSaveCoordinator
  userDataPath: string
  getVersion: () => string
  getRemoteStatus: () => RemoteStatus
  /** Deliver a channel message to the Pi's main renderer */
  sendToRenderer: (channel: string, ...args: unknown[]) => void
  /**
   * Ask the Pi renderer something and wait for its answer
   * (ConsoleRequestCoordinator). Absent: show:get-current is unavailable.
   */
  requestFromConsole?: (type: string, payload: Record<string, unknown>) => Promise<unknown>
}

/** Thrown for bad input: the message is returned to the client as the error */
export class RemoteInputError extends Error {}

const MAX_FIXTURE_JSON = 2 * 1024 * 1024

function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Shows arrive as an object (current client) or a JSON string (older clients) */
export function parseShowArg(arg: unknown): ShowFile {
  let value: unknown = arg
  if (typeof arg === 'string') {
    if (arg.length > MAX_SHOW_FILE_SIZE) throw new RemoteInputError('Show data is too large')
    try { value = JSON.parse(arg) } catch { throw new RemoteInputError('Show data is not valid JSON') }
  }
  const check = checkShowObject(value)
  if (!check.ok) throw new RemoteInputError(check.error)
  return check.show
}

function optionsArg(arg: unknown): Record<string, unknown> {
  if (arg === undefined || arg === null) return {}
  if (!isPlainObject(arg)) throw new RemoteInputError('Invalid options')
  return arg
}

function universeArg(v: unknown, count: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= count) {
    throw new RemoteInputError(`Universe must be 0-${count - 1}`)
  }
  return v
}

export function createRemoteInvokeHandler(deps: RemoteInvokeDeps) {
  const { dmxEngine, outputManager, showManager, oflService, piSave } = deps

  const existsError = (path: string, name: string): ShowSaveResult => ({
    success: false,
    exists: true,
    path,
    error: mt('showExists', { name })
  })

  async function remoteSave(showArg: unknown, rawOpts: unknown, mode: 'save' | 'save-as'): Promise<ShowSaveResult> {
    const opts = optionsArg(rawOpts)
    // The browser's copy is only used for its name; the Pi saves its own state.
    let showName: unknown
    if (showArg !== undefined && showArg !== null) showName = parseShowArg(showArg).name

    let path: string | null = null
    if (mode === 'save') {
      path = showManager.getCurrentPath()
      if (!path) {
        const name = sanitizeShowName(showName)
        path = showManager.pathForName(name)
        if (existsSync(path)) return existsError(path, name)
      }
    } else {
      const rawName = opts.name !== undefined ? opts.name : showName
      if (rawName !== undefined && typeof rawName !== 'string') throw new RemoteInputError('Invalid show name')
      const name = sanitizeShowName(rawName)
      path = showManager.pathForName(name)
      if (existsSync(path) && opts.overwrite !== true) return existsError(path, name)
    }
    return piSave.request(path)
  }

  async function upload(content: unknown, fileName: unknown, rawOpts: unknown): Promise<ShowLoadResult> {
    const opts = optionsArg(rawOpts)
    if (typeof content !== 'string') throw new RemoteInputError('Invalid file content')
    if (fileName !== undefined && typeof fileName !== 'string') throw new RemoteInputError('Invalid file name')
    const parsed = parseShowFileContent(content)
    if (!parsed.ok) return { success: false, error: parsed.error }
    const name = sanitizeShowName(fileName, 'Uploaded Show')
    const destPath = showManager.pathForName(name)
    if (existsSync(destPath) && opts.overwrite !== true) {
      return { success: false, exists: true, path: destPath, error: mt('showExistsUpload', { name }) }
    }
    // Fixture types the show uses but this console lacks come from the offline catalog
    await showManager.runShowReadHook(parsed.show)
    // Explicit remote action: this becomes the Pi's current show
    const saved = await showManager.saveAs(parsed.show, destPath)
    if (!saved.success) return { success: false, error: saved.error, path: destPath }
    deps.sendToRenderer(IPC.STAGE_COMMAND, { type: 'apply-show', payload: parsed.show })
    console.log(`[Web] Show uploaded: ${name} (${destPath})`)
    return { success: true, show: parsed.show, path: destPath }
  }

  async function loadByName(name: unknown, rawOpts: unknown): Promise<ShowLoadResult> {
    const opts = optionsArg(rawOpts)
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) throw new RemoteInputError('Invalid show name')
    const path = showManager.findShowByName(name)
    if (!path) return { success: false, error: mt('showNotFound', { name: String(name) }) }
    if (opts.apply === true) {
      const result = await showManager.load(path)
      if (result.success && result.show) {
        deps.sendToRenderer(IPC.STAGE_COMMAND, { type: 'apply-show', payload: result.show })
      }
      return result
    }
    return showManager.readWithBackup(path)
  }

  return async function handleInvoke(channel: string, args: unknown[]): Promise<unknown> {
    switch (channel) {
      // DMX
      case IPC.DMX_GET_VALUES:
        return Array.from(dmxEngine.getUniverse(universeArg(args[0], dmxEngine.getUniverseCount())))

      // ArtNet (legacy)
      case IPC.ARTNET_CONFIGURE: {
        const result = await outputManager.configureArtnet(args[0])
        if (!result.success) throw new RemoteInputError(result.error || 'Invalid Art-Net configuration')
        return true
      }
      case IPC.ARTNET_GET_STATUS:
        return outputManager.getArtnetStatus()

      // DMX Outputs — validated strictly by the manager (ports must exist, ranges…)
      case IPC.DMX_OUTPUTS_CONFIGURE:
        return outputManager.configure(args[0])
      case IPC.DMX_OUTPUTS_GET_CONFIG:
        return outputManager.getConfig()
      case IPC.DMX_OUTPUTS_GET_STATUS:
        return outputManager.getStatus()
      case IPC.DMX_OUTPUTS_SCAN_USB:
        return outputManager.scanUsbPorts()

      // Show
      case IPC.SHOW_NEW:
        // Template only: the Pi keeps its current file
        return showManager.newShow({ resetCurrent: false })
      case IPC.SHOW_SAVE:
        return remoteSave(args[0], args[1], 'save')
      case IPC.SHOW_SAVE_AS:
        return remoteSave(args[0], args[1], 'save-as')
      case IPC.SHOW_LOAD:
        return { success: false, error: mt('noFileDialogRemote') } satisfies ShowLoadResult
      case IPC.SHOW_LIST:
        return showManager.listShowNames()
      case IPC.SHOW_LOAD_BY_NAME:
        return loadByName(args[0], args[1])
      case IPC.SHOW_GET_RECENT:
        return showManager.getRecent()
      case IPC.SHOW_LOAD_LAST:
        return showManager.loadLastShow({ readOnly: true })
      case IPC.SHOW_GET_PATH:
        return showManager.getCurrentPath()
      case IPC.SHOW_REVEAL:
        return false // no Finder on the remote side
      case IPC.SHOW_GET_CURRENT: {
        // The show the Pi renderer is running now (unsaved edits included) — never a file
        const opts = optionsArg(args[0])
        const origin = typeof opts.origin === 'string' && opts.origin.length <= 64 ? opts.origin : undefined
        const sections = Array.isArray(opts.sections)
          ? opts.sections.filter((x): x is string => typeof x === 'string' && x.length <= 32).slice(0, 32)
          : undefined
        if (!deps.requestFromConsole) throw new RemoteInputError('The console cannot be reached')
        return deps.requestFromConsole('collect-show-content', { origin, sections })
      }
      case 'remote:upload-show':
        return upload(args[0], args[1], args[2])

      // Fixtures
      case IPC.FIXTURES_SCAN:
        return showManager.scanFixtures(join(deps.userDataPath, 'fixtures'))
      case IPC.FIXTURES_GET_ALL: {
        const result: unknown[] = []
        for (const f of showManager.getAllFixtures()) {
          try { JSON.stringify(f); result.push(f) } catch { /* skip */ }
        }
        return JSON.stringify(result)
      }
      case IPC.FIXTURES_IMPORT:
        return null // dialogs don't work remotely
      case IPC.FIXTURES_OFL_SEARCH:
        if (typeof args[0] !== 'string' || args[0].length > 200) throw new RemoteInputError('Invalid search query')
        return oflService.search(args[0])
      case IPC.FIXTURES_OFL_DOWNLOAD: {
        if (!isOflKey(args[0]) || !isOflKey(args[1])) throw new RemoteInputError('Invalid fixture key')
        const fixture = await oflService.download(args[0], args[1])
        showManager.saveUserFixture(fixture)
        return fixture
      }
      case IPC.FIXTURES_SAVE: {
        let fixture: unknown = args[0]
        if (typeof fixture === 'string') {
          if (fixture.length > MAX_FIXTURE_JSON) throw new RemoteInputError('Fixture data is too large')
          try { fixture = JSON.parse(fixture) } catch { throw new RemoteInputError('Fixture data is not valid JSON') }
        }
        if (!isPlainObject(fixture) || typeof fixture.id !== 'string' || typeof fixture.name !== 'string' || !isPlainObject(fixture.channels)) {
          throw new RemoteInputError('Invalid fixture definition')
        }
        return showManager.saveUserFixture(fixture as any)
      }
      case IPC.FIXTURES_DELETE:
        if (typeof args[0] !== 'string' || args[0].length > 256) throw new RemoteInputError('Invalid fixture ID')
        return showManager.deleteUserFixture(args[0])

      // Offline fixture catalog
      case IPC.FIXTURES_CATALOG_INFO:
        if (!deps.fixtureCatalog) return { available: false, error: 'unavailable', fixtureCount: 0, sources: [], manufacturers: [], categories: [] }
        return deps.fixtureCatalog.info()
      case IPC.FIXTURES_CATALOG_SEARCH: {
        let query
        try { query = sanitizeCatalogQuery(args[0]) } catch (e) { throw new RemoteInputError((e as Error).message) }
        return deps.fixtureCatalog ? deps.fixtureCatalog.search(query) : { total: 0, entries: [] }
      }
      case IPC.FIXTURES_CATALOG_GET:
        if (!isCatalogId(args[0])) throw new RemoteInputError('Invalid fixture ID')
        return deps.fixtureCatalog ? deps.fixtureCatalog.get(args[0]) : null
      case IPC.FIXTURES_CATALOG_INSTALL:
        if (!isCatalogId(args[0])) throw new RemoteInputError('Invalid fixture ID')
        if (!deps.fixtureCatalog) throw new RemoteInputError('The offline fixture library is not available')
        return installCatalogFixture(deps.fixtureCatalog, showManager, args[0])

      // App
      case IPC.APP_GET_VERSION:
        return deps.getVersion()

      // Remote access: status only. Settings (PIN) are never readable/changeable remotely.
      case IPC.REMOTE_GET_STATUS:
        return deps.getRemoteStatus()
      case IPC.REMOTE_GET_SETTINGS:
      case IPC.REMOTE_SET_SETTINGS:
        throw new RemoteInputError('Remote access settings can only be changed on the PhotonBoard console itself')

      default:
        throw new RemoteInputError(`Unknown or forbidden channel: ${String(channel).slice(0, 64)}`)
    }
  }
}

/**
 * Fire-and-forget messages from remote clients. Returns false when rejected.
 */
export function handleRemoteSend(
  deps: Pick<RemoteInvokeDeps, 'sendToRenderer'>,
  channel: string,
  args: unknown[],
  /** Set by the web server for each connection: lets the console release what a client holds */
  clientId?: string
): boolean {
  switch (channel) {
    // Raw DMX writes (dmx:set-channel(s), dmx:blackout) are NOT accepted from
    // remote clients: they would bypass the console's mixer (and the mixer only
    // re-sends changed channels, so a raw blackout would stick on pan/tilt…).
    case IPC.STAGE_COMMAND: {
      const command = args[0]
      if (!isPlainObject(command) || !isWebRemoteCommandType(command.type)) {
        console.warn('[Web] Rejected command:', isPlainObject(command) ? String(command.type).slice(0, 64) : typeof command)
        return false
      }
      // Rebuilt: a client can never inject its own clientId
      const relayed: { type: string; payload: unknown; clientId?: string } = { type: command.type, payload: command.payload }
      if (clientId) relayed.clientId = clientId
      deps.sendToRenderer(IPC.STAGE_COMMAND, relayed)
      return true
    }
    case IPC.API_STATE:
      // Remote clients never push state to the Pi
      return true
    default:
      return false
  }
}
