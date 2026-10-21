import { readFileSync } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import type { ImportContext, ImportedShowFragment } from '../../../shared/interchange'
import type { FixtureDefinition } from '../../../shared/types'
import { normalizeShow } from '../../../shared/show-format'
import { detectImporter, getImporter } from '../registry'
import { findChannelForAttribute, maAttributeInfo } from './attributes'
import { splitTypeName } from './build'
import { ma2XmlImporter, ma3XmlImporter, zipEntryNames } from './index'
import { splitMa2Address } from './ma2'
import { parseMa3Patch } from './ma3'
import { cueNumber, maTime } from './xml'

const FIX = join(__dirname, '../../../../test-fixtures/interchange')
const read = (p: string) => new Uint8Array(readFileSync(join(FIX, p)))

const MAC250: FixtureDefinition = {
  id: 'ofl/martin/mac-250-plus', name: 'MAC 250+', manufacturer: 'Martin', categories: ['Moving Head'],
  channels: {
    Shutter: { name: 'Shutter', type: 'shutter' },
    Dimmer: { name: 'Dimmer', type: 'intensity' },
    'Color Wheel': { name: 'Color Wheel', type: 'color' },
    Gobo: { name: 'Gobo', type: 'gobo' },
    'Gobo Rotation': { name: 'Gobo Rotation', type: 'gobo' },
    Pan: { name: 'Pan', type: 'pan' },
    'Pan fine': { name: 'Pan fine', type: 'pan', fineOf: 'Pan' },
    Tilt: { name: 'Tilt', type: 'tilt' },
    'Tilt fine': { name: 'Tilt fine', type: 'tilt', fineOf: 'Tilt' }
  },
  modes: [
    { name: 'Mode 4', channels: ['Shutter', 'Dimmer', 'Color Wheel', 'Gobo', 'Pan', 'Tilt'], channelCount: 6 },
    { name: 'Mode 2', channels: ['Shutter', 'Dimmer', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Pan', 'Pan fine', 'Tilt', 'Tilt fine'], channelCount: 9 }
  ],
  physical: { panRange: 540, tiltRange: 257 }
}

function makeCtx(): ImportContext & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async findFixture(manufacturer, model, count) {
      calls.push(`${manufacturer}|${model}|${count ?? ''}`)
      if (/mac 250\+/i.test(model)) return MAC250
      return null
    },
    async parseGdtf() { return null },
    async parseQxf() { return null }
  }
}

/** The fragment must survive the show normaliser unchanged in substance */
function normalises(frag: ImportedShowFragment): void {
  const { show } = normalizeShow({
    version: '3', name: frag.name, createdAt: '', modifiedAt: '', patch: frag.patch, groups: frag.groups,
    presets: frag.presets, cuelists: frag.cuelists, chases: frag.chases, effects: frag.effects,
    midiMappings: [], macros: frag.macros, stageLayout: { width: 10, height: 10, fixtures: [] }
  })
  expect(show.patch).toHaveLength(frag.patch.length)
  expect(show.cuelists.map(c => c.cues.length)).toEqual(frag.cuelists.map(c => c.cues.length))
  expect(show.presets).toHaveLength(frag.presets.length)
}

const pct = (p: number) => Math.round((p / 100) * 255)
const deg16 = (deg: number, range: number) => Math.round((0.5 + deg / range) * 65535)

describe('grandMA helpers', () => {
  it('parses MA times and cue numbers', () => {
    expect(maTime('3.000')).toBe(3)
    expect(maTime('1m30')).toBe(90)
    expect(maTime('1:30')).toBe(90)
    expect(maTime('CueTiming')).toBeUndefined()
    expect(maTime(String(2 * 16777216))).toBe(2)
    expect(cueNumber('  2.5')).toBe(2.5)
    expect(cueNumber('1', '500')).toBe(1.5)
  })
  it('splits addresses and type names', () => {
    expect(splitMa2Address(7)).toEqual({ universe: 0, address: 7 })
    expect(splitMa2Address(7980)).toEqual({ universe: 15, address: 300 })
    expect(splitMa2Address(0)).toBeNull()
    expect(parseMa3Patch('2.001')).toEqual({ universe: 1, address: 1 })
    expect(parseMa3Patch('')).toBeNull()
    expect(splitTypeName('3 Mac 250+ Mode 2')).toEqual({ manufacturer: '', model: 'Mac 250+ Mode 2' })
    expect(splitTypeName('Robe@Robin MegaPointe')).toEqual({ manufacturer: 'Robe', model: 'Robin MegaPointe' })
    expect(splitTypeName("FixtureType 4 'Spot 18'")).toEqual({ manufacturer: '', model: 'Spot 18' })
  })
  it('maps MA attribute names to PhotonBoard channels', () => {
    expect(maAttributeInfo('ColorAdd_R').key).toBe('red')
    expect(maAttributeInfo('COLORRGB3').key).toBe('blue')
    expect(maAttributeInfo('GOBO1_POS').key).toBe('gobo rotation')
    const mode = MAC250.modes[1]
    expect(findChannelForAttribute(MAC250, mode, 'DIM')).toBe('Dimmer')
    expect(findChannelForAttribute(MAC250, mode, 'Pan')).toBe('Pan')
    expect(findChannelForAttribute(MAC250, mode, 'COLOR1')).toBe('Color Wheel')
    expect(findChannelForAttribute(MAC250, mode, 'Gobo1_Pos')).toBe('Gobo Rotation')
    expect(findChannelForAttribute(MAC250, mode, 'Zoom')).toBeNull()
  })
})

describe('grandMA2 XML import', () => {
  it('detects grandMA2 XML and not grandMA3', () => {
    const head = read('ma2/fixture-layers-testshow.xml')
    expect(ma2XmlImporter.detect('x.xml', head)).toBe(1)
    expect(ma3XmlImporter.detect('x.xml', head)).toBe(0)
    expect(detectImporter('x.xml', head)?.importer.info.id).toBe('ma2-xml')
  })

  it('imports a real fixture layer export (patch, types, positions)', async () => {
    const ctx = makeCtx()
    const frag = await ma2XmlImporter.parse(read('ma2/fixture-layers-testshow.xml'), 'testshow.xml', ctx)
    expect(frag.format).toBe('ma2-xml')
    expect(frag.sourceApp).toBe('grandMA2 3.9.60')
    expect(frag.name).toBe('testshow')
    expect(frag.patch).toHaveLength(12)
    const mac1 = frag.patch.find(p => p.id === 'ma-fix-1')!
    expect(mac1).toMatchObject({ fixtureDefId: MAC250.id, modeName: 'Mode 2', universe: 0, address: 7, fid: 1, name: 'Mac250+2 1' })
    // MA2 z is up → PhotonBoard y
    expect(mac1.position3D).toEqual({ x: -5, y: 7, z: -3 })
    const dim1 = frag.patch.find(p => p.id === 'ma-ch-1')!
    expect(dim1).toMatchObject({ fixtureDefId: 'ma-import/generic-dimmer', address: 1 })
    expect(dim1.fid).toBeUndefined() // fixture 1 already owns fid 1
    expect(frag.fixtures.map(f => f.id)).toEqual(['ma-import/generic-dimmer']) // MAC from the catalog is referenced, not embedded
    expect(ctx.calls.some(c => c.includes('Mac 250+ Mode 2|9'))).toBe(true)
    normalises(frag)
  })

  it('imports sequences, presets, groups, effects from a zip with the patch', async () => {
    const zip = new AdmZip()
    for (const f of ['fixture-layers-testshow.xml', 'sequence-testshow.xml', 'presets-groups-effect.xml', 'macros-3.9.60.xml']) {
      zip.addFile(`importexport/${f}`, Buffer.from(read(`ma2/${f}`)))
    }
    const bytes = new Uint8Array(zip.toBuffer())
    expect(zipEntryNames(bytes.subarray(0, 65536)).length).toBeGreaterThan(0)
    expect(ma3XmlImporter.detect('show.zip', bytes.subarray(0, 65536))).toBeGreaterThan(0.5)
    const frag = await ma3XmlImporter.parse(bytes, 'show.zip', makeCtx())
    expect(frag.format).toBe('ma2-xml')

    // Sequence
    expect(frag.cuelists).toHaveLength(1)
    const cl = frag.cuelists[0]
    expect(cl.name).toBe('Main')
    expect(cl.cues.map(c => c.number)).toEqual([1, 1.5, 2])
    const [c1, c2, c3] = cl.cues
    expect(c1).toMatchObject({ name: 'Opening', fadeIn: 3, fadeOut: 5 })
    const val = (cue: typeof c1, fixtureId: string, ch: string) => cue.values.find(v => v.fixtureId === fixtureId && v.channelName === ch)?.value
    expect(val(c1, 'ma-ch-1', 'Dimmer')).toBe(255)
    expect(val(c1, 'ma-ch-2', 'Dimmer')).toBe(pct(50))
    expect(val(c1, 'ma-fix-1', 'Dimmer')).toBe(pct(75))
    // PAN -45° on a 540° fixture, 16 bit
    const p16 = deg16(-45, 540)
    expect(val(c1, 'ma-fix-1', 'Pan')).toBe(p16 >> 8)
    expect(val(c1, 'ma-fix-1', 'Pan fine')).toBe(p16 & 255)
    const t16 = deg16(30, 257)
    expect(val(c1, 'ma-fix-1', 'Tilt')).toBe(t16 >> 8)
    // Cue 1.5 triggers "Follow" → cue 1 follows
    expect(c1.followTime).toBe(0)
    expect(c1.followMode).toBe('after-fade')
    expect(c2).toMatchObject({ name: 'Follow-on', fadeIn: 2, delay: 1 })
    expect(c2.parts).toEqual([{ index: 1, name: 'Late', fade: 4, delay: 2 }])
    expect(c2.values.find(v => v.fixtureId === 'ma-fix-3')?.part).toBe(1)
    expect(c3).toMatchObject({ name: 'Blackout', fadeIn: 10, values: [] })

    // Fixture 42 is used in a cue but not in the layers → placeholder
    expect(frag.placeholderFixtureIds).toEqual(['ma-fix-42'])
    const ph = frag.patch.find(p => p.id === 'ma-fix-42')!
    expect(ph.fid).toBe(42)
    expect(ph.universe).toBe(1) // parking universe after the used one
    expect(frag.warnings.some(w => w.code === 'ma.placeholderFixtures')).toBe(true)

    // Presets: pool 2 = position (degrees), pool unknown + gobo values → gobo family
    const center = frag.presets.find(p => p.name === 'Center')!
    expect(center).toMatchObject({ type: 'position', number: 1, scope: 'selective' })
    expect(center.values['ma-fix-1'].Pan).toBe(32768 >> 8)
    expect(center.values['ma-fix-2'].Pan).toBe(deg16(-30.874996, 540) >> 8)
    const gobo = frag.presets.find(p => p.name === 'Gobo look')!
    expect(gobo.type).toBe('gobo')
    expect(gobo.values['ma-fix-1'].Gobo).toBe(pct(20))

    // Groups keep selection order
    const odd = frag.groups.find(g => g.name === 'Macs odd')!
    expect(odd.fixtureIds).toEqual(['ma-fix-5', 'ma-fix-1', 'ma-fix-3'])
    expect(odd.number).toBe(3)
    expect(frag.groups.find(g => g.name === 'Dimmers')!.fixtureIds).toEqual(['ma-ch-1', 'ma-ch-2'])
    expect(frag.patch.find(p => p.id === 'ma-fix-5')!.groupIds).toContain(odd.id)

    // Effect line → PhotonBoard effect
    expect(frag.effects).toHaveLength(1)
    expect(frag.effects[0]).toMatchObject({ name: 'Tilt wave', waveform: 'sine', channelType: 'Dimmer', depth: 255, fan: 360, fixtureIds: ['ma-fix-1', 'ma-fix-2', 'ma-fix-3'] })

    // Real macro export
    expect(frag.macros).toHaveLength(1)
    expect(frag.macros[0].name).toBe('Song Change')
    expect(frag.macros[0].lines).toEqual([
      { command: 'ClearAll' }, { command: 'Go+ Executor 1.1', wait: 2 }, { command: 'Macro "Song Change"' }
    ])
    normalises(frag)
  })
})

describe('grandMA3 XML import', () => {
  it('detects grandMA3 XML', () => {
    const head = read('ma3/sequence.xml')
    expect(ma3XmlImporter.detect('seq.xml', head)).toBe(1)
    expect(ma2XmlImporter.detect('seq.xml', head)).toBe(0)
    expect(detectImporter('seq.xml', head)?.importer.info.id).toBe('ma3-xml')
    expect(getImporter('ma3-xml')).toBe(ma3XmlImporter)
  })

  it('imports a patch export with its fixture type', async () => {
    const frag = await ma3XmlImporter.parse(read('ma3/patch.xml'), 'patch.xml', makeCtx())
    expect(frag.sourceApp).toBe('grandMA3 2.4.0.2')
    const spot = frag.fixtures.find(f => f.name === 'Spot 18')!
    expect(spot.manufacturer).toBe('Demo')
    expect(spot.modes[0].channels).toEqual(['Pan', 'Pan fine', 'Tilt', 'Tilt fine', 'Color Wheel', 'Gobo', 'Shutter', 'Dimmer'])
    expect(spot.channels.Pan.defaultValue).toBe(128)
    const s1 = frag.patch.find(p => p.fid === 101)!
    expect(s1).toMatchObject({ name: 'Spot 1', fixtureDefId: spot.id, universe: 0, address: 1 })
    expect(s1.position3D).toEqual({ x: -2, y: 6, z: 1.5 })
    expect(s1.rotation3D?.ry).toBeCloseTo(Math.PI / 2)
    expect(frag.patch.find(p => p.fid === 102)!.address).toBe(9)
    const front = frag.patch.find(p => p.id === 'ma-ch-11')!
    expect(front).toMatchObject({ fixtureDefId: 'ma-import/generic-dimmer', universe: 1, address: 1, fid: 11 })
    const unpatched = frag.patch.find(p => p.fid === 103)!
    expect(unpatched.universe).toBe(2) // parked after the highest used universe
    expect(frag.warnings.some(w => w.code === 'ma.unpatchedFixtures')).toBe(true)
  })

  it('imports sequences, presets and groups from a zipped gma3_library', async () => {
    const zip = new AdmZip()
    zip.addFile('gma3_library/patch/patch.xml', Buffer.from(read('ma3/patch.xml')))
    zip.addFile('gma3_library/datapools/sequences/Act 1.xml', Buffer.from(read('ma3/sequence.xml')))
    zip.addFile('gma3_library/datapools/presets/presets.xml', Buffer.from(read('ma3/presets-group.xml')))
    zip.addFile('gma3_library/datapools/macros/vivaldi.xml', Buffer.from(read('ma3/macro-vivaldi.xml')))
    zip.addFile('gma3_library/readme.txt', Buffer.from('hello'))
    const bytes = new Uint8Array(zip.toBuffer())
    expect(ma3XmlImporter.detect('lib.zip', bytes.subarray(0, 65536))).toBe(0.7)
    const frag = await ma3XmlImporter.parse(bytes, 'lib.zip', makeCtx())
    expect(frag.format).toBe('ma3-xml')

    const cl = frag.cuelists[0]
    expect(cl).toMatchObject({ name: 'Act 1', tracking: true, isLooping: false, priority: 70 })
    // OffCue and an empty CueZero are skipped
    expect(cl.cues.map(c => c.number)).toEqual([1, 2, 2.5, 3])
    const [c1, c2, c25, c3] = cl.cues
    expect(c1).toMatchObject({ name: 'Preset', fadeIn: 3, fadeOut: 5, delay: 0.5 })
    expect(c1.featureTiming).toEqual({ position: { fade: 6 }, colour: { fade: 1.5 } })
    expect(c1.parts).toEqual([{ index: 1, name: 'Late part', fade: 10, delay: 2 }])
    const v = (cue: typeof c1, fid: number, ch: string) => cue.values.find(x => x.fixtureId === `ma-fix-${fid}` && x.channelName === ch)
    expect(v(c1, 101, 'Dimmer')?.value).toBe(255)
    // AbsolutePhys -90° on a fixture type without range → 540° assumed
    expect(v(c1, 101, 'Pan')?.value).toBe(deg16(-90, 540) >> 8)
    expect(v(c1, 101, 'Pan fine')?.value).toBe(deg16(-90, 540) & 255)
    expect(v(c1, 101, 'Tilt')?.value).toBe(Math.round(0.75 * 65535) >> 8)
    // value stored from preset 4.1 keeps the link
    const red = frag.presets.find(p => p.name === 'Red')!
    expect(v(c1, 101, 'Color Wheel')).toMatchObject({ value: pct(20), presetId: red.id })
    expect(v(c1, 102, 'Dimmer')).toMatchObject({ value: pct(50), fade: 8 })
    expect(v(c1, 102, 'Gobo')).toMatchObject({ value: pct(40), part: 1 })
    expect(c1.values.find(x => x.fixtureId === 'ma-ch-11')?.value).toBe(pct(80))
    // TrigType Follow on cue 2 → cue 1 follows after its fade; Time on 2.5 → cue 2 follows 4 s after its GO
    expect(c1).toMatchObject({ followTime: 0, followMode: 'after-fade' })
    expect(c2).toMatchObject({ followTime: 4, followMode: 'after-go' })
    expect(c25.followTime).toBeNull()
    // phaser → first step; relative skipped; fixture 201 unknown → placeholder with a Red channel
    expect(v(c2, 101, 'Dimmer')?.value).toBe(255)
    expect(v(c2, 101, 'Tilt')).toBeUndefined()
    expect(v(c2, 201, 'Red')?.value).toBe(255)
    expect(frag.placeholderFixtureIds).toEqual(['ma-fix-201'])
    // physical strobe value (Hz) cannot be converted
    expect(c25.values).toEqual([])
    expect(c3.values).toHaveLength(1)
    const codes = frag.warnings.map(w => w.code)
    for (const code of ['ma3.phaser', 'ma.relativeValue', 'ma.physicalValue', 'ma.triggerUnsupported', 'ma.assumedRange', 'ma.macroSyntax']) {
      expect(codes).toContain(code)
    }

    // Presets
    expect(red).toMatchObject({ type: 'color', number: 1, scope: 'selective' })
    expect(red.values['ma-fix-101']['Color Wheel']).toBe(pct(20))
    const full = frag.presets.find(p => p.name === 'Full')!
    expect(full).toMatchObject({ type: 'intensity', number: 1, scope: 'universal', universal: { dimmer: 255 } })
    const floor = frag.presets.find(p => p.name === 'Floor')!
    expect(floor.type).toBe('position')
    expect(floor.values['ma-fix-101'].Tilt).toBe(deg16(-45, 270) >> 8)

    // Group selection order
    expect(frag.groups[0]).toMatchObject({ name: 'Spots R-L', fixtureIds: ['ma-fix-102', 'ma-fix-101', 'ma-ch-11'] })

    // Real grandMA3 macro export
    const mac = frag.macros.find(m => m.name === 'Macro vivaldi')!
    expect(mac.lines[0]).toEqual({ command: 'Store Sequence 100 Cue 1 thru 21', wait: 0.1 })
    expect(mac.lines.some(l => l.command === 'Label Sequence 100 Cue 1 "elsobumm"')).toBe(true)
    expect(frag.warnings.some(w => w.code === 'ma.skippedFiles')).toBe(true)
    normalises(frag)
  })

  it('returns what it can from a damaged file and never throws for recognised content', async () => {
    const bad = new TextEncoder().encode('<?xml version="1.0"?><GMA3 DataVersion="2.0"><Sequence Name="x"><Cue No="1"><Part><Phaser ID="abc" Attribute="Dimmer"/></Part></Cue></Sequence><Group Name="g"><SelectionData><Item ID="5"/></SelectionData></Group></GMA3>')
    const frag = await ma3XmlImporter.parse(bad, 'bad.xml', makeCtx())
    expect(frag.cuelists[0].cues[0].values).toEqual([])
    expect(frag.groups[0].fixtureIds).toEqual(['ma-fix-5'])
    const broken = new TextEncoder().encode('<GMA3 DataVersion="2.0"><Sequence Name="x"><Cue No="1"></Sequence>')
    const f2 = await ma3XmlImporter.parse(broken, 'broken.xml', makeCtx())
    expect(f2.format).toBe('ma3-xml')
    await expect(ma3XmlImporter.parse(new TextEncoder().encode('<foo/>'), 'foo.xml', makeCtx())).rejects.toThrow()
  })

  it('refuses DOCTYPE entity tricks', async () => {
    const evil = new TextEncoder().encode('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><GMA3 DataVersion="2"><Macro Name="&a;"/></GMA3>')
    const frag = await ma3XmlImporter.parse(evil, 'evil.xml', makeCtx())
    expect(frag.macros).toHaveLength(0)
    expect(frag.warnings.some(w => w.level === 'error')).toBe(true)
  })

  it('does not claim MVR or GDTF archives', () => {
    const zip = new AdmZip()
    zip.addFile('GeneralSceneDescription.xml', Buffer.from('<GeneralSceneDescription/>'))
    const head = new Uint8Array(zip.toBuffer()).subarray(0, 65536)
    expect(ma3XmlImporter.detect('rig.mvr', head)).toBe(0)
    expect(ma3XmlImporter.detect('rig.zip', head)).toBe(0)
  })
})
