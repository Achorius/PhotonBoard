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
  'start-effect',        // payload: Effect (started / updated, phase kept when running)
  'stop-effect',         // payload: effect id
  'stop-all-effects',    // no payload
  'select-group',        // payload: group id
  'select-all',          // no payload
  'clear-selection',     // no payload
  'clear-programmer',    // no payload
  'set-programmer-channels',     // payload: { [universe]: { [channel 0-511]: value 0-255 } }
  'release-programmer-channels', // payload: { [universe]: channel[] }
  'swap-cells',          // payload: { from:{col,row}, to:{col,row} }
  'set-executor-layout'  // payload: { grid, columns, modes }
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
// Commands only the MAIN process sends to the main renderer
// (over the same 'stage:command' channel). They are deliberately
// NOT in REMOTE_COMMANDS: remote clients / Companion cannot send them.
// ------------------------------------------------------------

export const INTERNAL_COMMANDS = [
  // A remote client pressed Save / Save As. The Pi renderer is the single source
  // of truth for the show, so main asks it to save ITS OWN state. The renderer
  // must answer with window.photonboard.show.save(collectShowData(), { requestId })
  // — main writes it to the path the remote chose and returns the result to the
  // remote client. payload: SaveShowCommandPayload
  'save-show',
  // Main replaced the show on disk on behalf of a remote client (upload, or
  // load-by-name with apply). The renderer must adopt it. payload: ShowFile
  'apply-show'
] as const

export type InternalCommandType = (typeof INTERNAL_COMMANDS)[number]

export interface SaveShowCommandPayload {
  requestId: string
}
