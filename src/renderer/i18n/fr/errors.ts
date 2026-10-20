import type { Translation } from '../types'

export const errors: Translation['errors'] = {
  unknown: 'Erreur inconnue',
  notConnected: 'Non connecté',
  consoleSaveFailed: 'La console n’a pas pu enregistrer le show.',
  consoleBusy: 'La console est occupée par une autre opération sur le show (fenêtre Ouvrir / Enregistrer ?) — réessayez.',
  consoleCollectFailed: 'La console n’a pas pu rassembler son show',
  copyFailed: 'Copie impossible',
  copied: 'Copié dans le presse-papiers'
}
