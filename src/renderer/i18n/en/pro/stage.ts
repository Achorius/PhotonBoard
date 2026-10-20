// Executor pages & live surfaces (pro.stage.*): executor bar pages and
// Pro cell menu, column faders, stage pages (designer + widgets), Stage
// window / tablet view switch.

export const stage = {
  kinds: {
    cuelist: 'Scene',
    chase: 'Chase',
    effect: 'Effect',
    macro: 'Macro',
    group: 'Group',
    speed: 'Speed master'
  },
  missingObject: 'Missing: {kind}',
  goTargetMark: 'GO / Back target',

  /** Button functions of an executor cell */
  fn: {
    toggle: 'Toggle',
    go: 'GO',
    goBack: 'GO back',
    flash: 'Flash',
    temp: 'Trigger (temp)',
    off: 'Off',
    select: 'Select',
    swap: 'Swap',
    pause: 'Pause',
    learn: 'Learn'
  },
  fnHint: {
    toggle: 'Tap = GO / Stop',
    go: 'Tap = next cue',
    goBack: 'Tap = previous cue',
    flash: 'Full while held',
    temp: 'Plays while held',
    off: 'Tap = stop',
    select: 'Tap = GO / Back target',
    swap: 'Flash, other scenes held out',
    pause: 'Tap = pause the fade',
    learn: 'Tap = MIDI learn this executor'
  },

  undo: {
    assign: 'Assign executor',
    removeFromCell: 'Empty executor',
    buttonFn: 'Button function',
    columnFader: 'Column fader',
    addPage: 'New executor page',
    renamePage: 'Rename executor page',
    addStagePage: 'New stage page',
    renameStagePage: 'Rename stage page',
    addWidget: 'Add widget',
    moveWidget: 'Move widget',
    resizeWidget: 'Resize widget',
    editWidget: 'Edit widget',
    gridSize: 'Stage page grid'
  },

  menu: {
    proSection: 'Executor {slot}',
    buttonFn: 'Button function',
    fnFromMode: 'From the mode ({fn})',
    assign: 'Assign…',
    assignOther: 'Assign something else…',
    assignCell: 'Assign executor, column {col} row {row}',
    noneOfKind: 'None in this show',
    columnFader: 'Fader of column {n}',
    selectGoTarget: 'Select as GO target',
    selectGoTargetHint: 'GO / Back keys and MIDI act on it',
    unselectGoTarget: 'Unselect GO target',
    removeFromCell: 'Remove from executor',
    runMacro: 'Run macro',
    selectGroup: 'Select group',
    tap: 'Tap tempo'
  },

  /** Column fader functions */
  fader: {
    label: 'Column fader',
    column: 'Column (its scenes and chases)',
    cell: 'Row {n} only',
    grandmaster: 'Grand Master',
    group: 'Group master: {name}',
    speed: 'Speed master: {name}',
    rate: 'Rate of row {n}',
    xfade: 'Crossfade of row {n}'
  },
  faders: {
    show: 'Show column faders',
    hide: 'Hide column faders',
    tooltip: 'Column faders (a dashed tick shows where an unsynced MIDI fader is)',
    columnAria: 'Fader of column {n}'
  },

  pages: {
    aria: 'Executor pages',
    selectorAria: '{name}, page {n} of {count}',
    selectorTooltip: 'Executor pages — swipe sideways or PageUp / PageDown',
    jumpTo: 'Go to page',
    playing: 'Something plays',
    previous: 'Previous page',
    next: 'Next page',
    add: 'New page',
    rename: 'Rename page…',
    delete: 'Delete page…',
    renameTitle: 'Rename executor page',
    renameLabel: 'Page name',
    pageLabel: 'page “{name}”',
    deleteMessage: 'Its executors are emptied. Scenes stay in the show and move to a free cell.'
  },

  /** Stage window / tablet: what the main area shows */
  view: {
    aria: 'Stage view',
    executors: 'Executors',
    pages: 'Pages'
  },

  widgetKinds: {
    executor: 'Executor',
    go: 'GO / Back',
    fader: 'Fader',
    master: 'Master',
    group: 'Group',
    preset: 'Preset',
    macro: 'Macro',
    speed: 'Speed master',
    clock: 'Clock',
    label: 'Label'
  },
  widgetHints: {
    executor: 'Any executor cell (fixed page or current page)',
    go: 'GO / Back of a sequence with the cue names',
    fader: 'Scene, chase, group master, column or Grand Master',
    master: 'Grand Master, Blackout, Blinder, Strobe, Release, Clear',
    group: 'Select a group (optional master fader)',
    preset: 'Apply a preset to the selection',
    macro: 'Run a macro',
    speed: 'Speed master BPM with a tap button',
    clock: 'Time of day',
    label: 'A title or a note'
  },
  presetFamily: {
    full: 'All',
    intensity: 'Dimmer',
    position: 'Position',
    gobo: 'Gobo',
    color: 'Colour',
    beam: 'Beam',
    focus: 'Focus',
    control: 'Control'
  },

  widget: {
    notSet: '{kind} — not set',
    emptyExecutor: 'Executor {slot} — empty',
    runMacro: 'Run macro {name}',
    applyPreset: 'Apply preset {name} to the selection',
    selectGroup: 'Select group {name}',
    groupMaster: '{name} master',
    tap: 'Tap',
    tapConsoleOnly: 'Tap from the console',
    noSequence: 'No sequence to GO',
    selectedSeq: 'Selected',
    nextCue: 'Next: {n} {name}',
    endOfSequence: 'End of the sequence',
    goAria: 'GO {name}',
    backAria: 'Back {name}',
    emptyLabel: 'Label'
  },

  designer: {
    title: 'Stage',
    pagesAria: 'Stage pages',
    arrange: 'Arrange',
    arrangeTooltip: 'Arrange: add, move and resize widgets (nothing fires)',
    doneTooltip: 'Done — back to playing',
    arrangeHint: 'Arrange — drag a widget (touch: hold, then drag), pull its corner to resize, tap an empty cell to add. Nothing fires.',
    newPage: 'New page',
    starterPage: 'Starter layout',
    starterHint: 'GO, masters, executors, groups — ready to play, then edit it',
    emptyPage: 'Empty page',
    pageOptions: 'Page options',
    rename: 'Rename…',
    renameTitle: 'Rename stage page',
    renameLabel: 'Page name',
    gridSize: 'Grid size',
    gridValue: '{cols} × {rows}',
    deletePage: 'Delete page…',
    pageLabel: 'stage page “{name}”',
    emptyTitle: 'No stage page yet',
    emptyDescription: 'Build your own touch page: the executors, faders, presets and masters you need during the show, sized for fingers. It also plays on the Stage window and on tablets.',
    emptyPlayer: 'Create stage pages in the Stage view of the console.',
    addWidget: 'Add a widget',
    paletteHint: 'Or tap an empty cell of the page. Select a widget to edit it.',
    addAt: 'Add a widget at column {x}, row {y}',
    widgetAria: '{kind} at column {x}, row {y}, {w} × {h}',
    widgetLabel: '{kind} widget',
    pageFull: 'No room left on this page — make the grid bigger or a widget smaller.',
    widgetsDropped: { one: '{count} widget did not fit and was removed', other: '{count} widgets did not fit and were removed' },
    inspectorAria: 'Widget settings'
  },

  inspector: {
    kind: 'Widget',
    choose: 'Choose…',
    noObjects: 'None in this show yet.',
    execPage: 'Executor page',
    currentPage: 'Current page (follows)',
    execCell: 'Executor',
    emptyCell: 'Empty — column {col}, row {row}',
    column: 'Column',
    faderTarget: 'Fader drives',
    faderTargets: {
      cuelist: 'Scene',
      chase: 'Chase',
      group: 'Group master',
      column: 'Executor column',
      gm: 'Grand Master'
    },
    groupMaster: 'Master fader',
    groupMasterHint: 'Needs a widget 2 cells high',
    sequence: 'Sequence',
    goTarget: 'The selected sequence (GO target)',
    masterFn: 'Function',
    masterFns: {
      gm: 'Grand Master fader',
      blackout: 'Blackout',
      blinder: 'Blinder (hold)',
      strobe: 'Strobe (hold)',
      release: 'Release all',
      clear: 'Clear the programmer'
    },
    seconds: 'Show seconds',
    label: 'Label',
    labelAuto: 'Automatic (object name)',
    text: 'Text',
    width: 'Width (cells)',
    height: 'Height (cells)',
    position: 'Column {x}, row {y} · {w} × {h}',
    moveHint: 'Move: drag it, or the arrow keys. Resize: its corner, or Shift + arrows.',
    deleteWidget: 'Delete the widget'
  }
}
