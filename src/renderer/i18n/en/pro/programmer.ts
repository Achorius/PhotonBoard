// Pro programmer (pro.programmer.*): undo step names of the pro facade
// (lib/pro/api.ts) and default object names.

export const programmer = {
  /** Undo step names (shown in "Undone: …" and the Undo tooltip) */
  undo: {
    storeCue: 'Store cue {cue}',
    updateCues: 'Update cues',
    editCue: 'Edit cue {cue}',
    deleteCue: 'Delete cue {cue}',
    copyCue: 'Copy cue {cue}',
    moveCue: 'Move cue {cue}',
    newSequence: 'New sequence',
    deleteSequence: 'Delete sequence “{name}”',
    renameSequence: 'Rename sequence',
    storePreset: 'Store preset {preset}',
    updatePresets: 'Update presets',
    editPreset: 'Edit preset {preset}',
    deletePreset: 'Delete preset {preset}',
    copyPreset: 'Copy preset {preset}',
    movePreset: 'Move preset {preset}',
    storeGroup: 'Store group {n}',
    deleteGroup: 'Delete group “{name}”',
    renameGroup: 'Rename group',
    storeMacro: 'Store macro {n}',
    editMacro: 'Edit macro {n}',
    deleteMacro: 'Delete macro {n}',
    assignExecutor: 'Assign executor {page}.{slot}',
    park: 'Park',
    unpark: 'Unpark'
  },
  defaults: {
    group: 'Group {n}'
  }
}
