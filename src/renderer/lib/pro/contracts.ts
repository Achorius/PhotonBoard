// ============================================================
// PhotonBoard — Pro programming: shared contracts (types only)
//
// ProApi is the ONE facade the command line (lib/cli), macros, MIDI
// controller profiles and remote commands talk to. The command line
// never reaches into stores directly: it asks ProApi, so it can be
// tested with a fake (tests) and wired to the real stores by the
// integrator (lib/pro/api.ts → createProApi()).
//
// Conventions
//   - Object NUMBERS are what the user types (fixture ID `fid`, group /
//     sequence / macro / speed master `number`, preset `type` + `number`
//     = "Preset 4.2"). IDS are the internal uuids. ProApi methods take
//     ids; lib/cli/objects.ts resolves numbers → ids.
//   - Executor pages are 0-based indexes in code (Page 1 = index 0);
//     columns 0-7, rows 0-3 (row 0 = top). "Executor 2.5" in the CLI =
//     page 2, slot 5 (column-major: slot = col*4 + row + 1).
//   - Every MUTATING method is undoable on its own (one undo step); a
//     command that calls several wraps them in `transaction(label, fn)`
//     so it is ONE step ("Oops" undoes the whole command line).
//   - DMX values are 0-255; times are seconds.
// ============================================================

import type {
  Chase, CueChannelValue, CueFeature, Cuelist, Effect, ExecutorButtonFn, ExecutorCell, ExecutorColumnFader, ExecutorPage,
  FixtureDefinition, Group, Macro, PatchEntry, Preset, PresetScope, PresetType, SpeedMaster
} from '@shared/types'
import type { Matricks } from './selection-tools'
import type { ProgrammerMeta } from './programmer-engine'
import type { StoreOptions } from './store-ops'

/** An executor cell: page index (0-based), column 0-7, row 0-3 */
export type ExecutorRef = { page: number; col: number; row: number }

/** Programmer fade / delay (seconds) */
export interface ProgTime {
  fade: number
  delay: number
}

export type AlignMode = '<' | '>' | '<>' | '><'

/** One value the programmer should hold */
export interface ProgrammerValueInput {
  fixtureId: string
  channelName: string
  value: number
  meta?: ProgrammerMeta
}

/** Clear in 3 stages (grandMA): selection first, then values, then everything */
export type ClearStage = 'selection' | 'values' | 'all'

export interface AskChoice {
  id: string
  label: string
}

/** Result of storing into a cue */
export interface StoreCueResult {
  cuelistId: string
  cueId: string
  /** The cue already existed (merge / overwrite…) */
  existed: boolean
}

/** Something an executor cell / Assign can point at */
export interface ExecutorTarget {
  kind: ExecutorCell['kind']
  id: string
}

/**
 * Everything the command line (and macros, MIDI profiles, remotes) can do.
 * Reads return CURRENT store data (never stale copies); writes are
 * synchronous unless they return a Promise.
 */
export interface ProApi {
  // ---------------------------------------------------------------- read model
  getPatch(): readonly PatchEntry[]
  getFixtureDefs(): readonly FixtureDefinition[]
  getGroups(): readonly Group[]
  getPresets(): readonly Preset[]
  getCuelists(): readonly Cuelist[]
  getChases(): readonly Chase[]
  getEffects(): readonly Effect[]
  getMacros(): readonly Macro[]
  getSpeedMasters(): readonly SpeedMaster[]
  getExecutorPages(): readonly ExecutorPage[]

  // ---------------------------------------------------------------- selection
  /** Selected fixture ids, in selection order */
  getSelection(): string[]
  /** Replace the selection (order kept) */
  setSelection(fixtureIds: string[]): void
  /** Step through the selection (MAtricks step); `null` = all */
  selectStep(direction: 'next' | 'prev' | 'all'): void
  /** Fixture ids active after MAtricks / step (what "At" applies to) */
  getActiveSelection(): string[]
  getMatricks(): Matricks
  setMatricks(m: Matricks): void
  setAlign(align: AlignMode | null): void

  // ---------------------------------------------------------------- programmer
  /** Put values in the programmer (with the programmer time unless `time` is given) */
  setAttributeValues(values: ProgrammerValueInput[], time?: ProgTime): void
  /** Apply a preset to fixtures (refs kept as meta); returns the number of values set */
  applyPreset(presetId: string, fixtureIds: string[], time?: ProgTime): number
  /** Release these fixtures' programmer values */
  releaseFixtures(fixtureIds: string[]): void
  /** Clear (3 stages) and say what was cleared */
  clear(stage?: ClearStage): ClearStage
  /** Programmer content as cue values (`withMeta`: preset refs + timing) */
  getProgrammerValues(opts?: { withMeta?: boolean; fixtureIds?: string[] }): CueChannelValue[]
  getProgTime(): ProgTime | null
  setProgTime(time: ProgTime | null): void
  /** Raw DMX tester: universe 0-based, channel 0-511 */
  setDmx(universe: number, channel: number, value: number): void

  // ---------------------------------------------------------------- presets
  /** Store the programmer into preset `type`.`number` (created when empty) */
  storePreset(type: PresetType, number: number, opts?: { scope?: PresetScope; mode?: StoreOptions['mode']; name?: string; fixtureIds?: string[] }): Preset | null
  /** Update presets the programmer values came from; returns how many changed */
  updatePresetsFromProgrammer(): number
  updatePreset(id: string, updates: Partial<Omit<Preset, 'id'>>): void
  deletePreset(id: string): void
  /** Copy (new id) / move (renumber) a preset to `toNumber` in its family */
  copyPreset(id: string, toNumber: number): string | null
  movePreset(id: string, toNumber: number): boolean

  // ---------------------------------------------------------------- sequences & cues
  /** Sequence the "Store Cue n" / GO keys act on (the selected executor's, else the Scenes view's) */
  getSelectedCuelist(): string | null
  selectCuelist(id: string | null): void
  /** New sequence; returns its id */
  createCuelist(name?: string, number?: number): string
  /** Store the programmer into a cue (cuelistId null = selected sequence; cueNumber null = next) */
  storeCue(cuelistId: string | null, cueNumber: number | null, opts: StoreOptions): StoreCueResult | null
  /** Update active cues the programmer values came from; returns how many changed */
  updateCuesFromProgrammer(opts?: Partial<StoreOptions>): number
  deleteCue(cuelistId: string, cueId: string): void
  updateCue(cuelistId: string, cueId: string, updates: { name?: string; fadeIn?: number; fadeOut?: number; delay?: number; followTime?: number | null; color?: string }): void
  copyCue(cuelistId: string, cueId: string, toNumber: number, toCuelistId?: string): string | null
  moveCue(cuelistId: string, cueId: string, toNumber: number): boolean
  deleteCuelist(id: string): void
  renameCuelist(id: string, name: string): void
  go(cuelistId: string): void
  goBack(cuelistId: string): void
  /** Jump to the cue numbered `cueNumber` */
  goto(cuelistId: string, cueNumber: number): boolean
  off(cuelistId: string): void
  pause(cuelistId: string): void
  releaseAll(): void

  // ---------------------------------------------------------------- executors
  getCurrentExecutorPage(): number
  setExecutorPage(page: number): void
  executorPress(ref: ExecutorRef, phase: 'down' | 'up', opts?: { fn?: ExecutorButtonFn }): void
  columnFader(page: number, col: number, level: number): void
  /** Put an object in an executor cell (null = empty it) */
  assignExecutor(ref: ExecutorRef, target: ExecutorTarget | null, opts?: { button?: ExecutorButtonFn; fader?: ExecutorColumnFader }): void
  getSelectedExecutor(): ExecutorRef | null
  selectExecutor(ref: ExecutorRef | null): void

  // ---------------------------------------------------------------- macros
  runMacro(id: string): void
  stopMacro(id: string): void
  storeMacro(number: number, lines: Macro['lines'], name?: string): string
  updateMacro(id: string, updates: Partial<Omit<Macro, 'id'>>): void
  deleteMacro(id: string): void

  // ---------------------------------------------------------------- groups
  /** Store fixtures as group `number` (replaces / merges its fixtures) */
  storeGroup(number: number, fixtureIds: string[], opts?: { name?: string; mode?: 'merge' | 'overwrite' | 'remove' }): string
  deleteGroup(id: string): void
  renameGroup(id: string, name: string): void
  /** Group master 0-255 */
  setGroupMaster(id: string, level: number): void

  // ---------------------------------------------------------------- objects (chases / effects)
  toggleChase(id: string, on?: boolean): void
  setEffectRunning(id: string, on: boolean): void
  setSpeedMasterBpm(id: string, bpm: number): void
  tapSpeedMaster(id: string): void

  // ---------------------------------------------------------------- park / highlight / blind / masters
  park(values: CueChannelValue[]): void
  unpark(fixtureIds: string[]): void
  isHighlight(): boolean
  setHighlight(on: boolean): void
  isBlind(): boolean
  setBlind(on: boolean): void
  setBlackout(on?: boolean): void
  setGrandMaster(level: number): void

  // ---------------------------------------------------------------- undo & UI
  /** Run `fn` as ONE undo step named `label` */
  transaction<T>(label: string, fn: () => T): T
  /** Undo the last step ("Oops"); its label, or null when there was nothing */
  undo(): string | null
  redo(): string | null
  /** Ask the operator (dialog / keypad prompt); null = cancelled. Macros answer with `fallback`. */
  ask(question: string, choices: AskChoice[], fallback?: string): Promise<string | null>
  /** Feature filter of a channel (store filters, per-feature timing) */
  featureOf(fixtureId: string, channelName: string): CueFeature
}
