// The shell: top bar, File / Edit menus, navigation rail, fixture sidebar,
// executor bar, status bar, command line, output health.

export const shell = {
  loadingView: 'Loading view…',
  unsavedChanges: 'Unsaved changes',
  remoteBadge: 'REMOTE',

  tabs: {
    patch: { label: 'Patch', title: 'Patch' },
    fixtures: { label: 'Fixtures', title: 'Fixtures & programmer' },
    effects: { label: 'Effects', title: 'Effects' },
    playback: { label: 'Scenes', title: 'Scenes & chases' },
    live: { label: 'Timeline', title: 'Timeline' },
    visualizer: { label: '3D', title: '3D visualiser' },
    'stage-layout': { label: 'Layout', title: 'Stage layout' },
    midi: { label: 'MIDI', title: 'MIDI devices & mappings' },
    follow: { label: 'Follow', title: 'Follow spot' },
    settings: { label: 'Settings', title: 'Settings' }
  },
  workspace: 'Workspace',

  fileMenu: {
    trigger: 'File',
    newShow: 'New show',
    open: 'Open…',
    openDemo: 'Open a demo…',
    openDemoDescription: 'Ready-made shows to try PhotonBoard',
    openOnConsole: 'Open show on console',
    openRecent: 'Open recent',
    noRecent: 'No show in the shows folder',
    save: 'Save',
    saveAs: 'Save as…',
    upload: 'Upload show file…',
    uploadDescription: 'Send a .pbshow from this device to the console',
    reveal: 'Reveal show file',
    openUsb: 'Open from a USB stick…',
    saveCopyUsb: 'Save a copy on the USB stick',
    ejectUsb: 'Eject the USB stick',
    usbNone: 'No USB stick connected',
    quit: 'Quit PhotonBoard'
  },

  editMenu: {
    trigger: 'Edit',
    undo: 'Undo',
    undoWhat: 'Undo: {what}',
    redo: 'Redo',
    redoWhat: 'Redo: {what}',
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
    deleteSelection: 'Delete selection',
    deleteWhat: 'Delete {what}',
    duplicateSelection: 'Duplicate selection',
    duplicateWhat: 'Duplicate {what}',
    renameSelection: 'Rename…',
    noSelection: 'Nothing selected in this view',
    remoteHint: 'Undoes the edits made on this device; the console applies them like any remote edit.'
  },

  follow: {
    label: 'Follow',
    tooltip: 'Follow spot is tracking — open Follow'
  },
  timelineButton: {
    label: 'Live',
    play: 'Play the timeline · right-click: MIDI learn',
    stop: 'Stop the timeline · right-click: MIDI learn',
    playAria: 'Play timeline',
    stopAria: 'Stop timeline',
    midiLabel: 'Live / Timeline'
  },
  learn: {
    label: 'Learn',
    learning: 'Learning {target}',
    learningEllipsis: 'Learning…',
    tooltipIdle: 'MIDI learn: right-click (or long-press) any control, then move a MIDI fader or key. Click here to learn the Grand Master.',
    tooltipLearning: 'Move a MIDI control to map it — click to cancel',
    ariaIdle: 'MIDI learn',
    ariaLearning: 'MIDI learning {target} — cancel'
  },
  clear: {
    label: 'Clear',
    aria: 'Clear programmer',
    tooltipActive: 'Clear the programmer (release manual values)',
    tooltipEmpty: 'Programmer is empty'
  },
  stage: {
    label: 'Stage',
    tooltipRemote: 'Switch to the Stage view',
    tooltipConsole: 'Open the Stage window (second screen)'
  },
  connection: {
    connected: 'Connected to the console',
    pinRequired: 'PIN required',
    reconnecting: 'Reconnecting to the console…',
    online: 'Online',
    offline: 'Offline'
  },

  masters: {
    gm: 'GM',
    gmTooltip: 'Grand Master — double-click: full · right-click: MIDI learn',
    strobeTooltip: 'Strobe — hold · right-click: MIDI learn',
    strobeAria: 'Strobe (hold)',
    blinderTooltip: 'Blinder — hold for full white · right-click: MIDI learn',
    blinderAria: 'Blinder (hold)',
    blackoutTooltip: 'Blackout · right-click: MIDI learn',
    blackoutBanner: 'Blackout — all intensity output is at zero',
    release: 'Release (Esc)'
  },

  nav: {
    shortcuts: 'Keyboard shortcuts',
    showSidebar: 'Show fixture list',
    hideSidebar: 'Hide fixture list'
  },

  status: {
    noMidi: 'No MIDI',
    midiInputs: 'MIDI inputs: {names}',
    noMidiInput: 'No MIDI input connected',
    timecodeReceiving: 'Receiving MIDI timecode',
    timecodeNoSignal: 'Timecode enabled — no signal',
    notSavedYet: 'Not saved yet',
    revealPath: '{path} — click to reveal',
    showExecutors: 'Show executors',
    hideExecutors: 'Hide executors'
  },

  outputs: {
    summaryOk: { one: '{count} output OK', other: '{count} outputs OK' },
    connecting: 'Output connecting',
    error: 'Output error',
    none: 'No DMX output',
    checking: 'Output status…',
    popoverLabel: 'DMX outputs',
    patchedUniverses: { one: '{count} universe patched', other: '{count} universes patched' },
    emptyHelp: 'No Art-Net or USB DMX output is configured. The show runs, but nothing reaches the fixtures.',
    configure: 'Configure outputs',
    state: {
      ok: 'Sending',
      connecting: 'Connecting',
      error: 'Error',
      invalid: 'Invalid config',
      disabled: 'Disabled'
    }
  },

  sidebar: {
    title: 'Fixtures',
    addFixtures: 'Add fixtures (Patch)',
    hide: 'Hide fixture list',
    searchPlaceholder: 'Search name, type, address',
    searchAria: 'Search fixtures',
    universeAria: 'Universe',
    listAria: 'Patched fixtures',
    groupTitle: { one: '{name} — {count} fixture', other: '{name} — {count} fixtures' },
    emptyTitle: 'No fixtures patched',
    emptyDescription: 'Add fixtures from the library to start programming.',
    emptyAction: 'Add fixtures',
    noMatchTitle: 'No match',
    noMatchQuery: 'Nothing matches “{query}”.',
    noMatchUniverse: 'No fixture on this universe.',
    showAll: 'Show all',
    selectedCount: { one: '{count} selected', other: '{count} selected' },
    selectShown: 'Select shown',
    clearSelection: 'Clear',
    unknownType: 'Unknown fixture type',
    fadersHint: 'Double-click a fader to reset it'
  },

  executors: {
    aria: 'Executors',
    arrange: 'Arrange executors',
    doneArranging: 'Done arranging',
    arrangeTooltip: 'Arrange: move cells, rename, colours, modes (nothing fires)',
    doneTooltip: 'Done — back to playback',
    releaseAll: 'Release all scenes',
    releaseAllTooltip: 'Stop every scene and chase',
    modeShort: { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' },
    modeName: {
      toggle: 'Toggle — tap GO / STOP',
      trigger: 'Trigger — plays while held',
      flash: 'Flash — full while held'
    },
    buttonMode: 'Button mode',
    back: 'Back',
    cancelLearn: 'Cancel MIDI learn',
    learn: 'MIDI learn…',
    learnDescription: 'Then press a MIDI key or pad',
    rename: 'Rename…',
    renameTitle: 'Rename scene',
    renameLabel: 'Scene name',
    editInScenes: 'Edit in Scenes',
    deleteScene: 'Delete scene…',
    sceneLabel: 'scene “{name}”',
    columnN: 'Column {n}',
    columnTitle: 'Column title',
    columnHeaderTooltip: 'Column title & colour',
    cellPlaying: '{name}, {mode}, playing cue {cue} of {count}',
    cellStopped: '{name}, {mode}, stopped',
    midiMapped: 'MIDI mapped'
  },

  commandLine: {
    aria: 'Command line',
    placeholder: 'Fixture 1 thru 4 at 80   (press /)',
    programmerCleared: 'Programmer cleared',
    blackoutToggled: 'Blackout toggled',
    goScene: 'GO Scene {n}',
    stopScene: 'STOP Scene {n}',
    sceneNotFound: 'Scene {n} not found',
    noScenes: 'No scenes',
    allStopped: 'All scenes stopped',
    groupNotFound: 'Group {n} not found',
    invalidValue: 'Invalid value',
    invalidValueAfterAt: 'Invalid value after At',
    groupAt: 'Group {n} “{name}” at {percent}',
    groupSelected: { one: 'Selected group “{name}” ({count} fixture)', other: 'Selected group “{name}” ({count} fixtures)' },
    noMatchingFixtures: 'No matching fixtures',
    fixturesAt: { one: '{count} fixture at {percent}', other: '{count} fixtures at {percent}' },
    fixturesSelected: { one: 'Selected {count} fixture', other: 'Selected {count} fixtures' },
    noSelection: 'No fixtures selected',
    fixturesFull: { one: '{count} fixture at Full', other: '{count} fixtures at Full' },
    fixturesZero: { one: '{count} fixture at Zero', other: '{count} fixtures at Zero' },
    channelUsage: '{channel} <0-255>',
    channelSet: { one: '{count} fixture {channel} = {value}', other: '{count} fixtures {channel} = {value}' },
    unknown: 'Unknown command: {command}'
  }
}
