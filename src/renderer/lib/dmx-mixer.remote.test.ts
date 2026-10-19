import { describe, expect, it, vi } from 'vitest'

// Remote browser: programmer edits are batched (~33 ms) and forwarded as commands
const sent = vi.hoisted(() => {
  const list: { type: string; payload: any }[] = []
  ;(globalThis as Record<string, unknown>).window = {
    photonboard: { remote: { isRemote: true, sendCommand: (type: string, payload: unknown) => { list.push({ type, payload }) } } }
  }
  return list
})

import { releaseProgrammerChannels, setProgrammerChannel } from './dmx-mixer'

describe('remote programmer release', () => {
  it('drops a batched set of the released channel (no re-send after the release)', () => {
    vi.useFakeTimers()
    try {
      setProgrammerChannel(0, 10, 200)
      setProgrammerChannel(0, 11, 100)
      releaseProgrammerChannels({ 0: [10] })
      vi.advanceTimersByTime(100)
      expect(sent.map(c => c.type)).toEqual(['release-programmer-channels', 'set-programmer-channels'])
      expect(sent[1].payload).toEqual({ 0: { 11: 100 } })
    } finally {
      vi.useRealTimers()
    }
  })
})
