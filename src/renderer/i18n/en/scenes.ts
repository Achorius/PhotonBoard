// Scenes & chases view: scene list, cue table, record popover, chase pane, scene settings (components/playback, lib record helpers).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.

export const scenes = {
  // Shared bits of the view
  effectCount: { one: '{count} effect', other: '{count} effects' },
  stepCount: { one: '{count} step', other: '{count} steps' },
  liveCount: '{count} LIVE',
  liveBadge: 'LIVE',
  flashBadge: 'FLASH',
  learnBadge: 'LEARN',
  noCues: 'No cues',
  loop: 'Loop',
  level: 'Level',
  priority: 'Priority',
  priorityShort: 'P{n}',
  cueN: 'Cue {number}',
  stepN: 'Step {n}',
  /** Executor slot "EX 3.2" (column.row) */
  slotShort: 'EX {slot}',
  slotShortMode: 'EX {slot} · {mode}',
  slotTitle: 'Executor column {col}, row {row}',
  /** Name of a duplicated scene / chase */
  copyName: '{name} copy',
  modeHint: {
    toggle: 'Tap = GO / Stop',
    trigger: 'Plays while held',
    flash: 'Full level while held'
  },

  /** Default names given to new items (stored in the show) */
  defaults: {
    sceneName: 'Scene {n}',
    chaseName: 'Chase {n}',
    cueName: 'Cue {n}'
  },

  /** Noun phrases for "Delete …?" and "Deleted: …" (see GLOSSARY.md › selection labels) */
  selection: {
    scene: 'scene “{name}”',
    cue: 'cue {number}',
    cueNamed: 'cue {number} “{name}”',
    chase: 'chase “{name}”',
    step: 'step {n}',
    effect: 'effect “{name}”',
    midiMapping: 'MIDI {source} of “{name}”'
  },

  /** Confirm dialogs of the deletes (followed by the "You can undo…" sentence) */
  delete: {
    sceneContents: 'Removes {cues}, its executor button and its timeline clips.',
    sceneContentsFx: 'Removes {cues} and {effects}, its executor button and its timeline clips.',
    sceneAction: 'Delete scene',
    cueContents: {
      one: 'Its channel value is removed; cues after it may change on stage (tracking).',
      other: 'Its {count} channel values are removed; cues after it may change on stage (tracking).'
    },
    cueAction: 'Delete cue',
    chaseContents: 'Removes {steps}.',
    chaseAction: 'Delete chase',
    stepContents: { one: 'Its channel value is removed.', other: 'Its {count} channel values are removed.' },
    stepAction: 'Delete step'
  },

  view: {
    paneAria: 'Scenes or chases',
    record: 'Record…',
    recordSceneTooltip: 'Record the programmer into a new scene, a new cue or an existing cue',
    recordChaseTooltip: 'Record the programmer into a new chase, a new step or an existing step',
    noSceneTitle: 'No scene selected',
    noSceneText: 'Record a look as a scene, or pick one in the list to edit its cues and timing.',
    noChaseTitle: 'No chase selected',
    noChaseText: 'Record a chase, or pick one in the list to edit its steps, tempo and direction.'
  },

  programmer: {
    counts: '{fixtures} fix · {channels} ch',
    empty: 'Programmer empty',
    activeTooltip: 'Values in the programmer — Record stores these',
    emptyTooltip: 'The programmer is empty — Record stores the live output'
  },

  list: {
    newEmpty: 'New empty scene',
    searchPlaceholder: 'Find scene by name or number',
    searchAria: 'Find scene',
    emptyTitle: 'No scenes yet',
    emptyText: 'Set a look in Fixtures, then record it. Scenes play from here, the executor bar and MIDI.',
    recordScene: 'Record scene',
    emptyScene: 'Empty scene',
    noMatchTitle: 'No matching scene',
    clearSearch: 'Clear search',
    cuesLoop: '{cues} · loop',
    stopNamed: 'Stop “{name}”',
    goNamed: 'GO “{name}”'
  },

  detail: {
    aria: 'Scene {name}',
    numberShort: 'S{n}',
    nameAria: 'Scene name',
    namePlaceholder: 'Untitled scene',
    stopped: 'Stopped',
    duplicate: 'Duplicate scene',
    delete: 'Delete scene',
    deleteEllipsis: 'Delete scene…',
    actions: 'Scene actions',
    backTooltip: 'Previous cue',
    goTooltip: 'GO next cue',
    stopTooltip: 'Stop and release the scene',
    flashTooltip: 'Hold: full level (plays a stopped scene while held)',
    levelAria: 'Scene level',
    tabsAria: 'Scene editor'
  },

  onStage: {
    next: 'Next',
    autoAfter: 'auto after {time}',
    delayPlusFade: '{delay} + {fade}',
    end: 'End of scene'
  },

  midi: {
    learning: 'MIDI learn…',
    cancelLearn: 'Cancel MIDI learn',
    learnTrigger: 'MIDI learn…',
    relearnTrigger: 'Re-learn MIDI trigger…',
    learnChase: 'MIDI learn start/stop…',
    relearnChase: 'Re-learn MIDI start/stop…',
    learnHint: 'Then press a MIDI key or pad',
    waiting: 'Waiting for a MIDI key or pad…',
    none: 'No MIDI trigger',
    relearn: 'Re-learn',
    removeAction: 'Remove mapping'
  },

  midiSource: {
    note: 'Note',
    cc: 'CC',
    program: 'Program',
    describe: '{kind} {number} · channel {channel}',
    describeDevice: '{kind} {number} · channel {channel} · {device}'
  },

  /** Shared by the cue table and the step table */
  table: {
    reorder: 'Reorder',
    actions: 'Actions',
    dragTitle: 'Drag to reorder',
    moveUp: 'Move up',
    moveDown: 'Move down'
  },

  /** Update a cue / step from the programmer */
  update: {
    fromProgrammer: 'Update from programmer',
    replaceWithProgrammer: 'Replace with programmer',
    mergeDescription: 'Merge: add / override channels',
    replaceCueDescription: 'The cue keeps only the new values',
    replaceStepDescription: 'The step keeps only the new values',
    merge: 'Merge',
    mergeTitle: 'Add / override channels, keep the others',
    replace: 'Replace'
  },

  cues: {
    fadeIn: 'Fade in',
    fadeInTitle: 'Fade in: intensity going up and every other attribute',
    fadeOut: 'Fade out',
    fadeOutTitle: 'Fade out: intensity going down',
    delay: 'Delay',
    delayTitle: 'Wait before the fade starts',
    follow: 'Follow',
    followTitle: 'Auto-follow: the next cue starts this long after this cue’s fade ends',
    channelsShort: 'Ch',
    channelsTitle: 'Channels stored in this cue',
    tracked: 'Tracked',
    trackedTitle: 'Channels on stage with tracking (this cue and the cues before it)',
    dragAria: 'Drag to reorder cue {number}',
    onStage: 'On stage',
    nameAria: 'Cue {number} name',
    fadeInAria: 'Cue {number} fade in',
    fadeOutAria: 'Cue {number} fade out',
    delayAria: 'Cue {number} delay',
    followAria: 'Cue {number} auto-follow time',
    manual: 'Manual',
    manualTooltip: 'Manual: waits for GO. Click for auto-follow.',
    backToManual: 'Back to manual GO',
    actionsAria: 'Cue {number} actions',
    menuTitleNamed: 'Cue {number} · {name}',
    goTo: 'GO to this cue',
    autoFollow: 'Auto-follow',
    moveUp: 'Move cue up',
    moveDown: 'Move cue down',
    duplicate: 'Duplicate cue',
    delete: 'Delete cue',
    deleteEllipsis: 'Delete cue…',
    updateTooltip: 'Merge the programmer into the selected cue',
    add: 'Add cue',
    addTooltip: 'Record the programmer as a new cue at the end',
    emptyTitle: 'No cues in this scene',
    emptyText: 'Set a look in Fixtures, then record it as cue 1. Each cue fades from the previous one; unchanged channels track through.',
    recordFirst: 'Record cue 1'
  },

  effects: {
    replaceTitle: 'Replace the effects of “{name}”?',
    replaceMessage: {
      one: 'Its stored effect is replaced by the {running} running now.',
      other: 'Its {count} stored effects are replaced by the {running} running now.'
    },
    replaceAction: 'Replace effects',
    stored: { one: '{count} effect stored in “{name}”', other: '{count} effects stored in “{name}”' },
    noneRunningTooltip: 'No effect is running — start effects in the Effects view',
    storeTooltip: 'Store the effects running now in this scene',
    storeRunning: 'Store running effects',
    storeRunningCount: 'Store running effects ({count})',
    replaceRunning: 'Replace with running ({count})',
    emptyTitle: 'No effects in this scene',
    emptyText: 'Effects stored in a scene restart on every GO and stop with the scene.',
    summary: '{effects} · restart on GO, stop with the scene',
    nameAria: 'Effect name',
    speed: 'Speed',
    size: 'Size',
    spread: 'Spread',
    removeNamed: 'Remove “{name}”',
    removeTitle: 'Remove “{name}” from this scene?',
    removeMessage: 'The effect stays in the Effects view.',
    removeAction: 'Remove effect'
  },

  settings: {
    colorHint: 'Executor column {col} — shared by its scenes',
    colorHintNamed: 'Executor column {col} “{title}” — shared by its scenes',
    colorHintNoSlot: 'Shown once the scene has an executor slot',
    priorityHint: 'Higher wins on channels shared with other scenes',
    loopDescription: 'After the last cue, auto-follow continues with cue 1',
    autoFollowAll: 'Auto-follow all',
    manualAll: 'Manual GO for all',
    renumber: 'Renumber',
    renumberTooltip: 'Number the cues 1, 2, 3… in list order',
    executor: 'Executor',
    slot: 'Slot',
    slotPosition: 'column {col}, row {row}',
    button: 'Button',
    buttonModeAria: 'Executor button mode',
    noSlot: 'Not on the executor bar — all 32 slots are in use. Free a slot to give this scene a button.',
    midi: 'MIDI'
  },

  chaseList: {
    newEmpty: 'New empty chase',
    emptyTitle: 'No chases yet',
    emptyText: 'A chase steps through looks to the beat. Record each look as a step.',
    recordChase: 'Record chase',
    emptyChase: 'Empty chase',
    playNamed: 'Play “{name}”'
  },

  chase: {
    aria: 'Chase {name}',
    numberShort: 'C{n}',
    nameAria: 'Chase name',
    namePlaceholder: 'Untitled chase',
    stopped: 'Stopped',
    duplicate: 'Duplicate chase',
    delete: 'Delete chase',
    deleteEllipsis: 'Delete chase…',
    actions: 'Chase actions',
    play: 'Play',
    playTooltip: 'Start the chase',
    stopTooltip: 'Stop the chase',
    tap: 'Tap',
    tapTooltip: 'Tap 2+ times to the beat',
    perStep: '{time} / step',
    stepTimeTitle: 'Step time at this tempo',
    levelAria: 'Chase level',
    directionAria: 'Direction',
    direction: { forward: 'Fwd', backward: 'Back', bounce: 'Bounce', random: 'Random' },
    directionTitle: {
      forward: 'Forward: 1 → n',
      backward: 'Backward: n → 1',
      bounce: 'Bounce: 1 → n → 1',
      random: 'Random step order'
    },
    crossfade: 'Crossfade'
  },

  steps: {
    moveUp: 'Move step up',
    moveDown: 'Move step down',
    duplicate: 'Duplicate step',
    delete: 'Delete step',
    deleteEllipsis: 'Delete step…',
    updateTooltip: 'Merge the programmer into the selected step',
    add: 'Add step',
    addTooltip: 'Record the programmer as a new step at the end',
    emptyTitle: 'No steps yet',
    emptyText: 'Set a look in Fixtures and record it as step 1, then change the look and add the next step.',
    recordFirst: 'Record step 1',
    look: 'Look',
    lookTitle: 'Approximate colour / level of each fixture',
    noColour: 'No colour or level (position / beam only)',
    unpatched: 'Unpatched',
    contents: 'Contents',
    time: 'Time',
    timeTitle: 'Step time: one beat at the chase tempo, or a fixed hold time',
    dragAria: 'Drag to reorder step {n}',
    oneBeat: '1 beat · {time}',
    beatTooltip: 'One beat at the chase tempo. Click to hold this step for a fixed time.',
    hold: 'Hold',
    backToBeat: 'Back to one beat',
    actionsAria: 'Step {n} actions'
  },

  record: {
    titleScenes: 'Record scene / cue',
    titleChases: 'Record chase / step',
    contents: 'Contents',
    nothing: 'Nothing to record',
    nothingHint: 'Set levels in Fixtures (programmer) first.',
    nothingHintEffects: 'Set levels in Fixtures or turn on an effect first.',
    sourceProgrammer: 'Programmer values',
    sourceProgrammerHint: 'Only the channels you touched are stored.',
    sourceOutput: 'Live output (programmer empty)',
    sourceOutputHint: 'Every channel above zero is stored.',
    fixturesShort: '{count} fix',
    selectedOnly: 'Selected fixtures only ({count})',
    into: 'Record into',
    newScene: 'New scene',
    newSceneHint: 'Creates a scene with this look as cue 1',
    newChase: 'New chase',
    newChaseHint: 'Creates a chase with this look as step 1',
    addCueTo: 'Add cue to {name}',
    addCueSelected: 'Add cue to selected scene',
    addStepTo: 'Add step to {name}',
    addStepSelected: 'Add step to selected chase',
    becomesCue: 'Becomes cue {number}, after the last cue',
    becomesStep: 'Becomes step {n}',
    selectSceneFirst: 'Select a scene first',
    selectChaseFirst: 'Select a chase first',
    updateCueN: 'Update cue {number} {name}',
    updateACue: 'Update a cue',
    updateStepN: 'Update step {n}',
    updateAStep: 'Update a step',
    updateCueSelected: '{count} ch now · selected cue',
    updateCueOnStage: '{count} ch now · cue on stage',
    channelsNow: '{count} ch now',
    selectCueFirst: 'Select a cue in the cue list',
    selectStepFirst: 'Select a step in the step list',
    updateModeAria: 'Update mode',
    sceneNamePlaceholder: 'Scene name (optional)',
    chaseNamePlaceholder: 'Chase name (optional)',
    includeEffects: 'Include running effects',
    runningEffects: '{count} running: {names}',
    noEffectRunning: 'No effect is running',
    clearAfter: 'Clear programmer after recording',
    clearAfterHint: 'REC + Clear: release your manual values once stored',
    recordCue: 'Record cue',
    recordStep: 'Record step',
    emptyValues: 'Empty',
    describeValues: '{fixtures} · {count} ch'
  },

  toast: {
    captureSummary: '{fixtures} · {channels}',
    summaryCleared: '{summary} · programmer cleared',
    recorded: 'Recorded',
    sceneRecorded: 'Scene “{name}” recorded',
    chaseRecorded: 'Chase “{name}” recorded',
    cueAdded: 'Cue {number} added to “{name}”',
    cueUpdated: 'Cue {number} updated',
    cueReplaced: 'Cue {number} replaced',
    channelsMerged: { one: '{count} channel merged', other: '{count} channels merged' },
    stepAdded: 'Step {n} added to “{name}”',
    stepUpdated: 'Step {n} updated',
    stepReplaced: 'Step {n} replaced'
  }
}
