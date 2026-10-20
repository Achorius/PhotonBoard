// Keyboard cheat sheet (press ?) and key names.

export const shortcuts = {
  title: 'Keyboard shortcuts',
  description: 'Single-key shortcuts work when no text field is focused.',
  groups: {
    masters: 'Masters',
    playback: 'Playback',
    edit: 'Edit',
    views: 'Views',
    file: 'File',
    general: 'General',
    pointer: 'Mouse & touch'
  },
  items: {
    blackout: 'Blackout on / off',
    clearProgrammer: 'Clear programmer',
    go: 'GO selected scene / start-stop selected chase (Scenes view)',
    previous: 'Previous scene / chase (list focused)',
    next: 'Next scene / chase (list focused)',
    undo: 'Undo',
    redo: 'Redo',
    deleteSelection: 'Delete the selection (scene, cue, fixture…)',
    duplicateSelection: 'Duplicate the selection',
    renameSelection: 'Rename the selection',
    newShow: 'New show',
    openShow: 'Open show',
    save: 'Save',
    saveAs: 'Save as',
    commandLine: 'Focus the command line',
    showShortcuts: 'Show keyboard shortcuts'
  },
  pointer: {
    learn: 'Right-click / long-press a control',
    learnDoes: 'MIDI learn or options',
    reset: 'Double-click / double-tap a fader',
    resetDoes: 'Reset to default',
    fine: 'Shift-drag or two fingers',
    fineDoes: 'Fine adjustment',
    hold: 'Hold Strobe, Blinder, TRIG, FLASH',
    holdDoes: 'Active while held'
  },
  /** Key cap labels (Windows / Linux keyboards; macOS uses symbols) */
  keys: {
    shift: 'Shift',
    enter: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    escape: 'Esc',
    space: 'Space'
  }
}
