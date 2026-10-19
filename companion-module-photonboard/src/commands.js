// ============================================================
// PhotonBoard command whitelist — COPY of REMOTE_COMMANDS in
// src/shared/remote-commands.ts (this module is a separate package).
// Keep in sync: src/main/companion-sync.test.ts fails when they differ.
// ============================================================

export const COMMANDS = [
  'set-grand-master',             // payload: number 0-255
  'toggle-blackout',              // no payload
  'set-blackout',                 // payload: boolean
  'toggle-blinder',               // payload?: boolean (explicit state; omitted = toggle)
  'toggle-strobe',                // payload?: boolean (explicit state; omitted = toggle)
  'set-strobe-rate',              // payload: number Hz 1-25
  'reset-all',                    // no payload — masters to default + clear programmer
  'toggle-timeline',              // no payload
  'start-timeline',               // no payload
  'stop-timeline',                // no payload
  'rewind-timeline',              // no payload
  'set-timeline-time',            // payload: seconds
  'go-cuelist',                   // payload: cuelist id
  'go-back-cuelist',              // payload: cuelist id
  'stop-cuelist',                 // payload: cuelist id
  'set-cuelist-fader',            // payload: { id, level }
  'flash-cuelist',                // payload: { id, on: boolean }
  'release-all',                  // no payload — stop every cuelist and chase
  'toggle-chase',                 // payload: chase id | { id, on?: boolean }
  'set-chase-bpm',                // payload: { id, bpm }
  'set-chase-fader',              // payload: { id, level }
  'tap-tempo',                    // payload?: chase id (default: every playing chase)
  'start-effect',                 // payload: effect id (legacy: an Effect — only created when its id is unknown)
  'stop-effect',                  // payload: effect id
  'stop-all-effects',             // no payload
  'select-group',                 // payload: group id
  'select-all',                   // no payload
  'clear-selection',              // no payload
  'clear-programmer',             // no payload
  'set-programmer-channels',      // payload: { [universe]: { [channel 0-511]: value 0-255 } }
  'release-programmer-channels',  // payload: { [universe]: channel[] }
  'swap-cells',                   // payload: { from:{col,row}, to:{col,row} }
  'set-executor-layout'           // payload: { grid, columns, modes }
]

export function isCommand(type) {
  return COMMANDS.includes(type)
}
