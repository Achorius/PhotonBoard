// ============================================================
// PhotonBoard — Built-in Fixture Library
// Generics + real-world fixtures from major manufacturers
// ============================================================

import type { FixtureDefinition, FixtureChannel } from '../shared/types'

// ---- Channel factories ----

function panCh(def = 128): FixtureChannel {
  return { name: 'Pan', type: 'pan', defaultValue: def, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Pan', label: 'Pan' }] }
}
function panFineCh(): FixtureChannel {
  return { name: 'Pan Fine', type: 'pan', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'PanFine', label: 'Pan Fine' }] }
}
function tiltCh(def = 128): FixtureChannel {
  return { name: 'Tilt', type: 'tilt', defaultValue: def, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Tilt', label: 'Tilt' }] }
}
function tiltFineCh(): FixtureChannel {
  return { name: 'Tilt Fine', type: 'tilt', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'TiltFine', label: 'Tilt Fine' }] }
}
function dimmerCh(name = 'Dimmer'): FixtureChannel {
  return { name, type: 'intensity', defaultValue: 0, highlightValue: 255, precedence: 'HTP', capabilities: [{ dmxRange: [0, 255], type: 'Intensity', label: '0-100%' }] }
}
function shutterCh(): FixtureChannel {
  return { name: 'Shutter', type: 'shutter', defaultValue: 20, precedence: 'LTP', capabilities: [
    { dmxRange: [0, 19], type: 'ShutterClose', label: 'Closed' },
    { dmxRange: [20, 24], type: 'ShutterOpen', label: 'Open' },
    { dmxRange: [64, 95], type: 'StrobeSpeed', label: 'Strobe slow→fast' }
  ]}
}
function strobeCh(): FixtureChannel {
  return { name: 'Strobe', type: 'strobe', defaultValue: 0, precedence: 'LTP', capabilities: [
    { dmxRange: [0, 9], type: 'ShutterOpen', label: 'Open' },
    { dmxRange: [10, 255], type: 'StrobeSpeed', label: 'Strobe slow→fast' }
  ]}
}
function colorCh(name: string, color: string): FixtureChannel {
  return { name, type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorIntensity', label: name, color }] }
}
function speedCh(): FixtureChannel {
  return { name: 'Speed', type: 'speed', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'PanTiltSpeed', label: 'Fast→Slow' }] }
}
function zoomCh(def = 128): FixtureChannel {
  return { name: 'Zoom', type: 'generic', defaultValue: def, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Zoom', label: 'Narrow→Wide' }] }
}
function focusCh(): FixtureChannel {
  return { name: 'Focus', type: 'generic', defaultValue: 128, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Focus', label: 'Focus' }] }
}
function goboCh(label = 'Gobo Wheel'): FixtureChannel {
  return { name: 'Gobo', type: 'gobo', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'WheelSlot', label }] }
}
function goboRotCh(): FixtureChannel {
  return { name: 'Gobo Rotation', type: 'gobo', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'WheelSlotRotation', label: 'Rotation' }] }
}
function prismCh(): FixtureChannel {
  return { name: 'Prism', type: 'prism', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Prism', label: 'Prism' }] }
}
function colorWheelCh(): FixtureChannel {
  return { name: 'Color Wheel', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'WheelSlot', label: 'Color Wheel' }] }
}
function resetCh(): FixtureChannel {
  return { name: 'Reset', type: 'maintenance', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [200, 255], type: 'Maintenance', label: 'Reset' }] }
}
function irisCh(): FixtureChannel {
  return { name: 'Iris', type: 'generic', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Iris', label: 'Open→Closed' }] }
}
function frostCh(): FixtureChannel {
  return { name: 'Frost', type: 'generic', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Frost', label: 'Off→Full' }] }
}
function ctoCh(): FixtureChannel {
  return { name: 'CTO', type: 'color', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'ColorTemperature', label: 'CTO' }] }
}
function cyanCh(): FixtureChannel { return colorCh('Cyan', '#00ffff') }
function magentaCh(): FixtureChannel { return colorCh('Magenta', '#ff00ff') }
function yellowCh(): FixtureChannel { return colorCh('Yellow', '#ffff00') }
function genericCh(name: string): FixtureChannel {
  return { name, type: 'generic', defaultValue: 0, precedence: 'LTP', capabilities: [{ dmxRange: [0, 255], type: 'Effect', label: name }] }
}

// Build channels record
function chs(...channels: FixtureChannel[]): Record<string, FixtureChannel> {
  const rec: Record<string, FixtureChannel> = {}
  for (const ch of channels) rec[ch.name] = ch
  return rec
}

// ---- All built-in fixtures ----

export const BUILTIN_FIXTURES: FixtureDefinition[] = [

  // ================================================================
  // GENERICS
  // ================================================================
  {
    id: 'generic/dimmer',
    name: 'Generic Dimmer',
    manufacturer: 'Generic',
    categories: ['Dimmer'],
    channels: chs(dimmerCh()),
    modes: [{ name: '1ch', channels: ['Dimmer'], channelCount: 1 }]
  },
  {
    id: 'generic/dimmer-2ch',
    name: 'Generic Dimmer 2ch',
    manufacturer: 'Generic',
    categories: ['Dimmer'],
    channels: chs(dimmerCh(), dimmerCh('Dimmer Fine')),
    modes: [{ name: '2ch', channels: ['Dimmer', 'Dimmer Fine'], channelCount: 2 }]
  },
  {
    id: 'generic/rgb',
    name: 'Generic RGB',
    manufacturer: 'Generic',
    categories: ['Color Changer'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff')),
    modes: [{ name: '3ch', channels: ['Red', 'Green', 'Blue'], channelCount: 3 }]
  },
  {
    id: 'generic/rgbw',
    name: 'Generic RGBW',
    manufacturer: 'Generic',
    categories: ['Color Changer'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff')),
    modes: [{ name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 }]
  },
  {
    id: 'generic/rgbwa',
    name: 'Generic RGBWA',
    manufacturer: 'Generic',
    categories: ['Color Changer'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00')),
    modes: [{ name: '5ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber'], channelCount: 5 }]
  },
  {
    id: 'generic/rgbwau',
    name: 'Generic RGBWAU',
    manufacturer: 'Generic',
    categories: ['Color Changer'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('UV', '#7700ff')),
    modes: [{ name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'UV'], channelCount: 6 }]
  },
  {
    id: 'generic/moving-head-wash',
    name: 'Generic Moving Head Wash',
    manufacturer: 'Generic',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), shutterCh(), speedCh()),
    modes: [{ name: '11ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Red', 'Green', 'Blue', 'White', 'Shutter', 'Speed'], channelCount: 11 }],
    physical: { lens: { degreesMinMax: [5, 25] } }
  },
  {
    id: 'generic/moving-head-spot',
    name: 'Generic Moving Head Spot',
    manufacturer: 'Generic',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), prismCh(), focusCh(), zoomCh(), speedCh(), resetCh()),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Prism', 'Focus', 'Zoom', 'Speed', 'Reset'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [10, 40] } }
  },

  // ================================================================
  // CHAUVET PROFESSIONAL
  // ================================================================
  {
    id: 'chauvet-professional/rogue-r2-wash',
    name: 'Rogue R2 Wash',
    manufacturer: 'Chauvet Professional',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), genericCh('Color Macro'), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), dimmerCh(), shutterCh(), speedCh(), resetCh(), genericCh('Auto Programs')),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Color Macro', 'Red', 'Green', 'Blue', 'White', 'Dimmer', 'Shutter', 'Speed', 'Reset', 'Auto Programs'], channelCount: 14 }],
    physical: { lens: { degreesMinMax: [3, 20] }, bulb: { lumens: 4000 }, power: 430 }
  },
  {
    id: 'chauvet-professional/rogue-r2-spot',
    name: 'Rogue R2 Spot',
    manufacturer: 'Chauvet Professional',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), shutterCh(), dimmerCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), focusCh(), zoomCh(), genericCh('Auto'), genericCh('Effect'), speedCh(), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Shutter', 'Dimmer', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Focus', 'Zoom', 'Auto', 'Effect', 'Speed', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [4, 22] }, power: 620 }
  },
  {
    id: 'chauvet-professional/colorado-solo-batten',
    name: 'COLORado Solo Batten',
    manufacturer: 'Chauvet Professional',
    categories: ['Batten'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), strobeCh()),
    modes: [
      { name: '7ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Strobe'], channelCount: 7 },
      { name: '5ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber'], channelCount: 5 }
    ],
    physical: { lens: { degreesMinMax: [20, 20] } }
  },

  // ================================================================
  // CHAUVET DJ
  // ================================================================
  {
    id: 'chauvet-dj/slimpar-pro-h',
    name: 'SlimPAR Pro H USB',
    manufacturer: 'Chauvet DJ',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), colorCh('White', '#ffffff'), colorCh('UV', '#7700ff'), strobeCh(), genericCh('Color Macro'), genericCh('Auto Speed'), genericCh('Auto/Sound'), genericCh('Programs')),
    modes: [
      { name: '6ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'White', 'UV'], channelCount: 6 },
      { name: '12ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Amber', 'White', 'UV', 'Strobe', 'Color Macro', 'Auto Speed', 'Auto/Sound', 'Programs'], channelCount: 12 }
    ]
  },
  {
    id: 'chauvet-dj/intimidator-spot-475z',
    name: 'Intimidator Spot 475Z',
    manufacturer: 'Chauvet DJ',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), shutterCh(), dimmerCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), focusCh(), zoomCh(), speedCh(), resetCh(), genericCh('Reserved 1'), genericCh('Reserved 2')),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Shutter', 'Dimmer', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Focus', 'Zoom', 'Speed', 'Reset', 'Reserved 1', 'Reserved 2'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [6, 32] }, power: 300 }
  },
  {
    id: 'chauvet-dj/well-fit',
    name: 'WELL Fit',
    manufacturer: 'Chauvet DJ',
    categories: ['Color Changer'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), colorCh('White', '#ffffff'), dimmerCh(), strobeCh(), genericCh('Effect'), genericCh('Auto Speed'), genericCh('Prog')),
    modes: [
      { name: '5ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'White'], channelCount: 5 },
      { name: '10ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'White', 'Dimmer', 'Strobe', 'Effect', 'Auto Speed', 'Prog'], channelCount: 10 }
    ]
  },

  // ================================================================
  // MARTIN
  // ================================================================
  {
    id: 'martin/mac-aura-xb',
    name: 'MAC Aura XB',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), genericCh('Dimmer Fine'), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), genericCh('CTC'), zoomCh(), colorCh('Aura Red', '#ff0000'), colorCh('Aura Green', '#00ff00'), colorCh('Aura Blue', '#0000ff'), dimmerCh('Aura Intensity'), genericCh('Control')),
    modes: [
      { name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Dimmer Fine', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Control'], channelCount: 14 },
      { name: '19ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Dimmer Fine', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'CTC', 'Zoom', 'Aura Red', 'Aura Green', 'Aura Blue', 'Aura Intensity', 'Control'], channelCount: 19 }
    ],
    physical: { lens: { degreesMinMax: [4, 40] }, power: 440 }
  },
  {
    id: 'martin/thrill-cxi',
    name: 'Thrill CXI',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), genericCh('Control')),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Control'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [5, 50] }, power: 300 }
  },
  {
    id: 'martin/mac-viper-performance',
    name: 'MAC Viper Performance',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), genericCh('Dimmer Fine'), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), genericCh('Gobo 2'), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), resetCh(), genericCh('Control')),
    modes: [{ name: '24ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Dimmer Fine', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo 2', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Reset', 'Control', 'Reserved'], channelCount: 24 }],
    physical: { lens: { degreesMinMax: [7, 50] }, power: 1000 }
  },

  // ================================================================
  // ROBE
  // ================================================================
  {
    id: 'robe/pointe',
    name: 'POINTE',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), focusCh(), colorWheelCh(), frostCh(), zoomCh(0), irisCh(), genericCh('Dimmer Fine'), resetCh()),
    modes: [
      { name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Focus', 'Color Wheel', 'Frost', 'Zoom'], channelCount: 16 },
      { name: '18ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Dimmer Fine', 'Shutter', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Focus', 'Color Wheel', 'Frost', 'Zoom', 'Iris'], channelCount: 18 }
    ],
    physical: { lens: { degreesMinMax: [0, 0] }, power: 470 }
  },
  {
    id: 'robe/megapointe',
    name: 'MegaPointe',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), genericCh('Prism 2'), frostCh(), zoomCh(0), focusCh(), irisCh(), resetCh()),
    modes: [
      { name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus'], channelCount: 16 },
      { name: '19ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Prism 2', 'Frost', 'Zoom', 'Focus', 'Iris', 'Reset'], channelCount: 19 }
    ],
    physical: { lens: { degreesMinMax: [0, 8] }, power: 520 }
  },

  // ================================================================
  // GLP
  // ================================================================
  {
    id: 'glp/impression-x4',
    name: 'impression X4',
    manufacturer: 'GLP',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), genericCh('Color Temperature'), zoomCh(), genericCh('Control')),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Color Temperature', 'Zoom', 'Control'], channelCount: 14 }],
    physical: { lens: { degreesMinMax: [7, 50] }, power: 370 }
  },
  {
    id: 'glp/jdc1',
    name: 'JDC1',
    manufacturer: 'GLP',
    categories: ['Strobe', 'Color Changer'],
    channels: chs(dimmerCh(), strobeCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), genericCh('Color Temperature'), genericCh('Mode'), zoomCh(), genericCh('Control')),
    modes: [{ name: '10ch', channels: ['Dimmer', 'Strobe', 'Red', 'Green', 'Blue', 'White', 'Color Temperature', 'Mode', 'Zoom', 'Control'], channelCount: 10 }],
    physical: { power: 620 }
  },

  // ================================================================
  // ETC
  // ================================================================
  {
    id: 'etc/source-four-par',
    name: 'Source Four PAR',
    manufacturer: 'ETC',
    categories: ['PAR'],
    channels: chs(dimmerCh()),
    modes: [{ name: '1ch', channels: ['Dimmer'], channelCount: 1 }],
    physical: { lens: { degreesMinMax: [26, 50] }, power: 750 }
  },
  {
    id: 'etc/colorsource-par',
    name: 'ColorSource PAR',
    manufacturer: 'ETC',
    categories: ['Color Changer', 'PAR'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Lime', '#80ff00'), dimmerCh(), strobeCh()),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'Lime'], channelCount: 4 },
      { name: '6ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Lime', 'Strobe'], channelCount: 6 }
    ],
    physical: { lens: { degreesMinMax: [50, 50] } }
  },

  // ================================================================
  // CLAY PAKY
  // ================================================================
  {
    id: 'clay-paky/sharpy',
    name: 'Sharpy',
    manufacturer: 'Clay Paky',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), goboCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), colorWheelCh(), ctoCh(), focusCh(), genericCh('Color Fine'), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Gobo', 'Prism', 'Prism Rotation', 'Frost', 'Color Wheel', 'CTO', 'Focus', 'Color Fine', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [0, 0] }, power: 470 }
  },
  {
    id: 'clay-paky/aleda-b-eye-k20',
    name: 'A.leda B-EYE K20',
    manufacturer: 'Clay Paky',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), genericCh('Color Select'), genericCh('Control'), genericCh('Ring Control'), genericCh('Ring Dimmer')),
    modes: [
      { name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Color Select', 'Control', 'Ring Control', 'Ring Dimmer'], channelCount: 16 }
    ],
    physical: { lens: { degreesMinMax: [4, 60] }, power: 650 }
  },

  // ================================================================
  // ADJ (American DJ)
  // ================================================================
  {
    id: 'adj/vizi-beam-rxone',
    name: 'Vizi Beam RXONE',
    manufacturer: 'ADJ',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), colorWheelCh(), goboCh(), prismCh(), focusCh(), shutterCh(), resetCh(), genericCh('Mode')),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Color Wheel', 'Gobo', 'Prism', 'Focus', 'Shutter', 'Reset', 'Mode'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [2, 2] }, power: 330 }
  },
  {
    id: 'adj/mega-par-profile-plus',
    name: 'Mega Par Profile Plus',
    manufacturer: 'ADJ',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), colorCh('White', '#ffffff'), colorCh('UV', '#7700ff'), strobeCh()),
    modes: [
      { name: '7ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'White', 'UV', 'Strobe'], channelCount: 7 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Amber', 'White', 'UV', 'Strobe'], channelCount: 8 }
    ]
  },
  {
    id: 'adj/hydro-wash-x19',
    name: 'Hydro Wash X19',
    manufacturer: 'ADJ',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), dimmerCh(), shutterCh(), speedCh(), zoomCh(), genericCh('Effect')),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Red', 'Green', 'Blue', 'White', 'Dimmer', 'Shutter', 'Speed', 'Zoom', 'Effect'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [10, 50] } }
  },

  // ================================================================
  // AYRTON
  // ================================================================
  {
    id: 'ayrton/magicblade-r',
    name: 'MagicBlade-R',
    manufacturer: 'Ayrton',
    categories: ['Batten', 'Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), dimmerCh(), shutterCh(), zoomCh(), genericCh('Macro'), genericCh('Effect'), genericCh('Master Speed'), genericCh('User Pattern'), genericCh('Segment'), genericCh('Control'), genericCh('Reset')),
    modes: [{ name: '18ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Red', 'Green', 'Blue', 'White', 'Dimmer', 'Shutter', 'Zoom', 'Macro', 'Effect', 'Master Speed', 'User Pattern', 'Segment', 'Control', 'Reset'], channelCount: 18 }],
    physical: { lens: { degreesMinMax: [3, 60] }, power: 650 }
  },
  {
    id: 'ayrton/mistral-s',
    name: 'Mistral-S',
    manufacturer: 'Ayrton',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), goboCh(), prismCh(), zoomCh(), focusCh(), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Gobo', 'Prism', 'Zoom', 'Focus', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [5, 40] }, power: 420 }
  },

  // ================================================================
  // ELATION
  // ================================================================
  {
    id: 'elation/platinum-beam-5r-extreme',
    name: 'Platinum Beam 5R Extreme',
    manufacturer: 'Elation',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), shutterCh(), dimmerCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), focusCh(), genericCh('Lamp'), speedCh(), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Shutter', 'Dimmer', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Focus', 'Lamp', 'Speed', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [0, 2] }, power: 660 }
  },
  {
    id: 'elation/artisan-profile',
    name: 'Artisan Profile',
    manufacturer: 'Elation',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), genericCh('Dimmer Fine'), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing Rotate'), resetCh()),
    modes: [{ name: '24ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Dimmer Fine', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing Rotate', 'Reset'], channelCount: 24 }],
    physical: { lens: { degreesMinMax: [6, 55] }, power: 880 }
  },

  // ================================================================
  // EUROLITE
  // ================================================================
  {
    id: 'eurolite/led-par-64-rgba',
    name: 'LED PAR-64 RGBA',
    manufacturer: 'Eurolite',
    categories: ['Color Changer', 'PAR'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), dimmerCh(), strobeCh(), genericCh('Programs'), genericCh('Sound')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'Amber'], channelCount: 4 },
      { name: '8ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'Dimmer', 'Strobe', 'Programs', 'Sound'], channelCount: 8 }
    ]
  },
  {
    id: 'eurolite/led-tmh-x25',
    name: 'LED TMH-X25',
    manufacturer: 'Eurolite',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), dimmerCh(), shutterCh(), speedCh(), zoomCh(), resetCh()),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Red', 'Green', 'Blue', 'White', 'Dimmer', 'Shutter', 'Speed', 'Zoom', 'Reset'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [8, 40] } }
  },

  // ================================================================
  // STAIRVILLE
  // ================================================================
  {
    id: 'stairville/mh-x30-led-spot',
    name: 'MH-x30 LED Spot',
    manufacturer: 'Stairville',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), colorWheelCh(), goboCh(), dimmerCh(), shutterCh(), speedCh(), genericCh('Special')),
    modes: [
      { name: '10ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Color Wheel', 'Gobo', 'Dimmer', 'Shutter', 'Speed', 'Special'], channelCount: 10 }
    ],
    physical: { lens: { degreesMinMax: [13, 13] } }
  },

  // ================================================================
  // CAMEO
  // ================================================================
  {
    id: 'cameo/auro-spot-200',
    name: 'AURO SPOT 200',
    manufacturer: 'Cameo',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), prismCh(), focusCh(), zoomCh(), speedCh()),
    modes: [{ name: '12ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Prism', 'Focus', 'Zoom', 'Speed'], channelCount: 12 }],
    physical: { lens: { degreesMinMax: [7, 25] } }
  },

  // ================================================================
  // SHOWTEC
  // ================================================================
  {
    id: 'showtec/led-par-56-short',
    name: 'LED PAR-56 Short',
    manufacturer: 'Showtec',
    categories: ['Color Changer', 'PAR'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), colorCh('White', '#ffffff'), dimmerCh(), strobeCh()),
    modes: [
      { name: '5ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'White'], channelCount: 5 },
      { name: '7ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'White', 'Dimmer', 'Strobe'], channelCount: 7 }
    ]
  },
  {
    id: 'showtec/compact-beam-7',
    name: 'Compact Beam 7',
    manufacturer: 'Showtec',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), colorWheelCh(), goboCh(), prismCh(), dimmerCh(), shutterCh(), speedCh(), resetCh()),
    modes: [{ name: '11ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Color Wheel', 'Gobo', 'Prism', 'Dimmer', 'Shutter', 'Speed', 'Reset'], channelCount: 11 }],
    physical: { lens: { degreesMinMax: [3, 3] } }
  },

  // ================================================================
  // ROBE (additional)
  // ================================================================
  {
    id: 'robe/robin-600e-spot',
    name: 'Robin 600E Spot',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), resetCh()),
    modes: [{ name: '21ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Reset'], channelCount: 21 }],
    physical: { lens: { degreesMinMax: [8, 42] }, power: 750 }
  },
  {
    id: 'robe/robin-300e-wash',
    name: 'Robin 300E Wash',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), resetCh()),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Reset'], channelCount: 14 }],
    physical: { lens: { degreesMinMax: [6, 45] }, power: 400 }
  },
  {
    id: 'robe/robin-ledbeam-150',
    name: 'Robin LEDBeam 150',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), genericCh('Pixel'), resetCh()),
    modes: [{ name: '15ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Pixel', 'Reset'], channelCount: 15 }],
    physical: { lens: { degreesMinMax: [3, 60] }, power: 250 }
  },
  {
    id: 'robe/robin-t1-profile',
    name: 'Robin T1 Profile',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing 3'), genericCh('Framing 4'), genericCh('Framing Rotate'), resetCh()),
    modes: [{ name: '26ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing 3', 'Framing 4', 'Framing Rotate', 'Reset'], channelCount: 26 }],
    physical: { lens: { degreesMinMax: [5, 50] }, power: 680 }
  },
  {
    id: 'robe/spiider',
    name: 'SPIIDER',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), genericCh('Ring'), resetCh()),
    modes: [{ name: '15ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Ring', 'Reset'], channelCount: 15 }],
    physical: { lens: { degreesMinMax: [4, 50] }, power: 620 }
  },
  {
    id: 'robe/robin-forte',
    name: 'Robin Forte',
    manufacturer: 'Robe',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), genericCh('Power'), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), genericCh('Gobo 2'), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing 3'), genericCh('Framing 4'), genericCh('Framing Rotate'), genericCh('Animation'), resetCh()),
    modes: [{ name: '29ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Power', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Gobo 2', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing 3', 'Framing 4', 'Framing Rotate', 'Animation', 'Reset'], channelCount: 29 }],
    physical: { lens: { degreesMinMax: [5, 50] }, power: 1000 }
  },

  // ================================================================
  // MARTIN (additional)
  // ================================================================
  {
    id: 'martin/mac-encore-performance',
    name: 'MAC Encore Performance',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), genericCh('Dimmer Fine'), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing Rotate'), genericCh('Control'), resetCh()),
    modes: [{ name: '25ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Dimmer Fine', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing Rotate', 'Control', 'Reset'], channelCount: 25 }],
    physical: { lens: { degreesMinMax: [7, 55] }, power: 820 }
  },
  {
    id: 'martin/mac-quantum-wash',
    name: 'MAC Quantum Wash',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), genericCh('Control')),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Control'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [8, 50] }, power: 350 }
  },
  {
    id: 'martin/rush-mh5-profile',
    name: 'RUSH MH 5 Profile',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), focusCh(), zoomCh(), speedCh(), resetCh()),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Focus', 'Zoom', 'Speed', 'Reset'], channelCount: 14 }],
    physical: { lens: { degreesMinMax: [10, 26] }, power: 230 }
  },
  {
    id: 'martin/era-300-profile',
    name: 'ERA 300 Profile',
    manufacturer: 'Martin',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), resetCh()),
    modes: [{ name: '20ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Reset'], channelCount: 20 }],
    physical: { lens: { degreesMinMax: [5, 44] }, power: 330 }
  },

  // ================================================================
  // GLP (additional)
  // ================================================================
  {
    id: 'glp/impression-x4-bar-20',
    name: 'impression X4 Bar 20',
    manufacturer: 'GLP',
    categories: ['Batten', 'Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), genericCh('Color Temperature'), zoomCh(), genericCh('Pixel'), genericCh('Control')),
    modes: [{ name: '15ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Color Temperature', 'Zoom', 'Pixel', 'Control'], channelCount: 15 }],
    physical: { lens: { degreesMinMax: [7, 50] }, power: 400 }
  },
  {
    id: 'glp/impression-x5',
    name: 'impression X5',
    manufacturer: 'GLP',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Lime', '#80ff00'), genericCh('Color Temperature'), zoomCh(), genericCh('Control')),
    modes: [{ name: '15ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Lime', 'Color Temperature', 'Zoom', 'Control'], channelCount: 15 }],
    physical: { lens: { degreesMinMax: [7, 50] }, power: 540 }
  },
  {
    id: 'glp/force-120',
    name: 'FORCE 120',
    manufacturer: 'GLP',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Control'), resetCh()),
    modes: [{ name: '22ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Control', 'Reset'], channelCount: 22 }],
    physical: { lens: { degreesMinMax: [5, 50] }, power: 1200 }
  },

  // ================================================================
  // CLAY PAKY (additional)
  // ================================================================
  {
    id: 'clay-paky/sharpy-plus',
    name: 'Sharpy Plus',
    manufacturer: 'Clay Paky',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), focusCh(), zoomCh(), genericCh('Control'), resetCh()),
    modes: [{ name: '21ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Focus', 'Zoom', 'Control', 'Reset'], channelCount: 21 }],
    physical: { lens: { degreesMinMax: [2, 44] }, power: 550 }
  },
  {
    id: 'clay-paky/mythos-2',
    name: 'Mythos 2',
    manufacturer: 'Clay Paky',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), genericCh('Gobo 2'), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Animation'), genericCh('Control'), resetCh()),
    modes: [{ name: '24ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Gobo 2', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Animation', 'Control', 'Reset'], channelCount: 24 }],
    physical: { lens: { degreesMinMax: [2, 44] }, power: 470 }
  },
  {
    id: 'clay-paky/axcor-profile-900',
    name: 'Axcor Profile 900',
    manufacturer: 'Clay Paky',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing 3'), genericCh('Framing 4'), genericCh('Framing Rotate'), resetCh()),
    modes: [{ name: '25ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing 3', 'Framing 4', 'Framing Rotate', 'Reset'], channelCount: 25 }],
    physical: { lens: { degreesMinMax: [5, 50] }, power: 900 }
  },
  {
    id: 'clay-paky/mini-b',
    name: 'Mini-B',
    manufacturer: 'Clay Paky',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), prismCh(), frostCh(), focusCh(), zoomCh(), resetCh()),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Prism', 'Frost', 'Focus', 'Zoom', 'Reset'], channelCount: 14 }],
    physical: { lens: { degreesMinMax: [1, 11] }, power: 140 }
  },

  // ================================================================
  // ETC (additional)
  // ================================================================
  {
    id: 'etc/source-four-led-s2-lustr',
    name: 'Source Four LED Series 2 Lustr',
    manufacturer: 'ETC',
    categories: ['Profile'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Lime', '#80ff00'), colorCh('Amber', '#ffaa00'), colorCh('Cyan', '#00ffff'), colorCh('Indigo', '#3300ff'), strobeCh(), genericCh('Fan')),
    modes: [
      { name: '5ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Strobe'], channelCount: 5 },
      { name: '10ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Lime', 'Amber', 'Cyan', 'Indigo', 'Strobe', 'Fan'], channelCount: 10 }
    ],
    physical: { lens: { degreesMinMax: [26, 50] }, power: 160 }
  },
  {
    id: 'etc/colorsource-spot',
    name: 'ColorSource Spot',
    manufacturer: 'ETC',
    categories: ['Profile'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Lime', '#80ff00'), strobeCh(), genericCh('Fan')),
    modes: [{ name: '7ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Lime', 'Strobe', 'Fan'], channelCount: 7 }],
    physical: { lens: { degreesMinMax: [19, 36] } }
  },
  {
    id: 'etc/colorsource-linear-1',
    name: 'ColorSource Linear 1',
    manufacturer: 'ETC',
    categories: ['Batten', 'Color Changer'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Lime', '#80ff00'), strobeCh()),
    modes: [{ name: '6ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Lime', 'Strobe'], channelCount: 6 }]
  },
  {
    id: 'etc/smartbar-2',
    name: 'SmartBar 2',
    manufacturer: 'ETC',
    categories: ['Dimmer'],
    channels: chs(dimmerCh('Dimmer 1'), dimmerCh('Dimmer 2'), dimmerCh('Dimmer 3'), dimmerCh('Dimmer 4')),
    modes: [
      { name: '4ch', channels: ['Dimmer 1', 'Dimmer 2', 'Dimmer 3', 'Dimmer 4'], channelCount: 4 },
      { name: '1ch', channels: ['Dimmer 1'], channelCount: 1 }
    ]
  },

  // ================================================================
  // CHAUVET (additional)
  // ================================================================
  {
    id: 'chauvet-professional/rogue-r3-wash',
    name: 'Rogue R3 Wash',
    manufacturer: 'Chauvet Professional',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('Lime', '#80ff00'), genericCh('Color Macro'), zoomCh(), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Lime', 'Color Macro', 'Zoom', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [8, 48] }, power: 560 }
  },
  {
    id: 'chauvet-professional/maverick-mk3-profile',
    name: 'Maverick MK3 Profile',
    manufacturer: 'Chauvet Professional',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing 3'), genericCh('Framing 4'), genericCh('Framing Rotate'), genericCh('Control'), resetCh()),
    modes: [{ name: '26ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing 3', 'Framing 4', 'Framing Rotate', 'Control', 'Reset'], channelCount: 26 }],
    physical: { lens: { degreesMinMax: [5, 42] }, power: 820 }
  },
  {
    id: 'chauvet-professional/colorado-panel-q40',
    name: 'COLORado Panel Q40',
    manufacturer: 'Chauvet Professional',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), genericCh('Auto'), genericCh('Speed')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Auto', 'Speed'], channelCount: 8 }
    ]
  },
  {
    id: 'chauvet-professional/ovation-e-910fc',
    name: 'Ovation E-910FC',
    manufacturer: 'Chauvet Professional',
    categories: ['Profile'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), colorCh('Lime', '#80ff00'), strobeCh(), genericCh('Fan')),
    modes: [{ name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Amber', 'Lime', 'Strobe', 'Fan'], channelCount: 8 }],
    physical: { lens: { degreesMinMax: [26, 50] }, power: 310 }
  },
  {
    id: 'chauvet-dj/freedom-par-rgba',
    name: 'Freedom Par RGBA',
    manufacturer: 'Chauvet DJ',
    categories: ['Color Changer', 'PAR'],
    channels: chs(colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), dimmerCh(), strobeCh(), genericCh('Color Macro'), genericCh('Auto')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'Amber'], channelCount: 4 },
      { name: '8ch', channels: ['Red', 'Green', 'Blue', 'Amber', 'Dimmer', 'Strobe', 'Color Macro', 'Auto'], channelCount: 8 }
    ]
  },
  {
    id: 'chauvet-dj/gigbar-2',
    name: 'GigBAR 2',
    manufacturer: 'Chauvet DJ',
    categories: ['Multi-Effect'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), genericCh('Derby'), genericCh('Laser'), genericCh('UV'), genericCh('Effect'), genericCh('Programs'), genericCh('Speed')),
    modes: [{ name: '12ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Derby', 'Laser', 'UV', 'Effect', 'Programs', 'Speed'], channelCount: 12 }]
  },

  // ================================================================
  // ADJ (additional)
  // ================================================================
  {
    id: 'adj/focus-spot-5z',
    name: 'Focus Spot 5Z',
    manufacturer: 'ADJ',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), focusCh(), zoomCh(), speedCh(), resetCh()),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Focus', 'Zoom', 'Speed', 'Reset'], channelCount: 14 }],
    physical: { lens: { degreesMinMax: [12, 18] }, power: 200 }
  },
  {
    id: 'adj/encore-fr150z',
    name: 'Encore FR150z',
    manufacturer: 'ADJ',
    categories: ['Fresnel'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), genericCh('Color Temperature'), zoomCh()),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Color Temperature', 'Zoom'], channelCount: 8 }
    ],
    physical: { lens: { degreesMinMax: [16, 45] } }
  },
  {
    id: 'adj/ultra-hex-bar-12',
    name: 'Ultra HEX Bar 12',
    manufacturer: 'ADJ',
    categories: ['Batten', 'Color Changer'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('UV', '#7700ff'), strobeCh(), genericCh('Color Macro'), genericCh('Programs'), genericCh('Speed')),
    modes: [
      { name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'UV'], channelCount: 6 },
      { name: '11ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'UV', 'Strobe', 'Color Macro', 'Programs', 'Speed'], channelCount: 11 }
    ]
  },
  {
    id: 'adj/element-hex',
    name: 'Element H6',
    manufacturer: 'ADJ',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('UV', '#7700ff'), strobeCh()),
    modes: [
      { name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'UV'], channelCount: 6 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'UV', 'Strobe'], channelCount: 8 }
    ]
  },

  // ================================================================
  // AYRTON (additional)
  // ================================================================
  {
    id: 'ayrton/perseo-profile',
    name: 'Perseo Profile',
    manufacturer: 'Ayrton',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing 3'), genericCh('Framing 4'), genericCh('Framing Rotate'), genericCh('Animation'), resetCh()),
    modes: [{ name: '27ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing 3', 'Framing 4', 'Framing Rotate', 'Animation', 'Reset'], channelCount: 27 }],
    physical: { lens: { degreesMinMax: [5, 50] }, power: 750 }
  },
  {
    id: 'ayrton/khamsin-s',
    name: 'Khamsin-S',
    manufacturer: 'Ayrton',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing Rotate'), genericCh('Animation'), resetCh()),
    modes: [{ name: '25ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing Rotate', 'Animation', 'Reset'], channelCount: 25 }],
    physical: { lens: { degreesMinMax: [6, 56] }, power: 750 }
  },
  {
    id: 'ayrton/eurus-s',
    name: 'Eurus-S',
    manufacturer: 'Ayrton',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), goboCh(), prismCh(), zoomCh(), focusCh(), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Gobo', 'Prism', 'Zoom', 'Focus', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [4, 45] }, power: 400 }
  },
  {
    id: 'ayrton/diablo-s',
    name: 'Diablo-S',
    manufacturer: 'Ayrton',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), resetCh()),
    modes: [{ name: '19ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Reset'], channelCount: 19 }],
    physical: { lens: { degreesMinMax: [3, 53] }, power: 380 }
  },

  // ================================================================
  // ELATION (additional)
  // ================================================================
  {
    id: 'elation/smarty-hybrid',
    name: 'Smarty Hybrid',
    manufacturer: 'Elation',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), focusCh(), zoomCh(), speedCh(), resetCh()),
    modes: [{ name: '15ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Focus', 'Zoom', 'Speed', 'Reset'], channelCount: 15 }],
    physical: { lens: { degreesMinMax: [2, 20] }, power: 350 }
  },
  {
    id: 'elation/fuze-wash-500',
    name: 'Fuze Wash 500',
    manufacturer: 'Elation',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Lime', '#80ff00'), genericCh('Color Temperature'), zoomCh(), genericCh('Control'), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Lime', 'Color Temperature', 'Zoom', 'Control', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [6, 44] }, power: 500 }
  },
  {
    id: 'elation/sixpar-200',
    name: 'SixPar 200',
    manufacturer: 'Elation',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('UV', '#7700ff'), strobeCh()),
    modes: [
      { name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'UV'], channelCount: 6 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'UV', 'Strobe'], channelCount: 8 }
    ]
  },

  // ================================================================
  // CAMEO (additional)
  // ================================================================
  {
    id: 'cameo/zenit-w600',
    name: 'ZENIT W600',
    manufacturer: 'Cameo',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('Lime', '#80ff00'), strobeCh(), genericCh('Color Temperature'), zoomCh()),
    modes: [
      { name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'Lime'], channelCount: 6 },
      { name: '10ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Lime', 'Strobe', 'Color Temperature', 'Zoom'], channelCount: 10 }
    ],
    physical: { lens: { degreesMinMax: [8, 48] }, power: 600 }
  },
  {
    id: 'cameo/movo-beam-z100',
    name: 'MOVO BEAM Z100',
    manufacturer: 'Cameo',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), prismCh(), focusCh(), zoomCh(), speedCh(), resetCh()),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Prism', 'Focus', 'Zoom', 'Speed', 'Reset'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [2, 8] }, power: 100 }
  },
  {
    id: 'cameo/evos-w7',
    name: 'EVOS W7',
    manufacturer: 'Cameo',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), genericCh('Pixel'), genericCh('Control'), resetCh()),
    modes: [{ name: '15ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Pixel', 'Control', 'Reset'], channelCount: 15 }],
    physical: { lens: { degreesMinMax: [4, 36] }, power: 350 }
  },
  {
    id: 'cameo/flat-pro-18',
    name: 'FLAT PRO 18',
    manufacturer: 'Cameo',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('UV', '#7700ff'), strobeCh(), genericCh('Color Macro')),
    modes: [
      { name: '6ch', channels: ['Red', 'Green', 'Blue', 'White', 'Amber', 'UV'], channelCount: 6 },
      { name: '9ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'UV', 'Strobe', 'Color Macro'], channelCount: 9 }
    ]
  },

  // ================================================================
  // SHOWTEC (additional)
  // ================================================================
  {
    id: 'showtec/phantom-75',
    name: 'Phantom 75 LED Spot',
    manufacturer: 'Showtec',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), focusCh(), speedCh(), resetCh()),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Focus', 'Speed', 'Reset'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [12, 12] }, power: 75 }
  },
  {
    id: 'showtec/spectral-m3000-zoom',
    name: 'Spectral M3000 Zoom Q4',
    manufacturer: 'Showtec',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), zoomCh()),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '7ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Zoom'], channelCount: 7 }
    ]
  },
  {
    id: 'showtec/kanjo-wash-rgb',
    name: 'Kanjo Wash RGB',
    manufacturer: 'Showtec',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), speedCh(), genericCh('Auto'), genericCh('Sound')),
    modes: [{ name: '12ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'Speed', 'Auto', 'Sound'], channelCount: 12 }],
    physical: { lens: { degreesMinMax: [25, 25] }, power: 30 }
  },

  // ================================================================
  // STAIRVILLE (additional)
  // ================================================================
  {
    id: 'stairville/mh-x50+',
    name: 'MH-x50+ LED Spot',
    manufacturer: 'Stairville',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), focusCh(), speedCh(), resetCh()),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Focus', 'Speed', 'Reset'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [13, 13] }, power: 50 }
  },
  {
    id: 'stairville/mh-z1915',
    name: 'MH-z1915 LED Wash',
    manufacturer: 'Stairville',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), zoomCh(), speedCh(), resetCh()),
    modes: [{ name: '13ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Zoom', 'Speed', 'Reset'], channelCount: 13 }],
    physical: { lens: { degreesMinMax: [8, 50] } }
  },
  {
    id: 'stairville/led-par-64-rgbw',
    name: 'LED PAR 64 CX-6 RGBW',
    manufacturer: 'Stairville',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), genericCh('Programs'), genericCh('Speed')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Programs', 'Speed'], channelCount: 8 }
    ]
  },

  // ================================================================
  // EUROLITE (additional)
  // ================================================================
  {
    id: 'eurolite/led-tmh-fe-600',
    name: 'LED TMH-FE 600',
    manufacturer: 'Eurolite',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), speedCh(), genericCh('Effect'), genericCh('Macro'), resetCh()),
    modes: [{ name: '14ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Red', 'Green', 'Blue', 'White', 'Speed', 'Effect', 'Macro', 'Reset'], channelCount: 14 }]
  },
  {
    id: 'eurolite/led-bar-252-rgba',
    name: 'LED BAR-252 RGBA',
    manufacturer: 'Eurolite',
    categories: ['Batten', 'Color Changer'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('Amber', '#ffaa00'), strobeCh(), genericCh('Programs'), genericCh('Speed')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'Amber'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Amber', 'Strobe', 'Programs', 'Speed'], channelCount: 8 }
    ]
  },

  // ================================================================
  // ASTERA
  // ================================================================
  {
    id: 'astera/titan-tube',
    name: 'Titan Tube',
    manufacturer: 'Astera',
    categories: ['Batten', 'Color Changer'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('Lime', '#80ff00'), strobeCh(), genericCh('Color Temperature'), genericCh('Effect'), genericCh('Speed')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '11ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Lime', 'Strobe', 'Color Temperature', 'Effect', 'Speed'], channelCount: 11 }
    ]
  },
  {
    id: 'astera/helios-tube',
    name: 'Helios Tube',
    manufacturer: 'Astera',
    categories: ['Batten', 'Color Changer'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), strobeCh(), genericCh('Color Temperature')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Strobe', 'Color Temperature'], channelCount: 8 }
    ]
  },
  {
    id: 'astera/ax1-pixeltube',
    name: 'AX1 PixelTube',
    manufacturer: 'Astera',
    categories: ['Batten', 'Color Changer', 'Pixel Bar'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('Lime', '#80ff00'), strobeCh(), genericCh('Color Temperature'), genericCh('Effect'), genericCh('Speed')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '11ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Lime', 'Strobe', 'Color Temperature', 'Effect', 'Speed'], channelCount: 11 }
    ]
  },

  // ================================================================
  // SGM
  // ================================================================
  {
    id: 'sgm/g-7-spot',
    name: 'G-7 Spot',
    manufacturer: 'SGM',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), resetCh()),
    modes: [{ name: '19ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Reset'], channelCount: 19 }],
    physical: { lens: { degreesMinMax: [6, 52] }, power: 700 }
  },
  {
    id: 'sgm/p-6',
    name: 'P-6',
    manufacturer: 'SGM',
    categories: ['Color Changer', 'PAR'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), genericCh('Color Temperature'), genericCh('Programs')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Color Temperature', 'Programs'], channelCount: 8 }
    ],
    physical: { power: 325 }
  },

  // ================================================================
  // VARI-LITE
  // ================================================================
  {
    id: 'vari-lite/vl3500-wash-fx',
    name: 'VL3500 Wash FX',
    manufacturer: 'Vari-Lite',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), zoomCh(), genericCh('Effect'), genericCh('Control'), resetCh()),
    modes: [{ name: '16ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Zoom', 'Effect', 'Control', 'Reset'], channelCount: 16 }],
    physical: { lens: { degreesMinMax: [15, 65] }, power: 1500 }
  },
  {
    id: 'vari-lite/vl2600-profile',
    name: 'VL2600 Profile',
    manufacturer: 'Vari-Lite',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing Rotate'), genericCh('Control'), resetCh()),
    modes: [{ name: '24ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing Rotate', 'Control', 'Reset'], channelCount: 24 }],
    physical: { lens: { degreesMinMax: [7, 52] }, power: 800 }
  },

  // ================================================================
  // HIGH END SYSTEMS
  // ================================================================
  {
    id: 'high-end-systems/solaspot-pro-2000',
    name: 'SolaSpot Pro 2000',
    manufacturer: 'High End Systems',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), genericCh('Prism Rotation'), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Control'), resetCh()),
    modes: [{ name: '22ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Prism Rotation', 'Frost', 'Zoom', 'Focus', 'Iris', 'Control', 'Reset'], channelCount: 22 }],
    physical: { lens: { degreesMinMax: [6, 43] }, power: 700 }
  },
  {
    id: 'high-end-systems/solaframe-3000',
    name: 'SolaFrame 3000',
    manufacturer: 'High End Systems',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), speedCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), genericCh('Framing 1'), genericCh('Framing 2'), genericCh('Framing 3'), genericCh('Framing 4'), genericCh('Framing Rotate'), genericCh('Animation'), genericCh('Control'), resetCh()),
    modes: [{ name: '27ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Speed', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Framing 1', 'Framing 2', 'Framing 3', 'Framing 4', 'Framing Rotate', 'Animation', 'Control', 'Reset'], channelCount: 27 }],
    physical: { lens: { degreesMinMax: [5, 55] }, power: 1400 }
  },

  // ================================================================
  // TMB / SOLARIS
  // ================================================================
  {
    id: 'tmb/solaris-flare',
    name: 'Solaris Flare',
    manufacturer: 'TMB',
    categories: ['Blinder', 'Strobe'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), genericCh('Effect'), genericCh('Speed')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '8ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Effect', 'Speed'], channelCount: 8 }
    ],
    physical: { power: 350 }
  },

  // ================================================================
  // ROBERT JULIAT
  // ================================================================
  {
    id: 'robert-juliat/dalis-860',
    name: 'Dalis 860',
    manufacturer: 'Robert Juliat',
    categories: ['Color Changer', 'Cyclorama'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), colorCh('Amber', '#ffaa00'), colorCh('Lime', '#80ff00'), strobeCh(), genericCh('Color Temperature')),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '9ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Amber', 'Lime', 'Strobe', 'Color Temperature'], channelCount: 9 }
    ],
    physical: { power: 100 }
  },

  // ================================================================
  // GENERIC (additional)
  // ================================================================
  {
    id: 'generic/dimmer-rgbw',
    name: 'Generic RGBW + Dimmer',
    manufacturer: 'Generic',
    categories: ['Color Changer'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh()),
    modes: [{ name: '6ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe'], channelCount: 6 }]
  },
  {
    id: 'generic/moving-head-beam',
    name: 'Generic Moving Head Beam',
    manufacturer: 'Generic',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), colorWheelCh(), goboCh(), prismCh(), focusCh(), speedCh(), resetCh()),
    modes: [{ name: '12ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Color Wheel', 'Gobo', 'Prism', 'Focus', 'Speed', 'Reset'], channelCount: 12 }],
    physical: { lens: { degreesMinMax: [0, 3] } }
  },
  {
    id: 'generic/led-bar',
    name: 'Generic LED Bar',
    manufacturer: 'Generic',
    categories: ['Batten', 'Pixel Bar'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh()),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '6ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe'], channelCount: 6 }
    ]
  },
  {
    id: 'generic/fog-machine',
    name: 'Generic Fog Machine',
    manufacturer: 'Generic',
    categories: ['Fog'],
    channels: chs(dimmerCh('Fog Output'), genericCh('Fan Speed')),
    modes: [
      { name: '1ch', channels: ['Fog Output'], channelCount: 1 },
      { name: '2ch', channels: ['Fog Output', 'Fan Speed'], channelCount: 2 }
    ]
  },
  {
    id: 'generic/hazer',
    name: 'Generic Hazer',
    manufacturer: 'Generic',
    categories: ['Fog'],
    channels: chs(dimmerCh('Haze Output'), genericCh('Fan Speed')),
    modes: [
      { name: '1ch', channels: ['Haze Output'], channelCount: 1 },
      { name: '2ch', channels: ['Haze Output', 'Fan Speed'], channelCount: 2 }
    ]
  },
  {
    id: 'generic/strobe',
    name: 'Generic Strobe',
    manufacturer: 'Generic',
    categories: ['Strobe'],
    channels: chs(dimmerCh(), strobeCh()),
    modes: [{ name: '2ch', channels: ['Dimmer', 'Strobe'], channelCount: 2 }]
  },
  {
    id: 'generic/blinder-2',
    name: 'Generic 2-Lite Blinder',
    manufacturer: 'Generic',
    categories: ['Blinder'],
    channels: chs(dimmerCh('Cell 1'), dimmerCh('Cell 2')),
    modes: [
      { name: '1ch', channels: ['Cell 1'], channelCount: 1 },
      { name: '2ch', channels: ['Cell 1', 'Cell 2'], channelCount: 2 }
    ]
  },
  {
    id: 'generic/cmy-moving-head',
    name: 'Generic CMY Moving Head',
    manufacturer: 'Generic',
    categories: ['Moving Head'],
    channels: chs(panCh(), panFineCh(), tiltCh(), tiltFineCh(), dimmerCh(), shutterCh(), cyanCh(), magentaCh(), yellowCh(), ctoCh(), colorWheelCh(), goboCh(), goboRotCh(), prismCh(), frostCh(), zoomCh(), focusCh(), irisCh(), speedCh(), resetCh()),
    modes: [{ name: '20ch', channels: ['Pan', 'Pan Fine', 'Tilt', 'Tilt Fine', 'Dimmer', 'Shutter', 'Cyan', 'Magenta', 'Yellow', 'CTO', 'Color Wheel', 'Gobo', 'Gobo Rotation', 'Prism', 'Frost', 'Zoom', 'Focus', 'Iris', 'Speed', 'Reset'], channelCount: 20 }],
    physical: { lens: { degreesMinMax: [5, 45] } }
  },
  {
    id: 'generic/fresnel-rgbw',
    name: 'Generic Fresnel RGBW',
    manufacturer: 'Generic',
    categories: ['Fresnel'],
    channels: chs(dimmerCh(), colorCh('Red', '#ff0000'), colorCh('Green', '#00ff00'), colorCh('Blue', '#0000ff'), colorCh('White', '#ffffff'), strobeCh(), zoomCh()),
    modes: [
      { name: '4ch', channels: ['Red', 'Green', 'Blue', 'White'], channelCount: 4 },
      { name: '7ch', channels: ['Dimmer', 'Red', 'Green', 'Blue', 'White', 'Strobe', 'Zoom'], channelCount: 7 }
    ],
    physical: { lens: { degreesMinMax: [15, 55] } }
  },
]
