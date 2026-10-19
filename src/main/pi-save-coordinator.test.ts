import { describe, it, expect, vi } from 'vitest'
import { PiSaveCoordinator } from './pi-save-coordinator'

describe('PiSaveCoordinator', () => {
  it('routes the renderer save to the remote request by requestId', async () => {
    let requestId = ''
    const c = new PiSaveCoordinator((cmd) => { requestId = cmd.payload.requestId; return true })
    const p = c.request('/shows/Gig.pbshow')
    expect(c.claim(undefined)).toBeNull() // a normal local save is not an answer
    expect(c.claim('other')).toBeNull()
    const claim = c.claim(requestId)
    expect(claim?.path).toBe('/shows/Gig.pbshow')
    c.complete(claim!.id, { success: true, path: claim!.path })
    await expect(p).resolves.toEqual({ success: true, path: '/shows/Gig.pbshow' })
  })

  it('fails fast without a renderer, times out, and refuses concurrent saves', async () => {
    expect(await new PiSaveCoordinator(() => false).request('/x')).toMatchObject({ success: false })
    vi.useFakeTimers()
    const c = new PiSaveCoordinator(() => true)
    const p = c.request('/x', 1000)
    expect(await c.request('/y')).toMatchObject({ success: false, error: expect.stringMatching(/already/) })
    vi.advanceTimersByTime(1001)
    expect(await p).toMatchObject({ success: false, error: expect.stringMatching(/did not answer/) })
    vi.useRealTimers()
  })
})
