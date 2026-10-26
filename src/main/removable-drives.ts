// ============================================================
// PhotonBoard — USB sticks (removable drives) with shows
//
// Where removable drives are mounted:
//   Raspberry Pi image   /media/photonboard/<LABEL|UUID>  (pi-setup.sh
//                        automount: udev + systemd, owned by the kiosk user)
//   other Linux          /media/<user>/*, /run/media/<user>/* (udisks2)
//   macOS                /Volumes/* (the boot volume excluded)
// The watcher polls the mount points (cheap: a readdir + stat) and scans
// a drive's shows (.pbshow, top level and one folder deep) only when the
// set of drives changes or on request. Eject = sync + unmount through
// the Pi helper (sudo rule limited to /media/photonboard/*), udisksctl,
// or diskutil on macOS.
//
// Pure helpers (roots, scan, signature, path checks) are unit-tested.
// ============================================================

import { execFile } from 'child_process'
import { existsSync, promises as fsp, type Stats } from 'fs'
import { basename, join, resolve, sep } from 'path'
import type { RemovableDrive, RemovableShow, SimpleResult } from '../shared/photonboard-api'

export const PI_MEDIA_ROOT = '/media/photonboard'
export const PI_USB_HELPER = '/usr/local/sbin/photonboard-usb-mount'
const SHOW_EXT = '.pbshow'
/** Folders never worth scanning on a stick */
const SKIP_DIRS = /^(\.|\$RECYCLE\.BIN$|System Volume Information$|LOST\.DIR$|FOUND\.\d+$)/i
/** At most this many folders looked into, shows listed, per drive (a big stick must not stall the UI) */
const MAX_DIRS = 200
const MAX_SHOWS = 200

/** Mount roots of removable drives on this system */
export function removableRoots(platform: NodeJS.Platform, user: string): string[] {
  if (platform === 'darwin') return ['/Volumes']
  if (platform === 'linux') {
    const roots = [PI_MEDIA_ROOT]
    if (user && user !== 'photonboard') roots.push(`/media/${user}`, `/run/media/${user}`)
    else roots.push('/run/media/photonboard')
    return roots
  }
  return []
}

export interface ScanFs {
  readdir(path: string): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }[]>
  stat(path: string): Promise<Pick<Stats, 'mtimeMs' | 'dev' | 'isDirectory'>>
  lstat(path: string): Promise<Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'dev'>>
}

const nodeFs: ScanFs = {
  readdir: (p) => fsp.readdir(p, { withFileTypes: true }),
  stat: (p) => fsp.stat(p),
  lstat: (p) => fsp.lstat(p)
}

function isShowFile(name: string): boolean {
  return name.toLowerCase().endsWith(SHOW_EXT) && !name.startsWith('.') && !name.startsWith('._')
}

/** Shows on a drive: top level and one folder deep, newest first */
export async function scanDriveShows(drivePath: string, fs: ScanFs = nodeFs): Promise<RemovableShow[]> {
  const shows: RemovableShow[] = []
  const add = async (dir: string, name: string) => {
    if (shows.length >= MAX_SHOWS) return
    const path = join(dir, name)
    let modifiedAt = 0
    try { modifiedAt = (await fs.stat(path)).mtimeMs } catch { return }
    const rel = dir === drivePath ? name : `${basename(dir)}/${name}`
    shows.push({ name: name.slice(0, -SHOW_EXT.length), path, relPath: rel, modifiedAt })
  }
  let entries: Awaited<ReturnType<ScanFs['readdir']>>
  try { entries = await fs.readdir(drivePath) } catch { return [] }
  const dirs: string[] = []
  for (const e of entries) {
    if (e.isFile() && isShowFile(e.name)) await add(drivePath, e.name)
    else if (e.isDirectory() && !SKIP_DIRS.test(e.name)) dirs.push(e.name)
  }
  for (const d of dirs.slice(0, MAX_DIRS)) {
    const dir = join(drivePath, d)
    let sub: Awaited<ReturnType<ScanFs['readdir']>>
    try { sub = await fs.readdir(dir) } catch { continue }
    for (const e of sub) if (e.isFile() && isShowFile(e.name)) await add(dir, e.name)
  }
  return shows.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/**
 * Mount points under the roots: sub-directories on another device than
 * their root (an empty leftover folder is not a drive), never a symlink
 * (macOS "/Volumes/Macintosh HD" → /).
 */
export async function listMountPoints(roots: readonly string[], fs: ScanFs = nodeFs, requireMount = true): Promise<string[]> {
  const out: string[] = []
  for (const root of roots) {
    let rootDev: number
    let entries: Awaited<ReturnType<ScanFs['readdir']>>
    try {
      rootDev = (await fs.lstat(root)).dev
      entries = await fs.readdir(root)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = join(root, e.name)
      try {
        const st = await fs.lstat(p)
        if (st.isSymbolicLink() || !st.isDirectory()) continue
        if (requireMount && st.dev === rootDev) continue // not mounted
        out.push(p)
      } catch {
        // vanished meanwhile
      }
    }
  }
  return out.sort()
}

/** Drives with their shows */
export async function listRemovableDrives(roots: readonly string[], fs: ScanFs = nodeFs, requireMount = true): Promise<RemovableDrive[]> {
  const mounts = await listMountPoints(roots, fs, requireMount)
  const drives: RemovableDrive[] = []
  for (const path of mounts) {
    drives.push({ name: basename(path), path, shows: await scanDriveShows(path, fs), canEject: true })
  }
  return drives
}

/** Is `path` a file inside one of the drives? (every USB file operation checks it) */
export function isInsideDrive(path: unknown, drives: readonly Pick<RemovableDrive, 'path'>[]): path is string {
  if (typeof path !== 'string' || !path) return false
  const p = resolve(path)
  return drives.some((d) => p.startsWith(resolve(d.path) + sep))
}

/** The drive (mount point) a path is, or is inside of */
export function driveOf(path: unknown, drives: readonly RemovableDrive[]): RemovableDrive | null {
  if (typeof path !== 'string' || !path) return null
  const p = resolve(path)
  return drives.find((d) => p === resolve(d.path) || p.startsWith(resolve(d.path) + sep)) ?? null
}

/** File name for a show copy on a drive: sanitised, ".pbshow" */
export function copyFileName(showName: string): string {
  const base = showName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'Show'
  return `${base}${SHOW_EXT}`
}

/** A plain ".txt" file name for the root of a drive (diagnostic reports), or null when unsafe */
export function safeTextFileName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  if (!/^[\w][\w .()-]{0,119}\.txt$/i.test(name) || name.includes('..')) return null
  return name
}

// ---------------- Watcher ----------------

export class RemovableWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private mounts = ''
  private drives: RemovableDrive[] = []
  private scanning: Promise<RemovableDrive[]> | null = null

  constructor(
    private roots: readonly string[],
    private onChange: (drives: RemovableDrive[]) => void,
    private opts: { intervalMs?: number; fs?: ScanFs; requireMount?: boolean } = {}
  ) {}

  private get fs(): ScanFs { return this.opts.fs ?? nodeFs }
  private get requireMount(): boolean { return this.opts.requireMount !== false }

  start(): void {
    if (this.timer || this.roots.length === 0) return
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, this.opts.intervalMs ?? 2000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get current(): RemovableDrive[] {
    return this.drives
  }

  /** Re-scan every drive's shows now (after a save to the stick, on request) */
  refresh(): Promise<RemovableDrive[]> {
    if (this.scanning) return this.scanning
    this.scanning = (async () => {
      try {
        const drives = await listRemovableDrives(this.roots, this.fs, this.requireMount)
        const changed = JSON.stringify(drives) !== JSON.stringify(this.drives)
        this.drives = drives
        this.mounts = drives.map((d) => d.path).join('\n')
        if (changed) this.onChange(drives)
        return drives
      } finally {
        this.scanning = null
      }
    })()
    return this.scanning
  }

  async tick(): Promise<void> {
    const mounts = (await listMountPoints(this.roots, this.fs, this.requireMount)).join('\n')
    if (mounts !== this.mounts) await this.refresh()
  }
}

// ---------------- Eject ----------------

function run(cmd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; out: string }> {
  return new Promise((done) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      done({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.trim() || (err ? err.message : '') })
    })
  })
}

/**
 * Safely remove a drive: flush, unmount (and power off when udisks does it).
 * The Pi image's helper runs through a sudo rule that only accepts mount
 * points under /media/photonboard.
 */
export async function ejectDrive(drivePath: string, platform: NodeJS.Platform = process.platform): Promise<SimpleResult> {
  await run('sync', [], 10000)
  if (platform === 'darwin') {
    const r = await run('diskutil', ['eject', drivePath])
    return r.ok ? { success: true } : { success: false, error: r.out }
  }
  if (platform !== 'linux') return { success: false, error: 'Eject is not supported on this system' }
  if (resolve(drivePath).startsWith(PI_MEDIA_ROOT + sep) && existsSync(PI_USB_HELPER)) {
    const r = await run('sudo', ['-n', PI_USB_HELPER, 'eject', resolve(drivePath)])
    if (r.ok) return { success: true }
    if (!/not allowed|password|sudo/i.test(r.out)) return { success: false, error: r.out }
  }
  // Desktop Linux: udisks2
  const src = await run('findmnt', ['-n', '-o', 'SOURCE', '--target', drivePath])
  if (src.ok && src.out.startsWith('/dev/')) {
    const dev = src.out.split('\n')[0].trim()
    const r = await run('udisksctl', ['unmount', '-b', dev])
    if (r.ok) {
      await run('udisksctl', ['power-off', '-b', dev.replace(/p?\d+$/, '')])
      return { success: true }
    }
  }
  const r = await run('umount', [drivePath])
  return r.ok ? { success: true } : { success: false, error: r.out }
}
