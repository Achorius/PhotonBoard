// Programmation pro — couche de données commune (lot 0).

import type { Translation } from '../../types'
import type { core as enCore } from '../../en/pro/core'

/** The keys of en/pro/core.ts (other pro areas add their own files) */
type Core = { [K in keyof typeof enCore]: Translation['pro'][K] }

export const core: Core = {
  sections: {
    macros: 'Modification de macro',
    speedMasters: 'Modification de speed master',
    stagePages: 'Modification de page Stage',
    parked: 'Modification du park'
  },
  executor: {
    pageN: 'Page {n}'
  },
  defaults: {
    macro: 'Macro {n}',
    speedMaster: 'Speed {n}',
    stagePage: 'Page Stage {n}',
    preset: 'Preset {n}'
  },
  proMode: 'Programmation pro',
  proModeHint: 'Pools, numéros d’objets, outils de sélection, temps de cue avancés et pages d’exécuteurs. Le show se joue de la même façon dans les deux modes.'
}
