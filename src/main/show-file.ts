import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, promises as fsp } from 'fs'
import { join, basename, resolve, dirname, sep } from 'path'
import { homedir } from 'os'
import type { ShowFile, FixtureDefinition } from '../shared/types'
import type { ShowLoadResult, ShowSaveResult } from '../shared/photonboard-api'
import { DEFAULT_ROOM_CONFIG } from '../shared/types'
import { SHOW_FORMAT_VERSION } from '../shared/show-format'
import { BUILTIN_FIXTURES } from './fixture-library'
import { parseFixtureFile } from './fixture-parsers'
import { atomicWriteFile, atomicWriteFileSync, backupPathFor, isJsonContent } from './atomic-write'
import { loadJsonConfig } from './config-store'
import { Mutex } from './async-mutex'
import {
  MAX_SHOW_FILE_SIZE,
  SHOW_EXTENSION,
  checkShowObject,
  describeReadError,
  parseShowFileContent,
  sanitizeShowName
} from './show-validation'

const MAX_RECENT = 10

/**
 * Show file I/O. Main does robust I/O only (atomic writes with a .bak of the
 * previous version, readable error messages); schema normalisation/migration
 * is done by the renderer (src/shared/show-format.ts).
 *
 * `currentFilePath` is the show the Pi renderer is running. It only changes on
 * a successful load/save — remote read-only operations never touch it.
 */
export class ShowFileManager {
  private userDataPath: string
  private documentsShowsPath: string
  private currentFilePath: string | null = null
  private recentFiles: string[] = []
  private fixtureCache: Map<string, FixtureDefinition> = new Map()
  private saveLock = new Mutex()

  constructor(userDataPath: string, opts: { documentsShowsPath?: string } = {}) {
    this.userDataPath = userDataPath
    this.documentsShowsPath = opts.documentsShowsPath ?? join(homedir(), 'Documents', 'PhotonBoard')
    this.ensureDirectories()
    this.loadRecentFiles()
    this.loadBuiltinFixtures()
  }

  private ensureDirectories(): void {
    const dirs = [
      join(this.userDataPath, 'fixtures'),
      join(this.userDataPath, 'config'),
      this.documentsShowsPath
    ]
    for (const dir of dirs) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch (e) {
        // A read-only Documents folder must not prevent the console from starting
        console.error(`[Show] Cannot create ${dir}:`, (e as Error).message)
      }
    }
  }

  getDefaultShowsDir(): string {
    return this.documentsShowsPath
  }

  private showDirs(): string[] {
    return [this.documentsShowsPath, join(this.userDataPath, 'shows')]
  }

  /** All available .pbshow files (for remote UI without file dialogs), by name */
  listShows(): { name: string; path: string; modifiedAt: number }[] {
    const byName = new Map<string, { name: string; path: string; modifiedAt: number }>()
    for (const dir of this.showDirs()) {
      if (!existsSync(dir)) continue
      try {
        const files = readdirSync(dir).filter(f => f.endsWith(SHOW_EXTENSION) && !f.startsWith('.'))
        for (const file of files) {
          const name = basename(file, SHOW_EXTENSION)
          if (byName.has(name)) continue // Documents/PhotonBoard wins over userData/shows
          const path = join(dir, file)
          let modifiedAt = 0
          try { modifiedAt = statSync(path).mtimeMs } catch { /* vanished */ }
          byName.set(name, { name, path, modifiedAt })
        }
      } catch { /* skip unreadable dir */ }
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  listShowNames(): string[] {
    return this.listShows().map(s => s.name)
  }

  /** Resolve a show name from listShowNames() to its path (never builds a path from input) */
  findShowByName(name: unknown): string | null {
    if (typeof name !== 'string' || !name) return null
    return this.listShows().find(s => s.name === name)?.path ?? null
  }

  /** Path for a (sanitised) show name in the default shows folder */
  pathForName(name: unknown): string {
    const dir = resolve(this.documentsShowsPath)
    const path = resolve(join(dir, `${sanitizeShowName(name)}${SHOW_EXTENSION}`))
    if (!path.startsWith(dir + sep)) throw new Error('Invalid show name')
    return path
  }

  // ---- Loading ----

  /** Read and validate a show file. Never changes the current file / recent list. */
  async readShow(filePath: string): Promise<ShowLoadResult> {
    try {
      const st = await fsp.stat(filePath)
      if (!st.isFile()) return { success: false, error: describeReadError({ code: 'EISDIR' }), path: filePath }
      if (st.size > MAX_SHOW_FILE_SIZE) {
        return { success: false, error: `This show file is too large (${(st.size / 1024 / 1024).toFixed(1)} MB).`, path: filePath }
      }
      const text = await fsp.readFile(filePath, 'utf-8')
      const parsed = parseShowFileContent(text)
      if (!parsed.ok) return { success: false, error: parsed.error, path: filePath }
      return { success: true, show: parsed.show, path: filePath }
    } catch (e) {
      return { success: false, error: describeReadError(e), path: filePath }
    }
  }

  /**
   * Read a show, falling back to its .bak if the file itself is unreadable.
   * The result's `path` is always the original file.
   */
  async readWithBackup(filePath: string): Promise<ShowLoadResult> {
    const result = await this.readShow(filePath)
    if (result.success) return result
    const backup = await this.readShow(backupPathFor(filePath))
    if (backup.success) {
      const name = basename(filePath, SHOW_EXTENSION)
      console.warn(`[Show] ${filePath}: ${result.error} — loaded the backup copy`)
      return {
        success: true,
        show: backup.show,
        path: filePath,
        warning: `"${name}" could not be read: ${result.error} The previous version was restored from the backup copy — save the show to repair the file.`
      }
    }
    return result
  }

  /** Load a show and make it the current one (only on success) */
  async load(filePath: string): Promise<ShowLoadResult> {
    const result = await this.readWithBackup(filePath)
    if (result.success) {
      this.currentFilePath = filePath
      this.addToRecent(filePath)
    }
    return result
  }

  /**
   * The show to open at startup: the most recent one. If it is corrupt or
   * missing we try its backup and otherwise REPORT the problem — never silently
   * open an older show (the operator would run the wrong show).
   * `readOnly` (remote clients): prefer the Pi's current file, change nothing.
   */
  async loadLastShow(opts: { readOnly?: boolean } = {}): Promise<ShowLoadResult> {
    let candidate: string | null = null
    if (opts.readOnly && this.currentFilePath) candidate = this.currentFilePath
    if (!candidate) candidate = this.recentFiles[0] ?? null
    if (!candidate) {
      // No history (first run, or recent.json lost): newest show in the shows folders
      const newest = this.listShows().sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
      candidate = newest?.path ?? null
    }
    if (!candidate) {
      console.log('[Show] No existing show found to auto-load')
      return { success: false }
    }

    const result = await this.readWithBackup(candidate)
    if (!result.success) {
      const name = basename(candidate, SHOW_EXTENSION)
      console.error(`[Show] Last show ${candidate} could not be opened: ${result.error}`)
      return { success: false, error: `The last show "${name}" could not be opened: ${result.error}`, path: candidate }
    }
    if (!opts.readOnly) {
      this.currentFilePath = candidate
      this.addToRecent(candidate)
    }
    console.log('[Show] Last show:', candidate, opts.readOnly ? '(read-only)' : '')
    return result
  }

  // ---- Recent files ----

  private recentPath(): string {
    return join(this.userDataPath, 'config', 'recent.json')
  }

  private loadRecentFiles(): void {
    const loaded = loadJsonConfig<string[]>(
      this.recentPath(),
      (raw) => Array.isArray(raw) && raw.every(f => typeof f === 'string')
        ? { ok: true, value: raw as string[] }
        : { ok: false, error: 'not a list of paths' },
      () => []
    )
    this.recentFiles = loaded.value.slice(0, MAX_RECENT)
  }

  private saveRecentFiles(): void {
    try {
      atomicWriteFileSync(this.recentPath(), JSON.stringify(this.recentFiles.slice(0, MAX_RECENT)), {
        backup: true,
        isValidBackup: isJsonContent
      })
    } catch (e) {
      console.error('[Show] Could not save recent files:', (e as Error).message)
    }
  }

  private addToRecent(filePath: string): void {
    this.recentFiles = [filePath, ...this.recentFiles.filter((f) => f !== filePath)].slice(0, MAX_RECENT)
    this.saveRecentFiles()
  }

  getRecent(): string[] {
    return this.recentFiles.filter((f) => existsSync(f))
  }

  // ---- Saving ----

  /**
   * Template for a new show, in the CURRENT format (no legacy output config:
   * outputs are machine config) — so it never triggers the v1 migration or
   * the legacy-outputs warning. `resetCurrent` (local New Show) forgets the
   * current file.
   */
  newShow(opts: { resetCurrent?: boolean } = { resetCurrent: true }): ShowFile {
    if (opts.resetCurrent) this.currentFilePath = null
    const now = new Date().toISOString()
    return {
      version: String(SHOW_FORMAT_VERSION),
      name: 'New Show',
      createdAt: now,
      modifiedAt: now,
      patch: [],
      groups: [],
      presets: [],
      cuelists: [],
      chases: [],
      effects: [],
      midiMappings: [],
      stageLayout: { width: 1200, height: 600, fixtures: [] },
      roomConfig: { ...DEFAULT_ROOM_CONFIG }
    }
  }

  /** Save to the current file; `needsSaveAs` when there is none yet */
  async save(show: ShowFile): Promise<ShowSaveResult & { needsSaveAs?: boolean }> {
    if (!this.currentFilePath) {
      // No file path yet — caller opens a Save As dialog
      return { success: false, needsSaveAs: true }
    }
    return this.saveAs(show, this.currentFilePath)
  }

  /**
   * Atomic save: <file>.tmp → fsync → rename, previous version kept as <file>.bak
   * (only if it was a valid show, so a corrupt file never replaces a good backup).
   */
  saveAs(show: ShowFile, filePath: string): Promise<ShowSaveResult> {
    return this.saveLock.run(async () => {
      const check = checkShowObject(show)
      if (!check.ok) return { success: false, error: `Refusing to save invalid show data: ${check.error}` }
      try {
        const data = JSON.stringify({ ...show, modifiedAt: new Date().toISOString() }, null, 2)
        if (data.length > MAX_SHOW_FILE_SIZE) {
          return { success: false, error: `The show is too large to save (${(data.length / 1024 / 1024).toFixed(1)} MB).` }
        }
        await fsp.mkdir(dirname(filePath), { recursive: true })
        await atomicWriteFile(filePath, data, {
          backup: true,
          isValidBackup: (content) => parseShowFileContent(content.toString('utf-8')).ok
        })
        this.currentFilePath = filePath
        this.addToRecent(filePath)
        return { success: true, path: filePath }
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        const reason = err.code === 'ENOSPC' ? 'the disk is full'
          : err.code === 'EACCES' || err.code === 'EPERM' ? 'permission denied'
          : err.code === 'EROFS' ? 'the disk is read-only'
          : err.message
        console.error(`[Show] Save failed for ${filePath}:`, err.message)
        return { success: false, error: `The show could not be saved (${reason}). The previous version is unchanged.`, path: filePath }
      }
    })
  }

  getCurrentPath(): string | null {
    return this.currentFilePath
  }

  // ---- Fixtures ----

  private loadBuiltinFixtures(): void {
    for (const fixture of BUILTIN_FIXTURES) {
      this.fixtureCache.set(fixture.id, { ...fixture, source: 'builtin' as const })
    }
  }

  scanFixtures(dir: string): FixtureDefinition[] {
    if (!existsSync(dir)) return []
    const files: FixtureDefinition[] = []
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const raw = readFileSync(join(dir, entry.name), 'utf-8')
            const fixture = JSON.parse(raw) as FixtureDefinition
            if (fixture && typeof fixture.id === 'string' && fixture.name && fixture.channels) {
              this.fixtureCache.set(fixture.id, fixture)
              files.push(fixture)
            }
          } catch { /* skip invalid files */ }
        }
      }
    } catch { /* dir not readable */ }
    return files
  }

  getAllFixtures(): FixtureDefinition[] {
    return Array.from(this.fixtureCache.values())
  }

  getFixturesDir(): string {
    return join(this.userDataPath, 'fixtures')
  }

  /** Path of a user fixture file; null when the id would escape the fixtures dir */
  private fixturePath(fixtureId: string): string | null {
    if (!fixtureId || fixtureId.includes('\0')) return null
    const destDir = resolve(this.getFixturesDir())
    const safeId = fixtureId.replace(/[/\\]/g, '_').replace(/\.\./g, '_')
    const destPath = resolve(join(destDir, `${safeId}.json`))
    return destPath.startsWith(destDir + sep) ? destPath : null
  }

  saveUserFixture(fixture: FixtureDefinition): { success: boolean; error?: string } {
    try {
      if (!fixture || typeof fixture !== 'object' || typeof fixture.id !== 'string' || !fixture.channels) {
        return { success: false, error: 'Invalid fixture definition' }
      }
      if (!fixture.source) fixture.source = 'user'
      fixture.lastModified = new Date().toISOString()
      const destPath = this.fixturePath(fixture.id)
      if (!destPath) return { success: false, error: 'Invalid fixture ID' }
      atomicWriteFileSync(destPath, JSON.stringify(fixture, null, 2))
      this.fixtureCache.set(fixture.id, fixture)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  deleteUserFixture(fixtureId: string): { success: boolean; error?: string } {
    try {
      // Security: validate fixture ID
      if (!fixtureId || typeof fixtureId !== 'string' || fixtureId.includes('..') || fixtureId.includes('\0')) {
        return { success: false, error: 'Invalid fixture ID' }
      }
      const fixture = this.fixtureCache.get(fixtureId)
      if (!fixture) return { success: false, error: 'Fixture not found' }
      // Don't allow deleting built-in fixtures
      if (fixture.source === 'builtin' || !fixture.source) {
        return { success: false, error: 'Cannot delete built-in fixtures' }
      }
      const destPath = this.fixturePath(fixtureId)
      if (!destPath) return { success: false, error: 'Invalid fixture path' }
      if (existsSync(destPath)) unlinkSync(destPath)
      this.fixtureCache.delete(fixtureId)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  importFixtureFile(sourcePath: string): { success: boolean; fixture?: FixtureDefinition; error?: string } {
    try {
      // Use universal parser — supports OFL, GDTF, QLC+, Avolites, GrandMA, CSV, native JSON
      const fixture = parseFixtureFile(sourcePath)
      if (!fixture.source) fixture.source = 'user'
      const saved = this.saveUserFixture(fixture)
      if (!saved.success) return { success: false, error: saved.error }
      return { success: true, fixture }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }
}
