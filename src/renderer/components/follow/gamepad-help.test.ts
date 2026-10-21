import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})
import { gamepadHelpLines } from './gamepad-help'
import { newDrives } from '@renderer/lib/usb-sticks'

describe('gamepad help', () => {
  const pad = { name: 'Xbox pad', js: 'js0', event: 'event5', jsReadable: true, eventReadable: true }
  it('says what to do', () => {
    expect(gamepadHelpLines(null)[0]).toMatch(/press/i)
    expect(gamepadHelpLines({ supported: true, controllers: [], joydev: true })[0]).toMatch(/no game controller/i)
    expect(gamepadHelpLines({ supported: true, controllers: [pad], joydev: true })[0]).toMatch(/Xbox pad.*press/i)
    expect(gamepadHelpLines({ supported: true, controllers: [{ ...pad, js: null }], joydev: false })[0]).toMatch(/joydev/)
    expect(gamepadHelpLines({ supported: true, controllers: [{ ...pad, jsReadable: false }], joydev: true })[0]).toMatch(/input.*group/)
  })
})

describe('USB sticks', () => {
  it('announces only the drives just plugged in', () => {
    const a = { name: 'A', path: '/m/A', shows: [], canEject: true }
    const b = { name: 'B', path: '/m/B', shows: [], canEject: true }
    expect(newDrives([a], [a, b])).toEqual([b])
    expect(newDrives([a, b], [a])).toEqual([])
  })
})
