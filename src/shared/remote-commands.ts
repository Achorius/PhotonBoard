// ============================================================
// PhotonBoard — Command protocol shared by the Stage window,
// the remote web UI, the Companion API server and the main
// renderer (which executes every command).
// ============================================================

export const REMOTE_COMMANDS = [
  'set-grand-master',    // payload: number 0-255
  'toggle-blackout',     // no payload
  'set-blackout',        // payload: boolean
  'toggle-blinder',      // payload?: boolean (explicit state; omitted = toggle)
  'toggle-strobe',       // payload?: boolean (explicit state; omitted = toggle)
  'set-strobe-rate',     // payload: number Hz 1-25
  'reset-all',           // no payload — masters to default + clear programmer
  'toggle-timeline',     // no payload
  'start-timeline',      // no payload
  'stop-timeline',       // no payload
  'rewind-timeline',     // no payload
  'set-timeline-time',   // payload: seconds
  'go-cuelist',          // payload: cuelist id
  'go-back-cuelist',     // payload: cuelist id
  'stop-cuelist',        // payload: cuelist id
  'set-cuelist-fader',   // payload: { id, level }
  'flash-cuelist',       // payload: { id, on: boolean }
  'release-all',         // no payload — stop every cuelist and chase
  'toggle-chase',        // payload: chase id | { id, on?: boolean }
  'set-chase-bpm',       // payload: { id, bpm }
  'set-chase-fader',     // payload: { id, level }
  'tap-tempo',           // payload?: chase id (default: every playing chase)
  'start-effect',        // payload: effect id (legacy: an Effect — only created when its id is unknown)
  'stop-effect',         // payload: effect id
  'stop-all-effects',    // no payload
  'select-group',        // payload: group id
  'select-all',          // no payload
  'clear-selection',     // no payload
  'clear-programmer',    // no payload
  'set-programmer-channels',     // payload: { [universe]: { [channel 0-511]: value 0-255 } }
  'release-programmer-channels', // payload: { [universe]: channel[] }
  'swap-cells',          // payload: { from:{col,row}, to:{col,row} }
  'set-executor-layout', // payload: { grid, columns, modes } (current executor page)
  'run-macro',           // payload: macro id | { id } | { number } (macro number)
  'set-executor-page',   // payload: page index (0-based) | { page } | { delta: +1 / -1 }
  'executor',            // payload: ExecutorCommandPayload { page, col, row, phase }
  'column-fader',        // payload: ColumnFaderCommandPayload { page, col, level } (its column fader function)
  'set-group-master',    // payload: { id, level } (group id, 0-255)
  'tap-speed-master',    // payload: speed master id | { id }
  'set-speed-master-bpm' // payload: { id, bpm }
] as const

export type RemoteCommandType = (typeof REMOTE_COMMANDS)[number]

export interface RemoteCommand {
  type: RemoteCommandType | string
  payload?: unknown
}

export function isRemoteCommandType(type: unknown): type is RemoteCommandType {
  return typeof type === 'string' && (REMOTE_COMMANDS as readonly string[]).includes(type)
}

// ------------------------------------------------------------
// Commands only the web remote (full UI in a browser) may send, on top
// of REMOTE_COMMANDS. Not part of the Companion protocol.
// ------------------------------------------------------------

export const WEB_REMOTE_COMMANDS = [
  // Content edits made on the remote, merged into the running show
  // without stopping anything. payload: ApplyShowContentPayload
  'apply-show-content',
  // Record with the CONSOLE's programmer / output. payload: RecordCommandPayload
  'record',
  // A command line typed on the remote, run by the console. payload: CliCommandPayload
  'cli'
] as const

export type WebRemoteCommandType = (typeof WEB_REMOTE_COMMANDS)[number]

/** Commands a web remote client may send (REMOTE_COMMANDS + WEB_REMOTE_COMMANDS). */
export function isWebRemoteCommandType(type: unknown): type is RemoteCommandType | WebRemoteCommandType {
  return isRemoteCommandType(type) || (typeof type === 'string' && (WEB_REMOTE_COMMANDS as readonly string[]).includes(type))
}

/**
 * 'executor' command: press / release an executor cell. `page` is the
 * 0-based page index ('current' = the console's current page); col 0-7,
 * row 0-3 (row 0 = top).
 */
export interface ExecutorCommandPayload {
  page: number | 'current'
  col: number
  row: number
  phase: 'down' | 'up'
}

/**
 * 'column-fader' command: move a column fader (0-255) the way the
 * console's own fader does (column level, cell master, Grand Master,
 * group / speed master, rate, X-fade: the column's fader function).
 * `page` 0-based or 'current'; col 0-7.
 */
export interface ColumnFaderCommandPayload {
  page: number | 'current'
  col: number
  level: number
}

/** 'cli' command: one command line typed on a web remote */
export interface CliCommandPayload {
  text: string
  /** Remote page id (content-sync origin) */
  origin?: string
  /** Increases with every line sent by that page */
  seq?: number
}

/** One changed section. List sections: a diff by id; the others: the whole value. */
export interface SectionChange {
  upsert?: unknown[]
  remove?: string[]
  /** Item ids in their new order (items the remote does not know keep their place at the end) */
  order?: string[]
  /** Whole-value sections (executor, timeline, roomConfig, parked) */
  value?: unknown
}

export interface ApplyShowContentPayload {
  /** Random id of the remote page (stable for its lifetime) */
  origin: string
  /** Increases with every payload sent by that page */
  seq: number
  sections: Record<string, SectionChange>
  /** Section revisions the remote edited from (informational: last writer wins per item) */
  baseRevisions?: Record<string, number>
}

export type RecordAction = 'new-scene' | 'add-cue' | 'update-cue' | 'new-chase' | 'add-step' | 'update-step'

export interface RecordCommandPayload {
  action: RecordAction
  /** Limit to these fixtures (the remote's selection); omitted = all fixtures */
  fixtureIds?: string[]
  /** new-scene / add-cue: id of the scene; new-chase / add-step: id of the chase (new ones are created with it) */
  targetId: string
  /** add-cue / new-scene: id of the new cue · update-cue: the cue · update-step: the step · add-step / new-chase: id of the new step */
  itemId?: string
  name?: string
  includeEffects?: boolean
  mode?: 'merge' | 'replace'
  /**
   * Pro store mode (add-cue / update-cue on scenes): merge / overwrite /
   * remove / cue only / block, with an optional feature filter. When set
   * it replaces `mode`.
   */
  storeMode?: 'merge' | 'overwrite' | 'remove' | 'cueonly' | 'block'
  /** Pro store filter: only these features are stored */
  filter?: ('intensity' | 'position' | 'colour' | 'beam' | 'control')[]
}

/** Per-section revision as published in the state snapshot */
export interface ContentRevision {
  rev: number
  /** Origin (remote page) of the last change, when it came from a remote edit */
  by?: string
  seq?: number
}

export interface ContentState {
  /** Changes when the console renderer restarts (revisions start again) */
  epoch: string
  sections: Record<string, ContentRevision>
}

/** show:get-current result (remote → main → console renderer) */
export interface CurrentShowContent {
  success: boolean
  error?: string
  /** The requested sections (all when none were named) + name */
  show?: Record<string, unknown>
  content?: ContentState
  /** Last seq applied from the requesting origin */
  appliedSeq?: number
}

// ------------------------------------------------------------
// Commands only the MAIN process sends to the main renderer
// (over the same 'stage:command' channel). They are deliberately
// NOT in REMOTE_COMMANDS: remote clients / Companion cannot send them.
// ------------------------------------------------------------

export const INTERNAL_COMMANDS = [
  // A remote client pressed Save / Save As. The Pi renderer is the single source
  // of truth for the show, so main asks it to save ITS OWN state. The renderer
  // must answer with window.photonboard.show.save(collectShowData(), { requestId })
  // — main writes it to the path the remote chose and returns the result to the
  // remote client. When another show operation keeps it busy for too long it answers
  // remote.replyToMain(requestId, { error }) instead. payload: SaveShowCommandPayload
  'save-show',
  // Main replaced the show on disk on behalf of a remote client (upload, or
  // load-by-name with apply). The renderer must adopt it. payload: ShowFile
  'apply-show',
  // A web remote asked for the console's CURRENT show content (show:get-current).
  // The renderer answers with window.photonboard.remote.replyToMain(requestId, CurrentShowContent).
  // payload: { requestId, origin?, sections?: string[] }
  'collect-show-content',
  // A web remote client disconnected: release what it was holding (flash, trigger,
  // blinder, strobe). payload: { clientId }
  'client-disconnected'
] as const

export type InternalCommandType = (typeof INTERNAL_COMMANDS)[number]

export interface SaveShowCommandPayload {
  requestId: string
}
