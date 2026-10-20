// Programmer pro (pro.programmer.*) : noms des étapes d’annulation et noms
// par défaut.

import type { Translation } from '../../types'

export const programmer: Translation['pro']['programmer'] = {
  undo: {
    storeCue: 'Mémoriser la cue {cue}',
    updateCues: 'Mettre à jour les cues',
    editCue: 'Modifier la cue {cue}',
    deleteCue: 'Supprimer la cue {cue}',
    copyCue: 'Copier la cue {cue}',
    moveCue: 'Déplacer la cue {cue}',
    newSequence: 'Nouvelle séquence',
    deleteSequence: 'Supprimer la séquence « {name} »',
    renameSequence: 'Renommer la séquence',
    storePreset: 'Mémoriser le preset {preset}',
    updatePresets: 'Mettre à jour les presets',
    editPreset: 'Modifier le preset {preset}',
    deletePreset: 'Supprimer le preset {preset}',
    copyPreset: 'Copier le preset {preset}',
    movePreset: 'Déplacer le preset {preset}',
    storeGroup: 'Mémoriser le groupe {n}',
    deleteGroup: 'Supprimer le groupe « {name} »',
    renameGroup: 'Renommer le groupe',
    storeMacro: 'Mémoriser la macro {n}',
    editMacro: 'Modifier la macro {n}',
    deleteMacro: 'Supprimer la macro {n}',
    assignExecutor: 'Affecter l’exécuteur {page}.{slot}',
    park: 'Park',
    unpark: 'Unpark'
  },
  defaults: {
    group: 'Groupe {n}'
  }
}
