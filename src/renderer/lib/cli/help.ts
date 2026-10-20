// ============================================================
// PhotonBoard — Command line: help keys and cheat sheet
//
// Syntax stays English (console convention); the explanations are
// translated: pro.cli.help.<key> (one line per keyword, autocomplete
// chips) and pro.cli.cheatsheet.* (the syntax card of the expanded
// command line panel, FR / EN).
// ============================================================

import type { TranslationKey } from '@renderer/i18n'
import { key } from './registry'

/** Help key (pro.cli.help.<key>) of a canonical keyword or expectation helpKey */
const HELP_KEY: Readonly<Record<string, string>> = {
  'go-': 'goBack', clearall: 'clearAll', clearselection: 'clearSelection'
}

export function helpKeyOf(keyword: string): TranslationKey {
  const k = keyword.toLowerCase()
  return key(`pro.cli.help.${HELP_KEY[k] ?? k}`)
}

export interface CheatLine {
  /** Command line syntax (never translated) */
  syntax: string
  /** pro.cli.cheatsheet.lines.<key> */
  key: string
}

export interface CheatSection {
  /** pro.cli.cheatsheet.sections.<id> */
  id: string
  lines: CheatLine[]
}

export const CLI_CHEATSHEET: readonly CheatSection[] = [
  {
    id: 'select',
    lines: [
      { syntax: 'Fixture 1 Thru 4', key: 'selectRange' },
      { syntax: 'Fixture 1 + 3 + 5', key: 'selectAdd' },
      { syntax: '+ 7 · - Group 2', key: 'selectRelative' },
      { syntax: 'Group 2', key: 'selectGroup' },
      { syntax: 'Fixture 1 Thru 20 If Group 3', key: 'selectIf' },
      { syntax: 'Next · Prev · All · Set', key: 'step' }
    ]
  },
  {
    id: 'values',
    lines: [
      { syntax: 'At 80 · @ 80', key: 'at' },
      { syntax: 'Fixture 1 Thru 4 At 80', key: 'selectAt' },
      { syntax: 'Full · Zero', key: 'fullZero' },
      { syntax: 'At 0 Thru 100', key: 'fan' },
      { syntax: 'At 50 Fade 3 Delay 1', key: 'timed' },
      { syntax: 'At Preset 4.2', key: 'preset' },
      { syntax: 'Fade 2 · Delay 1 · Fade Off', key: 'progTime' },
      { syntax: 'DMX 1.101 At 50', key: 'dmx' },
      { syntax: 'Gobo 30 · Color 50 · Pan 128', key: 'channel' }
    ]
  },
  {
    id: 'store',
    lines: [
      { syntax: 'Store', key: 'storeNext' },
      { syntax: 'Store Cue 5', key: 'storeCue' },
      { syntax: 'Store Cue 5 /merge · /overwrite · /cueonly', key: 'storeOptions' },
      { syntax: 'Store Cue 5 /filter=position,color', key: 'storeFilter' },
      { syntax: 'Store Preset 4.2 /global', key: 'storePreset' },
      { syntax: 'Store Group 5 "Front"', key: 'storeGroup' },
      { syntax: 'Update', key: 'update' }
    ]
  },
  {
    id: 'playback',
    lines: [
      { syntax: 'Go · Go 3 · Go Sequence 3', key: 'go' },
      { syntax: 'Go- · Pause · Off Sequence 3', key: 'goBack' },
      { syntax: 'Goto Cue 5 · Goto Cue 5 Sequence 2', key: 'goto' },
      { syntax: 'Executor 2.5 · Go Executor 2.5', key: 'executor' },
      { syntax: 'Page 2 · Page + · Page -', key: 'page' },
      { syntax: 'Macro 3 · Off Macro 3', key: 'macro' },
      { syntax: 'Release · Stop', key: 'release' },
      { syntax: 'Blackout · Blackout On', key: 'blackout' }
    ]
  },
  {
    id: 'edit',
    lines: [
      { syntax: 'Delete Cue 3 · Delete Preset 4.2', key: 'delete' },
      { syntax: 'Copy Cue 2 At 5 · Move Preset 4.1 At 4.5', key: 'copyMove' },
      { syntax: 'Label Group 3 "Wash"', key: 'label' },
      { syntax: 'Assign Sequence 3 At Executor 2.5', key: 'assign' },
      { syntax: 'Assign Executor 1.5 /button=flash', key: 'assignButton' }
    ]
  },
  {
    id: 'tools',
    lines: [
      { syntax: 'Clear', key: 'clear' },
      { syntax: 'Highlight · Blind', key: 'highlightBlind' },
      { syntax: 'Park · Unpark', key: 'park' },
      { syntax: 'Oops', key: 'oops' },
      { syntax: 'Align < · > · <> · ><', key: 'align' },
      { syntax: 'F G P C S E T M Pg Ch Fx @', key: 'abbreviations' }
    ]
  }
]
