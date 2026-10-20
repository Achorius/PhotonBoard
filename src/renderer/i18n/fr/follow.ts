import type { Translation } from '../types'

// Traduction de en/follow.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md
// Follow spot = poursuite ; moving head = lyre ; Stage layout = plan de feu ; gamepad = manette.

export const follow: Translation['follow'] = {
  title: 'Poursuite',
  badgeTracking: 'SUIVI',
  badgeStandby: 'VEILLE',
  groupCount: { one: '{count} projecteur dans le groupe', other: '{count} projecteurs dans le groupe' },
  gamepadReady: 'Manette prête',
  start: 'Lancer la poursuite',
  stop: 'Arrêter la poursuite',
  startTooltip: 'Pointer le groupe sur la cible',
  stopTooltip: 'Rendre les projecteurs',
  startDisabledTooltip: 'Ajoutez des projecteurs placés sur le plan de feu',

  fixtures: {
    aria: 'Projecteurs de la poursuite',
    assignedOf: '{n} sur {total}',
    allTooltip: 'Ajouter toutes les lyres au groupe de poursuite',
    noneTooltip: 'Vider le groupe de poursuite',
    emptyTitle: 'Aucune lyre patchée',
    emptyDescription: 'La poursuite pointe des lyres sur une cible. Patchez-en d’abord.',
    openPatch: 'Ouvrir le patch',
    footnote: 'Le pointage utilise la position de chaque projecteur sur le plan de feu et sa plage pan / tilt.',
    rowAria: 'Suivre avec {name}',
    range: 'Pan {pan} · Tilt {tilt}',
    rangeDefault: 'Pan {pan} · Tilt {tilt} (par défaut)',
    rangeFromProfile: 'Lu dans le profil du projecteur',
    rangeDefaultTooltip: 'Le profil n’indique pas de plage : valeur par défaut',
    noPosition: 'SANS POSITION',
    noPositionTooltip: 'Placez-le sur le plan de feu pour que la poursuite puisse le pointer'
  },

  pad: {
    aria: 'Pad de scène',
    title: 'Cible',
    subtitle: 'Scène vue de dessus — glissez pour viser · Maj / deuxième doigt = précis',
    centre: 'Centre',
    centreTooltip: 'Centre de la scène à {height} m',
    noPositionTitle: 'Les lyres n’ont pas de position',
    noPositionDescription: 'Placez-les sur le plan de feu : la poursuite doit savoir où chacune est accrochée.',
    openStageLayout: 'Ouvrir le plan de feu',
    heightAria: 'Hauteur de la cible',
    heightCaption: 'Hauteur m',
    upstage: 'Lointain',
    audience: 'Public',
    targetAria: 'Cible de la poursuite — glissez pour viser, flèches pour ajuster',
    readout: 'X {x} · Z {z} · H {h} m'
  },

  settings: {
    aria: 'Réglages de la poursuite',
    dimmerAria: 'Dimmer de la poursuite',
    movement: 'Mouvement',
    speed: 'Vitesse',
    speedAria: 'Vitesse de la manette',
    speedHint: 'Manette : mètres par seconde, stick à fond',
    homeHeight: 'Hauteur de base',
    homeHeightHint: 'Hauteur utilisée par Centre ({height} m ≈ poitrine)'
  },

  gamepad: {
    title: 'Manette',
    connected: 'Connectée',
    none: 'Aucune manette',
    plugIn: 'Branchez une manette USB / Bluetooth et appuyez sur un bouton',
    activation: 'Activation',
    activationAria: 'Mode d’activation',
    hold: 'Maintien',
    toggle: 'Bascule',
    trigger: 'Déclencheur',
    triggerHint: 'Appuyez sur le bouton de la manette à utiliser',
    pressButton: 'Appuyez sur un bouton...',
    invertX: 'Inverser gauche / droite',
    invertY: 'Inverser la hauteur',
    invertZ: 'Inverser la profondeur',
    leftStick: 'Gauche',
    rightStick: 'Droit',
    noButton: 'Aucun bouton appuyé',
    buttonN: 'Bouton {n}',
    dpadUp: 'Croix haut',
    dpadDown: 'Croix bas',
    dpadLeft: 'Croix gauche',
    dpadRight: 'Croix droite'
  },

  help: {
    title: 'Mode d’emploi',
    step1: 'Cochez les lyres qui doivent suivre, et placez-les sur le plan de feu.',
    step2: 'Lancez la poursuite (ou maintenez le déclencheur de la manette), puis glissez sur le pad.',
    step3: 'Stick gauche : gauche / droite et hauteur. Stick droit : profondeur.',
    step4: 'À l’arrêt, les projecteurs reprennent ce qu’ils faisaient.'
  }
}
