// Undo / redo history and keyboard actions on the selection
// (lib/history.ts, lib/selection-actions.ts).

export const edit = {
  undone: 'Undone: {what}',
  redone: 'Redone: {what}',
  nothingToUndo: 'Nothing to undo',
  nothingToRedo: 'Nothing to redo',
  deleted: 'Deleted: {what}',
  duplicated: 'Duplicated: {what}',
  undoGone: 'Cannot undo this deletion any more: other changes were made since. Use Undo ({keys}) step by step.',
  confirmDeleteTitle: 'Delete {what}?',
  confirmDeleteMessage: 'You can undo this with Undo ({keys}).',
  confirmDeleteAction: 'Delete',
  /** Default name of an automatic undo step, by show section */
  sections: {
    patch: 'Patch change',
    groups: 'Group change',
    presets: 'Preset change',
    cuelists: 'Scene change',
    chases: 'Chase change',
    effects: 'Effect change',
    midiMappings: 'MIDI mapping change',
    executor: 'Executor layout change',
    timeline: 'Timeline change',
    roomConfig: 'Stage layout change'
  },
  severalSections: 'Show changes'
}
