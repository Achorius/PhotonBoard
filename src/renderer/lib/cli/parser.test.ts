import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { tokenize, resolveKeyword } from './tokenizer'
import { formatParse } from './golden-format'

// ============================================================
// Golden table: input → compact AST ("sel fixture[1>4] @50") or
// "ERR <code>@<offset>[:token]". See golden-format.ts for the notation:
//   kind* = implicit (bare number), a>b = Thru, >end = open Thru,
//   cue[5]<sequence[3] = Cue 5 of Sequence 3, => = At target,
//   @v / @a>b / @P4.2 = value, f/d = fade/delay, #n = amount, "x" = text
// ============================================================

const GOLDEN: [string, string][] = [
  // ---- selection: keywords, abbreviations, prefixes, case
  ['Fixture 1', 'sel fixture[1]'],
  ['fixture 1', 'sel fixture[1]'],
  ['FIXTURE 1', 'sel fixture[1]'],
  ['Fix 1', 'sel fixture[1]'],
  ['F 1', 'sel fixture[1]'],
  ['Fi 1', 'sel fixture[1]'],
  ['Fixt 3', 'sel fixture[3]'],
  ['F1', 'sel fixture[1]'],
  ['Group2', 'sel group[2]'],
  ['1', 'sel fixture*[1]'],
  ['1 Thru 4', 'sel fixture*[1>4]'],
  ['Fixture 1 Thru 4', 'sel fixture[1>4]'],
  ['Fixture 1 thru 4', 'sel fixture[1>4]'],
  ['Fixture 1 T 4', 'sel fixture[1>4]'],
  ['Fixture 1 > 4', 'sel fixture[1>4]'],
  ['Fixture 8 Thru 1', 'sel fixture[8>1]'],
  ['Fixture 1 Thru', 'sel fixture[1>end]'],
  ['Fixture Thru 5', 'sel fixture[>5]'],
  ['Fixture 1 + 3 + 5', 'sel fixture[1 +3 +5]'],
  ['Fixture 1 Thru 10 - 5', 'sel fixture[1>10 -5]'],
  ['Fixture 1 Thru 10 - 3 Thru 5 + 12', 'sel fixture[1>10 -3>5 +12]'],
  ['Fixture 1 + Group 2', 'sel fixture[1] +group[2]'],
  ['Group 2 - Fixture 5', 'sel group[2] -fixture[5]'],
  ['Group 2', 'sel group[2]'],
  ['G 2', 'sel group[2]'],
  ['Gr 2', 'sel group[2]'],
  ['Group 1 Thru 3', 'sel group[1>3]'],
  ['+ 5', 'sel +fixture*[5]'],
  ['- 5', 'sel -fixture*[5]'],
  ['+ Group 2', 'sel +group[2]'],
  ['Fixture 1 Thru 20 If Group 3', 'sel fixture[1>20] if group[3]'],
  ['If Group 2', 'sel if group[2]'],
  ['Group 2 If Preset 4.1', 'sel group[2] if preset[4.1]'],
  // ---- values
  ['Fixture 1 At 50', 'sel fixture[1] @50'],
  ['Fixture 1 @ 50', 'sel fixture[1] @50'],
  ['Fixture 1 @50', 'sel fixture[1] @50'],
  ['Fixture 1 Thru 4 At 50', 'sel fixture[1>4] @50'],
  ['At 50', 'sel @50'],
  ['@ 50', 'sel @50'],
  ['at 50', 'sel @50'],
  ['At Full', 'sel @100'],
  ['At Zero', 'sel @0'],
  ['Full', 'sel @100'],
  ['Zero', 'sel @0'],
  ['Fu', 'sel @100'],
  ['At 0 Thru 100', 'sel @0>100'],
  ['At 100 Thru 0', 'sel @100>0'],
  ['Fixture 1 Thru 8 At 0 Thru 100', 'sel fixture[1>8] @0>100'],
  ['At 50 Fade 3', 'sel @50 f3'],
  ['At 50 Fade 3 Delay 1', 'sel @50 f3 d1'],
  ['At 50 Delay 1 Fade 3', 'sel @50 f3 d1'],
  ['At 50 Fade 1.5', 'sel @50 f1.5'],
  ['At 33.5', 'sel @33.5'],
  ['Fixture 1 Thru 4 At Preset 4.2', 'sel fixture[1>4] @P4.2'],
  ['Fixture 1 Thru 4 Preset 4.2', 'sel fixture[1>4] @P4.2'],
  ['At Preset 4.2 Fade 2', 'sel @P4.2 f2'],
  ['Preset 4.2', 'sel preset[4.2]'],
  ['P 4.2', 'sel preset[4.2]'],
  ['Preset 2', 'sel preset[2]'],
  ['Preset 4.1 Thru 4.3', 'sel preset[4.1>4.3]'],
  ['Fixture 5 At Off', 'sel fixture[5] @0'],
  ['Fixture 1 Full', 'sel fixture[1] @100'],
  ['Fixture 1 Zero', 'sel fixture[1] @0'],
  ['Group 2 At 75', 'sel group[2] @75'],
  ['At 150', 'sel @150'],
  ['At 128 /dmx', 'sel @128 /dmx'],
  ['DMX 1.101 At 50', 'sel dmx[1.101] @50'],
  ['DMX 101 At 50', 'sel dmx[101] @50'],
  ['DMX 1.1 Thru 1.10 At 0 Thru 100', 'sel dmx[1.1>1.10] @0>100'],
  ['dmx 2.512 at full', 'sel dmx[2.512] @100'],
  // ---- legacy channel words
  ['Gobo 30', 'attribute #30 "gobo"'],
  ['color 50', 'attribute #50 "color"'],
  ['Pan At 128', 'attribute #128 "pan"'],
  ['red 255', 'attribute #255 "red"'],
  // ---- programmer
  ['Clear', 'clear'],
  ['clear', 'clear'],
  ['Cl', 'clear'],
  ['ClearAll', 'clearall'],
  ['ClearSelection', 'clearselection'],
  ['Clr', 'clear'],
  ['Highlight', 'highlight'],
  ['Highlight On', 'highlight "on"'],
  ['Highlight Off', 'highlight "off"'],
  ['Highlight Fixture 1 Thru 4', 'highlight fixture[1>4]'],
  ['Hl', 'highlight'],
  ['Blind', 'blind'],
  ['Blind On', 'blind "on"'],
  ['Park', 'park'],
  ['Park Fixture 3', 'park fixture[3]'],
  ['Park 3 At 50', 'park fixture*[3] @50'],
  ['Unpark', 'unpark'],
  ['Unpark Group 2', 'unpark group[2]'],
  ['Fade 3', 'fade #3'],
  ['Fade 0.5', 'fade #0.5'],
  ['Fade Off', 'fade #0'],
  ['Delay 2', 'delay #2'],
  ['Next', 'next'],
  ['Prev', 'prev'],
  ['Previous', 'prev'],
  ['All', 'all'],
  ['Set', 'set'],
  ['Align <', 'align "<"'],
  ['Align >', 'align ">"'],
  ['Align <>', 'align "<>"'],
  ['Align ><', 'align "><"'],
  ['Align Off', 'align "off"'],
  ['Oops', 'oops'],
  ['Undo', 'oops'],
  ['Redo', 'redo'],
  // ---- playback
  ['Go', 'go'],
  ['Go 3', 'go sequence*[3]'],
  ['Go Sequence 3', 'go sequence[3]'],
  ['Go Seq 3', 'go sequence[3]'],
  ['Go S 3', 'go sequence[3]'],
  ['Go Scene 3', 'go sequence[3]'],
  ['Go Executor 2.5', 'go executor[2.5]'],
  ['Go Exec 5', 'go executor[5]'],
  ['Go Macro 2', 'go macro[2]'],
  ['Go Chase 1', 'go chase[1]'],
  ['Go Effect 1', 'go effect[1]'],
  ['Go Cue 3', 'go cue[3]'],
  ['Go-', 'go-'],
  ['Go- 2', 'go- sequence*[2]'],
  ['go- Sequence 2', 'go- sequence[2]'],
  ['GoBack 2', 'go- sequence*[2]'],
  ['Back', 'go-'],
  ['Goto 5', 'goto cue*[5]'],
  ['Goto Cue 5', 'goto cue[5]'],
  ['Goto Cue 5 Sequence 2', 'goto cue[5]<sequence[2]'],
  ['Goto Sequence 2 Cue 1.5', 'goto cue[1.5]<sequence[2]'],
  ['Got 3', 'goto cue*[3]'],
  ['Off', 'off'],
  ['Off 3', 'off sequence*[3]'],
  ['Off Sequence 3', 'off sequence[3]'],
  ['Off Macro 3', 'off macro[3]'],
  ['Off Executor 1.1', 'off executor[1.1]'],
  ['Off Group 2', 'off group[2]'],
  ['Pause', 'pause'],
  ['Pause 2', 'pause sequence*[2]'],
  ['Release', 'release'],
  ['Release Fixture 1 Thru 4', 'release fixture[1>4]'],
  ['Stop', 'stop'],
  ['Stop 2', 'stop sequence*[2]'],
  ['Page 2', 'page page*[2]'],
  ['Page +', 'page "+"'],
  ['Page -', 'page "-"'],
  ['Pg 3', 'page page*[3]'],
  ['Macro 3', 'macro macro*[3]'],
  ['M 3', 'macro macro*[3]'],
  ['Blackout', 'blackout'],
  ['BO', 'blackout'],
  ['Blackout On', 'blackout "on"'],
  ['Blackout Off', 'blackout "off"'],
  ['Executor 2.5', 'sel executor[2.5]'],
  ['Executor 5', 'sel executor[5]'],
  ['Executor 1.1 Thru 1.4', 'sel executor[1.1>1.4]'],
  ['Executor 1.1 At 50', 'sel executor[1.1] @50'],
  ['Sequence 3', 'sel sequence[3]'],
  ['Cue 5', 'sel cue[5]'],
  ['Chase 1', 'sel chase[1]'],
  ['Effect 1', 'sel effect[1]'],
  ['Fx 1', 'sel effect[1]'],
  ['Ch 1', 'sel chase[1]'],
  ['Speed 1 At 128', 'sel speed[1] @128'],
  ['Speed 1', 'sel speed[1]'],
  ['Edit Sequence 2', 'edit sequence[2]'],
  ['Select Executor 1.3', 'select executor[1.3]'],
  ['Select Sequence 2', 'select sequence[2]'],
  ['Call Preset 4.2', 'call preset[4.2]'],
  ['Call 4.2', 'call preset*[4.2]'],
  // ---- store / update
  ['Store', 'store'],
  ['Store Cue 5', 'store cue[5]'],
  ['Store 5', 'store cue*[5]'],
  ['St 5', 'store cue*[5]'],
  ['Store Cue 5 /merge', 'store cue[5] /merge'],
  ['Store Cue 5 /overwrite', 'store cue[5] /overwrite'],
  ['Store Cue 5 /cueonly', 'store cue[5] /cueonly'],
  ['Store Cue 5 /remove', 'store cue[5] /remove'],
  ['Store Cue 5 /block', 'store cue[5] /block'],
  ['Store /merge Cue 5', 'store cue[5] /merge'],
  ['Store Cue 5 /filter=position,color', 'store cue[5] /filter=position,color'],
  ['Store Cue 5 Sequence 3', 'store cue[5]<sequence[3]'],
  ['Store Sequence 3 Cue 5', 'store cue[5]<sequence[3]'],
  ['Store Cue 1 Thru 5', 'store cue[1>5]'],
  ['Store Cue 1.5', 'store cue[1.5]'],
  ['Store Cue 1.05', 'store cue[1.05]'],
  ['Store Sequence 4', 'store sequence[4]'],
  ['Store Sequence 4 "Finale"', 'store sequence[4] "Finale"'],
  ['Store Preset 4.2', 'store preset[4.2]'],
  ['Store Preset 4.2 /global', 'store preset[4.2] /global'],
  ['Store Preset 4.2 /universal "Deep blue"', 'store preset[4.2] "Deep blue" /universal'],
  ['Store Group 5 "Front"', 'store group[5] "Front"'],
  ['Store Executor 1.3', 'store executor[1.3]'],
  ['Record Cue 2', 'store cue[2]'],
  ['Update', 'update'],
  ['Update Cue 3', 'update cue[3]'],
  ['Update Preset 4.1 /overwrite', 'update preset[4.1] /overwrite'],
  ['Update /filter=intensity', 'update /filter=intensity'],
  // ---- objects
  ['Delete Cue 3', 'delete cue[3]'],
  ['Delete 3', 'delete cue*[3]'],
  ['Del Cue 1 Thru 3', 'delete cue[1>3]'],
  ['Delete Sequence 4', 'delete sequence[4]'],
  ['Delete Preset 4.2', 'delete preset[4.2]'],
  ['Delete Group 3', 'delete group[3]'],
  ['Delete Macro 2', 'delete macro[2]'],
  ['Delete Executor 1.5', 'delete executor[1.5]'],
  ['Copy Cue 2 At 5', 'copy cue[2] => cue*[5]'],
  ['Copy Cue 2 At Cue 5', 'copy cue[2] => cue[5]'],
  ['Copy Cue 2 At Cue 5 Sequence 2', 'copy cue[2] => cue[5]<sequence[2]'],
  ['Copy Preset 4.1 At 4.5', 'copy preset[4.1] => preset*[4.5]'],
  ['Copy Group 1 At 6', 'copy group[1] => group*[6]'],
  ['Copy Macro 1 At 4 /overwrite', 'copy macro[1] => macro*[4] /overwrite'],
  ['Move Cue 2 At 2.5', 'move cue[2] => cue*[2.5]'],
  ['Move Preset 4.1 At 4.8', 'move preset[4.1] => preset*[4.8]'],
  ['Move Executor 1.1 At 2.1', 'move executor[1.1] => executor*[2.1]'],
  ['Label Group 3 "Wash"', 'label group[3] "Wash"'],
  ["Label Group 3 'Wash'", 'label group[3] "Wash"'],
  ['Label Group 3 “Wash”', 'label group[3] "Wash"'],
  ['Label Group 3 «Wash»', 'label group[3] "Wash"'],
  ['Label Sequence 1 "Intro Song"', 'label sequence[1] "Intro Song"'],
  ['Label Cue 2 "Blackout cue"', 'label cue[2] "Blackout cue"'],
  ['Assign Sequence 3 At Executor 2.5', 'assign sequence[3] => executor[2.5]'],
  ['Assign 3 At Executor 2.5', 'assign sequence*[3] => executor[2.5]'],
  ['Assign Chase 1 At 1.4', 'assign chase[1] => executor*[1.4]'],
  ['Assign Sequence 3 At Executor 2.5 /button=flash', 'assign sequence[3] => executor[2.5] /button=flash'],
  ['Assign Executor 1.5 /button=go', 'assign executor[1.5] /button=go'],
  // ---- errors
  ['Fixture', 'ERR expectedNumber@7'],
  ['Fixture At 50', 'ERR expectedNumber@8:At'],
  ['Fixture 1 At', 'ERR expectedValue@12'],
  ['Fixture 1 At Banana', 'ERR unknownWord@13:Banana'],
  ['Fixture 1 Thru 4 At 50 Fade', 'ERR expectedNumber@27'],
  ['Florp 3', 'ERR unknownWord@0:Florp'],
  ['De 3', 'ERR ambiguous@0:De'],
  ['Pa 2', 'ERR ambiguous@0:Pa'],
  ['Fixture 1 $', 'ERR unexpectedChar@10:$'],
  ['Fixture 1 2', 'ERR unexpected@10:2'],
  ['Label Group 3', 'ERR expectedText@13'],
  ['Label Group 3 "Wash', 'ERR unterminatedString@14:"Wash'],
  ['Copy Cue 2', 'ERR expectedTarget@10'],
  ['Store Cue 5 /bogus', 'ERR unknownOption@12:/bogus'],
  ['Store Cue 5 /', 'ERR badOption@12:/'],
  ['Store Cue 5 /filter', 'ERR optionValue@12:/filter'],
  ['/merge', 'ERR unexpected@0:/merge'],
  ['Store Cue 5 /filter=smell', 'ERR badFilter@12:smell'],
  ['Assign Sequence 3 At Executor 1.1 /button=boom', 'ERR badButton@34:boom'],
  ['Preset 4.', 'ERR expectedNumber@7:4.'],
  ['Fade', 'ERR expectedNumber@4'],
  ['Align', 'ERR expectedValue@5'],
  ['At', 'ERR expectedValue@2'],
  ['Fixture 1 +', 'ERR expectedObject@11'],
  ['Go Banana', 'ERR unknownWord@3:Banana'],
  ['Clear 3', 'ERR unexpected@6:3'],
  ['Oops now', 'ERR unknownWord@5:now'],
  ['Highlight Group', 'ERR expectedNumber@15'],
  ['Group 2 Gobo 30', 'ERR unexpected@8:Gobo'],
  ['Thru', 'ERR expectedNumber@4'],
  ['Fixture 1 Thru 4 At 50 junk', 'ERR unknownWord@23:junk'],
  ['Fixture 1 If', 'ERR expectedObject@12'],
  ['DMX At 50', 'ERR expectedNumber@4:At'],
  ['Strobe', 'ERR expectedNumber@6'],
  ['', '(empty)'],
  ['   ', '(empty)']
]

describe('command line parser — golden table', () => {
  it('has more than 150 lines', () => {
    expect(GOLDEN.length).toBeGreaterThan(150)
  })

  if (process.env.GOLDEN_PRINT) {
    it('prints', () => {
      console.log(GOLDEN.map(([input]) => `  [${JSON.stringify(input)}, ${JSON.stringify(formatParse(parse(input)))}],`).join('\n'))
    })
  }

  it.each(GOLDEN)('%s', (input, expected) => {
    expect(formatParse(parse(input))).toBe(expected)
  })
})

// ============================================================
// What may come next (autocomplete): [input, must include, must not include]
// ============================================================

const EXPECTED: [string, string[], string[]][] = [
  ['', ['Store', 'Go-', 'Fixture', 'Group', 'At', 'Full'], []],
  ['Fixture 1', ['Thru', '+', '-', 'At', 'Full', 'Zero', 'If', 'Preset', '/dmx'], ['Store']],
  ['Fixture 1 ', ['Thru', 'At', 'If'], []],
  ['Fixture 1 Thru ', ['+', 'At'], ['Thru']],
  ['Fi', ['Fixture'], ['Fade', 'Group']],
  ['Go', ['Go', 'Go-', 'Goto', 'Sequence', 'Executor'], ['Store']],
  ['S', ['Store', 'Stop', 'Select', 'Set', 'Sequence', 'Speed'], ['Fixture']],
  ['De', ['Delete', 'Delay'], ['DMX']],
  ['Store Cue 5 ', ['/merge', '/overwrite', '/cueonly', '/filter=', 'Sequence'], ['At']],
  ['Store Cue 5 Seq', ['Sequence'], []],
  ['Fixture 1 At ', ['Full', 'Zero', 'Preset'], ['At', 'Fade']],
  ['Fixture 1 At 50 ', ['Fade', 'Delay', 'Thru'], ['At']],
  ['Fixture 1 At 50 Fade 2 ', ['Delay'], ['Fade']],
  ['Fixture 1 Thru 4 At 50 Fa', ['Fade'], ['Delay']],
  ['Label Group 3 ', [], ['At']],
  ['Copy Cue 2 ', ['At'], ['Full']],
  ['Assign Sequence 3 At Executor 1.1 ', ['/button='], []],
  ['Blind ', ['On', 'Off'], []],
  ['Align ', ['<', '>', '<>', '><', 'Off'], []],
  ['Goto Cue 5 ', ['Sequence'], []],
  ['Fixture 1 +', ['Fixture', 'Group'], []],
  ['Page ', ['Fixture', 'Page'], []],
  ['Fade ', ['Off'], ['Fade']]
]

function values(input: string): string[] {
  return parse(input).expected.flatMap(e => e.values ?? [])
}

describe('command line parser — expected (autocomplete)', () => {
  it.each(EXPECTED)('%s', (input, yes, no) => {
    const got = values(input)
    for (const v of yes) expect(got, `${input} → ${v}`).toContain(v)
    for (const v of no) expect(got, `${input} ↛ ${v}`).not.toContain(v)
  })

  it('kinds: end of a complete line, text for Label, number with its help key', () => {
    expect(parse('Clear').expected.some(e => e.kind === 'end')).toBe(true)
    expect(parse('Label Group 3 ').expected.some(e => e.kind === 'text' && e.helpKey === 'label')).toBe(true)
    expect(parse('Go ').expected.some(e => e.kind === 'number' && e.helpKey === 'sequence')).toBe(true)
    expect(parse('Store ').expected.some(e => e.kind === 'number' && e.helpKey === 'cue')).toBe(true)
    expect(parse('Preset 4.').expected.some(e => e.kind === 'number')).toBe(true)
    expect(parse('Fixture 1 At').expected.some(e => e.kind === 'end')).toBe(false)
  })

  it('a complete line keeps its AST while the last word could still grow', () => {
    const r = parse('Go')
    expect(r.ast?.action).toBe('go')
    expect(r.error).toBeUndefined()
  })
})

describe('command line tokenizer', () => {
  it('resolves keywords: exact, alias, unique prefix, shortest common prefix, ambiguous, channel words', () => {
    expect(resolveKeyword('Fixture')).toEqual({ kind: 'exact', keyword: 'fixture' })
    expect(resolveKeyword('SEQ')).toEqual({ kind: 'alias', keyword: 'sequence' })
    expect(resolveKeyword('scene')).toEqual({ kind: 'alias', keyword: 'sequence' })
    expect(resolveKeyword('Fixt')).toEqual({ kind: 'prefix', keyword: 'fixture' })
    expect(resolveKeyword('cl')).toEqual({ kind: 'prefix', keyword: 'clear' })
    expect(resolveKeyword('clearA')).toEqual({ kind: 'prefix', keyword: 'clearall' })
    expect(resolveKeyword('pa')).toEqual({ kind: 'ambiguous', candidates: ['page', 'park', 'pause'] })
    expect(resolveKeyword('gobo')).toEqual({ kind: 'channel', channel: 'gobo' })
    expect(resolveKeyword('zz')).toEqual({ kind: 'unknown' })
    expect(resolveKeyword('')).toEqual({ kind: 'unknown' })
  })

  it('tokens carry offsets; @ = At; Go- is one key; dotted numbers keep their text', () => {
    const t = tokenize('Fixture 1.101 @ 50')
    expect(t.map(x => [x.kind, x.text, x.at])).toEqual([['word', 'Fixture', 0], ['number', '1.101', 8], ['word', '@', 14], ['number', '50', 16], ['eof', '', 18]])
    expect(t[2].keyword).toBe('at')
    expect(tokenize('Go- 2')[0]).toMatchObject({ kind: 'word', text: 'Go-', keyword: 'go-' })
    expect(tokenize('Go -2').map(x => x.kind)).toEqual(['word', 'op', 'number', 'eof'])
    expect(tokenize('4.')[0]).toMatchObject({ kind: 'number', dangling: true })
    expect(tokenize('.5')[0]).toMatchObject({ kind: 'number', text: '.5' })
  })

  it('strings, options and unknown characters', () => {
    expect(tokenize('"Wash 2"')[0]).toMatchObject({ kind: 'string', value: 'Wash 2' })
    expect(tokenize('«Wash»')[0]).toMatchObject({ kind: 'string', value: 'Wash' })
    expect(tokenize('"Wash')[0]).toMatchObject({ kind: 'string', unterminated: true, value: 'Wash' })
    expect(tokenize('/filter=position,color')[0]).toMatchObject({ kind: 'option', option: { name: 'filter', value: 'position,color' } })
    expect(tokenize('/MERGE')[0]).toMatchObject({ kind: 'option', option: { name: 'merge' } })
    expect(tokenize('$')[0]).toMatchObject({ kind: 'op', text: '$' })
  })

  it('parse never throws, whatever the input', () => {
    const words = ['Fixture', 'Thru', 'At', '1', '4.2', '+', '-', '"x', '/merge', '@', 'Store', 'Cue', 'If', 'Go-', '>', '<', '$', 'Full', 'Preset', '.', 'Fade', 'Sequence', '', ' ']
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 2000; i++) {
      const n = Math.floor(rnd() * 7)
      const line = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(rnd() < 0.8 ? ' ' : '')
      expect(() => parse(line)).not.toThrow()
      const r = parse(line)
      expect(r.ast !== undefined || r.error !== undefined || line.trim() === '').toBe(true)
    }
  })
})
