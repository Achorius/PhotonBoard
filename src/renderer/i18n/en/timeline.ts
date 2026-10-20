// Timeline view: transport, tracks, clips, markers, zones, timecode panel, inspector, library (components/live).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.

export const timeline = {
  openScenes: 'Open Scenes',
  clipCount: { one: '{count} clip', other: '{count} clips' },

  /** Selection labels: read after "Delete …?" and "Deleted: …" */
  selection: {
    clip: 'clip “{name}”',
    marker: 'marker “{name}”',
    section: 'section “{name}”',
    track: 'track “{name}”'
  },

  confirm: {
    clipTitle: 'Remove “{name}” from the timeline?',
    clipMessage: 'The scene itself is kept. Undo ({keys}) puts the clip back.',
    clipAction: 'Remove clip',
    sectionMessage: 'Clips and markers inside it are kept. Undo ({keys}) brings it back.',
    trackMessage: {
      one: 'Its clip will be removed from the timeline. Undo ({keys}) brings it back.',
      other: 'Its {count} clips will be removed from the timeline. Undo ({keys}) brings them back.'
    },
    trackEmptyMessage: 'The track is empty. Undo ({keys}) brings it back.'
  },

  /** Names given to new items (then they are the user's data) */
  defaults: {
    trackName: 'Track {n}',
    markerName: 'Marker {n}',
    sectionName: 'Section {n}'
  },

  transport: {
    aria: 'Transport',
    rewind: 'Rewind to start (Home) · right-click: MIDI learn',
    previousMarker: 'Previous marker',
    nextMarker: 'Next marker',
    playTooltip: 'Play (Space) · right-click: MIDI learn',
    pauseTooltip: 'Pause (Space) · right-click: MIDI learn',
    playAria: 'Play timeline',
    pauseAria: 'Pause timeline',
    stop: 'Stop (press again: back to start) · right-click: MIDI learn',
    loopOn: 'Loop on — restart at the end',
    loopOff: 'Loop off'
  },

  readout: {
    time: 'Time',
    timecode: 'Timecode',
    bars: 'Bars · {bpm}',
    tooltip: 'Tap to switch between time, timecode and bars'
  },

  snap: {
    aria: 'Snap',
    tooltip: 'Snap clips, markers and sections to this grid',
    off: 'Snap off',
    quarterSecond: '¼ s',
    halfSecond: '½ s',
    oneSecond: '1 s',
    beat: 'Beat',
    bar: 'Bar'
  },

  zoom: {
    aria: 'Zoom',
    out: 'Zoom out (Ctrl+wheel, pinch)',
    in: 'Zoom in',
    fit: 'Zoom to fit'
  },

  options: {
    title: 'Timeline options',
    timeDisplay: 'Time display',
    displayTime: 'Time',
    displayTimecode: 'TC',
    displayBars: 'Bars',
    gridTempo: 'Grid tempo',
    gridTempoHint: 'Used by bar / beat snapping and the bars ruler',
    length: 'Length',
    lengthAria: 'Timeline length',
    lengthHint: 'Playback stops (or loops) here, unless clips run longer',
    followPlayhead: 'Follow playhead',
    followPlayheadDescription: 'Scroll the view to keep the playhead visible while playing'
  },

  timecode: {
    title: 'Timecode',
    buttonTooltip: 'Timecode source & chase',
    badgeInternal: 'INT',
    badgeLocked: 'MTC LOCK',
    badgeChase: 'CHASE',
    dropFrame: '{fps} df',
    clockSource: 'Clock source',
    internal: 'Internal',
    mtc: 'MIDI timecode',
    statusInternal: 'Internal clock — the timeline runs on its own',
    statusLocked: 'Locked to incoming MTC · {fps}',
    statusWaiting: 'Waiting for MIDI timecode…',
    frameRate: 'Frame rate',
    frameRateHint: 'Follows the incoming timecode once locked',
    chase: 'Chase timecode',
    chaseDescription: 'Start, follow and stop the timeline with the incoming timecode',
    dropout: 'Dropout',
    dropoutAria: 'Dropout time',
    dropoutHint: 'Stop the chased timeline after this much silence',
    offset: 'Offset',
    offsetAria: 'Timecode offset',
    offsetHint: 'Added to incoming timecode (negative = earlier)'
  },

  canvas: {
    timeCorner: 'Time',
    barsCorner: 'Bars · {bpm} BPM',
    markers: 'Markers',
    sections: 'Sections',
    rulerAria: 'Time ruler — tap or drag to move the playhead, double-tap to add a marker',
    zoneLaneHint: 'Drag on an empty part of this lane to create a section',
    emptyTitle: 'The timeline is empty',
    emptyDescription: 'Drag a scene from the library onto a track, or select a scene and press + to drop it at the playhead.',
    noScenesTitle: 'No scenes to place yet',
    noScenesDescription: 'Timeline clips play scenes. Record a scene first, then arrange it here.'
  },

  menu: {
    addSceneHere: 'Add scene here',
    addMarkerHere: 'Add marker here',
    addMarkerAt: 'Add marker at {time}',
    movePlayheadHere: 'Move playhead here',
    renameEdit: 'Rename / edit…'
  },

  ghost: {
    dropAt: '{track} at {time}',
    dropHint: 'Drop on a track'
  },

  clip: {
    missingScene: 'Missing scene',
    aria: '{name}, {start} to {end}',
    effectCount: { one: '{count} effect', other: '{count} effects' },
    editScene: 'Edit scene',
    goToStart: 'Go to clip start',
    goToStartShort: 'Go to start',
    splitAtPlayhead: 'Split at playhead',
    splitHint: 'Move the playhead inside the clip',
    remove: 'Remove clip',
    removeFromTimeline: 'Remove from timeline'
  },

  marker: {
    short: 'Marker',
    addAtPlayhead: 'Add marker at playhead',
    addAtPlayheadTooltip: 'Add a marker at the playhead',
    goTo: 'Go to marker',
    moveToPlayhead: 'Move to playhead',
    midiLearnMenu: 'MIDI learn: go to marker',
    delete: 'Delete marker'
  },

  section: {
    addAtPlayhead: 'Add section at playhead',
    goTo: 'Go to section',
    midiLearnMenu: 'MIDI learn: go to section',
    moveEarlier: 'Move earlier',
    moveLater: 'Move later',
    delete: 'Delete section'
  },

  track: {
    add: 'Add track',
    empty: 'Empty',
    rename: 'Rename track',
    insertBelow: 'Insert track below',
    moveUp: 'Move up',
    moveDown: 'Move down',
    remove: 'Remove track',
    removeEllipsis: 'Remove track…',
    lastTrack: 'The timeline needs at least one track',
    nameAria: 'Track {n} name',
    optionsAria: 'Track {n} options'
  },

  midi: {
    playTarget: 'Timeline play / pause',
    stopTarget: 'Timeline stop',
    rewindTarget: 'Timeline rewind',
    goTo: 'Go to {name}',
    learning: 'Learning… (tap to cancel)',
    relearn: 'MIDI mapped — re-learn'
  },

  inspector: {
    aria: 'Properties',
    close: 'Close properties (Esc)',
    actions: 'Actions',
    clipSection: 'Clip',
    clipSubtitle: 'Scene clip · {track}',
    label: 'Label',
    clipLabelAria: 'Clip label',
    sceneNamePlaceholder: 'Scene name',
    track: 'Track',
    timing: 'Timing',
    start: 'Start',
    end: 'End',
    length: 'Length',
    endsAt: 'Ends at {time}',
    fadeIn: 'Fade in',
    fadeOut: 'Fade out',
    fadeHint: 'Fades scale the scene’s level; drag the dots on the clip too',
    markerSection: 'Marker',
    markerSubtitle: 'Marker · {time}',
    markerNameAria: 'Marker name',
    markerTimeAria: 'Marker time',
    time: 'Time',
    sectionSection: 'Section',
    sectionSubtitle: 'Section {n} of {count}',
    sectionNameAria: 'Section name',
    sectionStartAria: 'Section start',
    sectionEndAria: 'Section end',
    arrange: 'Arrange',
    arrangeHint: 'clips & markers move along',
    trackSection: 'Track',
    trackSubtitle: 'Track {n} · {clips}',
    trackNameAria: 'Track name',
    trackNameHint: 'Saved with the show'
  },

  library: {
    aria: 'Timeline library',
    tabsAria: 'Library',
    show: 'Show library',
    hide: 'Hide library',
    noScenesTitle: 'No scenes yet',
    noScenesDescription: 'Record scenes in the Scenes view, then place them on the timeline.',
    searchScenes: 'Search scenes',
    noMatch: 'No matching scene',
    clearSearch: 'Clear search',
    scenesHint: 'Drag a scene by its grip onto a track, or press + to drop it at the playhead.',
    dragScene: 'Drag {name} onto the timeline',
    addSceneAtPlayhead: 'Add {name} at the playhead',
    placedCount: { one: 'Placed once on the timeline', other: 'Placed {count} times on the timeline' },
    noMarkersTitle: 'No markers',
    noMarkersDescription: 'Markers name the moments you jump to (also from MIDI). Double-tap the ruler or press M.',
    noSectionsTitle: 'No sections',
    noSectionsDescription: 'Sections (verse, chorus…) group a stretch of the show. Drag across the Sections lane to create one; reorder them here to rearrange the show.',
    sectionsHint: 'Drag a section by its grip to move it — its clips and markers move with it.',
    moveSection: 'Move section {name}'
  }
}
