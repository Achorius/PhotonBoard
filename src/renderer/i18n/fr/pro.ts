// ============================================================
// Programmation pro (pro.*) — un fichier par lot dans ./pro/.
// Les mots-clés de la ligne de commande restent en anglais.
// ============================================================

import type { Translation } from '../types'
import { core } from './pro/core'
import { cli } from './pro/cli'
import { programmer } from './pro/programmer'

export const pro: Translation['pro'] = {
  ...core,
  cli,
  programmer
}
