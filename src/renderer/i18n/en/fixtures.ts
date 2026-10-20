// Fixtures & programmer view: attribute panels, colour, position, beam, DMX grid, fixture sheet (components/fixtures).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.

export const fixtures = {
  // Header of the view
  modes: {
    aria: 'View',
    attributes: 'Attributes',
    attributesTitle: 'Program by attribute (intensity, position, colour, beam)',
    faders: 'Faders',
    fadersTitle: 'Channel faders per fixture',
    sheet: 'Sheet',
    sheetTitle: 'Spreadsheet of every fixture',
    dmx: 'DMX',
    dmxTitle: 'Raw DMX channels of a universe'
  },
  universeAria: 'Universe',
  unit: {
    aria: 'Values in',
    percent: 'Percent',
    dmx: 'DMX 0–255'
  },
  noSelection: 'No selection',
  locate: {
    label: 'Locate',
    aria: 'Locate selected fixtures',
    tooltip: 'Locate: selected fixtures at full, open white, centred (into the programmer)',
    toast: { one: 'Locate: {count} fixture open, white, centred', other: 'Locate: {count} fixtures open, white, centred' },
    toastDescription: 'Release or Clear to bring them back.'
  },
  release: {
    label: 'Release',
    selectionAria: 'Release selected fixtures',
    selectionTooltip: 'Release the selected fixtures from the programmer',
    attribute: 'Release {name}',
    intensity: 'Release intensity',
    colourTooltip: 'Release colour from the programmer',
    positionTooltip: 'Release pan / tilt from the programmer',
    feature: {
      beam: 'Release beam',
      control: 'Release control'
    }
  },
  groupMenu: {
    aria: 'Select a group',
    allFixtures: 'All fixtures',
    clearSelection: 'Clear selection'
  },

  // Empty states
  empty: {
    noPatchTitle: 'No fixtures patched',
    noPatchDescription: 'Patch fixtures to program them by attribute, or drive raw DMX channels directly.',
    addFixtures: 'Add fixtures',
    rawDmx: 'Raw DMX',
    nothingTitle: 'Nothing to program',
    nothingDescription: 'The selected fixtures have no known channels (missing fixture definition?).',
    selectTitle: 'Select fixtures to program',
    selectDescription: 'Pick fixtures in the fixture list, or select a group. Attributes appear for the channels the selection has.',
    showFixtureList: 'Show fixture list',
    universeTitle: 'No fixtures on universe {n}',
    universeDescription: 'Pick another universe above, or patch fixtures on this one.',
    noFixturesHere: 'No fixtures here'
  },

  // Attribute families (intensity / position / colour / beam come from common.*)
  features: {
    control: 'Control',
    aria: 'Attribute features',
    inProgrammer: 'in programmer'
  },

  // Names of well-known attributes (other channel names come from the fixture data)
  attributes: {
    dimmer: 'Dimmer',
    pan: 'Pan',
    tilt: 'Tilt',
    red: 'Red',
    green: 'Green',
    blue: 'Blue',
    white: 'White',
    amber: 'Amber',
    uv: 'UV',
    lime: 'Lime',
    cyan: 'Cyan',
    magenta: 'Magenta',
    yellow: 'Yellow',
    colorWheel: 'Colour wheel',
    colorMacro: 'Colour macro',
    colorTemperature: 'Colour temp',
    cto: 'CTO',
    ctb: 'CTB',
    shutter: 'Shutter',
    strobe: 'Strobe',
    gobo: 'Gobo',
    goboRotation: 'Gobo rotation',
    prism: 'Prism',
    prismRotation: 'Prism rotation',
    zoom: 'Zoom',
    focus: 'Focus',
    iris: 'Iris',
    frost: 'Frost',
    speed: 'Speed',
    cells: '{name} cells'
  },
  attr: {
    fine: '{name} (16-bit)',
    allCells: '{name} — all cells',
    cells: '{name} — cells',
    valueAria: '{name} value',
    selectionAria: '{name} (selection)',
    mixedValues: 'Mixed values',
    coverage: { one: '{count} of {total} selected fixtures', other: '{count} of {total} selected fixtures' }
  },

  // Intensity panel
  intensity: {
    full: 'Full',
    out: 'Out',
    mixedLevels: 'Mixed levels',
    coverage: { one: '{count} of {total} has a dimmer', other: '{count} of {total} have a dimmer' },
    more: { one: '+{count} more intensity channel in All', other: '+{count} more intensity channels in All' }
  },

  // Position panel
  position: {
    pan: 'Pan',
    tilt: 'Tilt',
    padLabel: 'Pan / Tilt',
    padLabelCount: { one: 'Pan / Tilt · {count} fixture', other: 'Pan / Tilt · {count} fixtures' },
    fine: 'Fine',
    fineTooltip: 'Fine: the pad moves at a tenth of the speed (relative drag)',
    centre: 'Centre',
    centreTooltip: 'Centre pan and tilt (home)',
    flip: 'Flip',
    flipTooltip: 'Same beam position from the other side (pan ±180°, tilt mirrored)',
    fineAdjust: 'Fine adjust',
    fineAdjustAria: '{name} fine adjust',
    sixteenBit: '16-bit: coarse and fine channels move together.',
    more: 'More',
    mixed: 'Mixed',
    mixedTitle: 'The selected fixtures have different values',
    xyPadAria: 'XY pad'
  },

  // Colour panel
  colour: {
    wheelAria: 'Colour wheel',
    wheelValueAria: 'Colour: hue {hue}°, saturation {sat}',
    brightness: 'Bright',
    brightnessAria: 'Colour brightness',
    currentAria: 'Current colour rgb {rgb}',
    none: 'No colour',
    mixed: 'Mixed colours',
    noMixing: 'No colour mixing',
    presetsAria: 'Colour presets',
    names: {
      open: 'Open',
      white: 'White',
      warmWhite: 'Warm white',
      coolWhite: 'Cool white',
      red: 'Red',
      orange: 'Orange',
      amber: 'Amber',
      yellow: 'Yellow',
      lime: 'Lime',
      green: 'Green',
      cyan: 'Cyan',
      lightBlue: 'Light blue',
      blue: 'Blue',
      congo: 'Congo',
      uv: 'UV',
      magenta: 'Magenta',
      pink: 'Pink',
      violet: 'Violet',
      black: 'Black',
      grey: 'Grey',
      colour: 'Colour'
    }
  },

  // Faders mode
  strips: {
    jumpAria: 'Jump to fixture',
    unknownType: 'Unknown fixture type'
  },

  // Sheet mode
  sheet: {
    noPatchDescription: 'The sheet lists every patched fixture with its live values.',
    noChannelsTitle: 'No channels',
    noChannelsDescription: 'The patched fixture types have no known channels.'
  },

  // Raw DMX mode
  dmx: {
    gridAria: 'Universe {n}, 512 channels',
    channelN: 'Ch {n}',
    unpatched: 'unpatched',
    selectHint: 'Select channels to set them',
    selectionRange: { one: '{count} channel · {from}–{to}', other: '{count} channels · {from}–{to}' },
    deselect: 'Deselect channels',
    levelAria: 'Level of the selected channels'
  },

  // Right-click / long-press menu on faders
  channelMenu: {
    learn: 'MIDI learn: {name}',
    learnGrandMaster: 'MIDI learn: Grand Master',
    learnBlackout: 'MIDI learn: Blackout',
    maps: 'Maps {name}'
  },

  // Programmer contents summary (lib/programmer-utils)
  summary: {
    empty: 'Empty',
    contents: '{fixtures}, {channels}',
    channels: { one: '{count} ch', other: '{count} ch' }
  }
}
