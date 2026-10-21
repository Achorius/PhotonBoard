import { describe, it, expect } from 'vitest'
import { renumberMacroLine, type MacroNumberMaps, type NumberMap } from './interchange-macros'

const map = (pairs: [number, number | null][]): NumberMap => new Map(pairs)

const maps: MacroNumberMaps = {
  fixture: map([[1, 11], [2, 12], [3, 13], [4, 14], [7, 30], [8, 31]]),
  group: map([[1, 11], [2, 12], [5, null]]),
  sequence: map([[3, 7], [5, 6], [8, null]]),
  chase: map([[1, 1]]),
  effect: map([[2, 9]]),
  macro: map([[2, 5]]),
  speed: map([[1, 3]]),
  page: map([[1, 3], [2, null]]),
  preset: new Map([[0, map([[1, 1]])], [4, map([[2, 5], [3, 6]])]])
}

const rn = (s: string) => renumberMacroLine(s, maps)

describe('macro text renumbering', () => {
  it('rewrites object numbers, keeps the operator’s spelling', () => {
    expect(rn('Go Sequence 3').text).toBe('Go Sequence 7')
    expect(rn('go seq 3').text).toBe('go seq 7')
    expect(rn('Go 3').text).toBe('Go 7') // Go: bare numbers are sequences
    expect(rn('Off Effect 2').text).toBe('Off Effect 9')
    expect(rn('Macro 2').text).toBe('Macro 5')
    expect(rn('Speed 1').text).toBe('Speed 3')
    expect(rn('G2 + G1').text).toBe('G12 + G11')
  })

  it('leaves cue numbers, values, times and DMX addresses alone', () => {
    expect(rn('Goto Cue 2 Sequence 5').text).toBe('Goto Cue 2 Sequence 6')
    expect(rn('Fixture 1 Thru 4 At 50 Fade 3 Delay 2').text).toBe('Fixture 11 Thru 14 At 50 Fade 3 Delay 2')
    expect(rn('DMX 1.1 At 3').changed).toBe(false)
    expect(rn('Store Cue 3 Sequence 5 /merge').text).toBe('Store Cue 3 Sequence 6 /merge')
  })

  it('bare numbers at the start of a line are fixtures; ranges move when the whole range moved alike', () => {
    expect(rn('1 Thru 4 At Full').text).toBe('11 Thru 14 At Full')
    expect(rn('Fixture 7 Thru').text).toBe('Fixture 30 Thru')
    expect(rn('Fixture 1 Thru').changed).toBe(false) // 1-4 and 7-8 moved differently
    expect(rn('Thru 3').text).toBe('Thru 13')
    // 1-4 moved by 10, 7-8 by 23: not one range any more
    const r = rn('Fixture 1 Thru 8')
    expect(r.changed).toBe(false)
    expect(r.unresolved).toEqual(['Fixture 1 Thru 8'])
  })

  it('presets: family.number, and a bare number of one family', () => {
    expect(rn('Group 2 At Preset 4.2').text).toBe('Group 12 At Preset 4.5')
    expect(rn('Preset 4.2 Thru 4.3').text).toBe('Preset 4.5 Thru 4.6')
    expect(rn('Call Preset 1').text).toBe('Call Preset 1') // 0.1 kept
    expect(rn('Call Preset 2').text).toBe('Call Preset 4.5')
  })

  it('executors and pages follow the executor pages', () => {
    expect(rn('Executor 1.5').text).toBe('Executor 3.5')
    expect(rn('Executor 5').changed).toBe(false) // current page
    expect(rn('Page 1').text).toBe('Page 3')
    expect(rn('Assign Sequence 3 At Executor 1.2').text).toBe('Assign Sequence 7 At Executor 3.2')
  })

  it('reports what cannot be resolved and keeps the text', () => {
    const notImported = rn('Go Sequence 8')
    expect(notImported).toEqual({ text: 'Go Sequence 8', changed: false, unresolved: ['Sequence 8'] })
    expect(rn('Go Sequence 42').unresolved).toEqual(['Sequence 42'])
    expect(rn('Executor 2.1').unresolved).toEqual(['Executor 2.1'])
    expect(rn('Group 5').unresolved).toEqual(['Group 5'])
    // creating a free number is not a reference
    expect(rn('Store Sequence 42').unresolved).toEqual([])
    expect(rn('Copy Group 1 At 6')).toEqual({ text: 'Copy Group 11 At 6', changed: true, unresolved: [] })
  })

  it('without maps nothing changes', () => {
    expect(renumberMacroLine('Go Sequence 3', {})).toEqual({ text: 'Go Sequence 3', changed: false, unresolved: [] })
  })
})
