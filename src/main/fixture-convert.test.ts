import { describe, it, expect } from 'vitest'
import { convertOflFixture, scaleDmxRange, scaleDmxValue } from './fixture-convert-ofl'
import { convertQxfFixture } from './fixture-convert-qxf'
import { manufacturerGroupKey, manufacturerMatchKey, modelMatchKey } from './fixture-convert-common'

// ---------------------------------------------------------------
// Representative OFL fixtures (trimmed real-world shapes)
// ---------------------------------------------------------------

const OFL_MOVING_HEAD = {
  $schema: 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json',
  name: 'Spot 575',
  shortName: 'S575',
  categories: ['Moving Head'],
  meta: { authors: ['Someone'], createDate: '2020-01-01', lastModifyDate: '2021-02-03' },
  physical: { dimensions: [400, 600, 300], weight: 25, power: 800, DMXconnector: '5-pin', bulb: { type: 'MSD 575', colorTemperature: 6000 }, lens: { degreesMinMax: [16, 16] }, focus: { type: 'Head', panMax: 540, tiltMax: 270 } },
  wheels: {
    'Color Wheel': { slots: [{ type: 'Open' }, { type: 'Color', name: 'Red', colors: ['#ff0000'] }, { type: 'Color', name: 'Blue', colors: ['#0000ff'] }] },
    'Gobo Wheel': { slots: [{ type: 'Open' }, { type: 'Gobo', resource: 'gobos/aerial' }, { type: 'Gobo', name: 'Dots' }] }
  },
  availableChannels: {
    Pan: { fineChannelAliases: ['Pan fine'], defaultValue: '50%', capability: { type: 'Pan', angleStart: '0deg', angleEnd: '540deg' } },
    Tilt: { fineChannelAliases: ['Tilt fine'], defaultValue: 32768, capability: { type: 'Tilt', angleStart: '0deg', angleEnd: '270deg' } },
    Dimmer: { capability: { type: 'Intensity' } },
    Shutter: {
      defaultValue: 255,
      capabilities: [
        { dmxRange: [0, 31], type: 'ShutterStrobe', shutterEffect: 'Closed' },
        { dmxRange: [32, 223], type: 'ShutterStrobe', shutterEffect: 'Strobe', speedStart: '1Hz', speedEnd: '20Hz' },
        { dmxRange: [224, 255], type: 'ShutterStrobe', shutterEffect: 'Open' }
      ]
    },
    'Color Wheel': {
      capabilities: [
        { dmxRange: [0, 9], type: 'WheelSlot', slotNumber: 1 },
        { dmxRange: [10, 19], type: 'WheelSlot', slotNumber: 1.5 },
        { dmxRange: [20, 29], type: 'WheelSlot', slotNumber: 2 },
        { dmxRange: [30, 39], type: 'WheelSlot', slotNumber: 3 },
        { dmxRange: [40, 255], type: 'WheelRotation', speedStart: 'slow CW', speedEnd: 'fast CW' }
      ]
    },
    'Gobo Wheel': {
      capabilities: [
        { dmxRange: [0, 63], type: 'WheelSlot', slotNumber: 1 },
        { dmxRange: [64, 127], type: 'WheelSlot', slotNumber: 2 },
        { dmxRange: [128, 191], type: 'WheelSlot', slotNumber: 3 },
        { dmxRange: [192, 255], type: 'WheelShake', slotNumber: 3, shakeSpeedStart: 'slow', shakeSpeedEnd: 'fast' }
      ]
    },
    Focus: { dmxValueResolution: '16bit', fineChannelAliases: ['Focus fine'], capabilities: [
      { dmxRange: [0, 32767], type: 'Focus', distanceStart: 'near', distanceEnd: 'far' },
      { dmxRange: [32768, 65535], type: 'Maintenance', comment: 'Auto focus' }
    ] },
    'Gobo Mode': { capabilities: [
      { dmxRange: [0, 127], type: 'Generic', comment: 'Gobo index', switchChannels: { 'Gobo Ctrl': 'Gobo Index' } },
      { dmxRange: [128, 255], type: 'Generic', comment: 'Gobo rotation', switchChannels: { 'Gobo Ctrl': 'Gobo Rotation' } }
    ] },
    'Gobo Index': { capability: { type: 'WheelSlotRotation', wheel: 'Gobo Wheel', angleStart: '0deg', angleEnd: '360deg' } },
    'Gobo Rotation': { capability: { type: 'WheelSlotRotation', wheel: 'Gobo Wheel', speedStart: 'slow CW', speedEnd: 'fast CW' } },
    Reset: { capabilities: [{ dmxRange: [0, 199], type: 'NoFunction' }, { dmxRange: [200, 255], type: 'Maintenance', comment: 'Reset', hold: '3s' }] }
  },
  modes: [
    { name: 'Standard', shortName: 'std', channels: ['Pan', 'Tilt', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo Wheel', 'Reset'] },
    { name: 'Extended', channels: ['Pan', 'Pan fine', 'Tilt', 'Tilt fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo Wheel', null, 'Focus', 'Focus fine', 'Gobo Mode', 'Gobo Ctrl', 'Reset'] }
  ]
}

const OFL_PIXEL_BAR = {
  name: 'Pixel Bar 4',
  categories: ['Pixel Bar'],
  matrix: { pixelCount: [4, 1, 1], pixelGroups: { Master: 'all' } },
  availableChannels: { Dimmer: { capability: { type: 'Intensity' } } },
  templateChannels: {
    'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } },
    'Green $pixelKey': { capability: { type: 'ColorIntensity', color: 'Green' } },
    'Blue $pixelKey': { capability: { type: 'ColorIntensity', color: 'Blue' } },
    'White $pixelKey': { capability: { type: 'ColorIntensity', color: 'White' } }
  },
  modes: [
    { name: '3ch', channels: ['Red Master', 'Green Master', 'Blue Master'] },
    { name: '17ch', channels: ['Dimmer', { insert: 'matrixChannels', repeatFor: 'eachPixelABC', channelOrder: 'perPixel', templateChannels: ['Red $pixelKey', 'Green $pixelKey', 'Blue $pixelKey', 'White $pixelKey'] }] },
    { name: '12ch per channel', channels: [{ insert: 'matrixChannels', repeatFor: 'eachPixelABC', channelOrder: 'perChannel', templateChannels: ['Red $pixelKey', 'Green $pixelKey', 'Blue $pixelKey'] }] }
  ]
}

const OFL_STROBE = {
  name: 'Atomic',
  categories: ['Strobe'],
  availableChannels: {
    Strobe: { capabilities: [
      { dmxRange: [0, 5], type: 'ShutterStrobe', shutterEffect: 'Closed' },
      { dmxRange: [6, 249], type: 'ShutterStrobe', shutterEffect: 'Strobe', speedStart: 'slow', speedEnd: 'fast' },
      { dmxRange: [250, 255], type: 'ShutterStrobe', shutterEffect: 'Open', comment: 'Blind' }
    ] },
    Intensity: { capability: { type: 'Intensity', brightnessStart: '0%', brightnessEnd: '100%' } },
    Duration: { capability: { type: 'StrobeDuration', durationStart: '0ms', durationEnd: '650ms' } }
  },
  modes: [{ name: '3-channel', channels: ['Strobe', 'Intensity', 'Duration'] }]
}

describe('OFL converter', () => {
  it('scales DMX values / ranges like OFL', () => {
    expect(scaleDmxValue(32768, 2, 1)).toBe(128)
    expect(scaleDmxValue(128, 1, 2)).toBe(32896)
    expect(scaleDmxRange(0, 32767, 2, 1)).toEqual([0, 127])
    expect(scaleDmxRange(32768, 65535, 2, 1)).toEqual([128, 255])
    expect(scaleDmxRange(10, 20, 1, 2)).toEqual([2560, 5375])
  })

  it('converts a moving head: 16-bit pan/tilt, wheels, strobe ranges, null + switching channels', () => {
    const def = convertOflFixture(OFL_MOVING_HEAD, { manufacturerKey: 'acme', fixtureKey: 'spot-575', manufacturerName: 'Acme', id: 'ofl/acme/spot-575' })
    expect(def.id).toBe('ofl/acme/spot-575')
    expect(def.manufacturer).toBe('Acme')
    expect(def.shortName).toBe('S575')
    expect(def.source).toBe('ofl')
    expect(def.lastModified).toBe('2021-02-03')
    expect(def.modes.map((m) => [m.name, m.channelCount])).toEqual([['Standard', 7], ['Extended', 14]])
    expect(def.modes[0].shortName).toBe('std')

    // 16-bit pan: coarse default from "50%", fine channel linked to its coarse
    expect(def.channels.Pan).toMatchObject({ type: 'pan', precedence: 'LTP', defaultValue: 127, fineChannelAliases: ['Pan fine'] })
    expect(def.channels['Pan fine']).toMatchObject({ type: 'pan', fineOf: 'Pan', defaultValue: 255 })
    expect(def.channels.Tilt.defaultValue).toBe(128)
    expect(def.channels['Tilt fine'].defaultValue).toBe(0)
    expect(def.channels.Pan.capabilities?.[0]).toMatchObject({ dmxRange: [0, 255], type: 'Pan', label: 'Pan 0…540°' })

    expect(def.channels.Dimmer).toMatchObject({ type: 'intensity', precedence: 'HTP', highlightValue: 255 })

    // shutter: open / closed made explicit for the Blinder and the programmer
    const shutter = def.channels.Shutter
    expect(shutter.type).toBe('shutter')
    expect(shutter.defaultValue).toBe(255)
    expect(shutter.capabilities?.map((c) => [c.type, c.label])).toEqual([
      ['ShutterClose', 'Shutter closed'],
      ['ShutterStrobe', 'Strobe 1…20Hz'],
      ['ShutterOpen', 'Shutter open']
    ])

    // colour wheel slots with colours, split slot, wheel rotation
    const cw = def.channels['Color Wheel']
    expect(cw.type).toBe('color')
    expect(cw.capabilities?.[1]).toMatchObject({ type: 'WheelSlot', label: 'Split Open / Red', colors: ['#ffffff', '#ff0000'], color: '#ffffff', wheel: 'Color Wheel' })
    expect(cw.capabilities?.[2]).toMatchObject({ label: 'Red', color: '#ff0000', wheelSlot: 2 })
    expect(cw.capabilities?.[4].label).toBe('Color Wheel rotation CW slow…fast')

    // gobo wheel: slot names from resources, shake
    const gobo = def.channels['Gobo Wheel']
    expect(gobo.type).toBe('gobo')
    expect(gobo.capabilities?.map((c) => c.label)).toEqual(['Open', 'Gobo aerial', 'Gobo Dots', 'Gobo Dots shake slow…fast'])
    expect(gobo.capabilities?.[1].image).toBe('gobos/aerial')

    expect(def.wheels?.map((w) => [w.name, w.slots.map((s) => s.type)])).toEqual([
      ['Color Wheel', ['Open', 'Color', 'Color']],
      ['Gobo Wheel', ['Open', 'Gobo', 'Gobo']]
    ])
    expect(def.wheels?.[0].slots[1]).toMatchObject({ name: 'Red', color: '#ff0000' })

    // 16-bit capability ranges are scaled to the coarse channel
    expect(def.channels.Focus.capabilities?.map((c) => c.dmxRange)).toEqual([[0, 127], [128, 255]])
    expect(def.channels.Focus.type).toBe('generic')

    // null channel keeps the addressing; switching channel takes its default target
    const ext = def.modes[1].channels
    expect(ext[8]).toBe('No function')
    expect(def.channels['No function'].capabilities?.[0].type).toBe('NoFunction')
    expect(ext[12]).toBe('Gobo Ctrl')
    expect(def.channels['Gobo Ctrl']).toMatchObject({ name: 'Gobo Ctrl', type: 'gobo' })
    expect(def.channels['Gobo Ctrl'].capabilities?.[0].label).toBe('Gobo stencil rotation 0…360°')
    expect(def.channels.Reset.capabilities?.[1].label).toBe('Reset (hold 3s)')
    expect(def.channels.Reset.type).toBe('maintenance')

    expect(def.physical).toEqual({ dimensions: [400, 600, 300], weight: 25, power: 800, DMXconnector: '5-pin', bulb: { type: 'MSD 575', colorTemperature: 6000 }, lens: { degreesMinMax: [16, 16] }, panRange: 540, tiltRange: 270 })
  })

  it('expands matrix template channels and builds pixel layouts for per-pixel modes', () => {
    const def = convertOflFixture(OFL_PIXEL_BAR, { manufacturerKey: 'acme', fixtureKey: 'pixel-bar-4' })
    expect(def.id).toBe('acme/pixel-bar-4')
    expect(def.modes[0].channels).toEqual(['Red Master', 'Green Master', 'Blue Master'])
    expect(def.modes[0].pixelLayout).toBeUndefined()
    const m = def.modes[1]
    expect(m.channelCount).toBe(17)
    expect(m.channels.slice(0, 6)).toEqual(['Dimmer', 'Red 1', 'Green 1', 'Blue 1', 'White 1', 'Red 2'])
    expect(m.pixelLayout).toMatchObject({ cellCount: 4, orientation: 'horizontal' })
    expect(m.pixelLayout?.cells[1]).toEqual({ index: 1, channelOffset: 5, channelNames: ['Red 2', 'Green 2', 'Blue 2', 'White 2'] })
    expect(def.channels['Red 3']).toMatchObject({ type: 'color', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red', color: '#ff0000' }] })
    expect(def.channels['White 4'].capabilities?.[0].color).toBe('#ffffff')
    // per-channel order: cells are not contiguous → no layout (the console addresses cells contiguously)
    expect(def.modes[2].channels.slice(0, 5)).toEqual(['Red 1', 'Red 2', 'Red 3', 'Red 4', 'Green 1'])
    expect(def.modes[2].pixelLayout).toBeUndefined()
  })

  it('converts a strobe', () => {
    const def = convertOflFixture(OFL_STROBE, { manufacturerKey: 'martin', fixtureKey: 'atomic' })
    expect(def.channels.Strobe.type).toBe('shutter')
    expect(def.channels.Strobe.capabilities?.map((c) => c.type)).toEqual(['ShutterClose', 'ShutterStrobe', 'ShutterOpen'])
    expect(def.channels.Strobe.capabilities?.[2].label).toBe('Shutter open (Blind)')
    expect(def.channels.Intensity).toMatchObject({ type: 'intensity', precedence: 'HTP' })
    expect(def.channels.Intensity.capabilities?.[0].label).toBe('Intensity 0…100%')
    expect(def.channels.Duration.type).toBe('strobe')
  })

  it('rejects redirects and fixtures without modes', () => {
    expect(() => convertOflFixture({ redirectTo: 'acme/other', reason: 'FixtureRenamed' }, { manufacturerKey: 'a', fixtureKey: 'b' })).toThrow(/Redirect/)
    expect(() => convertOflFixture({ name: 'x', availableChannels: {} }, { manufacturerKey: 'a', fixtureKey: 'b' })).toThrow(/No modes/)
  })

  it('is deterministic', () => {
    const a = convertOflFixture(OFL_MOVING_HEAD, { manufacturerKey: 'acme', fixtureKey: 'spot-575' })
    const b = convertOflFixture(JSON.parse(JSON.stringify(OFL_MOVING_HEAD)), { manufacturerKey: 'acme', fixtureKey: 'spot-575' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ---------------------------------------------------------------
// QLC+ .qxf
// ---------------------------------------------------------------

const QXF_RGBW_PAR = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE FixtureDefinition>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Creator><Name>Q Light Controller Plus</Name><Version>4.12.0</Version><Author>Jane, John</Author></Creator>
 <Manufacturer>Stairville</Manufacturer>
 <Model>LED Par 56 RGBW</Model>
 <Type>Color Changer</Type>
 <Channel Name="Dimmer" Preset="IntensityMasterDimmer"/>
 <Channel Name="Red" Preset="IntensityRed"/>
 <Channel Name="Green" Preset="IntensityGreen"/>
 <Channel Name="Blue" Preset="IntensityBlue"/>
 <Channel Name="White" Preset="IntensityWhite"/>
 <Channel Name="Strobe">
  <Group Byte="0">Shutter</Group>
  <Capability Min="0" Max="9" Preset="ShutterOpen">Open</Capability>
  <Capability Min="10" Max="255" Preset="StrobeFreqRange" Res1="1" Res2="25">Strobe</Capability>
 </Channel>
 <Channel Name="Macros">
  <Group Byte="0">Colour</Group>
  <Capability Min="0" Max="15">No function</Capability>
  <Capability Min="16" Max="31" Preset="ColorMacro" Res1="#ff0000">Red</Capability>
  <Capability Min="32" Max="47" Preset="ColorDoubleMacro" Res1="#ff0000" Res2="#00ff00">Red/Green</Capability>
  <Capability Min="48" Max="255" Color="#0000ff">Blue (old format)</Capability>
 </Channel>
 <Channel Name="R old">
  <Group Byte="0">Intensity</Group>
  <Colour>Red</Colour>
  <Capability Min="0" Max="255">Red intensity</Capability>
 </Channel>
 <Mode Name="4 Channel">
  <Channel Number="0">Red</Channel>
  <Channel Number="1">Green</Channel>
  <Channel Number="2">Blue</Channel>
  <Channel Number="3">White</Channel>
 </Mode>
 <Mode Name="8 Channel">
  <Physical>
   <Bulb Type="LED" Lumens="0" ColourTemperature="0"/>
   <Dimensions Weight="1.5" Width="250" Height="200" Depth="150"/>
   <Lens Name="Other" DegreesMin="25" DegreesMax="25"/>
   <Focus Type="Fixed" PanMax="0" TiltMax="0"/>
   <Technical PowerConsumption="60" DmxConnector="3-pin"/>
  </Physical>
  <Channel Number="0">Dimmer</Channel>
  <Channel Number="1">Red</Channel>
  <Channel Number="2">Green</Channel>
  <Channel Number="3">Blue</Channel>
  <Channel Number="4">White</Channel>
  <Channel Number="5">Strobe</Channel>
  <Channel Number="6">Macros</Channel>
  <Channel Number="7">R old</Channel>
 </Mode>
</FixtureDefinition>`

const QXF_MOVING_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>GLP</Manufacturer>
 <Model>Impression Mini</Model>
 <Type>Moving Head</Type>
 <Channel Name="Pan coarse" Default="128" Preset="PositionPan"/>
 <Channel Name="Pan fine" Preset="PositionPanFine"/>
 <Channel Name="Tilt" Default="128" Preset="PositionTilt"/>
 <Channel Name="Tilt LSB"><Group Byte="1">Tilt</Group></Channel>
 <Channel Name="Zoom" Preset="BeamZoomSmallBig"/>
 <Channel Name="Zoom 16" Preset="BeamZoomFine"/>
 <Channel Name="Gobo">
  <Group Byte="0">Gobo</Group>
  <Capability Min="0" Max="9" Preset="GoboMacro" Res1="Others/open.svg">Open</Capability>
  <Capability Min="10" Max="19" Preset="GoboMacro" Res1="Others/gobo00001.svg">Gobo 1</Capability>
  <Capability Min="20" Max="255" Preset="GoboShakeMacro" Res1="Others/gobo00001.svg">Gobo 1 shake</Capability>
 </Channel>
 <Channel Name="Red 1" Preset="IntensityRed"/>
 <Channel Name="Green 1" Preset="IntensityGreen"/>
 <Channel Name="Blue 1" Preset="IntensityBlue"/>
 <Channel Name="Red 2" Preset="IntensityRed"/>
 <Channel Name="Green 2" Preset="IntensityGreen"/>
 <Channel Name="Blue 2" Preset="IntensityBlue"/>
 <Mode Name="Pixel">
  <Channel Number="0">Pan coarse</Channel>
  <Channel Number="1">Pan fine</Channel>
  <Channel Number="2">Tilt</Channel>
  <Channel Number="3">Tilt LSB</Channel>
  <Channel Number="4">Zoom</Channel>
  <Channel Number="5">Zoom 16</Channel>
  <Channel Number="6">Gobo</Channel>
  <Channel Number="7">Red 1</Channel>
  <Channel Number="8">Green 1</Channel>
  <Channel Number="9">Blue 1</Channel>
  <Channel Number="10">Red 2</Channel>
  <Channel Number="11">Green 2</Channel>
  <Channel Number="12">Blue 2</Channel>
  <Head><Channel>7</Channel><Channel>8</Channel><Channel>9</Channel></Head>
  <Head><Channel>10</Channel><Channel>11</Channel><Channel>12</Channel></Head>
 </Mode>
 <Physical>
  <Bulb Type="LED" Lumens="3000" ColourTemperature="6500"/>
  <Dimensions Weight="5" Width="200" Height="300" Depth="150"/>
  <Lens Name="PC" DegreesMin="5" DegreesMax="50"/>
  <Focus Type="Head" PanMax="540" TiltMax="230"/>
  <Layout Width="2" Height="1"/>
  <Technical PowerConsumption="200" DmxConnector="5-pin"/>
 </Physical>
</FixtureDefinition>`

const QXF_DIMMER = `<?xml version="1.0" encoding="UTF-8"?>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>Generic</Manufacturer>
 <Model>Dimmer Pack 1ch</Model>
 <Type>Dimmer</Type>
 <Channel Name="Intensity" Preset="IntensityDimmer"/>
 <Mode Name="1 Channel"><Channel Number="0">Intensity</Channel></Mode>
</FixtureDefinition>`

const QXF_HAZER = `<?xml version="1.0" encoding="UTF-8"?>
<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
 <Manufacturer>Martin</Manufacturer>
 <Model>Jem K1 Hazer</Model>
 <Type>Hazer</Type>
 <Channel Name="Haze Density">
  <Group Byte="0">Intensity</Group>
  <Capability Min="0" Max="19">Standby</Capability>
  <Capability Min="20" Max="255">Output</Capability>
 </Channel>
 <Channel Name="Fan Speed">
  <Group Byte="0">Intensity</Group>
  <Capability Min="0" Max="255">Fan 0-100%</Capability>
 </Channel>
 <Mode Name="Mode 1"><Channel Number="0">Haze Density</Channel><Channel Number="1">Fan Speed</Channel></Mode>
</FixtureDefinition>`

describe('QLC+ converter', () => {
  it('converts an RGBW par: intensity presets, strobe ranges, colour macros (new and old format)', () => {
    const def = convertQxfFixture(QXF_RGBW_PAR, { id: 'qlc/stairville/led-par-56-rgbw' })
    expect(def).toMatchObject({ id: 'qlc/stairville/led-par-56-rgbw', name: 'LED Par 56 RGBW', manufacturer: 'Stairville', categories: ['Color Changer'], source: 'qlcplus' })
    expect(def.modes.map((m) => [m.name, m.channelCount])).toEqual([['4 Channel', 4], ['8 Channel', 8]])
    expect(def.channels.Dimmer).toMatchObject({ type: 'intensity', precedence: 'HTP', highlightValue: 255 })
    expect(def.channels.Red).toMatchObject({ type: 'color', precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: 'Red', color: '#ff0000' }] })
    expect(def.channels.White.capabilities?.[0].color).toBe('#ffffff')
    expect(def.channels.Strobe.type).toBe('strobe')
    expect(def.channels.Strobe.capabilities).toEqual([
      { dmxRange: [0, 9], type: 'ShutterOpen', label: 'Open' },
      { dmxRange: [10, 255], type: 'ShutterStrobe', label: 'Strobe (1…25 Hz)' }
    ])
    const macros = def.channels.Macros.capabilities!
    expect(def.channels.Macros.type).toBe('color')
    expect(macros[1]).toMatchObject({ type: 'ColorPreset', label: 'Red', color: '#ff0000' })
    expect(macros[2]).toMatchObject({ color: '#ff0000', colors: ['#ff0000', '#00ff00'] })
    expect(macros[3]).toMatchObject({ color: '#0000ff', label: 'Blue (old format)' })
    expect(def.channels['R old']).toMatchObject({ type: 'color' })
    expect(def.channels['R old'].capabilities?.[0]).toMatchObject({ type: 'ColorIntensity', color: '#ff0000' })
    // physical from the mode when the fixture has none
    expect(def.physical).toEqual({ dimensions: [250, 200, 150], weight: 1.5, power: 60, DMXconnector: '3-pin', bulb: { type: 'LED' }, lens: { degreesMinMax: [25, 25] } })
  })

  it('converts a moving head: 16-bit pairs named for the console, gobo pictures, heads → pixel layout', () => {
    const def = convertQxfFixture(QXF_MOVING_HEAD)
    expect(def.id).toBe('glp/impression-mini')
    const mode = def.modes[0]
    expect(mode.channels.slice(0, 6)).toEqual(['Pan', 'Pan fine', 'Tilt', 'Tilt LSB', 'Zoom', 'Zoom fine'])
    expect(def.channels.Pan).toMatchObject({ type: 'pan', defaultValue: 128, fineChannelAliases: ['Pan fine'] })
    expect(def.channels['Pan fine']).toMatchObject({ type: 'pan', fineOf: 'Pan' })
    expect(def.channels['Tilt LSB']).toMatchObject({ type: 'tilt', fineOf: 'Tilt' })
    expect(def.channels['Zoom fine']).toMatchObject({ type: 'generic', fineOf: 'Zoom' })
    expect(def.channels.Gobo.type).toBe('gobo')
    expect(def.channels.Gobo.capabilities?.map((c) => [c.type, c.image])).toEqual([
      ['WheelSlot', 'Others/open.svg'], ['WheelSlot', 'Others/gobo00001.svg'], ['WheelShake', 'Others/gobo00001.svg']
    ])
    expect(mode.pixelLayout).toEqual({
      cellCount: 2,
      orientation: 'horizontal',
      cells: [
        { index: 0, channelOffset: 7, channelNames: ['Red 1', 'Green 1', 'Blue 1'] },
        { index: 1, channelOffset: 10, channelNames: ['Red 2', 'Green 2', 'Blue 2'] }
      ]
    })
    expect(def.physical).toMatchObject({ panRange: 540, tiltRange: 230, lens: { degreesMinMax: [5, 50] }, power: 200 })
  })

  it('converts a dimmer', () => {
    const def = convertQxfFixture(QXF_DIMMER)
    expect(def.categories).toEqual(['Dimmer'])
    expect(def.modes).toEqual([{ name: '1 Channel', channels: ['Intensity'], channelCount: 1 }])
    expect(def.channels.Intensity).toMatchObject({ type: 'intensity', precedence: 'HTP' })
  })

  it('never turns a hazer\'s output or fan into an intensity channel', () => {
    const def = convertQxfFixture(QXF_HAZER)
    expect(def.categories).toEqual(['Hazer'])
    expect(def.channels['Haze Density']).toMatchObject({ type: 'fog', precedence: 'LTP' })
    expect(def.channels['Haze Density'].capabilities?.[1]).toMatchObject({ type: 'FogOutput', label: 'Output' })
    expect(def.channels['Fan Speed'].type).toBe('speed')
  })

  it('rejects non-QXF content', () => {
    expect(() => convertQxfFixture('<Foo/>')).toThrow(/Not a QLC\+/)
  })
})

describe('catalog matching keys', () => {
  it('merges manufacturer spellings and drops the maker from the model', () => {
    expect(manufacturerMatchKey('ADJ')).toBe(manufacturerMatchKey('American DJ'))
    expect(manufacturerMatchKey('Showtec')).toBe(manufacturerMatchKey('Showtec Lighting'))
    expect(manufacturerMatchKey('Clay Paky')).toBe(manufacturerMatchKey('Clay-Paky'))
    expect(modelMatchKey('Showtec Sunstrip Active', 'Showtec')).toBe(modelMatchKey('Sunstrip Active', 'Showtec'))
    expect(modelMatchKey('MAC Aura XB', 'Martin')).toBe('macauraxb')
    // listing: spellings merge, product lines stay apart
    expect(manufacturerGroupKey('ADJ')).toBe(manufacturerGroupKey('American DJ'))
    expect(manufacturerGroupKey('Pro-Lights')).toBe(manufacturerGroupKey('Prolights'))
    expect(manufacturerGroupKey('Chauvet')).not.toBe(manufacturerGroupKey('Chauvet Professional'))
  })
})
