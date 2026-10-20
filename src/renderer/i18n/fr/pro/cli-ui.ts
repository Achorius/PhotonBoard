// Interface de la ligne de commande (pro.cliUi.*) : panneau, journal,
// suggestions, pavé tactile. Les mots-clés des touches restent en anglais.

import type { Translation } from '../../types'

export const cliUi: Translation['pro']['cliUi'] = {
  expand: 'Ouvrir le panneau de commande',
  collapse: 'Fermer le panneau de commande',
  panelTitle: 'Ligne de commande',
  panelAria: 'Panneau de la ligne de commande',
  keypad: 'Pavé',
  keypadShow: 'Afficher le pavé',
  keypadHide: 'Masquer le pavé',
  keypadAria: 'Pavé de commande',
  clearLog: 'Effacer le journal',
  logAria: 'Journal des commandes',
  logEmptyTitle: 'Aucune commande pour l’instant',
  logEmptyText: 'Tapez une commande ou utilisez le pavé, par exemple Fixture 1 Thru 4 At 80, puis Please.',
  recallTitle: 'Remettre cette commande sur la ligne',
  origin: {
    console: 'Console',
    macro: 'Macro',
    remote: 'Télécommande'
  },
  expect: {
    title: 'Ensuite',
    action: 'une commande',
    object: 'un objet',
    number: 'un nombre',
    value: 'une valeur',
    option: 'une option',
    text: 'un nom entre guillemets',
    end: 'Please (Entrée) l’exécute'
  },
  chipsAria: 'Suggestions',
  syntaxError: 'Vérifiez la commande près de « {token} »',
  syntaxErrorEnd: 'La commande n’est pas complète',
  legacyNote: 'Commandes de base (syntaxe complète à venir)',
  backspace: 'Effacer le dernier caractère',
  please: 'Please',
  pleaseTitle: 'Exécuter la commande (Entrée)'
}
