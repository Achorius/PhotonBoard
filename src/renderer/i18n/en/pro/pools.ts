// Pools view (pro.pools.*): presets, groups, macros, speed masters.
// Command-line keywords inside macro lines stay English.

export const pools = {
  /** Navigation rail entries added by the Pro view */
  nav: {
    pools: { label: 'Pools', title: 'Pools: presets, groups, macros, speed masters' },
    stage: { label: 'Stage', title: 'Stage pages' }
  },
  title: 'Pools',
  tabsAria: 'Pools',
  tabs: {
    presets: 'Presets',
    groups: 'Groups',
    macros: 'Macros',
    speed: 'Speed masters'
  },
  /** Preset families (pool rows) */
  families: {
    intensity: 'Dimmer',
    position: 'Position',
    gobo: 'Gobo',
    color: 'Colour',
    beam: 'Beam',
    focus: 'Focus',
    control: 'Control',
    full: 'All'
  },
  familyAria: '{family} presets',
  selection: { zero: 'No selection', one: '{count} fixture selected', other: '{count} fixtures selected' },
  emptySlot: 'Empty slot {ref}',
  emptySlotHint: 'Tap to store here',
  scope: {
    selective: 'Selective',
    selectiveHint: 'Values for these fixtures only',
    global: 'Global',
    globalHint: 'Values per fixture type',
    universal: 'Universal',
    universalHint: 'Any fixture that has these attributes',
    short: { selective: 'SEL', global: 'GLO', universal: 'UNI' }
  },
  hint: {
    presets: 'Tap a preset to apply it to the selection. Tap + to store the programmer there; right-click or long-press a tile for more.',
    groups: 'Tap a group to select its fixtures. Tap + to store the current selection as a group.',
    macros: 'Tap a macro to run it. A macro is a list of command lines with waits.',
    speed: 'Chases, effects and scenes linked to a speed master follow its tempo. Tap to set the beat.'
  },
  menu: {
    apply: 'Apply to selection',
    select: 'Select fixtures',
    store: 'Store here',
    storeHint: 'From the programmer',
    storeSelection: 'Store selection here',
    merge: 'Merge',
    mergeHint: 'Add to what it holds',
    overwrite: 'Overwrite',
    overwriteHint: 'Replace what it holds',
    update: 'Update',
    updateHint: 'Its values from the programmer',
    label: 'Label…',
    colour: 'Colour…',
    renumber: 'Renumber…',
    edit: 'Edit…',
    run: 'Run',
    stop: 'Stop',
    assign: 'Assign to executor…',
    delete: 'Delete'
  },
  ask: {
    storeTitle: 'Preset {ref} already holds values',
    storeMessage: 'Merge the programmer into it, or replace its values?'
  },
  dialog: {
    labelTitle: 'Label {what}',
    labelField: 'Name',
    renumberTitle: 'Renumber {what}',
    renumberField: 'Number',
    renumberMessage: 'An object already using that number takes the old one.',
    renumberInvalid: 'Enter a whole number from 1 to {max}',
    colourTitle: 'Colour of {what}',
    noColour: 'No colour'
  },
  sel: {
    preset: 'preset {ref} “{name}”',
    presetNoName: 'preset {ref}',
    group: 'group {n} “{name}”',
    macro: 'macro {n} “{name}”',
    speed: 'speed master {n} “{name}”'
  },
  defaults: {
    group: 'Group {n}',
    macro: 'Macro {n}',
    speed: 'Speed {n}'
  },
  undo: {
    storePreset: 'Store preset {ref}',
    updatePreset: 'Update preset {ref}',
    storeGroup: 'Store group {n}',
    newMacro: 'New macro {n}',
    editMacro: 'Edit {what}',
    newSpeed: 'New speed master {n}',
    label: 'Label {what}',
    colour: 'Colour {what}',
    renumber: 'Renumber {what}',
    link: 'Link to {what}',
    assign: 'Assign {what}'
  },
  toast: {
    selectFirst: 'Select fixtures first',
    selectFirstHint: 'Presets apply to the selected fixtures.',
    storeGroupHint: 'A group stores the selected fixtures.',
    presetNothing: '{what} has nothing for the selected fixtures',
    nothingToStore: 'The programmer has nothing for this preset',
    nothingToStoreHint: 'Set some {family} values for the selected fixtures first.',
    nothingToUpdate: 'Nothing to update',
    nothingToUpdateHint: 'The programmer holds none of the values this preset stores.',
    stored: 'Stored {what}',
    updated: 'Updated {what}',
    groupEmpty: 'This group has no fixtures',
    macroEmpty: 'This macro has no command yet'
  },
  groups: {
    emptyPatchTitle: 'No fixtures patched',
    emptyPatchDescription: 'Groups hold fixtures: patch some first.',
    openPatch: 'Open Patch',
    current: 'Selected'
  },
  macros: {
    lines: { zero: 'No line', one: '{count} line', other: '{count} lines' },
    running: 'Running'
  },
  macroEditor: {
    title: 'Macro {n}',
    name: 'Name',
    namePlaceholder: 'Macro {n}',
    lines: 'Lines',
    command: 'Command line {n}',
    commandPlaceholder: 'Fixture 1 Thru 4 At 50',
    wait: 'Wait',
    waitAria: 'Wait after line {n} (seconds)',
    addLine: 'Add line',
    removeLine: 'Remove line {n}',
    moveUp: 'Move line {n} up',
    moveDown: 'Move line {n} down',
    emptyTitle: 'No line yet',
    emptyDescription: 'Each line is a command line (English keywords), run in order. Wait = seconds before the next line.',
    saveAndRun: 'Save and run',
    stop: 'Stop'
  },
  speed: {
    bpm: 'Tempo',
    bpmAria: 'Tempo of {what}',
    tap: 'Tap',
    tapAria: 'Tap the tempo of {what}',
    linked: { zero: 'Nothing follows it', one: '{count} object follows it', other: '{count} objects follow it' },
    link: 'Link',
    linkAria: 'Objects following {what}',
    chases: 'Chases',
    effects: 'Effects',
    scenes: 'Scenes',
    noObjects: 'No scene, chase or effect in the show',
    unlink: 'Stop following',
    half: 'Half tempo',
    double: 'Double tempo',
    halfShort: '/2',
    doubleShort: 'x2'
  },
  assign: {
    title: 'Assign {what} to an executor',
    page: 'Page',
    slot: 'Executor {page}.{slot}',
    free: 'Free',
    done: 'Assigned to executor {page}.{slot}'
  }
}
