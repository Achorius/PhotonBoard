import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.window ??= {
    innerWidth: 1400,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
  }
})

import { getT, hasTranslation, type TranslationKey, type TParams } from '@renderer/i18n'
import { useProStore } from '@renderer/stores/pro-store'
import {
  CLI_CHEATSHEET, createCliHistory, createMacroRunner, executeLine, helpKeyOf, listCommands, parse, previewLine, runCommandLine,
  setCliContext, type CliContext, type CliResult, type MacroClock, type TFn
} from '@renderer/lib/cli'
import { createFakeShow, type FakeProApi } from './testing/fake-pro-api'

// ---------------------------------------------------------------- translation (records missing keys)

const missingKeys = new Set<string>()
const unfilled = new Set<string>()

function translator(locale: 'en' | 'fr'): TFn {
  const tt = getT(locale)
  return (key: TranslationKey, params?: TParams) => {
    if (!hasTranslation(key)) missingKeys.add(key)
    const out = tt(key, params)
    if (/\{[a-z]+\}/i.test(out)) unfilled.add(`${key} → ${out}`)
    return out
  }
}

const en = translator('en')
const fr = translator('fr')

let api: FakeProApi
let ctx: CliContext

function run(line: string, c: CliContext = ctx): CliResult {
  return executeLine(line, c)
}

beforeEach(() => {
  api = createFakeShow()
  ctx = { api, t: en, now: () => 0 }
})

afterAll(() => {
  expect([...missingKeys]).toEqual([])
  expect([...unfilled]).toEqual([])
})

// ============================================================
// Regression: every command the old CommandLine.tsx accepted keeps its
// effect (old rules: fixture / group / scene numbers = list position;
// "At" sets the "Dimmer" / "Intensity" channel; ≤ 100 = percent, else
// DMX; channel words take DMX values on the selection or every fixture).
// Run on a show WITH numbers (fid = position, as after the v3
// migration) and on one WITHOUT numbers (list order fallback).
// ============================================================

type Check = (api: FakeProApi, res: CliResult) => void

const vals = (a: FakeProApi, ids: string[], ch: string) => ids.map(id => a.value(id, ch))

const REGRESSION: [string, (a: FakeProApi) => void, Check][] = [
  ['Clear', a => { a.setAttributeValues([{ fixtureId: 'd5', channelName: 'Intensity', value: 9 }]) }, a => expect(a.programmer.size).toBe(0)],
  ['clear', a => { a.setAttributeValues([{ fixtureId: 'd5', channelName: 'Intensity', value: 9 }]) }, a => expect(a.programmer.size).toBe(0)],
  ['Blackout', () => {}, a => expect(a.blackout).toBe(true)],
  ['BO', a => { a.blackout = true }, a => expect(a.blackout).toBe(false)],
  ['bo', () => {}, a => expect(a.blackout).toBe(true)],
  ['Go', () => {}, a => expect(a.callsOf('go')).toEqual([['cl-intro']])],
  ['go', () => {}, a => expect(a.callsOf('go')).toEqual([['cl-intro']])],
  ['Go 2', () => {}, a => expect(a.callsOf('go')).toEqual([['cl-verse']])],
  ['Go 3', () => {}, a => expect(a.callsOf('go')).toEqual([['cl-chorus']])],
  ['Go 9', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.callsOf('go')).toEqual([]) }],
  ['Go', a => { a.cuelists = [] }, (a, r) => { expect(r.ok).toBe(false); expect(a.callsOf('go')).toEqual([]) }],
  ['Stop 2', () => {}, a => expect(a.callsOf('off')).toEqual([['cl-verse']])],
  ['Stop', a => { a.go('cl-intro'); a.go('cl-verse') }, a => expect(a.callsOf('off')).toEqual([['cl-intro'], ['cl-verse']])],
  ['stop', () => {}, (a, r) => { expect(r.ok).toBe(true); expect(a.callsOf('off')).toEqual([]) }],
  ['Group 2', () => {}, a => expect(a.selection).toEqual(['d5', 'd6', 'd7', 'd8'])],
  ['group 1', () => {}, a => expect(a.selection).toEqual(['mh1', 'mh2', 'mh3', 'mh4'])],
  ['Group 3', () => {}, a => expect(a.selection).toEqual(['p9', 'p10'])],
  ['Group 9', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.callsOf('setSelection')).toEqual([]) }],
  ['Group 2 At 50', () => {}, a => { expect(a.selection).toEqual(['d5', 'd6', 'd7', 'd8']); expect(vals(a, ['d5', 'd8'], 'Intensity')).toEqual([128, 128]) }],
  ['Group 2 at full', () => {}, a => expect(vals(a, ['d5', 'd8'], 'Intensity')).toEqual([255, 255])],
  ['Group 2 At zero', () => {}, a => expect(vals(a, ['d5', 'd8'], 'Intensity')).toEqual([0, 0])],
  ['Group 2 At 200', () => {}, a => expect(vals(a, ['d5'], 'Intensity')).toEqual([200])],
  ['Group 2 At 999', () => {}, a => expect(vals(a, ['d5'], 'Intensity')).toEqual([255])],
  ['Group 1 @ 100', () => {}, a => expect(vals(a, ['mh1', 'mh4'], 'Dimmer')).toEqual([255, 255])],
  ['Fixture 1', () => {}, a => expect(a.selection).toEqual(['mh1'])],
  ['fixture 2', () => {}, a => expect(a.selection).toEqual(['mh2'])],
  ['fix 1 thru 4', () => {}, a => expect(a.selection).toEqual(['mh1', 'mh2', 'mh3', 'mh4'])],
  ['f 1 > 4', () => {}, a => expect(a.selection).toEqual(['mh1', 'mh2', 'mh3', 'mh4'])],
  ['Fixture 1 + 3 + 5', () => {}, a => expect(a.selection).toEqual(['mh1', 'mh3', 'd5'])],
  ['Fixture 5 Thru 8 At 80', () => {}, a => expect(vals(a, ['d5', 'd6', 'd7', 'd8'], 'Intensity')).toEqual([204, 204, 204, 204])],
  ['Fixture 1 Thru 4 At 80', () => {}, a => expect(vals(a, ['mh1', 'mh4'], 'Dimmer')).toEqual([204, 204])],
  ['F 5 at 50', () => {}, a => expect(a.value('d5', 'Intensity')).toBe(128)],
  ['Fixture 5 At zero', () => {}, a => expect(a.value('d5', 'Intensity')).toBe(0)],
  ['Fixture 5 At off', () => {}, a => expect(a.value('d5', 'Intensity')).toBe(0)],
  ['Fixture 5 At full', () => {}, a => expect(a.value('d5', 'Intensity')).toBe(255)],
  ['Fixture 11 At 50', () => {}, a => { expect(a.value('d11', 'Dimmer')).toBe(128); expect(a.value('d11', 'Dimmer Fine')).toBeUndefined() }],
  ['Fixture 9 At 50', () => {}, a => { expect(a.selection).toEqual(['p9']); expect(a.programmer.size).toBe(0) }],
  ['Fixture 99', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.callsOf('setSelection')).toEqual([]) }],
  ['At 50', a => { a.selection = ['mh1', 'd5'] }, a => { expect(a.value('mh1', 'Dimmer')).toBe(128); expect(a.value('d5', 'Intensity')).toBe(128) }],
  ['@ 50', a => { a.selection = ['d5'] }, a => expect(a.value('d5', 'Intensity')).toBe(128)],
  ['at 150', a => { a.selection = ['d5'] }, a => expect(a.value('d5', 'Intensity')).toBe(150)],
  ['At 50', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.programmer.size).toBe(0) }],
  ['Full', a => { a.selection = ['d5', 'd6'] }, a => expect(vals(a, ['d5', 'd6'], 'Intensity')).toEqual([255, 255])],
  ['full', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.programmer.size).toBe(0) }],
  ['Zero', a => { a.selection = ['d5'] }, a => expect(a.value('d5', 'Intensity')).toBe(0)],
  ['Off', a => { a.selection = ['d5'] }, a => expect(a.value('d5', 'Intensity')).toBe(0)],
  ['off', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.programmer.size).toBe(0) }],
  ['Gobo 30', a => { a.selection = ['mh2'] }, a => { expect(a.value('mh2', 'Gobo')).toBe(30); expect(a.programmer.size).toBe(1) }],
  ['gobo 30', () => {}, a => expect(vals(a, ['mh1', 'mh2', 'mh3', 'mh4'], 'Gobo')).toEqual([30, 30, 30, 30])],
  ['color 300', a => { a.selection = ['mh1'] }, a => expect(a.value('mh1', 'Color Wheel')).toBe(255)],
  ['red 128', a => { a.selection = ['p9'] }, a => expect(a.value('p9', 'Red')).toBe(128)],
  ['Green 7', a => { a.selection = ['p9', 'mh1'] }, a => expect(vals(a, ['p9', 'mh1'], 'Green')).toEqual([7, 7])],
  ['pan 10', a => { a.selection = ['mh1'] }, a => { expect(a.value('mh1', 'Pan')).toBe(10); expect(a.value('mh1', 'Pan Fine')).toBeUndefined() }],
  ['tilt 200', a => { a.selection = ['mh1'] }, a => expect(a.value('mh1', 'Tilt')).toBe(200)],
  ['shutter 22', a => { a.selection = ['mh1'] }, a => expect(a.value('mh1', 'Shutter')).toBe(22)],
  ['Gobo', () => {}, (a, r) => { expect(r.ok).toBe(false); expect(a.programmer.size).toBe(0) }]
]

/** The old show model: fid / numbers = list position, or no numbers at all */
function legacyShow(numbered: boolean): FakeProApi {
  const a = createFakeShow()
  a.patch = a.patch.filter(p => p.id !== 'd101' && p.id !== 'd13').map((p, i) => ({ ...p, fid: numbered ? i + 1 : undefined }))
  a.groups = a.groups.map((g, i) => ({ ...g, number: numbered ? i + 1 : undefined }))
  a.cuelists = a.cuelists.map((c, i) => ({ ...c, number: numbered ? i + 1 : undefined }))
  for (const p of a.patch) if (p.fid === undefined) delete p.fid
  for (const g of a.groups) if (g.number === undefined) delete g.number
  for (const c of a.cuelists) if (c.number === undefined) delete c.number
  a.calls = []
  return a
}

describe('regression: commands of the old command line', () => {
  for (const numbered of [true, false]) {
    describe(numbered ? 'numbered show' : 'show without numbers', () => {
      it.each(REGRESSION)('%s', (line, setup, check) => {
        const a = legacyShow(numbered)
        setup(a)
        a.calls = []
        const res = executeLine(line, { api: a, t: en, now: () => 0 })
        check(a, res)
      })
    })
  }

  it('old messages are kept in spirit (counts and percent)', () => {
    expect(run('Fixture 1 Thru 4 At 80').message).toBe('4 fixtures at 80%')
    expect(run('Group 2').message).toBe('Selected group “Wash” (4 fixtures)')
    expect(run('Fixture 1 + 3').message).toBe('Selected 2 fixtures')
    expect(run('Go 2').message).toBe('GO scene 2 “Verse”')
    expect(run('Gobo 30').message).toBe('2 fixtures gobo = 30')
    expect(run('Blackout').message).toBe('Blackout toggled')
    expect(run('Clear').message).toBe('Selection cleared')
  })
})

// ============================================================
// Selection and values
// ============================================================

describe('selection & values', () => {
  it('fixture IDs, open ranges, reverse order, list-position fallback', () => {
    run('Fixture 101')
    expect(api.selection).toEqual(['d101'])
    run('Fixture 13')
    expect(api.selection).toEqual(['d13'])
    run('Fixture 4 Thru 1')
    expect(api.selection).toEqual(['mh4', 'mh3', 'mh2', 'mh1'])
    run('Fixture 10 Thru')
    expect(api.selection).toEqual(['p10', 'd11', 'd13', 'd101'])
    run('Fixture Thru 3')
    expect(api.selection).toEqual(['mh1', 'mh2', 'mh3'])
    run('Fixture 1 Thru 10 - 3 Thru 8')
    expect(api.selection).toEqual(['mh1', 'mh2', 'p9', 'p10'])
  })

  it('+ / - change the current selection; If keeps the common fixtures', () => {
    run('Group 1')
    run('+ 5')
    expect(api.selection).toEqual(['mh1', 'mh2', 'mh3', 'mh4', 'd5'])
    run('- Fixture 2')
    expect(api.selection).toEqual(['mh1', 'mh3', 'mh4', 'd5'])
    run('Fixture 1 Thru 8 If Group 2')
    expect(api.selection).toEqual(['d5', 'd6', 'd7', 'd8'])
    run('Fixture 1 Thru 8')
    run('If Preset 4.1')
    expect(api.selection).toEqual(['mh1', 'mh2', 'mh3', 'mh4'])
    run('Fixture 1 Thru 8 If Cue 2 Sequence 1')
    expect(api.selection).toEqual(['d6'])
  })

  it('a missing object is an error that names it', () => {
    expect(run('Group 7')).toMatchObject({ ok: false, message: 'Group 7 not found' })
    expect(run('Sequence 9')).toMatchObject({ ok: false, message: 'Sequence 9 not found' })
    expect(run('Fixture 1 + Sequence 1')).toMatchObject({ ok: false, level: 'error' })
  })

  it('fans spread over the selection order (At 0 Thru 100), with align and MAtricks', () => {
    run('Fixture 5 Thru 8 At 0 Thru 100')
    expect(vals(api, ['d5', 'd6', 'd7', 'd8'], 'Intensity')).toEqual([0, 85, 170, 255])
    run('Fixture 8 Thru 5 At 0 Thru 100')
    expect(vals(api, ['d8', 'd7', 'd6', 'd5'], 'Intensity')).toEqual([0, 85, 170, 255])
    api.align = '<>'
    run('Fixture 5 Thru 7 At 0 Thru 100')
    expect(vals(api, ['d5', 'd6', 'd7'], 'Intensity')).toEqual([0, 255, 0])
    api.align = null
    api.matricks = { invert: true }
    run('Fixture 5 Thru 7 At 0 Thru 100')
    expect(vals(api, ['d5', 'd6', 'd7'], 'Intensity')).toEqual([255, 128, 0])
    expect(run('At 100 Thru 0').message).toBe('3 fixtures fanned 100% → 0%')
  })

  it('values go to the ACTIVE fixtures (Next / Prev)', () => {
    run('Group 2')
    run('Next')
    run('At 50')
    expect(vals(api, ['d5', 'd6'], 'Intensity')).toEqual([128, undefined])
    run('Next')
    run('Full')
    expect(api.value('d6', 'Intensity')).toBe(255)
  })

  it('Fade / Delay on a value are passed as the time of those values', () => {
    run('Fixture 5 At 50 Fade 2 Delay 0.5')
    expect(api.lastTime).toEqual({ fade: 2, delay: 0.5 })
    run('Fixture 5 At 50')
    expect(api.lastTime).toBeUndefined()
    run('Fixture 5 At 50 Delay 1')
    expect(api.lastTime).toEqual({ fade: 0, delay: 1 })
  })

  it('presets: At Preset, bare Preset, family 0 and unique-number fallback', () => {
    run('Fixture 1 Thru 4 At Preset 4.2 Fade 3')
    expect(api.callsOf('applyPreset')[0]).toEqual(['pr-blue', ['mh1', 'mh2', 'mh3', 'mh4'], { fade: 3, delay: 0 }])
    expect(vals(api, ['mh1', 'mh4'], 'Blue')).toEqual([255, 255])
    run('Fixture 1 Preset 4.1')
    expect(api.value('mh1', 'Red')).toBe(255)
    api.calls = []
    run('Preset 2')
    expect(api.callsOf('applyPreset')[0][0]).toBe('pr-blue')
    run('Preset 1')
    expect(api.callsOf('applyPreset')[1][0]).toBe('pr-look')
    expect(run('Fixture 5 At Preset 4.1')).toMatchObject({ ok: false, message: 'Preset 4.1 “Red” has no values for these fixtures' })
    expect(run('Preset 4.9').ok).toBe(false)
    run('Fixture 2')
    expect(run('Call Preset 2.1').message).toBe('Preset 2.1 “Center” on 1 fixture')
  })

  it('/dmx makes numbers DMX values; DMX tester writes raw channels (fans too)', () => {
    run('Fixture 5 At 100 /dmx')
    expect(api.value('d5', 'Intensity')).toBe(100)
    run('DMX 1.101 At 50')
    expect(api.dmx.get('0.100')).toBe(128)
    run('DMX 2.512 At Full')
    expect(api.dmx.get('1.511')).toBe(255)
    run('DMX 7 At 200')
    expect(api.dmx.get('0.6')).toBe(200)
    run('DMX 1.1 Thru 1.3 At 0 Thru 100')
    expect([api.dmx.get('0.0'), api.dmx.get('0.1'), api.dmx.get('0.2')]).toEqual([0, 128, 255])
    expect(run('DMX 1.513 At 5').ok).toBe(false)
    expect(run('DMX 1.1').ok).toBe(false)
  })

  it('bare objects do their default action', () => {
    run('Sequence 2')
    expect(api.selectedCuelist).toBe('cl-verse')
    run('Cue 1.5')
    expect(api.callsOf('goto')).toEqual([['cl-verse', 1.5]])
    run('Executor 1.1')
    expect(api.callsOf('executorPress')).toEqual([[{ page: 0, col: 0, row: 0 }, 'down', undefined], [{ page: 0, col: 0, row: 0 }, 'up', undefined]])
    run('Executor 5 At 50')
    expect(api.columnLevels.get('0.1')).toBe(128)
    run('Executor 2.5')
    expect(api.callsOf('executorPress').at(-1)?.[0]).toEqual({ page: 1, col: 1, row: 0 })
    run('Chase 1')
    expect(api.chases[0].isPlaying).toBe(true)
    run('Effect 1')
    expect(api.effects[0].isRunning).toBe(true)
    run('Speed 1 At 128')
    expect(api.speedMasters[0].bpm).toBe(128)
    run('Speed 1')
    expect(api.callsOf('tapSpeedMaster')).toEqual([['sm-main']])
    run('Select Executor 1.5')
    expect(api.selectedExecutor).toEqual({ page: 0, col: 1, row: 0 })
  })
})

// ============================================================
// Programmer tools
// ============================================================

describe('programmer tools', () => {
  it('Clear in three stages: selection, values, everything', () => {
    run('Fixture 5 At 50')
    expect(run('Clear').message).toBe('Selection cleared')
    expect(api.programmer.size).toBe(1)
    expect(run('Clear').message).toBe('Programmer values cleared')
    expect(api.programmer.size).toBe(0)
    expect(run('Clear').message).toBe('Programmer cleared')
    run('Fixture 5 At 50')
    run('ClearAll')
    expect([api.selection.length, api.programmer.size]).toEqual([0, 0])
    run('Fixture 5 At 50')
    run('ClearSelection')
    expect([api.selection.length, api.programmer.size]).toEqual([0, 1])
  })

  it('Highlight, Blind, Blackout toggles and On / Off', () => {
    run('Highlight')
    expect(api.highlight).toBe(true)
    run('Highlight')
    expect(api.highlight).toBe(false)
    run('Highlight Group 2')
    expect([api.highlight, api.selection.length]).toEqual([true, 4])
    run('Highlight Off')
    expect(api.highlight).toBe(false)
    run('Blind On')
    run('Blind On')
    expect(api.blind).toBe(true)
    run('Blind')
    expect(api.blind).toBe(false)
    run('Blackout On')
    run('Blackout On')
    expect(api.blackout).toBe(true)
    run('Blackout Off')
    expect(api.blackout).toBe(false)
  })

  it('Park the programmer values or a level; Unpark; both undoable', () => {
    expect(run('Park Fixture 5').ok).toBe(false)
    run('Fixture 5 At 40')
    run('Park')
    expect(api.parked).toEqual([{ fixtureId: 'd5', channelName: 'Intensity', value: 102 }])
    run('Park Group 1 At Full')
    expect(api.parked.length).toBe(5)
    run('Unpark Fixture 1')
    expect(api.parked.length).toBe(4)
    run('Oops')
    expect(api.parked.length).toBe(5)
    run('ClearSelection')
    run('Unpark')
    expect(api.parked).toEqual([])
  })

  it('Fade / Delay set the programmer time; Fade Off clears it', () => {
    run('Fade 3')
    expect(api.progTime).toEqual({ fade: 3, delay: 0 })
    run('Delay 1.5')
    expect(api.progTime).toEqual({ fade: 3, delay: 1.5 })
    run('Fade Off')
    expect(api.progTime).toEqual({ fade: 0, delay: 1.5 })
    expect(run('Delay 0').message).toBe('Programmer time off')
    expect(api.progTime).toBeNull()
  })

  it('Next / Prev / All / Set walk the selection', () => {
    expect(run('Next').ok).toBe(false)
    run('Fixture 1 Thru 3')
    expect(run('Next').message).toBe('→ Spot 1')
    expect(run('Next').message).toBe('→ Spot 2')
    expect(run('Prev').message).toBe('→ Spot 1')
    expect(run('Prev').message).toBe('→ Spot 3')
    expect(run('All').message).toBe('All: 3 fixtures')
    run('Next')
    run('Set')
    expect(api.selection).toEqual(['mh1'])
  })

  it('Align', () => {
    run('Align ><')
    expect(api.align).toBe('><')
    run('Align Off')
    expect(api.align).toBeNull()
  })
})

// ============================================================
// Playback
// ============================================================

describe('playback', () => {
  it('Go / Go- / Pause act on the selected sequence, else the first', () => {
    run('Go')
    api.selectedCuelist = 'cl-verse'
    run('Go')
    run('Go-')
    run('Back')
    run('Pause')
    expect(api.calls.map(c => [c.method, c.args[0]])).toEqual([['go', 'cl-intro'], ['go', 'cl-verse'], ['goBack', 'cl-verse'], ['goBack', 'cl-verse'], ['pause', 'cl-verse']])
  })

  it('Go on every kind of object', () => {
    run('Go Sequence 2')
    run('Go Scene 3')
    run('Go Executor 1.2')
    run('Go Macro 1')
    run('Go Chase 1')
    run('Go Effect 1')
    run('Go Cue 2 Sequence 1')
    expect(api.callsOf('go')).toEqual([['cl-verse'], ['cl-chorus']])
    expect(api.callsOf('executorPress')[0]).toEqual([{ page: 0, col: 0, row: 1 }, 'down', { fn: 'go' }])
    expect(api.callsOf('runMacro')).toEqual([['m-reset']])
    expect(api.chases[0].isPlaying).toBe(true)
    expect(api.effects[0].isRunning).toBe(true)
    expect(api.callsOf('goto')).toEqual([['cl-intro', 2]])
    expect(run('Go Group 1').ok).toBe(false)
  })

  it('Goto a cue of the selected or named sequence', () => {
    expect(run('Goto 2').message).toBe('Cue 2 of scene 1 “Intro”')
    run('Goto Cue 1.5 Sequence 2')
    run('Goto Sequence 2 Cue 2')
    expect(api.callsOf('goto')).toEqual([['cl-intro', 2], ['cl-verse', 1.5], ['cl-verse', 2]])
    expect(run('Goto Cue 9')).toMatchObject({ ok: false, message: 'Cue 9 not found' })
    expect(run('Goto Cue 1 Sequence 8')).toMatchObject({ ok: false, message: 'Sequence 8 not found' })
  })

  it('Off / Release on objects; Release alone releases everything', () => {
    run('Off 2')
    run('Off Executor 1.1')
    run('Off Macro 1')
    run('Chase 1')
    run('Off Chase 1')
    run('Fixture 1 Thru 4 At 50')
    run('Off Group 1')
    expect(api.callsOf('off')).toEqual([['cl-verse']])
    expect(api.callsOf('executorPress')[0][2]).toEqual({ fn: 'off' })
    expect(api.callsOf('stopMacro')).toEqual([['m-reset']])
    expect(api.chases[0].isPlaying).toBe(false)
    expect(api.programmer.size).toBe(0)
    run('Release')
    expect(api.callsOf('releaseAll').length).toBe(1)
    run('Fixture 5 At 50')
    run('Release Fixture 5')
    expect(api.programmer.size).toBe(0)
  })

  it('Page n / + / -', () => {
    run('Page 2')
    expect(api.currentPage).toBe(1)
    run('Page +')
    expect(api.currentPage).toBe(1)
    run('Page -')
    run('Page -')
    expect(api.currentPage).toBe(0)
    expect(run('Page 17').ok).toBe(false)
    run('Page 2')
    run('Executor 3')
    expect(api.callsOf('executorPress').at(-1)?.[0]).toEqual({ page: 1, col: 0, row: 2 })
  })

  it('Oops undoes, Redo redoes', () => {
    expect(run('Oops')).toMatchObject({ ok: false, message: 'Nothing to undo' })
    run('Label Group 1 "Front"')
    expect(run('Oops').message).toBe('Undone: Label Group 1 "Front"')
    expect(api.groups[0].name).toBe('Spots')
    run('Redo')
    expect(api.groups[0].name).toBe('Front')
    expect(run('Redo').ok).toBe(false)
  })
})

// ============================================================
// Store / Update
// ============================================================

describe('store & update', () => {
  it('needs something in the programmer', () => {
    expect(run('Store')).toMatchObject({ ok: false, level: 'warning' })
    expect(api.undoLabels).toEqual([])
  })

  it('Store = next cue of the selected sequence; a new sequence when none is selected', () => {
    run('Fixture 5 At 50')
    api.selectedCuelist = 'cl-intro'
    expect(run('Store').message).toBe('Stored cue 4 in scene 1 “Intro”')
    api.selectedCuelist = null
    run('Store')
    const created = api.cuelists.at(-1)!
    expect(created.number).toBe(4)
    expect(created.cues.map(c => c.number)).toEqual([1])
    expect(api.selectedCuelist).toBe(created.id)
    expect(api.undoLabels).toEqual(['Store', 'Store'])
    run('Oops')
    expect(api.cuelists.length).toBe(3)
  })

  it('Store Cue n on an existing cue asks Merge / Overwrite / Cue only / Cancel', async () => {
    run('Fixture 7 At 70')
    api.selectedCuelist = 'cl-intro'
    api.askAnswer = 'overwrite'
    const res = run('Store Cue 1')
    expect(res.pending).toBeDefined()
    expect(api.questions[0].question).toBe('Cue 1 of scene 1 “Intro” already exists')
    expect(api.questions[0].choices.map(c => c.id)).toEqual(['merge', 'overwrite', 'cueonly', 'cancel'])
    expect(api.questions[0].fallback).toBe('merge')
    const final = await res.pending!
    expect(final).toMatchObject({ ok: true, message: 'Cue 1 of scene 1 “Intro” stored (Overwrite)', undoLabel: 'Store Cue 1' })
    expect(api.cuelists[0].cues[0].values).toEqual([{ fixtureId: 'd7', channelName: 'Intensity', value: 179 }])
    expect(api.undoLabels).toEqual(['Store Cue 1'])

    api.askAnswer = null
    const cancelled = await run('Store Cue 2').pending!
    expect(cancelled).toMatchObject({ ok: false, message: 'Store cancelled' })
    expect(api.undoLabels).toEqual(['Store Cue 1'])

    api.askAnswer = 'merge'
    await run('Store Cue 2').pending
    expect(api.cuelists[0].cues[1].values.map(v => v.fixtureId)).toEqual(['d6', 'd7'])
  })

  it('an option answers the question in advance; macros merge without asking', () => {
    run('Fixture 7 At 70')
    api.selectedCuelist = 'cl-intro'
    const res = run('Store Cue 1 /overwrite')
    expect(res.pending).toBeUndefined()
    expect(api.cuelists[0].cues[0].values.map(v => v.fixtureId)).toEqual(['d7'])
    const inMacro = run('Store Cue 2', { ...ctx, macro: 'm-reset' })
    expect(inMacro.pending).toBeUndefined()
    expect(api.questions).toEqual([])
    expect(api.cuelists[0].cues[1].values.map(v => v.fixtureId)).toEqual(['d6', 'd7'])
    expect(api.callsOf('storeCue').map(c => (c[2] as { mode: string }).mode)).toEqual(['overwrite', 'merge'])
  })

  it('Store Cue n Sequence s, ranges, filters, cue-only / remove modes', () => {
    run('Fixture 1 At 50')
    run('Fixture 1 Preset 4.1')
    run('Store Cue 4 Sequence 2 /filter=color')
    const q4 = api.cuelists[1].cues.find(c => c.number === 4)!
    expect(q4.values.map(v => v.channelName)).toEqual(['Red'])
    run('Store Cue 1 Thru 2 Sequence 1 /cueonly')
    expect(api.callsOf('storeCue').slice(1).map(c => [c[0], c[1], (c[2] as { mode: string }).mode])).toEqual([['cl-intro', 1, 'cueonly'], ['cl-intro', 2, 'cueonly']])
    expect(api.undoLabels.at(-1)).toBe('Store Cue 1 Thru 2 Sequence 1 /cueonly')
    run('Store Cue 1 Sequence 9')
    expect(api.cuelists.at(-1)).toMatchObject({ number: 9 })
    expect(api.undoLabels.at(-1)).toBe('Store Cue 1 Sequence 9')
  })

  it('Store Sequence / Preset / Group / Executor', () => {
    run('Fixture 1 Thru 2 At Preset 4.2')
    run('Store Sequence 5 "Finale"')
    expect(api.cuelists.at(-1)).toMatchObject({ number: 5, name: 'Finale' })
    run('Store Sequence 2')
    expect(api.cuelists[1].cues.map(c => c.number)).toEqual([1, 1.5, 2, 3])
    expect(run('Store Preset 4.3 "Deep"').message).toBe('Stored preset 4.3 “Deep”')
    expect(api.presets.at(-1)).toMatchObject({ type: 'color', number: 3, name: 'Deep' })
    run('Store Preset 2.2 /global')
    expect(api.callsOf('storePreset').at(-1)).toEqual(['position', 2, { scope: 'global' }])
    run('Store Preset 7')
    expect(api.presets.at(-1)).toMatchObject({ type: 'full', number: 7 })
    expect(run('Store Group 5 "Front"').message).toBe('Stored group 5 “Front” (2 fixtures)')
    run('Fixture 3')
    run('Store Group 5')
    expect(api.groups.at(-1)?.fixtureIds).toEqual(['mh1', 'mh2', 'mh3'])
    run('Store Group 5 /overwrite')
    expect(api.groups.at(-1)?.fixtureIds).toEqual(['mh3'])
    run('Store Executor 2.1')
    expect(api.cell(1, 0, 0)).toMatchObject({ kind: 'cuelist' })
    expect(api.undoLabels.at(-1)).toBe('Store Executor 2.1')
    run('Oops')
    expect(api.cell(1, 0, 0)).toBeNull()
    run('Store Executor 1.1')
    expect(api.cuelists[0].cues.length).toBe(4)
    expect(run('Store Executor 1.2').ok).toBe(false)
    expect(run('Store Macro 1').ok).toBe(false)
  })

  it('Update: active cues and source presets; Update Cue / Preset', () => {
    expect(run('Update').ok).toBe(false)
    run('Fixture 1 At Preset 4.1')
    api.setAttributeValues([{ fixtureId: 'mh1', channelName: 'Red', value: 200, meta: { presetId: 'pr-red' } }])
    expect(run('Update').message).toBe('Updated 0 cue(s) and 1 preset(s)')
    expect(api.presets.find(p => p.id === 'pr-red')!.values.mh1.Red).toBe(200)
    api.selectedCuelist = 'cl-intro'
    run('Fixture 5 At 10')
    run('Update Cue 1')
    expect(api.cuelists[0].cues[0].values).toEqual([{ fixtureId: 'd5', channelName: 'Intensity', value: 26 }, expect.objectContaining({ fixtureId: 'mh1' })])
    expect(run('Update Cue 7').ok).toBe(false)
    run('Update Preset 4.2')
    expect(api.callsOf('storePreset').at(-1)).toEqual(['color', 2, { mode: 'merge' }])
    expect(run('Update Preset 4.8').ok).toBe(false)
  })
})

// ============================================================
// Delete / Copy / Move / Label / Assign
// ============================================================

describe('object editing', () => {
  it('Delete each kind of object; Oops brings it back', () => {
    api.selectedCuelist = 'cl-intro'
    run('Delete Cue 1 Thru 2')
    expect(api.cuelists[0].cues.map(c => c.number)).toEqual([3])
    run('Oops')
    expect(api.cuelists[0].cues.length).toBe(3)
    run('Delete Sequence 3')
    expect(api.cuelists.map(c => c.name)).toEqual(['Intro', 'Verse'])
    run('Delete Preset 4.1 + 4.2')
    expect(api.presets.map(p => p.name)).toEqual(['Look', 'Half', 'Center'])
    run('Delete Group 3')
    run('Delete Macro 2')
    expect(api.macros.map(x => x.name)).toEqual(['Reset'])
    run('Delete Executor 1.1')
    expect(api.cell(0, 0, 0)).toBeNull()
    expect(run('Delete Executor 1.1')).toMatchObject({ ok: false, message: 'Executor 1.1 is empty' })
    expect(run('Delete Fixture 1').ok).toBe(false)
    expect(api.undoLabels.length).toBe(5)
  })

  it('Copy / Move cues, presets, groups, macros, sequences, executors', () => {
    api.selectedCuelist = 'cl-intro'
    run('Copy Cue 1 At 5')
    expect(api.cuelists[0].cues.map(c => c.number)).toEqual([1, 2, 3, 5])
    expect(run('Copy Cue 2 At 5')).toMatchObject({ ok: false, message: 'Cue 5 already exists — add /overwrite to replace it' })
    run('Copy Cue 2 At Cue 7 Sequence 2')
    expect(api.cuelists[1].cues.map(c => c.number)).toContain(7)
    run('Move Cue 5 At 2.5')
    expect(api.cuelists[0].cues.map(c => c.number)).toEqual([1, 2, 2.5, 3])
    run('Copy Preset 4.1 At 4.5')
    expect(api.presets.at(-1)).toMatchObject({ type: 'color', number: 5, name: 'Red' })
    expect(run('Copy Preset 4.1 At 2.5').ok).toBe(false)
    run('Move Preset 4.5 At 6')
    expect(api.presets.at(-1)?.number).toBe(6)
    run('Copy Group 1 At 6')
    expect(api.groups.at(-1)).toMatchObject({ number: 6, name: 'Spots' })
    expect(run('Copy Group 1 At 2').ok).toBe(false)
    run('Copy Macro 1 At 4')
    expect(api.macros.at(-1)).toMatchObject({ number: 4, name: 'Reset' })
    run('Move Macro 4 At 8')
    expect(api.macros.at(-1)?.number).toBe(8)
    run('Copy Sequence 1 At 7')
    expect(api.cuelists.at(-1)).toMatchObject({ number: 7, name: 'Intro' })
    expect(api.cuelists.at(-1)?.cues.length).toBe(4)
    run('Copy Executor 1.1 At 2.1')
    expect(api.cell(1, 0, 0)).toMatchObject({ kind: 'cuelist', id: 'cl-intro' })
    run('Move Executor 1.2 At 2.8')
    expect([api.cell(0, 0, 1), api.cell(1, 1, 3)?.id]).toEqual([null, 'ch-rainbow'])
    expect(run('Copy Cue 1')).toMatchObject({ ok: false })
  })

  it('Label one or several objects', () => {
    run('Label Group 1 Thru 2 "Side"')
    expect(api.groups.map(g => g.name)).toEqual(['Side 1', 'Side 2', 'Pars'])
    run('Label Sequence 1 "Opening"')
    run('Label Cue 2 Sequence 1 "Big look"')
    run('Label Preset 4.1 "Rouge"')
    run('Label Macro 1 "Init"')
    expect([api.cuelists[0].name, api.cuelists[0].cues[1].name, api.presets[3].name, api.macros[0].name]).toEqual(['Opening', 'Big look', 'Rouge', 'Init'])
    expect(api.undoLabels.length).toBe(5)
    expect(run('Label Fixture 1 "x"').ok).toBe(false)
  })

  it('Assign objects to executors; button functions', () => {
    expect(run('Assign Sequence 3 At Executor 2.5').message).toBe('Sequence 3 “Chorus” assigned to executor 2.5')
    expect(api.cell(1, 1, 0)).toMatchObject({ kind: 'cuelist', id: 'cl-chorus' })
    run('Assign Chase 1 At 1.8 /button=flash')
    expect(api.cell(0, 1, 3)).toMatchObject({ kind: 'chase', id: 'ch-rainbow', button: 'flash' })
    run('Assign Macro 2 At Executor 1.32')
    expect(api.cell(0, 7, 3)).toMatchObject({ kind: 'macro', id: 'm-loop' })
    run('Assign Group 2 At Executor 2.2')
    run('Assign Effect 1 At Executor 2.3')
    run('Assign Speed 1 At Executor 2.4')
    expect([api.cell(1, 0, 1)?.kind, api.cell(1, 0, 2)?.kind, api.cell(1, 0, 3)?.kind]).toEqual(['group', 'effect', 'speed'])
    run('Assign Executor 1.1 /button=go')
    expect(api.cell(0, 0, 0)).toMatchObject({ kind: 'cuelist', id: 'cl-intro', button: 'go' })
    expect(run('Assign Executor 2.8 /button=go').ok).toBe(false)
    expect(run('Assign Sequence 3').ok).toBe(false)
    expect(run('Assign Sequence 9 At Executor 1.1').ok).toBe(false)
    expect(run('Assign Fixture 1 At Executor 1.1').ok).toBe(false)
    // A destination page that does not exist yet is created
    expect(run('Assign Sequence 3 At Executor 4.1').ok).toBe(true)
    expect(api.pages).toHaveLength(4)
    expect(api.cell(3, 0, 0)).toMatchObject({ kind: 'cuelist', id: 'cl-chorus' })
    expect(run('Assign Sequence 3 At Executor 17.1').ok).toBe(false)
  })
})

// ============================================================
// Undo transactions, errors, registry
// ============================================================

describe('one command line = one undo step', () => {
  it('every mutating command is one step named after the line', () => {
    run('Fixture 5 At 50')
    api.selectedCuelist = 'cl-intro'
    const lines = ['Store Cue 9', 'Label Cue 9 "Nine"', 'Copy Cue 9 At 10', 'Delete Cue 9 + 10', 'Store Group 4', 'Assign Sequence 2 At Executor 2.1', 'Park']
    for (const l of lines) {
      const res = run(l)
      expect(res.ok, l).toBe(true)
      expect(res.undoLabel, l).toBe(l)
    }
    expect(api.undoLabels).toEqual(lines)
    for (let i = 0; i < lines.length; i++) run('Oops')
    const fresh = createFakeShow()
    expect(api.cuelists).toEqual(fresh.cuelists)
    expect(api.groups).toEqual(fresh.groups)
    expect(api.pages).toEqual(fresh.pages)
  })

  it('reading commands create no undo step', () => {
    for (const l of ['Fixture 1 At 50', 'Go 2', 'Clear', 'Page 2', 'Highlight', 'Next', 'Goto 2', 'Blackout']) run(l)
    expect(api.undoLabels).toEqual([])
  })

  it('parse errors are translated messages; a throwing command is an error result', () => {
    expect(run('Florp 3')).toMatchObject({ ok: false, level: 'error', message: 'Unknown word “Florp”' })
    expect(run('Fixture 1 At')).toMatchObject({ ok: false, message: 'A value is missing (Full, Zero, 0-100 or Preset)' })
    expect(executeLine('Florp', { api, t: fr, now: () => 0 }).message).toBe('Mot inconnu « Florp »')
    const broken = { ...ctx, api: { ...api, getPatch: () => { throw new Error('boom') } } as unknown as FakeProApi }
    expect(executeLine('Fixture 1', broken)).toMatchObject({ ok: false, level: 'error', message: 'Command failed: boom' })
  })

  it('runCommandLine logs the line, then the answer of a question', async () => {
    useProStore.setState({ cliLog: [] })
    setCliContext(ctx)
    try {
      run('Fixture 5 At 50')
      api.selectedCuelist = 'cl-intro'
      const res = runCommandLine('Store Cue 1', 'remote-1')
      await res.pending
      const log = useProStore.getState().cliLog
      expect(log.map(l => [l.text, l.origin, l.ok])).toEqual([['Store Cue 1', 'remote-1', true], ['Store Cue 1', 'remote-1', true]])
      expect(log[1].message).toBe('Cue 1 of scene 1 “Intro” stored (Merge)')
    } finally {
      setCliContext(null)
    }
  })
})

// ============================================================
// Preview (expanded panel)
// ============================================================

describe('preview', () => {
  it('describes the objects and the value in EN and FR', () => {
    expect(previewLine('Group 2 + Fixture 7 At 50', ctx)).toBe('→ 4 fixtures, Group “Wash”, at 50%')
    expect(previewLine('Group 2 + 7', ctx)).toBe('→ 4 fixtures, Group “Wash”, Group 7?')
    expect(previewLine('Group 2 + Fixture 13 At 50', { ...ctx, t: fr })).toBe('→ 5 projecteurs, groupe « Wash », à 50 %')
    expect(previewLine('Fixture 1 Thru 8 At 0 Thru 100 Fade 2', ctx)).toBe('→ 8 fixtures, fan 0% → 100%, fade 2 s')
    expect(previewLine('Group 7', ctx)).toBe('→ no fixtures, Group 7?')
    api.selectedCuelist = 'cl-intro'
    expect(previewLine('Store Cue 5', ctx)).toBe('→ new cue 5 in “Intro”')
    expect(previewLine('Store Cue 2', ctx)).toBe('→ cue 2 of “Intro”')
    expect(previewLine('Go 2', ctx)).toBe('→ scene 2 “Verse”')
    expect(previewLine('Executor 1.1', ctx)).toBe('→ executor 1.1: “Intro”')
    expect(previewLine('Assign Sequence 3 At Executor 2.5', ctx)).toBe('→ scene 3 “Chorus”, to executor 2.5 (empty)')
    expect(previewLine('Fixture 1 At Preset 4.2', ctx)).toBe('→ 1 fixture, preset 4.2 “Blue”')
    expect(previewLine('DMX 1.1 Thru 1.10 At 50', ctx)).toBe('→ 10 DMX channels, at 50%')
    expect(previewLine('Macro 1', ctx)).toBe('→ Macro 1 “Reset”')
    expect(previewLine('Fixture 1 At', ctx)).toBe('')
    expect(previewLine('', ctx)).toBe('')
    expect(previewLine('Clear', ctx)).toBe('')
    expect(previewLine('Go', ctx)).toBe('→ scene 1 “Intro”')
    expect(previewLine('Store', ctx)).toBe('→ new cue 4 in “Intro”')
    api.selectedCuelist = null
    expect(previewLine('Store', ctx)).toBe('→ new Sequence')
    expect(previewLine('Go-', { ...ctx, t: fr })).toBe('→ scène 1 «\u00a0Intro\u00a0»')
  })

  it('bare value previews the active selection', () => {
    run('Group 1')
    expect(previewLine('At 50', ctx)).toBe('→ 4 fixtures, at 50%')
    expect(previewLine('At 50', { ...ctx, t: fr })).toBe('→ 4 projecteurs, à 50 %')
  })
})

// ============================================================
// Macros (fake clock)
// ============================================================

class FakeClock implements MacroClock {
  now = 0
  private timers: { at: number; fn: () => void; id: number }[] = []
  private seq = 0
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq
    this.timers.push({ at: this.now + ms, fn, id })
    return id
  }
  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter(t => t.id !== h)
  }
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at)
      const next = this.timers[0]
      if (!next || next.at > end) break
      this.timers.shift()
      this.now = next.at
      next.fn()
    }
    this.now = end
  }
}

describe('macro runner', () => {
  function setup() {
    const clock = new FakeClock()
    const ran: string[] = []
    const runner = createMacroRunner({
      getMacros: () => api.macros,
      clock,
      runLine: (line, id) => {
        ran.push(line)
        executeLine(line, { ...ctx, macro: id })
      }
    })
    api.onRunMacro = id => { runner.run(id) }
    api.stopMacro = id => { api.calls.push({ method: 'stopMacro', args: [id] }); runner.stop(id) }
    return { clock, ran, runner }
  }

  it('runs lines in order and waits between them', () => {
    const { clock, ran, runner } = setup()
    api.macros.push({ id: 'm-show', number: 5, name: 'Show', lines: [{ command: 'Group 2', wait: 2 }, { command: 'At 50', wait: 0.5 }, { command: 'Go 2' }] })
    expect(runner.run(5)).toBe(true)
    expect(ran).toEqual(['Group 2'])
    clock.advance(1999)
    expect(ran).toEqual(['Group 2'])
    clock.advance(1)
    expect(ran).toEqual(['Group 2', 'At 50'])
    expect(runner.isRunning('m-show')).toBe(true)
    clock.advance(500)
    expect(ran).toEqual(['Group 2', 'At 50', 'Go 2'])
    expect(runner.isRunning('m-show')).toBe(false)
    expect(api.value('d5', 'Intensity')).toBe(128)
    expect(api.callsOf('go')).toEqual([['cl-verse']])
  })

  it('Off Macro n cancels a waiting macro; a failing line does not stop it', () => {
    const { clock, ran, runner } = setup()
    api.macros.push({ id: 'm-w', number: 6, name: 'Wait', lines: [{ command: 'Florp' }, { command: 'Fixture 5', wait: 10 }, { command: 'Full' }] })
    run('Macro 6')
    expect(ran).toEqual(['Florp', 'Fixture 5'])
    expect(runner.isRunning('m-w')).toBe(true)
    expect(run('Off Macro 6').message).toBe('Macro 6 “Wait” stopped')
    clock.advance(20000)
    expect(ran).toEqual(['Florp', 'Fixture 5'])
    expect(runner.running()).toEqual([])
  })

  it('a macro never starts itself (directly or through another macro)', () => {
    const { ran, runner } = setup()
    const res = executeLine('Macro 2', { ...ctx, macro: 'm-loop' })
    expect(res).toMatchObject({ ok: false, message: 'A macro cannot start itself' })
    api.macros.push({ id: 'm-a', number: 7, name: 'A', lines: [{ command: 'Macro 8' }, { command: 'Fixture 1' }] })
    api.macros.push({ id: 'm-b', number: 8, name: 'B', lines: [{ command: 'Macro 7' }, { command: 'Fixture 2' }] })
    expect(runner.run(7)).toBe(true)
    expect(ran).toEqual(['Macro 8', 'Macro 7', 'Fixture 2', 'Fixture 1'])
    expect(runner.run(404)).toBe(false)
  })

  it('a macro stopping itself ends at once; Store inside a macro never asks', () => {
    const { ran, runner } = setup()
    run('Fixture 5 At 50')
    api.selectedCuelist = 'cl-intro'
    api.macros.push({ id: 'm-s', number: 9, name: 'S', lines: [{ command: 'Store Cue 1' }, { command: 'Off Macro 9' }, { command: 'Full' }] })
    runner.run(9)
    expect(ran).toEqual(['Store Cue 1', 'Off Macro 9'])
    expect(api.questions).toEqual([])
    expect(api.cuelists[0].cues[0].values.map(v => v.fixtureId)).toEqual(['d5'])
  })

  it('stopAll and nesting depth', () => {
    const { runner } = setup()
    api.macros = Array.from({ length: 12 }, (_, i) => ({ id: `n${i + 1}`, number: i + 1, name: `N${i + 1}`, lines: [{ command: `Macro ${i + 2}`, wait: 1 }] }))
    runner.run(1)
    expect(runner.running().length).toBe(8)
    runner.stopAll()
    expect(runner.running()).toEqual([])
  })
})

// ============================================================
// History
// ============================================================

describe('history', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = { ...initial }
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v } }
  }

  it('keeps 200 lines, newest first, without consecutive duplicates, in storage', () => {
    const storage = memoryStorage()
    const h = createCliHistory({ storage })
    for (let i = 0; i < 205; i++) h.push(`Fixture ${i}`)
    h.push('Fixture 204')
    h.push('  ')
    expect(h.lines().length).toBe(200)
    expect(h.lines()[0]).toBe('Fixture 204')
    expect(JSON.parse(storage.data['photonboard.cli.history'])[0]).toBe('Fixture 204')
    expect(createCliHistory({ storage }).lines().length).toBe(200)
  })

  it('arrow recall keeps the draft', () => {
    const h = createCliHistory({ storage: null })
    h.push('Go 1')
    h.push('Go 2')
    expect(h.recall(1, 'Fix')).toBe('Go 2')
    expect(h.recall(1, 'Go 2')).toBe('Go 1')
    expect(h.recall(1, 'Go 1')).toBeNull()
    expect(h.recall(-1, 'Go 1')).toBe('Go 2')
    expect(h.recall(-1, 'Go 2')).toBe('Fix')
    expect(h.recall(-1, 'Fix')).toBeNull()
  })

  it('survives broken or throwing storage', () => {
    const bad = { getItem: () => '{nope', setItem: () => { throw new Error('quota') } }
    const h = createCliHistory({ storage: bad })
    expect(h.lines()).toEqual([])
    expect(() => h.push('Go')).not.toThrow()
    expect(h.lines()).toEqual(['Go'])
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
    expect(createCliHistory({ storage: throwing }).lines()).toEqual([])
  })
})

// ============================================================
// Help texts
// ============================================================

describe('help', () => {
  it('every command, keyword and expectation has a help text (EN and FR)', () => {
    for (const c of listCommands()) expect(hasTranslation(`pro.cli.help.${c.helpKey}`), c.keyword).toBe(true)
    for (const k of ['fixture', 'group', 'preset', 'cue', 'sequence', 'executor', 'page', 'macro', 'chase', 'effect', 'speed', 'dmx', 'at', 'thru', 'full', 'zero', 'if', 'on', 'go-', 'clearall']) {
      expect(hasTranslation(helpKeyOf(k)), k).toBe(true)
    }
    for (const line of ['', 'Go ', 'Store ', 'Label Group 1 ', 'Fade ', 'Fixture 1 At ', 'Fixture 1 At 50 Fade ', 'Park ', 'Store Cue 1 ', 'Gobo ']) {
      for (const e of parse(line).expected) if (e.helpKey) expect(hasTranslation(`pro.cli.help.${e.helpKey}`), `${line}: ${e.helpKey}`).toBe(true)
    }
  })

  it('the cheat sheet has a translated text for every line, and every syntax parses', () => {
    expect(hasTranslation('pro.cli.cheatsheet.title')).toBe(true)
    for (const s of CLI_CHEATSHEET) {
      expect(hasTranslation(`pro.cli.cheatsheet.sections.${s.id}`), s.id).toBe(true)
      for (const l of s.lines) {
        expect(hasTranslation(`pro.cli.cheatsheet.lines.${l.key}`), l.key).toBe(true)
        if (l.key === 'abbreviations') continue
        const first = l.syntax.split(' · ')[0]
        expect(parse(first).error, first).toBeUndefined()
      }
    }
    expect(fr('pro.cli.cheatsheet.lines.storeCue' as TranslationKey)).toContain('Fusionner')
  })
})


describe('messages of unnamed objects', () => {
  it('drop the empty quotes (EN “” and FR « »)', async () => {
    const { stripEmptyQuotes } = await import('./commands/util')
    expect(stripEmptyQuotes('Stored preset 1.1 “”')).toBe('Stored preset 1.1')
    expect(stripEmptyQuotes('Macro 1 “” started')).toBe('Macro 1 started')
    expect(stripEmptyQuotes('Preset 1.1 « » mémorisé')).toBe('Preset 1.1 mémorisé')
    expect(stripEmptyQuotes('Preset 1.1 «  »')).toBe('Preset 1.1')
    expect(stripEmptyQuotes('Scene “Wash”')).toBe('Scene “Wash”')
  })
})
