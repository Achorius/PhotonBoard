// ============================================================
// PhotonBoard — Command protocol shared by the Stage window,
// the remote web UI, the Companion API server and the main
// renderer (which executes every command).
// ============================================================

export const REMOTE_COMMANDS = [
  'set-grand-master',    // payload: number 0-255
  'toggle-blackout',     // no payload
  'set-blackout',        // payload: boolean
  'toggle-blinder',      // payload: boolean
  'toggle-strobe',       // payload: boolean
  'toggle-timeline',     // no payload
  'go-cuelist',          // payload: cuelist id
  'stop-cuelist',        // payload: cuelist id
  'set-cuelist-fader',   // payload: { id, level }
  'select-group',        // payload: group id
  'select-all',          // no payload
  'clear-selection',     // no payload
  'clear-programmer',    // no payload
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
