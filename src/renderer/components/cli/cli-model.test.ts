import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT, applyChip, backspace, chipsFor, chooseRunner, expectationHints, insertKey, parseHistory, partialWord, pushHistory, removeLastWord,
  stepHistory
} from './cli-model'

describe('keypad editing', () => {
  it('builds a command from keys', () => {
    let s = ''
    for (const k of ['Fixture', '1', 'Thru', '1', '2', 'At', '5', '0']) s = insertKey(s, k)
    expect(s).toBe('Fixture 1 Thru 12 At 50')
  })

  it('keeps dotted ids together', () => {
    let s = ''
    for (const k of ['Preset', '4', '.', '2']) s = insertKey(s, k)
    expect(s).toBe('Preset 4.2')
  })

  it('a leading dot becomes 0.', () => {
    expect(insertKey('', '.')).toBe('0.')
    expect(insertKey('At ', '.')).toBe('At 0.')
  })

  it('operators are spaced', () => {
    expect(insertKey('Fixture 1', '+')).toBe('Fixture 1 + ')
    expect(insertKey('Fixture 1 + ', '3')).toBe('Fixture 1 + 3')
    expect(insertKey('Group 2', '-')).toBe('Group 2 - ')
  })

  it('a digit right after a word starts a new number', () => {
    expect(insertKey('At', '5')).toBe('At 5')
  })

  it('keywords after a number get a space', () => {
    expect(insertKey('Fixture 1', 'At')).toBe('Fixture 1 At ')
    expect(insertKey('Fixture 1   ', 'Thru')).toBe('Fixture 1 Thru ')
    expect(insertKey('', 'Go-')).toBe('Go- ')
  })

  it('backspace removes a whole keyword, else one character', () => {
    expect(backspace('Fixture 1 At ')).toBe('Fixture 1 ')
    expect(backspace('Fixture 12')).toBe('Fixture 1')
    expect(backspace('Fixture 1 + ')).toBe('Fixture 1 ')
    expect(backspace('Fixture 1 ')).toBe('Fixture 1')
    expect(backspace('')).toBe('')
  })

  it('removeLastWord (Oops on a line)', () => {
    expect(removeLastWord('Fixture 1 At 50')).toBe('Fixture 1 At ')
    expect(removeLastWord('Fixture 1 At ')).toBe('Fixture 1 ')
    expect(removeLastWord('Store')).toBe('')
    expect(removeLastWord('   ')).toBe('')
  })
})

describe('autocomplete', () => {
  const parsed = {
    expected: [
      { kind: 'action' as const, values: ['Store', 'Update', 'Go'] },
      { kind: 'object' as const, values: ['Fixture', 'Group', 'Go'], helpKey: 'objects' },
      { kind: 'number' as const }
    ]
  }

  it('partialWord', () => {
    expect(partialWord('Fix')).toBe('Fix')
    expect(partialWord('Fixture 1')).toBe('')
    expect(partialWord('Fixture ')).toBe('')
    expect(partialWord('Store Cue 3 /me')).toBe('/me')
    expect(partialWord('Store Cue 3 /')).toBe('/')
    expect(partialWord('')).toBe('')
  })

  it('chips: deduplicated, all candidates on an empty word', () => {
    expect(chipsFor(parsed, '').map((c) => c.value)).toEqual(['Store', 'Update', 'Go', 'Fixture', 'Group'])
    expect(chipsFor(parsed, '').find((c) => c.value === 'Group')?.helpKey).toBe('objects')
  })

  it('chips: narrowed to the word being typed (case-insensitive)', () => {
    expect(chipsFor(parsed, 'g').map((c) => c.value)).toEqual(['Go', 'Group'])
    expect(chipsFor(parsed, 'Fixture 1 + gr').map((c) => c.value)).toEqual(['Group'])
    // A complete word is not offered again
    expect(chipsFor(parsed, 'Go').map((c) => c.value)).toEqual([])
  })

  it('chips: options get their slash', () => {
    const p = { expected: [{ kind: 'option' as const, values: ['merge', '/overwrite'] }] }
    expect(chipsFor(p, 'Store Cue 3 ').map((c) => c.value)).toEqual(['/merge', '/overwrite'])
    expect(chipsFor(p, 'Store Cue 3 /o').map((c) => c.value)).toEqual(['/overwrite'])
  })

  it('chips: max', () => {
    const many = { expected: [{ kind: 'action' as const, values: Array.from({ length: 40 }, (_, i) => `K${i}`) }] }
    expect(chipsFor(many, '', 10)).toHaveLength(10)
    expect(chipsFor(null, '')).toEqual([])
  })

  it('hints for kinds without candidates', () => {
    expect(expectationHints(parsed)).toEqual(['number'])
    expect(expectationHints({ expected: [{ kind: 'end' }, { kind: 'end' }] })).toEqual(['end'])
  })

  it('applyChip completes the word or appends a new one', () => {
    expect(applyChip('Fix', 'Fixture')).toBe('Fixture ')
    expect(applyChip('Fixture 1 + gr', 'Group')).toBe('Fixture 1 + Group ')
    expect(applyChip('Fixture 1', 'At')).toBe('Fixture 1 At ')
    expect(applyChip('Store Cue 3 /ov', '/overwrite')).toBe('Store Cue 3 /overwrite ')
  })
})

describe('runner choice', () => {
  it('legacy while the engine is not wired', () => {
    expect(chooseRunner('Fixture 1 At 50', { hasContext: false, parsed: { ast: { options: [], source: '' } } })).toBe('legacy')
    expect(chooseRunner('Fixture 1 At 50', { hasContext: true, parsed: { error: { code: 'notImplemented', at: 0 } } })).toBe('legacy')
  })

  it('engine when it parses; legacy-only shortcuts fall back', () => {
    expect(chooseRunner('Fixture 1 At 50', { hasContext: true, parsed: { ast: { options: [], source: '' } } })).toBe('engine')
    expect(chooseRunner('Gobo 30', { hasContext: true, parsed: { error: { code: 'unknownWord', at: 0 } } })).toBe('legacy')
    expect(chooseRunner('stop 2', { hasContext: true, parsed: { error: { code: 'unknownWord', at: 0 } } })).toBe('legacy')
    // A real syntax error stays with the engine (it reports it)
    expect(chooseRunner('Fixture At At', { hasContext: true, parsed: { error: { code: 'unexpected', at: 8 } } })).toBe('engine')
  })
})

describe('history', () => {
  it('newest first, no consecutive duplicates, limited', () => {
    let h: string[] = []
    h = pushHistory(h, 'Fixture 1')
    h = pushHistory(h, ' Fixture 1 ')
    h = pushHistory(h, 'Go')
    h = pushHistory(h, '   ')
    expect(h).toEqual(['Go', 'Fixture 1'])
    let big: string[] = []
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) big = pushHistory(big, `L${i}`)
    expect(big).toHaveLength(HISTORY_LIMIT)
    expect(big[0]).toBe(`L${HISTORY_LIMIT + 19}`)
  })

  it('parseHistory tolerates garbage', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('{')).toEqual([])
    expect(parseHistory('{"a":1}')).toEqual([])
    expect(parseHistory('["a", 2, "", "b"]')).toEqual(['a', 'b'])
  })

  it('stepHistory walks up and back to the draft', () => {
    const h = ['Go', 'Fixture 1']
    expect(stepHistory(h, -1, 1, 'dra')).toEqual({ index: 0, text: 'Go' })
    expect(stepHistory(h, 0, 1, 'dra')).toEqual({ index: 1, text: 'Fixture 1' })
    expect(stepHistory(h, 1, 1, 'dra')).toBeNull()
    expect(stepHistory(h, 0, -1, 'dra')).toEqual({ index: -1, text: 'dra' })
    expect(stepHistory(h, -1, -1, 'dra')).toBeNull()
  })
})
