import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

const { splashHtml, splashDisabled, SPLASH_MIN_MS, SPLASH_MAX_MS, CONSOLE_BACKGROUND } = await import('./splash')

describe('splash screen', () => {
  it('shows the name, the version and the tagline in the UI language', () => {
    const en = splashHtml({ version: '1.1.2', language: 'en', cover: false })
    expect(en).toContain('PhotonBoard')
    expect(en).toContain('v1.1.2')
    expect(en).toContain('DMX lighting console')
    expect(en).toContain('<html lang="en">')
    const fr = splashHtml({ version: '1.1.2', language: 'fr', cover: true })
    expect(fr).toContain('Console d’éclairage DMX')
    // Linux kiosk: opaque page in the console's background colour
    expect(fr).toContain(`background: ${CONSOLE_BACKGROUND}`)
  })

  it('is self-contained: no script, no external resource', () => {
    const html = splashHtml({ version: '<1>', language: 'en', cover: false })
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)|src=/i)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('v&lt;1&gt;')
  })

  it('can be turned off for test harnesses', () => {
    expect(splashDisabled({ PB_NO_SPLASH: '1' })).toBe(true)
    expect(splashDisabled({})).toBe(false)
    expect(SPLASH_MIN_MS).toBeLessThan(SPLASH_MAX_MS)
  })
})
