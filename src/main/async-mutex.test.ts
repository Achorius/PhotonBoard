import { describe, it, expect } from 'vitest'
import { Mutex } from './async-mutex'

describe('Mutex', () => {
  it('runs tasks one at a time in order, even when one fails', async () => {
    const m = new Mutex()
    const log: string[] = []
    const task = (name: string, ms: number, fail = false) => m.run(async () => {
      log.push(`start ${name}`)
      await new Promise(r => setTimeout(r, ms))
      log.push(`end ${name}`)
      if (fail) throw new Error(name)
      return name
    })
    const results = await Promise.allSettled([task('a', 20), task('b', 1, true), task('c', 5)])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
  })
})
