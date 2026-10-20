// 3D visualiser: view toolbar, selection controls, room / rig panels, fixture properties (components/visualizer).
// Owned by the view's translator — add keys here (nested by panel), never in another area.
// Shared words (Save, Delete, Scene, Cue…) come from common.*; see ../GLOSSARY.md.
// The rig inspector shared with the stage layout lives in layout.* (fixture, room, bar…).

export const visualizer = {
  title: 'Visualiser',

  crash: {
    title: '3D view crashed',
    fallback: 'The 3D renderer stopped unexpectedly.',
    retry: 'Try again',
    openLayout: 'Open stage layout'
  },

  canvas: {
    unsupportedTitle: '3D is not available here',
    unsupportedText: 'This device could not start WebGL. The stage layout shows the same rig in 2D.',
    unsupportedTextError: 'This device could not start WebGL ({error}). The stage layout shows the same rig in 2D.',
    lostTitle: 'The 3D view was interrupted',
    lostText: 'The graphics context was lost (GPU reset or memory pressure). Restart the 3D view to continue.',
    restart: 'Restart 3D'
  },

  camera: {
    group: 'Camera',
    perspective: 'Persp',
    perspectiveHint: 'Perspective view',
    front: 'Front',
    frontHint: 'From the audience',
    top: 'Top',
    topHint: 'Plan view from above',
    side: 'Side',
    sideHint: 'From stage left'
  },

  show: {
    group: 'Show',
    beams: 'Beams',
    beamsHint: 'Show beam cones',
    haze: 'Haze',
    hazeHint: 'Hazed air: bright beams (off: clean air)',
    walls: 'Walls',
    wallsHint: 'Walls and ceiling',
    grid: 'Grid',
    gridHint: 'Floor grid (1 m)',
    labels: 'Labels',
    labelsHint: 'Fixture numbers',
    shadows: 'Shadows',
    shadowsHint: 'Real-time shadows (GPU heavy)',
    shadowsNeedQuality: 'Shadows need Medium or High quality'
  },

  quality: {
    group: 'Quality',
    label: 'Render quality',
    low: 'Low',
    lowHint: 'Low — 20 fps, reduced resolution, no real lights',
    medium: 'Med',
    mediumHint: 'Medium — 30 fps, 4 real lights',
    high: 'High',
    highHint: 'High — up to 60 fps, full resolution, 10 real lights',
    fpsHint: 'Frames rendered per second — the view only redraws when something changes',
    idle: 'idle'
  },

  toolbar: {
    inspector: 'Inspector',
    inspectorHint: 'Fixture inspector',
    room: 'Room',
    fullScreen: 'Full screen',
    exitFullScreen: 'Exit full screen'
  },

  room: {
    title: 'Room (metres)',
    houseLights: 'House lights'
  },

  empty: {
    title: 'No fixtures patched',
    description: 'Patched fixtures appear here with live beams.',
    action: 'Add fixtures'
  },

  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  hintTouch: 'Drag to orbit · pinch to zoom · two fingers to pan · tap a fixture to select, double-tap to focus',
  hintMouse: 'Drag to orbit · scroll to zoom · right-drag to pan · click a fixture to select, double-click to focus',

  /** Quick programmer strip under the 3D / layout views */
  quick: {
    region: 'Selected fixtures',
    colourPresets: 'Colour presets',
    colours: {
      red: 'Red',
      amber: 'Amber',
      yellow: 'Yellow',
      green: 'Green',
      cyan: 'Cyan',
      blue: 'Blue',
      magenta: 'Magenta',
      warmWhite: 'Warm white',
      white: 'White'
    },
    selectGroup: 'Select {name} ({count})',
    clearSelection: 'Clear selection',
    hide: 'Hide quick controls',
    show: 'Show quick controls',
    noChannels: 'No dimmer, pan, tilt or zoom channel on {name}.',
    sliders: {
      dim: 'Dim',
      pan: 'Pan',
      tilt: 'Tilt',
      zoom: 'Zoom'
    },
    sliderAria: '{label} of selected fixtures'
  }
}
