// Follow spot view: follow pad, panel, gamepad section (components/follow).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.

export const follow = {
  title: 'Follow spot',
  badgeTracking: 'TRACKING',
  badgeStandby: 'STANDBY',
  groupCount: { one: '{count} fixture in the group', other: '{count} fixtures in the group' },
  gamepadReady: 'Gamepad ready',
  start: 'Start follow',
  stop: 'Stop follow',
  startTooltip: 'Aim the group at the target',
  stopTooltip: 'Release the fixtures',
  startDisabledTooltip: 'Add fixtures that have a stage position',

  fixtures: {
    aria: 'Follow fixtures',
    assignedOf: '{n} of {total}',
    allTooltip: 'Add every moving head to the follow group',
    noneTooltip: 'Empty the follow group',
    emptyTitle: 'No moving heads patched',
    emptyDescription: 'Follow aims moving heads at a target. Patch some first.',
    openPatch: 'Open Patch',
    footnote: 'Aiming uses each fixture’s stage position and its pan / tilt range.',
    rowAria: 'Follow with {name}',
    range: 'Pan {pan} · Tilt {tilt}',
    rangeDefault: 'Pan {pan} · Tilt {tilt} (default)',
    rangeFromProfile: 'From the fixture profile',
    rangeDefaultTooltip: 'Profile has no range: default used',
    noPosition: 'NO POSITION',
    noPositionTooltip: 'Place it in Stage layout so follow can aim it'
  },

  pad: {
    aria: 'Stage pad',
    title: 'Target',
    subtitle: 'Stage seen from above — drag to aim · Shift / second finger = fine',
    centre: 'Centre',
    centreTooltip: 'Centre stage at {height} m',
    noPositionTitle: 'Moving heads have no stage position',
    noPositionDescription: 'Place them in Stage layout: follow needs to know where each one hangs.',
    openStageLayout: 'Open Stage layout',
    heightAria: 'Target height',
    heightCaption: 'Height m',
    upstage: 'Upstage',
    audience: 'Audience',
    targetAria: 'Follow target — drag to aim, arrow keys to nudge',
    readout: 'X {x} · Z {z} · H {h} m'
  },

  settings: {
    aria: 'Follow settings',
    dimmerAria: 'Follow dimmer',
    movement: 'Movement',
    speed: 'Speed',
    speedAria: 'Gamepad speed',
    speedHint: 'Gamepad: metres per second at full stick',
    homeHeight: 'Home height',
    homeHeightHint: 'Height used by Centre ({height} m ≈ chest)'
  },

  gamepad: {
    title: 'Gamepad',
    connected: 'Connected',
    none: 'No gamepad',
    plugIn: 'Plug in a USB / Bluetooth controller and press a button',
    activation: 'Activation',
    activationAria: 'Activation mode',
    hold: 'Hold',
    toggle: 'Toggle',
    trigger: 'Trigger',
    triggerHint: 'Press the button to use on the gamepad',
    pressButton: 'Press a button…',
    invertX: 'Invert left / right',
    invertY: 'Invert height',
    invertZ: 'Invert depth',
    leftStick: 'Left',
    rightStick: 'Right',
    noButton: 'No button pressed',
    buttonN: 'Button {n}',
    dpadUp: 'D-pad up',
    dpadDown: 'D-pad down',
    dpadLeft: 'D-pad left',
    dpadRight: 'D-pad right'
  },

  help: {
    title: 'How it works',
    step1: 'Tick the moving heads that should follow, and place them in Stage layout.',
    step2: 'Start follow (or hold the gamepad trigger), then drag on the pad.',
    step3: 'Left stick: left / right and height. Right stick: depth.',
    step4: 'Stopping gives the fixtures back to what they were doing.'
  }
}
