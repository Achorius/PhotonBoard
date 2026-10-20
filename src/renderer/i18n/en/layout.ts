// 2D stage layout editor: plan / side views, truss bars, fixture placement (components/visualizer/StageLayoutView + editor/).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.
// Also: the rig inspector shared with the 3D view (editor/FixturePropertiesPanel, RigPanels,
// rig-actions) and the PDF lighting plot (lib/pdf-export.ts).

export const layout = {
  title: 'Stage layout',
  /** A length in metres; {value} is already formatted for the locale */
  metres: '{value} m',
  centimetres: '{value} cm',

  toolbar: {
    addBar: 'Add bar',
    gridGroup: 'Grid',
    grid: 'Grid',
    gridHint: 'Show grid',
    snap: 'Snap',
    snapHint: 'Snap to grid',
    gridSize: 'Grid size',
    zoomGroup: 'Zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    fitHint: 'Fit the room',
    section: 'Section',
    sectionHint: 'Section view (height)',
    exportPdf: 'Export PDF',
    exportPdfHint: 'Lighting plot with patch list (A4)',
    exported: 'Lighting plot exported',
    exportFailed: 'PDF export failed'
  },

  empty: {
    title: 'No fixtures patched',
    description: 'Patch fixtures to place them on the plan. You can already set up the room and truss bars.',
    action: 'Add fixtures'
  },

  inspector: 'Inspector',

  multi: {
    title: { one: '{count} fixture selected', other: '{count} fixtures selected' },
    clearSelection: 'Clear selection',
    hangOnBar: 'Hang on bar',
    noBars: 'No truss bar yet.',
    spreadHint: 'Spreads them evenly along the bar, left to right.',
    mount: 'Mount',
    mountAll: 'Mount for all selected',
    setMount: 'Set mount…'
  },

  mounts: {
    ceiling: 'Ceiling / truss',
    floor: 'Floor',
    wallLeft: 'Wall left',
    wallRight: 'Wall right',
    wallBack: 'Back wall'
  },

  /** Rigging actions (inspector, plan context menu, 3D) */
  actions: {
    flip: 'Flip 180°',
    resetPlacement: 'Reset placement',
    resetPlacementEllipsis: 'Reset placement…',
    resetTitleOne: 'Reset “{name}” placement?',
    resetTitleMany: { one: 'Reset placement of {count} fixture?', other: 'Reset placement of {count} fixtures?' },
    resetMessage: {
      one: 'Position, mount and aim go back to the automatic layout. The fixture stays patched.',
      other: 'Position, mount and aim go back to the automatic layout. The fixtures stay patched.'
    },
    resetHint: 'Back to the automatic layout — the fixture stays patched'
  },

  fixture: {
    unknownType: 'Unknown type',
    closeInspector: 'Close inspector',
    position: 'Position',
    xAria: 'X position (metres)',
    yAria: 'Height (metres)',
    zAria: 'Depth (metres)',
    positionHint: 'Metres from centre stage · X stage right + · Y height · Z upstage +',
    rigging: 'Rigging',
    mount: 'Mount',
    trussBar: 'Truss bar',
    addBarHint: 'Add a bar in the stage layout.',
    notOnBar: 'Not on a bar',
    barOption: '{name} · {height}',
    mountingRotation: 'Mounting rotation',
    aim: 'Aim',
    tilt: 'Tilt',
    tiltAria: 'Tilt (degrees)',
    tiltHintWall: '0° horizontal, + aims down',
    tiltHintFloor: '0° straight up, + leans upstage',
    tiltHintCeiling: '0° straight down, + leans upstage',
    direction: 'Direction',
    directionAria: 'Direction (degrees)',
    directionHint: 'Rotation around the vertical axis',
    invertPan: 'Invert pan',
    invertTilt: 'Invert tilt',
    optics: 'Optics',
    beamAngle: 'Beam angle',
    beamAngleAria: 'Beam angle (degrees)',
    beamAngleHint: 'From the fixture definition',
    useDefinitionBeam: 'Use the definition’s beam angle',
    reversePixels: 'Reverse pixel order',
    renameTitle: 'Rename fixture'
  },

  room: {
    title: 'Room (metres)',
    widthShort: 'W',
    depthShort: 'D',
    heightShort: 'H',
    widthAria: 'Room width (metres)',
    depthAria: 'Room depth (metres)',
    heightAria: 'Room height (metres)',
    stageEdge: 'Stage edge',
    stageEdgeHint: 'Depth of the downstage edge (0 = centre)',
    stageEdgeAria: 'Stage edge depth (metres)',
    bars: 'Truss bars · {count}',
    barsList: 'Truss bars',
    noBars: 'No bars yet. Add one, then hang fixtures on it from their inspector or by long-pressing them.',
    barSubtitle: { one: '{count} fixture · {length}', other: '{count} fixtures · {length}' },
    barDepth: 'Z {value}',
    help: 'Select a fixture or a bar on the plan to edit it. Drag empty space to pan, pinch or scroll to zoom.'
  },

  bar: {
    deselect: 'Deselect bar',
    section: 'Bar',
    name: 'Name',
    depth: 'Depth (Z)',
    depthAria: 'Bar depth (metres)',
    height: 'Height',
    heightAria: 'Bar height (metres)',
    length: 'Length',
    lengthAria: 'Bar length (metres)',
    colour: 'Colour',
    fixturesOnBar: 'Fixtures on this bar · {count}',
    select: 'Select',
    spread: 'Spread',
    longPressHint: 'Long-press a fixture on the plan to hang it here.',
    delete: 'Delete bar',
    deleteEllipsis: 'Delete bar…',
    deleteMessage: 'Fixtures hung on it keep their position. You can undo this with Undo ({keys}).',
    duplicate: 'Duplicate bar',
    rename: 'Rename bar',
    copyName: '{name} copy'
  },

  /** Plan context menu */
  menu: {
    fixtureFallback: 'Fixture',
    hangOnBar: 'Hang on bar',
    hangOnBarSpread: 'Hang on bar (spread)',
    mount: 'Mount',
    selectOnBar: 'Select fixtures on bar',
    spreadEvenly: 'Spread fixtures evenly',
    addBarAt: 'Add bar at Z {z}',
    fit: 'Fit to view',
    snap: 'Snap to grid'
  },

  /** Words drawn on the plan canvas (short, capitals in both languages) */
  plan: {
    stage: 'STAGE',
    audience: 'AUDIENCE',
    centreLine: 'CL',
    stageEdge: 'STAGE EDGE',
    floorTag: 'FLOOR',
    wallTag: 'WALL',
    metreUnit: 'm',
    aria: 'Stage plan. Drag fixtures to move them, drag empty space to pan, pinch or scroll to zoom, long-press for actions. Arrow keys nudge the selection.'
  },

  /** Section view (seen from the side) */
  section: {
    title: 'SECTION · seen from stage left',
    audience: 'AUDIENCE',
    upstage: 'UPSTAGE',
    aria: 'Section view: drag a fixture up or down to change its height'
  },

  /** Noun phrases for Delete / Undo (read after "Delete …?" / "Deleted: …") */
  selection: {
    bar: 'truss bar “{name}”',
    placementOne: 'placement of “{name}”',
    placementMany: { one: 'placement of {count} fixture', other: 'placement of {count} fixtures' }
  },

  /** PDF lighting plot (follows the UI language) */
  pdf: {
    title: 'Lighting plot',
    summary: 'Room: {width} × {depth} × {height} m  |  {fixtures}  |  {date}',
    fixtureCount: { one: '{count} fixture', other: '{count} fixtures' },
    upstage: 'UPSTAGE',
    audience: 'AUDIENCE',
    legend: {
      par: 'PAR / Wash',
      movingHead: 'Moving head',
      fresnel: 'Fresnel',
      strip: 'Strip / Batten',
      profile: 'Profile'
    },
    scale: 'Scale: 1 m = {mm} mm',
    patchList: 'Patch list',
    columns: {
      number: '#',
      name: 'Name',
      manufacturer: 'Manufacturer',
      type: 'Type',
      mode: 'Mode',
      address: 'Addr',
      channels: 'Ch',
      group: 'Group'
    },
    footer: 'Generated by PhotonBoard',
    fileName: 'LightingPlot'
  }
}
