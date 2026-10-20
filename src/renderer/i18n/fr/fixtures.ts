import type { Translation } from '../types'

// Traduction de en/fixtures.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md

export const fixtures: Translation['fixtures'] = {
  modes: {
    aria: 'Vue',
    attributes: 'Attributs',
    attributesTitle: 'Programmer par attribut (intensité, position, couleur, faisceau)',
    faders: 'Faders',
    fadersTitle: 'Faders de canaux par projecteur',
    sheet: 'Tableau',
    sheetTitle: 'Tableau de tous les projecteurs',
    dmx: 'DMX',
    dmxTitle: 'Canaux DMX bruts d’un univers'
  },
  universeAria: 'Univers',
  unit: {
    aria: 'Valeurs en',
    percent: 'Pourcentage',
    dmx: 'DMX 0–255'
  },
  noSelection: 'Aucune sélection',
  locate: {
    label: 'Locate',
    aria: 'Locate des projecteurs sélectionnés',
    tooltip: 'Locate : projecteurs sélectionnés à full, blanc ouvert, centrés (dans le programmer)',
    toast: { one: 'Locate : {count} projecteur ouvert, en blanc, centré', other: 'Locate : {count} projecteurs ouverts, en blanc, centrés' },
    toastDescription: 'Release ou Clear pour revenir à l’état précédent.'
  },
  release: {
    label: 'Release',
    selectionAria: 'Relâcher les projecteurs sélectionnés',
    selectionTooltip: 'Relâcher les projecteurs sélectionnés du programmer',
    attribute: 'Relâcher {name}',
    intensity: 'Relâcher l’intensité',
    colourTooltip: 'Relâcher la couleur du programmer',
    positionTooltip: 'Relâcher pan / tilt du programmer',
    feature: {
      beam: 'Relâcher le faisceau',
      control: 'Relâcher le contrôle'
    }
  },
  groupMenu: {
    aria: 'Sélectionner un groupe',
    allFixtures: 'Tous les projecteurs',
    clearSelection: 'Effacer la sélection'
  },

  empty: {
    noPatchTitle: 'Aucun projecteur patché',
    noPatchDescription: 'Patchez des projecteurs pour les programmer par attribut, ou pilotez directement des canaux DMX bruts.',
    addFixtures: 'Ajouter des projecteurs',
    rawDmx: 'DMX brut',
    nothingTitle: 'Rien à programmer',
    nothingDescription: 'Les projecteurs sélectionnés n’ont aucun canal connu (type de projecteur manquant ?).',
    selectTitle: 'Sélectionnez des projecteurs à programmer',
    selectDescription: 'Choisissez des projecteurs dans la liste, ou sélectionnez un groupe. Les attributs apparaissent selon les canaux de la sélection.',
    showFixtureList: 'Afficher la liste des projecteurs',
    universeTitle: 'Aucun projecteur dans l’univers {n}',
    universeDescription: 'Choisissez un autre univers ci-dessus, ou patchez des projecteurs dans celui-ci.',
    noFixturesHere: 'Aucun projecteur ici'
  },

  features: {
    control: 'Contrôle',
    aria: 'Familles d’attributs',
    inProgrammer: 'dans le programmer'
  },

  attributes: {
    dimmer: 'Dimmer',
    pan: 'Pan',
    tilt: 'Tilt',
    red: 'Rouge',
    green: 'Vert',
    blue: 'Bleu',
    white: 'Blanc',
    amber: 'Ambre',
    uv: 'UV',
    lime: 'Lime',
    cyan: 'Cyan',
    magenta: 'Magenta',
    yellow: 'Jaune',
    colorWheel: 'Roue de couleurs',
    colorMacro: 'Macro couleur',
    colorTemperature: 'Température de couleur',
    cto: 'CTO',
    ctb: 'CTB',
    shutter: 'Shutter',
    strobe: 'Strobe',
    gobo: 'Gobo',
    goboRotation: 'Rotation gobo',
    prism: 'Prisme',
    prismRotation: 'Rotation prisme',
    zoom: 'Zoom',
    focus: 'Focus',
    iris: 'Iris',
    frost: 'Frost',
    speed: 'Vitesse',
    cells: '{name} (cellules)'
  },
  attr: {
    fine: '{name} (16 bits)',
    allCells: '{name} — toutes les cellules',
    cells: '{name} — cellules',
    valueAria: 'Valeur {name}',
    selectionAria: '{name} (sélection)',
    mixedValues: 'Valeurs différentes',
    coverage: { one: '{count} projecteur sélectionné sur {total}', other: '{count} projecteurs sélectionnés sur {total}' }
  },

  intensity: {
    full: 'Full',
    out: 'Out',
    mixedLevels: 'Niveaux différents',
    coverage: { one: '{count} sur {total} a un dimmer', other: '{count} sur {total} ont un dimmer' },
    more: { one: '+{count} autre canal d’intensité dans « Tous »', other: '+{count} autres canaux d’intensité dans « Tous »' }
  },

  position: {
    pan: 'Pan',
    tilt: 'Tilt',
    padLabel: 'Pan / Tilt',
    padLabelCount: { one: 'Pan / Tilt · {count} projecteur', other: 'Pan / Tilt · {count} projecteurs' },
    fine: 'Précis',
    fineTooltip: 'Précis : le pad bouge dix fois moins vite (glissement relatif)',
    centre: 'Centrer',
    centreTooltip: 'Centrer pan et tilt (position de repos)',
    flip: 'Flip',
    flipTooltip: 'Même position du faisceau, prise de l’autre côté (pan ±180°, tilt inversé)',
    fineAdjust: 'Réglage fin',
    fineAdjustAria: 'Réglage fin {name}',
    sixteenBit: '16 bits : les canaux coarse et fine bougent ensemble.',
    more: 'Autres',
    mixed: 'Différents',
    mixedTitle: 'Les projecteurs sélectionnés ont des valeurs différentes',
    xyPadAria: 'Pad XY'
  },

  colour: {
    wheelAria: 'Roue chromatique',
    wheelValueAria: 'Couleur : teinte {hue}°, saturation {sat}',
    brightness: 'Luminosité',
    brightnessAria: 'Luminosité de la couleur',
    currentAria: 'Couleur actuelle rgb {rgb}',
    none: 'Aucune couleur',
    mixed: 'Couleurs différentes',
    noMixing: 'Pas de mélange de couleurs',
    presetsAria: 'Presets de couleur',
    names: {
      open: 'Ouvert',
      white: 'Blanc',
      warmWhite: 'Blanc chaud',
      coolWhite: 'Blanc froid',
      red: 'Rouge',
      orange: 'Orange',
      amber: 'Ambre',
      yellow: 'Jaune',
      lime: 'Lime',
      green: 'Vert',
      cyan: 'Cyan',
      lightBlue: 'Bleu clair',
      blue: 'Bleu',
      congo: 'Congo',
      uv: 'UV',
      magenta: 'Magenta',
      pink: 'Rose',
      violet: 'Violet',
      black: 'Noir',
      grey: 'Gris',
      colour: 'Couleur'
    }
  },

  strips: {
    jumpAria: 'Aller au projecteur',
    unknownType: 'Type de projecteur inconnu'
  },

  sheet: {
    noPatchDescription: 'Le tableau liste chaque projecteur patché avec ses valeurs en direct.',
    noChannelsTitle: 'Aucun canal',
    noChannelsDescription: 'Les types de projecteurs patchés n’ont aucun canal connu.'
  },

  dmx: {
    gridAria: 'Univers {n}, 512 canaux',
    channelN: 'Can. {n}',
    unpatched: 'non patché',
    selectHint: 'Sélectionnez des canaux pour les régler',
    selectionRange: { one: '{count} canal · {from}–{to}', other: '{count} canaux · {from}–{to}' },
    deselect: 'Désélectionner les canaux',
    levelAria: 'Niveau des canaux sélectionnés'
  },

  channelMenu: {
    learn: 'MIDI learn : {name}',
    learnGrandMaster: 'MIDI learn : Grand Master',
    learnBlackout: 'MIDI learn : Blackout',
    maps: 'Affecte {name}'
  },

  summary: {
    empty: 'Vide',
    contents: '{fixtures}, {channels}',
    channels: { one: '{count} can.', other: '{count} can.' }
  }
}
