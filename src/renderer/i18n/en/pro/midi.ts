// MIDI controllers (pro.midi.*): controller profiles in the MIDI view
// (Devices panel, controller map) and the mapping editor's LED feedback.
// Device / profile names are never translated.

export const midi = {
  controllers: {
    region: 'MIDI controllers',
    title: 'Controllers',
    recognised: 'Recognised: {name}',
    enable: 'Use the profile',
    enableHint: 'Pads, faders and LEDs follow the executors. Your own mappings on a control always win.',
    handMapped: 'Off because this device already has your own mappings. Turn on to add the profile to them.',
    layout: 'Layout',
    layoutName: {
      'executors-2pages': 'Executors, 2 pages',
      'executors-busk': 'Executors + busking'
    },
    layoutHint: {
      'executors-2pages': 'Pad rows 1-4: current page · rows 5-8: next page.',
      'executors-busk': 'Rows 1-4: current page · then groups, colour presets, position presets, macros.'
    },
    faders: 'Faders',
    pickup: 'Pickup',
    jump: 'Jump',
    pickupHint: 'A fader takes over once it reaches the current value: nothing jumps on stage.',
    jumpHint: 'A fader applies its position at once.',
    pickupWait: '{control} ({target}) waits for pickup: the fader is at {position}, the value at {value}.',
    pickupWaitHint: 'Bring the fader to the current value to take over (the on-screen fader shows where it is), or choose “Jump” in MIDI › Controllers.',
    drives: 'What the profile drives',
    drivesFaders: 'Faders {from}–{to}: column faders of the current page (executor bar)',
    drivesControl: '{control}: {action}',
    drivesScenes: 'Scene buttons (top → bottom): {list}',
    drivesTracks: 'Track buttons: pages {from}–{to} (Shift: previous / next page)',
    drivesOverridden: 'Your mappings take over: {list}',
    rgb: 'Exact colours',
    rgbHint: 'Sends column colours as RGB (SysEx) instead of the nearest palette colour.',
    testLeds: 'Test LEDs',
    testing: 'Testing…',
    map: 'Map',
    mapTitle: '{name}: controller map',
    noOutput: 'No LED output port found: the LEDs stay dark.',
    disconnected: 'Disconnected',
    nanoLedMode: 'For the LEDs, set “LED Mode” to External in Korg Kontrol Editor.'
  },
  map: {
    hint: 'Tap a control to see what it does.',
    notUsed: 'Not used by this layout',
    userMapping: 'Your mapping “{name}” takes this control.',
    shiftThen: 'With Shift: {action}',
    control: {
      pad: 'Pad {col}.{row}',
      track: 'Track button {n}',
      scene: 'Scene button {n}',
      fader: 'Fader {n}',
      encoder: 'Encoder {n}',
      button: 'Button {id}'
    },
    action: {
      executor: 'Executor {page}.{slot}: {name}',
      executorEmpty: 'Executor {page}.{slot} (empty)',
      executorNoPage: 'Executor of page {page} (no such page yet)',
      selectExecutor: 'make it the GO / Back target',
      page: 'Page {n}',
      pagePrev: 'Previous page',
      pageNext: 'Next page',
      goSelected: 'GO (selected executor)',
      backSelected: 'Back (selected executor)',
      releaseAll: 'Release all',
      clear: 'Clear the programmer',
      blackout: 'Blackout',
      blinder: 'Blinder (hold)',
      strobe: 'Strobe (hold)',
      tap: 'Tap tempo',
      grandMaster: 'Grand Master',
      xfade: 'Crossfade of the selected scene',
      columnFader: 'Column {n} fader',
      group: 'Group {ref}',
      preset: 'Preset {ref}',
      macro: 'Macro {ref}'
    },
    short: {
      go: 'GO',
      back: 'Back',
      release: 'Rel.',
      clear: 'Clear',
      blackout: 'B.O.',
      blinder: 'Blind.',
      strobe: 'Strobe',
      tap: 'Tap',
      gm: 'GM',
      xfade: 'X-fade',
      prev: 'Pg −',
      next: 'Pg +'
    }
  },
  feedback: {
    label: 'LED feedback',
    off: 'Off',
    note: 'Note',
    cc: 'CC',
    hint: 'Sends the target’s state back to the device: pad LED (note), motor fader or LED ring (CC).',
    overridesProfile: 'This control also belongs to the {name} profile: this mapping wins.'
  }
}
