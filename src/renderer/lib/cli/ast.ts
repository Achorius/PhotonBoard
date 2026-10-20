// ============================================================
// PhotonBoard — Command line: AST types
//
// WP0 contract types (re-exported unchanged from lib/cli/index.ts).
// WP1 additions are all OPTIONAL fields (backward compatible):
//   CliId.text          the number as typed ("1.05" — cue numbers)
//   CliObjectRef.parent `Cue 5 Sequence 3` / `Sequence 3 Cue 5`
//   CliAst.target       `Copy Cue 2 At 5`, `Assign Sequence 3 At Executor 2.5`
//   CliAst.amount       `Fade 3`, `Delay 1.5`
// ============================================================

/** Object keywords (Fixture, Group, Preset, Cue, Sequence, Executor, Page, Macro, Chase, Effect, Speed, DMX) */
export type CliObjectKind =
  | 'fixture' | 'group' | 'preset' | 'cue' | 'sequence' | 'executor' | 'page' | 'macro' | 'chase' | 'effect' | 'speed' | 'dmx'

/** `4` → { major: 4 } · `4.2` → { major: 4, minor: 2 } (preset family.slot, page.slot, universe.address) */
export interface CliId {
  major: number
  minor?: number
  /** The number as typed ("1.05"): cue numbers use it as a decimal */
  text?: string
}

/** `1`, `1 Thru 8`, `1 Thru` (to the end) */
export interface CliIdRange {
  from: CliId
  /** undefined = single id; 'end' = open "Thru" */
  to?: CliId | 'end'
}

/** `Fixture 1 Thru 4 + 7 - 3` */
export interface CliObjectRef {
  kind: CliObjectKind
  /** Bare numbers default to 'fixture' (or the action's default object: Go 3 = Sequence 3, Store 5 = Cue 5) */
  implicit?: boolean
  ids: { op: '+' | '-'; range: CliIdRange }[]
  /** Owner object: the sequence of a cue (`Cue 5 Sequence 3`) */
  parent?: CliObjectRef
}

/** `Group 2 + Fixture 5 If Group 1` */
export interface CliObjectExpr {
  items: { op: '+' | '-'; object: CliObjectRef }[]
  condition?: CliObjectRef
  /** The line started with + / -: add to / remove from the current selection */
  relative?: boolean
}

export type CliValue =
  /** Percent 0-100 (Full = 100, Zero = 0); `to` = fan "At 0 Thru 100". Numbers above 100 are DMX 0-255 (legacy). */
  | { kind: 'level'; from: number; to?: number }
  /** `At Preset 4.2` */
  | { kind: 'preset'; id: CliId }

export interface CliValueExpr {
  value: CliValue
  fade?: number
  delay?: number
}

/** `/merge`, `/filter=position,color` */
export interface CliOption {
  name: string
  value?: string
}

export interface CliAst {
  /** Lower-case action keyword ('store', 'go-', 'clearall'…); undefined = selection / bare value */
  action?: string
  objects?: CliObjectExpr
  value?: CliValueExpr
  /** `Label Group 3 "Wash"` · On / Off of toggles · `+` / `-` of `Page +` · channel name of `Gobo 30` */
  text?: string
  options: CliOption[]
  /** The line as typed */
  source: string
  /** Destination after "At" of Copy / Move / Assign */
  target?: CliObjectRef
  /** Number argument of Fade / Delay (seconds), raw value of `Gobo 30` */
  amount?: number
}

/** What may come next (autocomplete chips, keypad hints) */
export interface CliExpectation {
  kind: 'action' | 'object' | 'number' | 'value' | 'option' | 'text' | 'end'
  /** Candidate keywords / options for this position */
  values?: string[]
  /** Help key of the candidate (pro.cli.help.*) */
  helpKey?: string
}

export interface CliParseError {
  /** Message key suffix under pro.cli.errors */
  code: string
  /** Character offset in the input */
  at: number
  token?: string
}

export interface CliParseResult {
  ast?: CliAst
  error?: CliParseError
  expected: CliExpectation[]
}
