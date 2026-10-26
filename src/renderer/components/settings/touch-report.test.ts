import { describe, expect, it } from 'vitest'
import { diagramRects, isWarningLine, panelSettings, screenNumber, touchReportFileName } from './touch-report'

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

  it('screens: number in screen order, rectangles to scale (two 1080p side by side)', () => {
    const outputs = [
      { name: 'HDMI-1', x: 0, y: 0, width: 1920, height: 1080, primary: true, rotation: 0 as const },
      { name: 'HDMI-2', x: 1920, y: 0, width: 1920, height: 1080, primary: false, rotation: 0 as const }
    ]
    expect(screenNumber(outputs, 'HDMI-2')).toBe(2)
    expect(screenNumber(outputs, 'DSI-1')).toBe(0)
    expect(diagramRects(outputs, { width: 3840, height: 1080 })).toEqual([
      { name: 'HDMI-1', left: 0, top: 0, width: 50, height: 100 },
      { name: 'HDMI-2', left: 50, top: 0, width: 50, height: 100 }
    ])
  })

  it('panel settings default to automatic, no orientation, no calibration', () => {
    expect(panelSettings({ saved: null, output: 'HDMI-1' })).toEqual({ output: null, rotation: 0, invertX: false, invertY: false, calibration: null })
    const saved = { output: 'HDMI-2', rotation: 90 as const, invertX: true, invertY: false, calibration: null }
    expect(panelSettings({ saved, output: 'HDMI-2' })).toBe(saved)
  })
})
