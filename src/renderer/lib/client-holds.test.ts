import { describe, expect, it } from 'vitest'
import { ClientHolds } from './client-holds'

describe('per-client momentary holds', () => {
  it('releases what a disconnected client was holding', () => {
    const h = new ClientHolds()
    h.flash('web-1', 'a', true)
    h.trigger('web-1', 'b', true)
    h.blinder('web-1', true)
    h.strobe('web-1', true)
    expect(h.release('web-1')).toEqual({ flash: ['a'], trigger: ['b'], blinder: true, strobe: true })
    expect(h.size()).toBe(0)
    expect(h.release('web-1')).toEqual({ flash: [], trigger: [], blinder: false, strobe: false })
  })

  it('forgets holds released normally (by anyone)', () => {
    const h = new ClientHolds()
    h.flash('web-1', 'a', true)
    h.flash('web-1', 'a', false)
    h.blinder('web-1', true)
    h.blinder('web-2', false)
    expect(h.release('web-1')).toEqual({ flash: [], trigger: [], blinder: false, strobe: false })
  })

  it('keeps what another client still holds', () => {
    const h = new ClientHolds()
    h.flash('web-1', 'a', true)
    h.flash('web-2', 'a', true)
    h.strobe('web-1', true)
    h.strobe('web-2', true)
    expect(h.release('web-1')).toEqual({ flash: [], trigger: [], blinder: false, strobe: false })
    expect(h.release('web-2')).toEqual({ flash: ['a'], trigger: [], blinder: false, strobe: true })
  })
})
