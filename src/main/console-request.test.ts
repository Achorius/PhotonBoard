import { describe, expect, it, vi } from 'vitest'
import { ConsoleRequestCoordinator } from './console-request'

describe('ConsoleRequestCoordinator', () => {
  it('relays a request to the console renderer and resolves with its (JSON) answer', async () => {
    const sent: any[] = []
    const c = new ConsoleRequestCoordinator((cmd) => { sent.push(cmd); return true })
    const p = c.request('collect-show-content', { origin: 'o' })
    expect(sent[0].type).toBe('collect-show-content')
    expect(sent[0].payload.origin).toBe('o')
    const id = sent[0].payload.requestId
    expect(c.has(id)).toBe(true)
    expect(c.answer('unknown', '{}')).toBe(false)
    expect(c.answer(id, JSON.stringify({ success: true, show: { name: 'Live' } }))).toBe(true)
    await expect(p).resolves.toEqual({ success: true, show: { name: 'Live' } })
    expect(c.answer(id, '{}')).toBe(false) // late duplicate
  })

  it('times out, and fails at once without a console window', async () => {
    vi.useFakeTimers()
    try {
      const c = new ConsoleRequestCoordinator(() => true)
      const p = c.request('collect-show-content', {}, 1000)
      vi.advanceTimersByTime(1001)
      await expect(p).rejects.toThrow(/did not answer/)
    } finally {
      vi.useRealTimers()
    }
    const none = new ConsoleRequestCoordinator(() => false)
    await expect(none.request('x')).rejects.toThrow(/not running/)
  })
})
