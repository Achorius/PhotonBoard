// Pro programming — shared data layer (WP0): undo step names of the
// new show sections, default object names, executor pages.

export const core = {
  /** Default name of an automatic undo step, by show section (see edit.sections) */
  sections: {
    macros: 'Macro change',
    speedMasters: 'Speed master change',
    stagePages: 'Stage page change',
    parked: 'Park change'
  },
  executor: {
    /** Default name of an executor page */
    pageN: 'Page {n}'
  },
  defaults: {
    macro: 'Macro {n}',
    speedMaster: 'Speed {n}',
    stagePage: 'Stage page {n}',
    preset: 'Preset {n}'
  },
  /** Pro view switch (Settings › General) */
  proMode: 'Pro programming',
  proModeHint: 'Pools, object numbers, selection tools, advanced cue timing and executor pages. A show plays the same either way.'
}
