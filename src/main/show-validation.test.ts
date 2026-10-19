import { describe, it, expect } from 'vitest'
import { parseShowFileContent, sanitizeShowName, checkShowObject, describeReadError } from './show-validation'

describe('parseShowFileContent', () => {
  it('accepts a minimal show', () => {
    const r = parseShowFileContent(JSON.stringify({ version: '1.0.0', name: 'X', patch: [] }))
    expect(r.ok).toBe(true)
  })

  it('accepts numeric and string versions (format v2 writes "2")', () => {
    expect(parseShowFileContent('{"version":2,"patch":[]}').ok).toBe(true)
    expect(parseShowFileContent('{"version":"2","patch":[]}').ok).toBe(true)
  })

  it('accepts a UTF-8 BOM', () => {
    expect(parseShowFileContent('﻿{"version":"1"}').ok).toBe(true)
  })

  it('reports empty files (power loss) with a readable message', () => {
    const r = parseShowFileContent('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/)
  })

  it('reports truncated JSON', () => {
    const r = parseShowFileContent('{"version":"1.0.0","patch":[{"id"')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/damaged/)
  })

  it('rejects things that are obviously not a show', () => {
    expect(parseShowFileContent('[1,2,3]').ok).toBe(false)
    expect(parseShowFileContent('"text"').ok).toBe(false)
    expect(parseShowFileContent('{"foo":1}').ok).toBe(false)
    expect(parseShowFileContent('{"version":"1","patch":{}}').ok).toBe(false)
    expect(checkShowObject({ name: 5 }).ok).toBe(false)
  })
})

describe('sanitizeShowName', () => {
  it('keeps accents and spaces', () => {
    expect(sanitizeShowName('Fête de la Musique 2026')).toBe('Fête de la Musique 2026')
  })

  it('never produces paths, hidden or empty names', () => {
    expect(sanitizeShowName('../../etc/passwd')).not.toMatch(/[/\\]|\.\./)
    expect(sanitizeShowName('.hidden')).toBe('hidden')
    expect(sanitizeShowName('...')).toBe('Untitled Show')
    expect(sanitizeShowName('   ')).toBe('Untitled Show')
    expect(sanitizeShowName('')).toBe('Untitled Show')
    expect(sanitizeShowName(undefined)).toBe('Untitled Show')
    expect(sanitizeShowName('a/b')).toBe('a_b')
    expect(sanitizeShowName('Show.pbshow')).toBe('Show')
    expect(sanitizeShowName('x\u0000y')).toBe('x_y')
    expect(sanitizeShowName('///')).toBe('Untitled Show')
  })

  it('limits the length', () => {
    expect(sanitizeShowName('a'.repeat(300)).length).toBeLessThanOrEqual(100)
  })
})

describe('describeReadError', () => {
  it('explains common errors', () => {
    expect(describeReadError({ code: 'ENOENT' })).toMatch(/no longer exists/)
    expect(describeReadError({ code: 'EACCES' })).toMatch(/permissions/)
  })
})
