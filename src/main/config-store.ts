// ============================================================
// PhotonBoard — Machine config files (<userData>/config/*.json)
// Atomic writes with a .bak of the previous version; on load a
// corrupt file falls back to the backup, then to defaults.
// ============================================================

import { readFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { atomicWriteFileSync, backupPathFor, isJsonContent } from './atomic-write'

export type Validator<T> = (raw: unknown) => { ok: true; value: T } | { ok: false; error: string }

export interface LoadedConfig<T> {
  value: T
  source: 'file' | 'backup' | 'default'
  /** Why the main file was not used (missing file is not an error) */
  error?: string
}

function readCandidate<T>(path: string, validate: Validator<T>): { ok: true; value: T } | { ok: false; error: string } | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return validate(raw)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function loadJsonConfig<T>(path: string, validate: Validator<T>, fallback: () => T): LoadedConfig<T> {
  const main = readCandidate(path, validate)
  // Missing file → defaults (atomic writes never leave the main file missing,
  // so a missing file means first run or a deliberate reset).
  if (!main) return { value: fallback(), source: 'default' }
  if (main.ok) return { value: main.value, source: 'file' }

  const backup = readCandidate(backupPathFor(path), validate)
  if (backup?.ok) {
    const error = `${path} is invalid (${main.error}); using the backup copy`
    console.warn(`[Config] ${error}`)
    return { value: backup.value, source: 'backup', error }
  }
  const error = `${path} is invalid (${main.error}); using defaults`
  console.error(`[Config] ${error}`)
  return { value: fallback(), source: 'default', error }
}

export function saveJsonConfig(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, JSON.stringify(value, null, 2), { backup: true, isValidBackup: isJsonContent })
}
