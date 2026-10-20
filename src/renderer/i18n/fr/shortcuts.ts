import type { Translation } from '../types'

export const shortcuts: Translation['shortcuts'] = {
  title: 'Raccourcis clavier',
  description: 'Les raccourcis à une touche fonctionnent quand aucun champ de texte n’a le focus.',
  groups: {
    masters: 'Masters',
    playback: 'Restitution',
    edit: 'Édition',
    views: 'Vues',
    file: 'Fichier',
    general: 'Général',
    pointer: 'Souris et tactile'
  },
  items: {
    blackout: 'Blackout activé / désactivé',
    clearProgrammer: 'Vider le programmer',
    go: 'GO de la scène sélectionnée / lancer-arrêter le chase sélectionné (vue Scènes)',
    previous: 'Scène / chase précédent (liste active)',
    next: 'Scène / chase suivant (liste active)',
    undo: 'Annuler',
    redo: 'Rétablir',
    deleteSelection: 'Supprimer la sélection (scène, cue, projecteur…)',
    duplicateSelection: 'Dupliquer la sélection',
    renameSelection: 'Renommer la sélection',
    newShow: 'Nouveau show',
    openShow: 'Ouvrir un show',
    save: 'Enregistrer',
    saveAs: 'Enregistrer sous',
    commandLine: 'Aller à la ligne de commande',
    showShortcuts: 'Afficher les raccourcis clavier'
  },
  pointer: {
    learn: 'Clic droit / appui long sur une commande',
    learnDoes: 'MIDI learn ou options',
    reset: 'Double-clic / double-tap sur un fader',
    resetDoes: 'Valeur par défaut',
    fine: 'Maj + glisser ou deux doigts',
    fineDoes: 'Réglage fin',
    hold: 'Maintenir Strobe, Blinder, TRIG, FLASH',
    holdDoes: 'Actif tant que maintenu'
  },
  keys: {
    shift: 'Maj',
    enter: 'Entrée',
    backspace: '⌫',
    delete: 'Suppr',
    escape: 'Échap',
    space: 'Espace'
  }
}
