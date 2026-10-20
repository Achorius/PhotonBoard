// ============================================================
// PhotonBoard — Command line: built-in commands
// ============================================================

import { registerCommand, type CliCommand } from '../registry'
import { attributeCommand, callCommand, selectCommand } from './selection'
import { programmerCommands } from './programmer'
import { playbackCommands } from './playback'
import { storeCommands } from './store'
import { editCommands } from './edit'

export const BUILTIN_COMMANDS: readonly CliCommand[] = [
  selectCommand, callCommand, attributeCommand, ...programmerCommands, ...playbackCommands, ...storeCommands, ...editCommands
]

/** Register every built-in command (idempotent) */
export function registerBuiltinCommands(): void {
  for (const c of BUILTIN_COMMANDS) registerCommand(c)
}
