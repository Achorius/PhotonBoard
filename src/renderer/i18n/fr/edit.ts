import type { Translation } from '../types'

export const edit: Translation['edit'] = {
  undone: 'Annulé : {what}',
  redone: 'Rétabli : {what}',
  nothingToUndo: 'Rien à annuler',
  nothingToRedo: 'Rien à rétablir',
  deleted: 'Supprimé : {what}',
  duplicated: 'Dupliqué : {what}',
  undoGone: 'Impossible d’annuler cette suppression : d’autres modifications ont suivi. Utilisez Annuler ({keys}) pas à pas.',
  confirmDeleteTitle: 'Supprimer {what} ?',
  confirmDeleteMessage: 'Vous pourrez revenir en arrière avec Annuler ({keys}).',
  confirmDeleteAction: 'Supprimer',
  sections: {
    patch: 'Modification du patch',
    groups: 'Modification des groupes',
    presets: 'Modification des presets',
    cuelists: 'Modification des scènes',
    chases: 'Modification des chases',
    effects: 'Modification des effets',
    midiMappings: 'Modification des mappings MIDI',
    executor: 'Modification des exécuteurs',
    timeline: 'Modification de la timeline',
    roomConfig: 'Modification du plan de feu'
  },
  severalSections: 'Modifications du show'
}
