import { describe, expect, it } from 'vitest'
import { isWarningLine, touchReportFileName } from './touch-report'

describe('touch report helpers', () => {
  it('flags ⚠ and NONE lines only', () => {
    expect(isWarningLine('  ⚠ The wacom driver holds some devices')).toBe(true)
    expect(isWarningLine('NONE — no touchscreen reaches the Pi')).toBe(true)
    expect(isWarningLine('⚠ Touch helper NONE found')).toBe(true)
    expect(isWarningLine('X running on :0')).toBe(false)
    expect(isWarningLine('Nonexistent')).toBe(false)
  })

  it('names the file with the local date and time', () => {
    expect(touchReportFileName(new Date(2026, 9, 6, 9, 5))).toBe('PhotonBoard-diagnostic-tactile-2026-10-06-0905.txt')
  })
})
