// ============================================================
// PhotonBoard — demo content shipped with the app (main process)
//
// resources/demos (extraResources → <resources>/demos when packaged,
// the repository folder in dev) holds demo shows and one example file
// per import format, described by demos.json (scripts/build-demos.ts).
// The UI only ever names a demo by its id: paths come from the
// manifest, never from the caller.
// ============================================================

import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve, sep } from 'path'
import type { DemoList, DemoManifest } from '../shared/demos'

/** Where the demos folder can be: packaged resources first, then the source tree */
export function defaultDemoDirs(opts: { resourcesPath?: string; appPath?: string; mainDir?: string }): string[] {
  const dirs: string[] = []
  if (opts.resourcesPath) dirs.push(join(opts.resourcesPath, 'demos'))
  if (opts.appPath) dirs.push(join(opts.appPath, 'resources', 'demos'))
  if (opts.mainDir) dirs.push(join(opts.mainDir, '..', '..', 'resources', 'demos'))
  return dirs
}

function isManifest(raw: unknown): raw is DemoManifest {
  const m = raw as DemoManifest
  return !!m && typeof m === 'object' && Array.isArray(m.shows) && Array.isArray(m.formats)
}

/** A path from the manifest, kept inside the demos folder */
function inside(dir: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel) return null
  const root = resolve(dir)
  const path = resolve(root, rel)
  return path.startsWith(root + sep) ? path : null
}

function fileSize(path: string): number {
  try {
    const st = statSync(path)
    return st.isFile() ? st.size : -1
  } catch {
    return -1
  }
}

export class DemoLibrary {
  private dir: string | null = null
  private manifest: DemoManifest | null = null

  constructor(private dirs: string[]) {}

  /** The manifest (read once); null when the app ships without demos */
  private load(): { dir: string; manifest: DemoManifest } | null {
    if (this.dir && this.manifest) return { dir: this.dir, manifest: this.manifest }
    for (const dir of this.dirs) {
      const file = join(dir, 'demos.json')
      if (!existsSync(file)) continue
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'))
        if (!isManifest(raw)) continue
        this.dir = dir
        this.manifest = raw
        return { dir, manifest: raw }
      } catch (e) {
        console.warn(`[Demos] ${file} could not be read:`, (e as Error).message)
      }
    }
    return null
  }

  /** Demo shows and example files that are really there */
  list(): DemoList {
    const loaded = this.load()
    if (!loaded) return { shows: [], formats: [] }
    const { dir, manifest } = loaded
    const shows: DemoList['shows'] = []
    for (const s of manifest.shows) {
      const path = inside(dir, s?.file)
      if (!path || fileSize(path) < 0 || typeof s.id !== 'string') continue
      shows.push({ id: s.id, name: String(s.name ?? s.id), description: s.description, fixtures: Number(s.fixtures) || 0, universes: Number(s.universes) || 0 })
    }
    const formats: DemoList['formats'] = []
    for (const f of manifest.formats) {
      const path = inside(dir, f?.file)
      const size = path ? fileSize(path) : -1
      if (!path || size < 0 || typeof f.id !== 'string') continue
      formats.push({ id: f.id, fileName: path.split(/[\\/]/).pop() ?? f.file, path, format: String(f.format ?? ''), description: f.description, size })
    }
    return { shows, formats }
  }

  /** Path of a demo show by id (null when unknown / missing) */
  showPath(id: unknown): string | null {
    const loaded = this.load()
    if (!loaded || typeof id !== 'string') return null
    const entry = loaded.manifest.shows.find((s) => s?.id === id)
    const path = entry ? inside(loaded.dir, entry.file) : null
    return path && fileSize(path) >= 0 ? path : null
  }

  /** Path of an example file by id (null when unknown / missing) */
  formatPath(id: unknown): string | null {
    const loaded = this.load()
    if (!loaded || typeof id !== 'string') return null
    const entry = loaded.manifest.formats.find((f) => f?.id === id)
    const path = entry ? inside(loaded.dir, entry.file) : null
    return path && fileSize(path) >= 0 ? path : null
  }
}
