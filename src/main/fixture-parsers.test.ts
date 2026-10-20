import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseFixtureFile } from './fixture-parsers'

let dir: string | null = null
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null })

describe('parseFixtureFile', () => {
  it('parses a PhotonBoard JSON fixture with an unknown extension (no infinite recursion)', () => {
    dir = mkdtempSync(join(tmpdir(), 'pb-fix-'))
    const file = join(dir, 'my-par.fixture')
    writeFileSync(file, JSON.stringify({ name: 'My Par', channels: { Dimmer: { name: 'Dimmer', type: 'intensity' } } }))
    const f = parseFixtureFile(file)
    expect(f.name).toBe('My Par')
    expect(f.modes[0].channels).toEqual(['Dimmer'])
    expect(f.source).toBe('user')
  })

  it('still rejects unknown content', () => {
    dir = mkdtempSync(join(tmpdir(), 'pb-fix-'))
    const file = join(dir, 'x.bin')
    writeFileSync(file, 'hello')
    expect(() => parseFixtureFile(file)).toThrow(/Unsupported/)
  })
})
