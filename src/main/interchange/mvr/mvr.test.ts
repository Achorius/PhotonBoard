import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import AdmZip from 'adm-zip'
import type { ImportContext } from '../../../shared/interchange'
import type { FixtureDefinition, PatchEntry, ShowFile } from '../../../shared/types'
import { aimDirection as rendererAim, autoPosition as rendererAutoPosition } from '@renderer/components/visualizer/scene/layout-math'
import { parseGdtfArchive } from '../gdtf/gdtf-import'
import { attr, childText, kid, kids, parseXml } from '../gdtf/xml'
import { aimDirection, autoPosition, beamOf, compose, mountFromBeam, mvrToPb, parseMvrMatrix, pbToMvr, rotationForBeam } from './geometry'
import { mvrExporter, mvrImporter } from './index'
import { looksLikePlaceholderGdtf, parseMvr, parseMvrAddress } from './mvr-import'
import { writeMvr } from './mvr-export'
import { detectImporter, getExporter, getImporter } from '../registry'
import '../formats'

const ROOT = resolve(__dirname, '../../../..')
const GDTF_DIR = join(ROOT, 'test-fixtures/interchange/gdtf')
const MVR_DIR = join(ROOT, 'test-fixtures/interchange/mvr')
const spotXml = readFileSync(join(GDTF_DIR, 'test-spot.description.xml'), 'utf-8')
const barXml = readFileSync(join(GDTF_DIR, 'test-bar.description.xml'), 'utf-8')
const sceneXml = readFileSync(join(MVR_DIR, 'rig.GeneralSceneDescription.xml'), 'utf-8')

function zipGdtf(xml: string): Buffer {
  const zip = new AdmZip()
  zip.addFile('description.xml', Buffer.from(xml, 'utf-8'))
  return zip.toBuffer()
}

/** The hand-written rig: scene + two embedded GDTFs (the scene description last, like Capture does) */
function rigMvr(): Uint8Array {
  const zip = new AdmZip()
  zip.addFile('PhotonBoard Labs@Test Spot 300.gdtf', zipGdtf(spotXml))
  zip.addFile('PhotonBoard Labs@Test Bar 4.gdtf', zipGdtf(barXml))
  zip.addFile('GeneralSceneDescription.xml', Buffer.from(sceneXml, 'utf-8'))
  return new Uint8Array(zip.toBuffer())
}

const macAura: FixtureDefinition = {
  id: 'ofl/martin/mac-aura',
  name: 'MAC Aura',
  manufacturer: 'Martin',
  categories: ['Moving Head'],
  channels: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`Ch ${i + 1}`, { name: `Ch ${i + 1}`, type: 'generic' as const }])),
  modes: [{ name: 'Standard', channels: Array.from({ length: 14 }, (_, i) => `Ch ${i + 1}`), channelCount: 14 }, { name: 'Extended', channels: Array.from({ length: 25 }, (_, i) => `Ch ${(i % 14) + 1}`), channelCount: 25 }]
}

function makeCtx(library: FixtureDefinition[] = [macAura]): ImportContext & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async findFixture(manufacturer, model, channelCount) {
      calls.push(`${manufacturer}|${model}|${channelCount ?? ''}`)
      return library.find((d) => d.manufacturer.toLowerCase() === manufacturer.toLowerCase() && d.name.toLowerCase() === model.toLowerCase()) ?? null
    },
    async parseGdtf(bytes, fileName) { return parseGdtfArchive(bytes, fileName).definition },
    async parseQxf() { return null }
  }
}

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('MVR geometry', () => {
  it('parses 4×3 and 4×4 matrices and composes nested transforms', () => {
    const m = parseMvrMatrix('{1,0,0}{0,1,0}{0,0,1}{100,200,300}')!
    expect(m.o).toEqual({ x: 100, y: 200, z: 300 })
    const m4 = parseMvrMatrix('{0,1,0,0}{-1,0,0,0}{0,0,1,0}{10,20,30,1}')!
    expect(m4.r[0]).toEqual({ x: 0, y: 1, z: 0 })
    expect(m4.o).toEqual({ x: 10, y: 20, z: 30 })
    expect(parseMvrMatrix('garbage')).toBeNull()
    // Parent rotated 90° around Z: a child 1 m along local X lands on world +Y
    const parent = parseMvrMatrix('{0,1,0}{-1,0,0}{0,0,1}{1000,0,0}')!
    const child = parseMvrMatrix('{1,0,0}{0,1,0}{0,0,1}{1000,0,0}')!
    expect(compose(parent, child).o).toEqual({ x: 1000, y: 1000, z: 0 })
  })

  it('maps MVR axes (Z up, Y upstage) to PhotonBoard axes (Y up, Z upstage)', () => {
    expect(mvrToPb({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 3, z: 2 })
    expect(pbToMvr(mvrToPb({ x: 1, y: 2, z: 3 }))).toEqual({ x: 1, y: 2, z: 3 })
    // Identity = hanging straight down
    expect(beamOf(parseMvrMatrix('{1,0,0}{0,1,0}{0,0,1}{0,0,0}')!)).toEqual({ x: -0, y: -0, z: -1 })
  })

  it('aims like the visualizer (layout-math) and inverts it', () => {
    for (const mountingLocation of ['ceiling', 'floor'] as const) {
      for (let tilt = 0; tilt <= 90; tilt += 15) {
        for (let pan = -165; pan <= 180; pan += 15) {
          const entry = { mountingLocation, mountingAngle: tilt, mountingPan: pan }
          const a = aimDirection(entry)
          const b = rendererAim(entry)
          expect(close(a.x, b.x) && close(a.y, b.y) && close(a.z, b.z)).toBe(true)
          const back = mountFromBeam(a, mountingLocation === 'floor' ? 0.2 : 6)
          const again = aimDirection(back)
          expect(close(again.x, a.x, 1e-3) && close(again.y, a.y, 1e-3) && close(again.z, a.z, 1e-3), `${mountingLocation} ${tilt} ${pan}`).toBe(true)
          // A rotation built for this beam points it back the same way
          const r = rotationForBeam(pbToMvr(a))
          const beam = mvrToPb(beamOf({ r, o: { x: 0, y: 0, z: 0 } }))
          expect(close(beam.x, a.x, 1e-9) && close(beam.y, a.y, 1e-9) && close(beam.z, a.z, 1e-9)).toBe(true)
        }
      }
    }
    expect(autoPosition(3, 10, { width: 20, depth: 15, height: 6 }, 'floor')).toEqual(rendererAutoPosition(3, 10, { width: 20, depth: 15, height: 6 }, 'floor'))
  })

  it('parses DMX addresses in both MVR forms', () => {
    expect(parseMvrAddress('1')).toEqual({ universe: 0, address: 1 })
    expect(parseMvrAddress('512')).toEqual({ universe: 0, address: 512 })
    expect(parseMvrAddress('513')).toEqual({ universe: 1, address: 1 })
    expect(parseMvrAddress('1025')).toEqual({ universe: 2, address: 1 })
    expect(parseMvrAddress('2.45')).toEqual({ universe: 1, address: 45 })
    expect(parseMvrAddress(' 1.19 ')).toEqual({ universe: 0, address: 19 })
    expect(parseMvrAddress('0')).toBeNull()
    expect(parseMvrAddress('')).toBeNull()
    expect(parseMvrAddress('1.600')).toBeNull()
    expect(parseMvrAddress('abc')).toBeNull()
  })
})

describe('MVR import', () => {
  it('imports a real BlenderDMX export (open-stage/python-mvr sample)', async () => {
    const bytes = new Uint8Array(readFileSync(join(MVR_DIR, 'basic_fixture.mvr')))
    expect(mvrImporter.detect('basic_fixture.mvr', bytes.subarray(0, 65536))).toBe(1)
    const frag = await parseMvr(bytes, 'basic_fixture.mvr', makeCtx())
    expect(frag.format).toBe('mvr')
    expect(frag.sourceApp).toBe('MVR 1.5')
    expect(frag.fixtures).toHaveLength(1)
    expect(frag.fixtures[0]).toMatchObject({ name: 'LED PAR 64 RGBW', manufacturer: 'BlenderDMX', source: 'gdtf' })
    expect(frag.fixtures[0].modes[0]).toMatchObject({ name: 'Default', channelCount: 5 })
    expect(frag.patch).toHaveLength(1)
    const p = frag.patch[0]
    expect(p).toMatchObject({ name: 'LED PAR 64 RGBW', modeName: 'Default', universe: 0, address: 1, position3D: { x: 5, y: 5, z: 5 }, mountingLocation: 'ceiling', mountingAngle: 0 })
    expect(p.id).toBe('mvr-cc20ff5c-ab12-11ed-937a-48f17fc77b85')
    expect(p.fid).toBeUndefined() // FixtureID 0 = none
    expect(frag.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['mvr.unpatched', 'mvr.ignoredProperties']))
  })

  it('imports a full rig: nested transforms, addresses, ids, modes, groups, trusses', async () => {
    const ctx = makeCtx()
    const bytes = rigMvr()
    // The scene description is the last entry: detection still wins on the extension
    expect(mvrImporter.detect('rig.mvr', bytes.subarray(0, 65536))).toBeGreaterThanOrEqual(0.8)
    const frag = await parseMvr(bytes, '/shows/rig.mvr', ctx)
    expect(frag.name).toBe('rig')
    expect(frag.sourceApp).toBe('grandMA3 2.1.1.5, MVR 1.6')
    const codes = frag.warnings.map((w) => w.code)

    // Fixture types: 2 embedded GDTFs, MAC Aura from the library, a generic one
    expect(frag.fixtures.map((f) => f.name).sort()).toEqual(['MAC Aura', 'Mystery Par', 'Test Bar 4', 'Test Spot 300'])
    expect(ctx.calls).toContain('Martin|MAC Aura|')
    expect(codes).toEqual(expect.arrayContaining(['mvr.gdtfMissing', 'mvr.libraryMatch', 'mvr.genericType']))
    const generic = frag.fixtures.find((f) => f.name === 'Mystery Par')!
    expect(generic.modes[0]).toMatchObject({ name: '3 channel', channelCount: 3 })

    const byName = new Map(frag.patch.map((p) => [p.name, p]))
    const spot1 = byName.get('Spot 1')!
    expect(spot1).toMatchObject({ fid: 101, universe: 0, address: 1, modeName: 'Standard 16bit', panInvert: true, mountingLocation: 'ceiling', mountingAngle: 30, mountingPan: 0 })
    expect(spot1.position3D).toEqual({ x: -3, y: 6.7, z: -6 })
    const spot2 = byName.get('Spot 2')!
    expect(spot2).toMatchObject({ fid: 102, universe: 0, address: 19, modeName: 'Standard 16bit', mountingAngle: 0 })
    expect(spot2.position3D).toEqual({ x: 3, y: 6.7, z: -6 })
    const wash = byName.get('Floor Wash')!
    expect(wash).toMatchObject({ fid: 201, universe: 1, address: 1, modeName: '13 channel', mountingLocation: 'floor', mountingAngle: 30, mountingPan: 0 })
    expect(wash.position3D).toEqual({ x: 0, y: 0.2, z: 2 })
    const side = byName.get('Side Light')!
    expect(side).toMatchObject({ fid: 301, universe: 2, address: 1, fixtureDefId: 'ofl/martin/mac-aura', modeName: 'Standard', mountingLocation: 'ceiling', mountingAngle: 90, mountingPan: 90 })
    const spot3 = byName.get('Spot 3')!
    expect(spot3).toMatchObject({ fid: 103, universe: 0, address: 37, modeName: 'Basic 8bit', tiltInvert: true })
    expect(spot3.position3D!.y).toBe(6) // layer elevation 0.5 m + 5.5 m
    const par = byName.get('Unpatched PAR')!
    expect(par.fid).toBeUndefined() // 101 is Spot 1's
    expect(par).toMatchObject({ universe: 3, address: 1 })
    expect(codes).toEqual(expect.arrayContaining(['mvr.unpatched', 'mvr.duplicateFixtureId', 'mvr.multiBreak', 'mvr.focusPoints', 'mvr.ignoredObjects', 'mvr.ignoredProperties']))

    // Console order: fixture id
    expect(frag.patch.map((p) => p.fid ?? null)).toEqual([101, 102, 103, 201, 301, null])

    // Groups: layers, position (= FOH group object, de-duplicated), a class
    expect(frag.groups.map((g) => [g.name, g.fixtureIds.length])).toEqual([['Rig', 5], ['Stage', 1], ['FOH Position', 2], ['Lighting-Floor', 1]])
    const foh = frag.groups.find((g) => g.name === 'FOH Position')!
    expect(foh.color).toBe('#ff0000')
    expect(foh.fixtureIds).toEqual([spot1.id, spot2.id])
    expect(spot1.groupIds).toContain(foh.id)
    expect(frag.groups.map((g) => g.number)).toEqual([1, 2, 3, 4])

    // Room + truss: FOH truss 10 m wide, 7 m high, 6 m downstage
    expect(frag.roomConfig!.trussBars).toEqual([{ id: 'mvr-truss-1', name: 'FOH Truss', z: -6, y: 7, width: 10 }])
    expect(frag.roomConfig).toMatchObject({ width: 16, depth: 14, height: 8 })
  })

  it('replaces Capture-style placeholder GDTFs with the library definition', async () => {
    const attrs = Array.from({ length: 14 }, (_, i) => `<Attribute Feature="Dimmer.Dimmer" Name="Dimmer${i + 1}" PhysicalUnit="None" Pretty="Dim${i + 1}"/>`).join('')
    const channels = Array.from({ length: 14 }, (_, i) => `<DMXChannel DMXBreak="1" Geometry="Base" Offset="${i + 1}"><LogicalChannel Attribute="Dimmer${i + 1}"><ChannelFunction Attribute="Dimmer${i + 1}" DMXFrom="0/1" Name=""/></LogicalChannel></DMXChannel>`).join('')
    const placeholder = `<?xml version="1.0"?><GDTF DataVersion="1.0"><FixtureType Name="MAC Aura" Manufacturer="Martin" FixtureTypeID="e5d165d6-f0d4-2444-bdc4-b9ba24f758cc"><AttributeDefinitions><FeatureGroups><FeatureGroup Name="Dimmer" Pretty="Dimmer"><Feature Name="Dimmer"/></FeatureGroup></FeatureGroups><Attributes>${attrs}</Attributes></AttributeDefinitions><Geometries><Geometry Name="Base"/></Geometries><DMXModes><DMXMode Name="Standard [14ch]" Geometry="Base"><DMXChannels>${channels}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`
    const scene = `<?xml version="1.0" encoding="UTF-8"?>
<!--Created by Capture 2023.1.6-->
<GeneralSceneDescription verMajor="1" verMinor="4"><Scene><Layers><Layer uuid="8becc9e4-adee-0a44-bf4c-34939930b329" name="Lights"><ChildList>
<Fixture uuid="2e149740-6a41-bc43-bd59-8968781b11b9" name="Aura"><Matrix>{8.53590478e-08,-1.50995803e-07,1.00000036}{1.48444723e-08,1,1.50995859e-07}{-1.00000095,1.41110048e-08,8.53590052e-08}{-6670.87305,-890.867859,5565.0166}</Matrix><GDTFSpec>Martin@MAC Aura@r3048.gdtf</GDTFSpec><GDTFMode>Standard [14ch]</GDTFMode><FixtureID>11</FixtureID><UnitNumber>1</UnitNumber><Addresses><Address break="0">513</Address></Addresses></Fixture>
</ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
    const zip = new AdmZip()
    zip.addFile('GeneralSceneDescription.xml', Buffer.from(scene))
    zip.addFile('Martin@MAC Aura@r3048.gdtf', zipGdtf(placeholder))
    const ctx = makeCtx()
    const frag = await parseMvr(new Uint8Array(zip.toBuffer()), 'capture.mvr', ctx)
    expect(looksLikePlaceholderGdtf(parseGdtfArchive(new Uint8Array(zipGdtf(placeholder))).definition)).toBe(true)
    expect(frag.sourceApp).toBe('Capture 2023.1.6, MVR 1.4')
    expect(ctx.calls[0]).toBe('Martin|MAC Aura|14')
    expect(frag.fixtures.map((f) => f.id)).toEqual(['ofl/martin/mac-aura'])
    expect(frag.patch[0]).toMatchObject({ fid: 11, universe: 1, address: 1, modeName: 'Standard', mountingLocation: 'ceiling', mountingAngle: 90, mountingPan: 90 })
    expect(frag.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['mvr.placeholderReplaced', 'mvr.modeMapped']))
  })

  it('is robust: not-an-MVR throws, broken content gives warnings', async () => {
    await expect(parseMvr(new Uint8Array([1, 2, 3]), 'x.mvr', makeCtx())).rejects.toThrow(/Not an MVR/)
    const noScene = new AdmZip()
    noScene.addFile('foo.xml', Buffer.from('<x/>'))
    await expect(parseMvr(new Uint8Array(noScene.toBuffer()), 'x.mvr', makeCtx())).rejects.toThrow(/GeneralSceneDescription/)
    const broken = new AdmZip()
    broken.addFile('GeneralSceneDescription.xml', Buffer.from('<GeneralSceneDescription><Scene><Layers><Layer><ChildList><Fixture name="A"><GDTFSpec>missing.gdtf</GDTFSpec><Addresses><Address>nope</Address></Addresses><Matrix>{bad}</Matrix></Fixture></ChildList></Layer></Layers></Scene></GeneralSceneDescription>'))
    broken.addFile('corrupt.gdtf', Buffer.from('not a zip'))
    const frag = await parseMvr(new Uint8Array(broken.toBuffer()), 'b.mvr', makeCtx([]))
    expect(frag.patch).toHaveLength(1)
    expect(frag.patch[0].position3D).toEqual({ x: 0, y: 0, z: 0 })
    expect(frag.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['mvr.gdtfMissing', 'mvr.genericType', 'mvr.unpatched']))
    const notXml = new AdmZip()
    notXml.addFile('GeneralSceneDescription.xml', Buffer.from('<<<'))
    const f2 = await parseMvr(new Uint8Array(notXml.toBuffer()), 'c.mvr', makeCtx())
    expect(f2.patch).toHaveLength(0)
    expect(f2.warnings.length).toBeGreaterThan(0)
  })
})

describe('MVR export', () => {
  async function importedRig() {
    return parseMvr(rigMvr(), 'rig.mvr', makeCtx())
  }

  function showOf(frag: Awaited<ReturnType<typeof importedRig>>, extra: Partial<ShowFile> = {}): ShowFile {
    return {
      version: '3', name: 'Rig', createdAt: '', modifiedAt: '',
      patch: frag.patch, groups: frag.groups, presets: [], cuelists: [], chases: [], effects: [], midiMappings: [],
      stageLayout: { width: 10, height: 10, fixtures: [] }, roomConfig: frag.roomConfig, ...extra
    }
  }

  it('writes a valid MVR that round-trips patch, ids, modes, positions and aim', async () => {
    const frag = await importedRig()
    const out = writeMvr(showOf(frag), frag.fixtures, { now: new Date('2026-01-01T00:00:00Z') })
    const zip = new AdmZip(Buffer.from(out.bytes))
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names[0]).toBe('GeneralSceneDescription.xml')
    expect(names.filter((n) => n.endsWith('.gdtf')).sort()).toEqual(['Martin@MAC_Aura@PhotonBoard.gdtf', 'Nobody@Mystery_Par@PhotonBoard.gdtf', 'PhotonBoard_Labs@Test_Bar_4@PhotonBoard.gdtf', 'PhotonBoard_Labs@Test_Spot_300@PhotonBoard.gdtf'])
    const doc = parseXml(out.xml)
    const gsd = kid(doc, 'GeneralSceneDescription')!
    expect([attr(gsd, 'verMajor'), attr(gsd, 'verMinor'), attr(gsd, 'provider')]).toEqual(['1', '6', 'PhotonBoard'])
    const fixtures = kids(kid(kid(kid(kid(gsd, 'Scene'), 'Layers'), 'Layer'), 'ChildList'), 'Fixture')
    expect(fixtures).toHaveLength(6)
    const spot1 = fixtures.find((f) => attr(f, 'name') === 'Spot 1')!
    expect(attr(spot1, 'uuid')).toBe('11111111-1111-4111-8111-111111111111') // original UUID kept
    expect(childText(spot1, 'GDTFSpec')).toBe('PhotonBoard_Labs@Test_Spot_300@PhotonBoard.gdtf')
    expect(childText(spot1, 'GDTFMode')).toBe('Standard 16bit')
    expect(childText(spot1, 'FixtureID')).toBe('101')
    expect(childText(spot1, 'FixtureIDNumeric')).toBe('101')
    expect(childText(spot1, 'DMXInvertPan')).toBe('true')
    expect(childText(kid(spot1, 'Addresses'), 'Address')).toBe('1')
    expect(childText(spot1, 'Color')).toMatch(/^0\.64\d*,0\.33\d*,/)
    const wash = fixtures.find((f) => attr(f, 'name') === 'Floor Wash')!
    expect(childText(kid(wash, 'Addresses'), 'Address')).toBe('513')

    // Every embedded GDTF re-reads
    for (const e of zip.getEntries().filter((x) => x.entryName.endsWith('.gdtf'))) {
      expect(parseGdtfArchive(new Uint8Array(e.getData())).definition.modes.length).toBeGreaterThan(0)
    }

    const back = await parseMvr(out.bytes, 'out.mvr', makeCtx())
    expect(back.sourceApp).toMatch(/^PhotonBoard \S+, MVR 1\.6$/)
    for (const p of frag.patch) {
      const q = back.patch.find((x) => x.id === p.id)!
      expect(q, p.name).toBeDefined()
      // Fixtures without a number get a free one (FixtureID is mandatory in MVR)
      expect([q.universe, q.address, q.fid, q.modeName, q.name, !!q.panInvert, !!q.tiltInvert], p.name).toEqual([p.universe, p.address, p.fid ?? 1, p.modeName, p.name, !!p.panInvert, !!p.tiltInvert])
      expect(q.position3D, p.name).toEqual(p.position3D)
      expect([q.mountingLocation, q.mountingAngle, q.mountingPan], p.name).toEqual([p.mountingLocation, p.mountingAngle, p.mountingPan])
    }
    const codes = out.warnings.map((w) => w.code)
    expect(codes).toEqual(expect.arrayContaining(['mvr.export.gdtfRegenerated', 'mvr.export.rigOnly', 'mvr.export.trusses']))
  })

  it('exports stable UUIDs, auto-placed fixtures and a show without definitions', async () => {
    const def: FixtureDefinition = { id: 'x/par', name: 'Par', manufacturer: 'X', categories: ['PAR'], channels: { Dimmer: { name: 'Dimmer', type: 'intensity' } }, modes: [{ name: '1ch', channels: ['Dimmer'], channelCount: 1 }] }
    const patch: PatchEntry[] = [
      { id: 'p-1', fixtureDefId: 'x/par', modeName: '1ch', universe: 0, address: 10, name: 'Par 1', groupIds: [], fid: 7 },
      { id: 'p-2', fixtureDefId: 'x/par', modeName: '1ch', universe: 4, address: 512, name: 'Par 2', groupIds: [], mountingLocation: 'floor', mountingAngle: 45, mountingPan: -90 },
      { id: 'p-3', fixtureDefId: 'missing/def', modeName: 'x', universe: 0, address: 1, name: 'Ghost', groupIds: [] }
    ]
    const show = { version: '3', name: 'S', createdAt: '', modifiedAt: '', patch, groups: [], presets: [], cuelists: [], chases: [], effects: [], midiMappings: [], stageLayout: { width: 1, height: 1, fixtures: [] } } as ShowFile
    const a = writeMvr(show, [def])
    const b = writeMvr(show, [def])
    const uuids = (xml: string) => [...xml.matchAll(/<Fixture name="[^"]*" uuid="([^"]+)"/g)].map((m) => m[1])
    expect(uuids(a.xml)).toEqual(uuids(b.xml))
    expect(new Set(uuids(a.xml)).size).toBe(3)
    expect(a.warnings.map((w) => w.code)).toContain('mvr.export.missingDefinition')
    const back = await parseMvr(a.bytes, 's.mvr', makeCtx([]))
    const p1 = back.patch.find((p) => p.name === 'Par 1')!
    expect(p1).toMatchObject({ fid: 7, universe: 0, address: 10 })
    expect(p1.position3D).toEqual(autoPosition(0, 3, { width: 20, depth: 15, height: 6 }, undefined))
    const p2 = back.patch.find((p) => p.name === 'Par 2')!
    expect(p2).toMatchObject({ fid: 1, universe: 4, address: 512, mountingLocation: 'floor', mountingAngle: 45, mountingPan: -90 })
    const ghost = back.patch.find((p) => p.name === 'Ghost')!
    expect(ghost.fid).toBe(2)
  })
})

describe('MVR plug-in registration', () => {
  it('registers importers / exporters and detects MVR before GDTF', async () => {
    expect(getImporter('mvr')).toBe(mvrImporter)
    expect(getExporter('mvr')).toBe(mvrExporter)
    expect(getImporter('gdtf')).toBeDefined()
    const mvr = rigMvr()
    // Scene description first (as PhotonBoard and most exporters write it)
    const frag = await parseMvr(mvr, 'rig.mvr', makeCtx())
    const out = await mvrExporter.write({ version: '3', name: 'R', createdAt: '', modifiedAt: '', patch: frag.patch, groups: [], presets: [], cuelists: [], chases: [], effects: [], midiMappings: [], stageLayout: { width: 1, height: 1, fixtures: [] } }, frag.fixtures)
    expect(detectImporter('show.mvr', out.bytes.subarray(0, 65536))?.importer.info.id).toBe('mvr')
    expect(detectImporter('unknown.zip', out.bytes.subarray(0, 65536))?.importer.info.id).toBe('mvr')
    expect(detectImporter('rig.mvr', mvr.subarray(0, 65536))?.importer.info.id).toBe('mvr')
    const gdtf = new AdmZip(Buffer.from(out.bytes)).getEntries().find((e) => e.entryName.endsWith('.gdtf'))!.getData()
    expect(detectImporter('fixture.gdtf', new Uint8Array(gdtf))?.importer.info.id).toBe('gdtf')
  })
})
