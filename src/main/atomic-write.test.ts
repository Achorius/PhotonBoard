import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { atomicWriteFile, atomicWriteFileSync, isJsonContent } from './atomic-write'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pb-atomic-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('atomicWriteFile', () => {
  it('writes a new file and leaves no temp file behind', async () => {
    const file = join(dir, 'a.json')
    await atomicWriteFile(file, '{"a":1}')
    expect(readFileSync(file, 'utf-8')).toBe('{"a":1}')
    expect(readdirSync(dir)).toEqual(['a.json'])
  })

  it('keeps the previous version as .bak when asked', async () => {
    const file = join(dir, 'show.pbshow')
    await atomicWriteFile(file, '{"v":1}', { backup: true })
    await atomicWriteFile(file, '{"v":2}', { backup: true })
    expect(readFileSync(file, 'utf-8')).toBe('{"v":2}')
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe('{"v":1}')
  })

  it('does not let a corrupt file replace a good backup', async () => {
    const file = join(dir, 'show.pbshow')
    writeFileSync(`${file}.bak`, '{"good":true}')
    writeFileSync(file, '{"trunc')
    await atomicWriteFile(file, '{"v":3}', { backup: true, isValidBackup: isJsonContent })
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe('{"good":true}')
    expect(readFileSync(file, 'utf-8')).toBe('{"v":3}')
  })

  it('leaves the target untouched and cleans up when the write fails', async () => {
    const file = join(dir, 'missing-dir', 'x.json')
    await expect(atomicWriteFile(file, 'x')).rejects.toThrow()
    expect(existsSync(file)).toBe(false)
  })
})

describe('atomicWriteFileSync', () => {
  it('replaces content and keeps a backup', () => {
    const file = join(dir, 'recent.json')
    atomicWriteFileSync(file, '[1]', { backup: true, isValidBackup: isJsonContent })
    atomicWriteFileSync(file, '[2]', { backup: true, isValidBackup: isJsonContent })
    expect(readFileSync(file, 'utf-8')).toBe('[2]')
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe('[1]')
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})
