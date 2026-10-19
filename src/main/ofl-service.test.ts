import { describe, it, expect } from 'vitest'
import { OFLService, isOflKey } from './ofl-service'

type Resp = { ok: boolean; status: number; json(): Promise<any> }
const ok = (body: any): Resp => ({ ok: true, status: 200, json: async () => body })
const fail = (status = 500): Resp => ({ ok: false, status, json: async () => ({}) })

describe('OFLService index loading', () => {
  it('a failed index load does not disable search until restart', async () => {
    let now = 0
    let online = false
    const fetch = async (url: string) => {
      if (!online) throw new Error('offline')
      if (url.endsWith('/manufacturers')) return ok({ acme: { name: 'Acme' } })
      return ok({ name: 'Acme', fixtures: [{ key: 'par-64', name: 'PAR 64', categories: ['Color Changer'] }] })
    }
    const svc = new OFLService({ fetch, now: () => now, retryDelayMs: 0 })
    expect(await svc.search('par')).toEqual([])
    online = true
    // Within the retry back-off we do not hammer the network
    expect(await svc.search('par')).toEqual([])
    now += 60_000
    const results = await svc.search('par')
    expect(results.map(r => r.fixtureKey)).toEqual(['par-64'])
  })

  it('retries failed manufacturer batches', async () => {
    let calls = 0
    const fetch = async (url: string) => {
      if (url.endsWith('/manufacturers')) return ok({ a: { name: 'A' }, b: { name: 'B' } })
      if (url.endsWith('/b') && calls++ === 0) return fail(503)
      return ok({ fixtures: [{ key: url.endsWith('/a') ? 'one' : 'two', name: 'X' }] })
    }
    const svc = new OFLService({ fetch, retryDelayMs: 0 })
    const results = await svc.search('x')
    expect(results.map(r => r.fixtureKey).sort()).toEqual(['one', 'two'])
  })

  it('validates fixture keys before downloading', async () => {
    const svc = new OFLService({ fetch: async () => ok({}) })
    await expect(svc.download('../x', 'y')).rejects.toThrow(/Invalid/)
    expect(isOflKey('martin')).toBe(true)
    expect(isOflKey('mac-aura-xb')).toBe(true)
    expect(isOflKey('a/b')).toBe(false)
  })
})
