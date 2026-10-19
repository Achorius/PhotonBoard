import { describe, it, expect } from 'vitest'
import {
  AuthFailureLimiter,
  isOriginAllowed,
  pinFromRequestUrl,
  pinMatches,
  validateRemoteSettings
} from './remote-auth'

const own = ['192.168.1.20', 'photonboard', 'photonboard.local']

describe('isOriginAllowed', () => {
  it('allows clients without Origin (Companion, node)', () => {
    expect(isOriginAllowed(undefined, '192.168.1.20:9090', own)).toBe(true)
  })
  it('allows the web UI served by this machine', () => {
    expect(isOriginAllowed('http://192.168.1.20:9091', '192.168.1.20:9091', own)).toBe(true)
    expect(isOriginAllowed('http://photonboard.local:9091', 'photonboard.local:9091', own)).toBe(true)
    expect(isOriginAllowed('http://localhost:9091', 'localhost:9091', own)).toBe(true)
    expect(isOriginAllowed('http://[::1]:9091', '[::1]:9091', own)).toBe(true)
  })
  it('rejects other sites (cross-site WebSocket hijacking)', () => {
    expect(isOriginAllowed('https://evil.example.com', '192.168.1.20:9091', own)).toBe(false)
    expect(isOriginAllowed('null', '192.168.1.20:9091', own)).toBe(false)
    expect(isOriginAllowed('file:///tmp/x.html', '192.168.1.20:9091', own)).toBe(false)
  })
  it('rejects DNS rebinding (public name pointing at the Pi)', () => {
    expect(isOriginAllowed('http://evil.example.com:9091', 'evil.example.com:9091', own)).toBe(false)
  })
  it('allows an origin that is one of our own addresses even if Host differs', () => {
    expect(isOriginAllowed('http://192.168.1.20:9091', 'photonboard.local:9090', own)).toBe(true)
  })
})

describe('PIN', () => {
  it('compares in constant time and rejects non-strings', () => {
    expect(pinMatches('1234', '1234')).toBe(true)
    expect(pinMatches('1234', '12345')).toBe(false)
    expect(pinMatches('1234', '')).toBe(false)
    expect(pinMatches('1234', 1234)).toBe(false)
    expect(pinMatches('1234', undefined)).toBe(false)
  })
  it('reads ?pin= from the request URL', () => {
    expect(pinFromRequestUrl('/?pin=1234')).toBe('1234')
    expect(pinFromRequestUrl('/?a=1&pin=ab%20c')).toBe('ab c')
    expect(pinFromRequestUrl('/')).toBeNull()
    expect(pinFromRequestUrl(undefined)).toBeNull()
  })
  it('validates settings', () => {
    expect(validateRemoteSettings({ pinEnabled: false, pin: '' }).ok).toBe(true)
    expect(validateRemoteSettings({ pinEnabled: true, pin: '1234' }).ok).toBe(true)
    expect(validateRemoteSettings({ pinEnabled: true, pin: '12' }).ok).toBe(false)
    expect(validateRemoteSettings({ pinEnabled: true, pin: '12 34' }).ok).toBe(false)
    expect(validateRemoteSettings({ pinEnabled: 'yes', pin: '1234' }).ok).toBe(false)
    expect(validateRemoteSettings([]).ok).toBe(false)
  })
})

describe('AuthFailureLimiter', () => {
  it('locks an address out after too many failures, then releases it', () => {
    let now = 0
    const l = new AuthFailureLimiter(3, 60_000, 30_000, () => now)
    l.recordFailure('a'); l.recordFailure('a')
    expect(l.isLocked('a')).toBe(false)
    l.recordFailure('a')
    expect(l.isLocked('a')).toBe(true)
    expect(l.isLocked('b')).toBe(false)
    now = 31_000
    expect(l.isLocked('a')).toBe(false)
  })
  it('a success clears the counter', () => {
    const l = new AuthFailureLimiter(2)
    l.recordFailure('a')
    l.recordSuccess('a')
    l.recordFailure('a')
    expect(l.isLocked('a')).toBe(false)
  })
})
