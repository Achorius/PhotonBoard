// ============================================================
// PhotonBoard — Crash-safe file writes
// A show controller on a Pi can lose power at any moment. Every
// file we own is written as: <file>.tmp → fsync → rename over <file>,
// so the target is always either the old or the new complete version.
// Optionally the previous version is kept as <file>.bak.
// No electron imports here: unit-tested with plain node.
// ============================================================

import { promises as fsp, openSync, writeSync, fsyncSync, closeSync, renameSync, readFileSync, existsSync, unlinkSync } from 'fs'
import type { FileHandle } from 'fs/promises'
import { dirname } from 'path'

export interface AtomicWriteOptions {
  /** Keep the current file as <file>.bak before replacing it */
  backup?: boolean
  /**
   * Only back up the current file if this returns true for its content.
   * Prevents a corrupt file from overwriting a good backup.
   */
  isValidBackup?: (content: Buffer) => boolean
}

export function tmpPathFor(filePath: string): string {
  return `${filePath}.tmp`
}

export function backupPathFor(filePath: string): string {
  return `${filePath}.bak`
}

/** fsync a directory so a rename survives power loss (best effort: not supported everywhere) */
async function fsyncDir(dir: string): Promise<void> {
  let handle: FileHandle | null = null
  try {
    handle = await fsp.open(dir, 'r')
    await handle.sync()
  } catch {
    // Windows and some filesystems refuse to open/fsync directories
  } finally {
    await handle?.close().catch(() => {})
  }
}

function fsyncDirSync(dir: string): void {
  let fd: number | null = null
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // best effort
  } finally {
    if (fd !== null) try { closeSync(fd) } catch { /* ignore */ }
  }
}

async function writeAndSync(path: string, data: string | Buffer): Promise<void> {
  const handle = await fsp.open(path, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function writeAndSyncSync(path: string, data: string | Buffer): void {
  const fd = openSync(path, 'w')
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    let offset = 0
    while (offset < buf.length) {
      offset += writeSync(fd, buf, offset, buf.length - offset)
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Atomically replace `filePath` with `data` (async; use for show files). */
export async function atomicWriteFile(filePath: string, data: string | Buffer, opts: AtomicWriteOptions = {}): Promise<void> {
  const tmp = tmpPathFor(filePath)
  try {
    await writeAndSync(tmp, data)

    if (opts.backup) {
      let current: Buffer | null = null
      try { current = await fsp.readFile(filePath) } catch { /* no previous version */ }
      if (current && current.length > 0 && (!opts.isValidBackup || opts.isValidBackup(current))) {
        const bak = backupPathFor(filePath)
        const bakTmp = `${bak}.tmp`
        await writeAndSync(bakTmp, current)
        await fsp.rename(bakTmp, bak)
      }
    }

    await fsp.rename(tmp, filePath)
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    throw e
  }
  await fsyncDir(dirname(filePath))
}

/** Synchronous variant for small config files (recent.json, outputs.json…). */
export function atomicWriteFileSync(filePath: string, data: string | Buffer, opts: AtomicWriteOptions = {}): void {
  const tmp = tmpPathFor(filePath)
  try {
    writeAndSyncSync(tmp, data)

    if (opts.backup && existsSync(filePath)) {
      let current: Buffer | null = null
      try { current = readFileSync(filePath) } catch { /* unreadable: don't back it up */ }
      if (current && current.length > 0 && (!opts.isValidBackup || opts.isValidBackup(current))) {
        const bak = backupPathFor(filePath)
        const bakTmp = `${bak}.tmp`
        writeAndSyncSync(bakTmp, current)
        renameSync(bakTmp, bak)
      }
    }

    renameSync(tmp, filePath)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
  fsyncDirSync(dirname(filePath))
}

/** True when the buffer is a JSON object/array (used to decide whether a file is worth backing up). */
export function isJsonContent(content: Buffer): boolean {
  try {
    const parsed = JSON.parse(content.toString('utf-8'))
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}
