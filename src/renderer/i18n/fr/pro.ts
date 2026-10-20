// ============================================================
// Programmation pro (pro.*) — un fichier par lot dans ./pro/.
// Les mots-clés de la ligne de commande restent en anglais.
// ============================================================

import type { Translation } from '../types'
import { core } from './pro/core'
import { cli } from './pro/cli'
import { programmer } from './pro/programmer'
import { programmerUi } from './pro/programmer-ui'
import { cliUi } from './pro/cli-ui'
import { scenes } from './pro/scenes'
import { pools } from './pro/pools'
import { midi } from './pro/midi'

export const pro: Translation['pro'] = {
  ...core,
  cli,
  // pro.programmer.* = engine undo/default names (programmer.ts) + Pro UI strings (programmer-ui.ts)
  programmer: { ...programmer, ...programmerUi },
  cliUi,
  scenes,
  pools,
  midi
}
