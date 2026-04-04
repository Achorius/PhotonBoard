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
]
