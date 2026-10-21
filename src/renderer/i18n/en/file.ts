// Show files: New / Open / Save / Save As / upload (lib/show-io.ts,
// components/layout/file-actions.ts).

export const file = {
  defaultShowName: 'New Show',
  busy: 'Busy — another show operation is in progress',
  ops: {
    save: 'Save',
    saveAs: 'Save As',
    open: 'Open',
    newShow: 'New show',
    autoLoad: 'Auto-load',
    upload: 'Upload'
  },
  canceled: '{op} cancelled',
  failed: '{op} failed: {error}',
  saving: 'Saving…',
  savingAs: 'Save As…',
  saved: 'Saved {name}',
  opening: 'Opening…',
  openingName: 'Opening {name}…',
  uploading: 'Uploading show…',
  loaded: 'Loaded {name}',
  loadedWithWarning: 'Loaded {name} — {warning}',
  loadedWithWarnings: { one: 'Loaded {name} — {warning} (+{count} more)', other: 'Loaded {name} — {warning} (+{count} more)' },
  newShowDone: 'New show',
  remoteShowLoaded: 'Show loaded: {name}',
  remoteShowRefused: 'Show from remote refused: {error}',
  errors: {
    unknown: 'Unknown error',
    notConnected: 'Not connected',
    unreadable: 'The file could not be read',
    exists: 'A show with this name already exists',
    notWritten: 'The show could not be written',
    remoteOpen: 'Pick a show from the list or upload a file on the remote',
    remoteNew: 'New Show is only available on the console',
    consoleNoShow: 'The console did not send its show'
  },
  unsaved: {
    title: 'Save changes to “{name}”?',
    newShow: 'Your changes will be lost if you start a new show without saving.',
    openShow: 'Your changes will be lost if you open another show without saving.',
    openNamed: 'Your changes will be lost if you open “{name}” without saving.',
    replaceConsole: 'Your changes will be lost if you replace the console show without saving.',
    quit: 'Your changes will be lost if you quit without saving.',
    dontSave: 'Don’t save',
    save: 'Save'
  },
  saveAsDialog: {
    title: 'Save show as',
    label: 'Show name',
    invalidName: 'A show name cannot contain \\ / : * ? " < > |'
  },
  replace: {
    title: 'Replace “{name}”?',
    message: 'A show with this name already exists on the console. Replacing it cannot be undone.',
    consoleTitle: 'Replace the show on the console?',
    action: 'Replace'
  },
  usb: {
    title: 'USB stick',
    detected: 'USB stick detected: {name}',
    detectedShows: { one: '{count} show on it', other: '{count} shows on it' },
    detectedNoShow: 'No show on it',
    none: 'No USB stick connected',
    noneHint: 'Plug in a USB stick (FAT32, exFAT or NTFS). It appears here within a few seconds.',
    noShows: 'No show (.pbshow) on this stick (top level and first-level folders).',
    open: 'Open',
    openHint: 'The show is copied to the console’s shows folder, then opened: the stick can be removed afterwards.',
    browse: 'Browse the stick…',
    saveCopy: 'Save a copy on the stick',
    eject: 'Eject',
    ejecting: 'Ejecting {name}…',
    ejected: '{name} can be removed safely',
    ejectFailed: 'Could not eject {name}: {error}',
    copied: 'Copy of {name} saved on {drive}',
    copyFailed: 'The copy could not be saved: {error}',
    replaceTitle: 'Replace the show “{name}” on the console?',
    replaceMessage: 'A show with this name is already in the shows folder. The one from the stick replaces it (its previous version is kept as a backup).',
    replaceCopyTitle: 'Replace “{name}” on the stick?',
    replaceCopyMessage: 'A show with this name is already on {drive}.',
    modified: 'Modified {date}'
  }
}
