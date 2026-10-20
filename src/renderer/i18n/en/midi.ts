// MIDI view: devices, mappings table, mapping editor, learn menu, monitor (components/midi, lib/midi-learn).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.

export const midi = {
  view: {
    mappings: 'Mappings',
    mappingCount: { one: '{count} mapping', other: '{count} mappings' },
    connecting: 'Connecting',
    inputsConnected: { one: '{count} input connected', other: '{count} inputs connected' },
    noController: 'No controller connected'
  },
  api: {
    title: 'MIDI is not available on this system',
    unsupported: 'Web MIDI is not supported here.',
    failed: 'The MIDI ports could not be opened.',
    kept: 'Mappings are kept and work again when MIDI comes back.'
  },
  learn: {
    button: 'Learn',
    learnControl: 'Learn a control',
    cancel: 'Cancel learn',
    learning: 'Learning “{label}”',
    hint: 'Move a fader, turn a knob or press a pad on your controller.',
    mapped: 'Mapped “{name}”'
  },
  learnMenu: {
    masters: 'Masters',
    playback: 'Scenes & chases',
    nothingToMap: 'Nothing to map yet',
    fixtureChannel: 'Fixture channel…',
    fixtureChannelHint: 'Right-click (long-press) a fader in Fixtures'
  },
  devices: {
    region: 'MIDI devices',
    title: 'Devices',
    count: '{inputs} in · {outputs} out',
    rescan: 'Rescan MIDI devices',
    emptyTitle: 'No MIDI devices',
    emptyText: 'Connect a controller by USB — it appears here automatically (or press Rescan).',
    unavailableTitle: 'MIDI unavailable',
    unavailableText: 'This system gives no access to MIDI ports right now.',
    inputs: 'Inputs',
    outputs: 'Outputs',
    noInputs: 'No input ports',
    noOutputs: 'No output ports',
    connected: 'Connected',
    disconnected: 'Disconnected',
    activity: 'MIDI activity',
    receiving: 'Receiving',
    idle: 'Idle'
  },
  monitor: {
    region: 'MIDI monitor',
    title: 'Monitor',
    paused: 'paused',
    last: 'last {count}',
    resume: 'Resume monitor',
    pause: 'Pause monitor',
    clear: 'Clear monitor',
    emptyTitle: 'Waiting for MIDI',
    emptyText: 'Move a fader, turn a knob or hit a pad: messages appear here with the mapping they drive.'
  },
  table: {
    emptyTitle: 'No MIDI mappings yet',
    emptyText: 'Press Learn, choose what to control, then move a control on your device. You can also right-click (or long-press) faders and buttons anywhere in PhotonBoard.',
    searchPlaceholder: 'Search name, target, CC / note',
    searchLabel: 'Search mappings',
    filterLabel: 'Filter by target',
    noMatch: 'No mapping matches',
    clearFilters: 'Clear filters',
    activity: 'Activity',
    source: 'Source',
    target: 'Target',
    range: 'Range',
    actions: 'Actions',
    anyDevice: 'Any device · {type}',
    deleteMapping: 'Delete mapping {name}',
    relative: 'REL',
    absolute: 'ABS',
    inverted: 'INV'
  },
  editor: {
    region: 'Edit mapping',
    deleteMapping: 'Delete mapping',
    mapping: 'Mapping',
    nameLabel: 'Mapping name',
    source: 'Source',
    relearn: 'Re-learn',
    moveControl: 'Move a control…',
    device: 'Device',
    anyDevice: 'Any device',
    message: 'Message',
    messageType: 'Message type',
    programChange: 'Program change',
    midiChannel: 'MIDI channel',
    note: 'Note',
    program: 'Program',
    controller: 'Controller',
    number: 'Number',
    target: 'Target',
    control: 'Control',
    ref: {
      cuelist: 'Scene',
      chase: 'Chase',
      effect: 'Effect',
      fixture: 'Fixture',
      marker: 'Marker',
      zone: 'Section'
    },
    pickTarget: 'Pick what this control drives',
    choose: 'Choose…',
    behaviour: 'Behaviour',
    encoding: 'Encoding',
    encodingRelative: 'Endless encoder: each step nudges the value',
    encodingAbsolute: 'Fader / knob: position = value',
    absolute: 'Absolute',
    relative: 'Relative',
    range: 'Range',
    minimum: 'Minimum',
    min: 'Min',
    maximum: 'Maximum',
    max: 'Max',
    inverted: 'Inverted',
    invertedHint: 'Control up = value down',
    dangerZone: 'Danger zone',
    channelGone: 'This channel no longer exists'
  },
  source: {
    cc: 'CC',
    note: 'Note',
    program: 'Program',
    channelShort: 'ch {channel}'
  },
  target: {
    playingChases: 'Playing chases',
    notSet: 'Not set',
    missing: 'Missing'
  },
  categories: {
    masters: 'Masters',
    playback: 'Playback',
    fixtures: 'Fixtures',
    timeline: 'Timeline'
  },
  targets: {
    master: { label: 'Grand Master', description: 'Overall output level' },
    blackout: { label: 'Blackout', description: 'Toggles blackout on each press' },
    blinder: { label: 'Blinder', description: 'Full white while held' },
    strobe: { label: 'Strobe', description: 'Strobe while held' },
    reset: { label: 'Reset all', description: 'Clears the programmer and releases playback' },
    tap_tempo: { label: 'Tap tempo', description: 'Tap to set the tempo (the chase, or every playing chase)' },
    cuelist_go: { label: 'Scene GO', description: 'Start / stop or step a scene' },
    cuelist_fader: { label: 'Scene fader', description: 'Scene playback level' },
    flash: { label: 'Scene flash', description: 'Scene at full while held' },
    chase_toggle: { label: 'Chase on / off', description: 'Starts or stops a chase' },
    chase_bpm: { label: 'Chase tempo', description: 'Chase speed (30–300 BPM)' },
    effect_toggle: { label: 'Effect on / off', description: 'Starts or stops an effect (trigger / flash: while held)' },
    channel: { label: 'Fixture channel', description: 'One channel of a fixture, in the programmer' },
    timeline_play: { label: 'Timeline play / pause', description: 'Toggles timeline playback' },
    timeline_stop: { label: 'Timeline stop', description: 'Stops the timeline' },
    timeline_rewind: { label: 'Timeline rewind', description: 'Back to the start' },
    timeline_goto_marker: { label: 'Go to marker', description: 'Jumps the timeline to a marker' },
    timeline_goto_zone: { label: 'Go to section', description: 'Jumps the timeline to a section' }
  },
  behaviors: {
    direct: { label: 'Direct', description: 'Follows the control (faders, knobs); GO on press for scenes' },
    toggle: { label: 'Toggle', description: 'Press = on, press again = off' },
    trigger: { label: 'Trigger', description: 'On while held, off on release' },
    flash: { label: 'Flash', description: 'Full while held' }
  },
  delete: {
    message: 'The control on your MIDI device will no longer do anything here. You can undo this with Undo ({keys}).',
    confirm: 'Delete mapping'
  },
  selection: {
    /** Noun phrase after "Delete …?" / "Deleted: …" */
    mapping: 'mapping “{name}”',
    copyName: '{name} copy'
  }
}
