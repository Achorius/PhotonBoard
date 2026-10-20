// ============================================================
// PhotonBoard — Show file I/O validation (main side)
// Main only checks that a file is readable JSON that looks like a
// show; schema normalisation/migration is the renderer's job
// (src/shared/show-format.ts). No electron imports: unit-tested.
// ============================================================

import type { ShowFile } from '../shared/types'
import { mt } from './messages'

export const SHOW_EXTENSION = '.pbshow'
/** Hard ceiling for a show file (a big rig with long cue lists is a few MB) */
export const MAX_SHOW_FILE_SIZE = 16 * 1024 * 1024

/** Top-level keys a PhotonBoard show always had; at least one must be present */
const SHOW_KEYS = ['version', 'patch', 'cuelists', 'groups', 'name', 'createdAt'] as const
/** Keys that must be arrays when present */
const ARRAY_KEYS = [
  'patch', 'groups', 'presets', 'cuelists', 'chases', 'effects', 'midiMappings', 'artnetConfig',
  'macros', 'speedMasters', 'stagePages', 'parked'
] as const

export type ShowParseResult =
  | { ok: true; show: ShowFile }
  | { ok: false; error: string }

/** Validate an already-parsed value as "obviously a show" */
export function checkShowObject(value: unknown): { ok: true; show: ShowFile } | { ok: false; error: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: mt('notAShowNoData') }
  }
  const obj = value as Record<string, unknown>
  if (!SHOW_KEYS.some(k => k in obj)) {
    return { ok: false, error: mt('notAShowUnknown') }
  }
  for (const key of ARRAY_KEYS) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null && !Array.isArray(obj[key])) {
      return { ok: false, error: mt('damagedKey', { key }) }
    }
  }
  if ('name' in obj && obj.name !== undefined && typeof obj.name !== 'string') {
    return { ok: false, error: mt('damagedKey', { key: 'name' }) }
  }
  return { ok: true, show: obj as unknown as ShowFile }
}

/** Parse the text of a .pbshow file into a show, with a human-readable error */
export function parseShowFileContent(text: string): ShowParseResult {
  if (text.length > MAX_SHOW_FILE_SIZE) {
    return { ok: false, error: mt('tooLarge', { size: (text.length / 1024 / 1024).toFixed(1), max: MAX_SHOW_FILE_SIZE / 1024 / 1024 }) }
  }
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) {
    return { ok: false, error: mt('emptyFile') }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    const detail = (e as Error).message
    return { ok: false, error: mt('invalidJson', { detail }) }
  }
  return checkShowObject(parsed)
}

/** Human-readable message for a filesystem error while reading a show */
export function describeReadError(err: unknown): string {
  const e = err as NodeJS.ErrnoException
  switch (e?.code) {
    case 'ENOENT': return 'The show file no longer exists (moved, renamed or on a drive that is not connected).'
    case 'EACCES':
    case 'EPERM': return 'PhotonBoard is not allowed to read this show file (permissions).'
    case 'EISDIR': return 'This is a folder, not a show file.'
    case 'EIO': return 'The disk reported a read error for this show file.'
    default: return `The show file could not be read (${e?.message || String(err)}).`
  }
}

/**
 * Turn a user-supplied show name into a safe file name (without extension).
 * Keeps accents and spaces; never empty, never hidden, never a path.
 */
export function sanitizeShowName(raw: unknown, fallback = 'Untitled Show'): string {
  let name = typeof raw === 'string' ? raw : ''
  name = name
    .replace(/\.pbshow$/i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    // No leading dots (hidden files) and no trailing dots/spaces (Windows/SMB shares)
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
  if (name.length > 100) name = name.slice(0, 100).trim()
  if (!name || /^_+$/.test(name)) return fallback
  return name
}
