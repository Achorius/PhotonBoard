// Ligne de commande (pro.cli.*) : messages, aide, descriptions de l'autocomplétion.
// Les mots-clés (Fixture, At, Store…) ne sont jamais traduits.

import type { Translation } from '../../types'

export const cli: Translation['pro']['cli'] = {
  notAvailable: 'La ligne de commande n’est pas encore disponible',
  unknownCommand: 'Commande inconnue : {command}',
  failed: 'La commande a échoué : {error}'
}
