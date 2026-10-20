// Pages d'exécuteurs et surfaces de jeu (pro.stage.*).

import type { Translation } from '../../types'

export const stage: Translation['pro']['stage'] = {
  kinds: {
    cuelist: 'Scène',
    chase: 'Chase',
    effect: 'Effet',
    macro: 'Macro',
    group: 'Groupe',
    speed: 'Speed master'
  },
  missingObject: 'Introuvable : {kind}',
  goTargetMark: 'Cible du GO / Retour',

  fn: {
    toggle: 'Bascule',
    go: 'GO',
    goBack: 'Retour',
    flash: 'Flash',
    temp: 'Trigger (temporaire)',
    off: 'Off',
    select: 'Sélection',
    swap: 'Swap',
    pause: 'Pause',
    learn: 'Learn'
  },
  fnHint: {
    toggle: 'Appui = GO / Stop',
    go: 'Appui = cue suivante',
    goBack: 'Appui = cue précédente',
    flash: 'Plein feu tant qu’on appuie',
    temp: 'Joue tant qu’on appuie',
    off: 'Appui = stop',
    select: 'Appui = cible du GO / Retour',
    swap: 'Flash, les autres scènes coupées',
    pause: 'Appui = met le fondu en pause',
    learn: 'Appui = MIDI learn de cet exécuteur'
  },

  undo: {
    assign: 'Affecter l’exécuteur',
    removeFromCell: 'Vider l’exécuteur',
    buttonFn: 'Fonction du bouton',
    columnFader: 'Fader de colonne',
    addPage: 'Nouvelle page d’exécuteurs',
    renamePage: 'Renommer la page d’exécuteurs',
    addStagePage: 'Nouvelle page Stage',
    renameStagePage: 'Renommer la page Stage',
    addWidget: 'Ajouter un widget',
    moveWidget: 'Déplacer le widget',
    resizeWidget: 'Redimensionner le widget',
    editWidget: 'Modifier le widget',
    gridSize: 'Grille de la page Stage'
  },

  menu: {
    proSection: 'Exécuteur {slot}',
    buttonFn: 'Fonction du bouton',
    fnFromMode: 'Selon le mode ({fn})',
    assign: 'Affecter…',
    assignOther: 'Affecter autre chose…',
    assignCell: 'Affecter l’exécuteur, colonne {col} rangée {row}',
    noneOfKind: 'Aucun dans ce show',
    columnFader: 'Fader de la colonne {n}',
    selectGoTarget: 'Choisir comme cible du GO',
    selectGoTargetHint: 'Les touches GO / Retour et le MIDI agissent dessus',
    unselectGoTarget: 'Retirer la cible du GO',
    removeFromCell: 'Retirer de l’exécuteur',
    runMacro: 'Lancer la macro',
    selectGroup: 'Sélectionner le groupe',
    tap: 'Tap tempo'
  },

  fader: {
    label: 'Fader de colonne',
    column: 'Colonne (ses scènes et chases)',
    cell: 'Rangée {n} seulement',
    grandmaster: 'Grand Master',
    group: 'Master de groupe : {name}',
    speed: 'Speed master : {name}',
    rate: 'Vitesse de la rangée {n}',
    xfade: 'Crossfade de la rangée {n}'
  },
  faders: {
    show: 'Afficher les faders de colonne',
    hide: 'Masquer les faders de colonne',
    tooltip: 'Faders de colonne (un trait pointillé montre où est un fader MIDI pas encore repris)',
    columnAria: 'Fader de la colonne {n}'
  },

  pages: {
    aria: 'Pages d’exécuteurs',
    selectorAria: '{name}, page {n} sur {count}',
    selectorTooltip: 'Pages d’exécuteurs — balayez de côté ou PageUp / PageDown',
    jumpTo: 'Aller à la page',
    playing: 'Quelque chose joue',
    previous: 'Page précédente',
    next: 'Page suivante',
    add: 'Nouvelle page',
    rename: 'Renommer la page…',
    delete: 'Supprimer la page…',
    renameTitle: 'Renommer la page d’exécuteurs',
    renameLabel: 'Nom de la page',
    pageLabel: 'la page « {name} »',
    deleteMessage: 'Ses exécuteurs sont vidés. Les scènes restent dans le show et vont dans une case libre.'
  },

  view: {
    aria: 'Vue Stage',
    executors: 'Exécuteurs',
    pages: 'Pages'
  },

  widgetKinds: {
    executor: 'Exécuteur',
    go: 'GO / Retour',
    fader: 'Fader',
    master: 'Master',
    group: 'Groupe',
    preset: 'Preset',
    macro: 'Macro',
    speed: 'Speed master',
    clock: 'Horloge',
    label: 'Étiquette'
  },
  widgetHints: {
    executor: 'N’importe quel exécuteur (page fixe ou page courante)',
    go: 'GO / Retour d’une séquence avec le nom des cues',
    fader: 'Scène, chase, master de groupe, colonne ou Grand Master',
    master: 'Grand Master, Blackout, Blinder, Strobe, Release, Clear',
    group: 'Sélectionner un groupe (fader de master en option)',
    preset: 'Appliquer un preset à la sélection',
    macro: 'Lancer une macro',
    speed: 'BPM d’un speed master avec bouton tap',
    clock: 'Heure',
    label: 'Un titre ou une note'
  },
  presetFamily: {
    full: 'Tout',
    intensity: 'Dimmer',
    position: 'Position',
    gobo: 'Gobo',
    color: 'Couleur',
    beam: 'Faisceau',
    focus: 'Focus',
    control: 'Contrôle'
  },

  widget: {
    notSet: '{kind} — non défini',
    emptyExecutor: 'Exécuteur {slot} — vide',
    runMacro: 'Lancer la macro {name}',
    applyPreset: 'Appliquer le preset {name} à la sélection',
    selectGroup: 'Sélectionner le groupe {name}',
    groupMaster: 'Master de {name}',
    tap: 'Tap',
    tapConsoleOnly: 'Tap depuis la console',
    noSequence: 'Aucune séquence à lancer',
    selectedSeq: 'Sélection',
    nextCue: 'Suivante : {n} {name}',
    endOfSequence: 'Fin de la séquence',
    goAria: 'GO {name}',
    backAria: 'Retour {name}',
    emptyLabel: 'Étiquette'
  },

  designer: {
    title: 'Stage',
    pagesAria: 'Pages Stage',
    arrange: 'Organiser',
    arrangeTooltip: 'Organiser : ajouter, déplacer et redimensionner les widgets (rien ne se déclenche)',
    doneTooltip: 'Terminé — retour au jeu',
    arrangeHint: 'Organiser — glissez un widget (tactile : maintenez, puis glissez), tirez son coin pour le redimensionner, touchez une case vide pour ajouter. Rien ne se déclenche.',
    newPage: 'Nouvelle page',
    starterPage: 'Disposition de départ',
    starterHint: 'GO, masters, exécuteurs, groupes — prête à jouer, puis à modifier',
    emptyPage: 'Page vide',
    pageOptions: 'Options de la page',
    rename: 'Renommer…',
    renameTitle: 'Renommer la page Stage',
    renameLabel: 'Nom de la page',
    gridSize: 'Taille de la grille',
    gridValue: '{cols} × {rows}',
    deletePage: 'Supprimer la page…',
    pageLabel: 'la page Stage « {name} »',
    emptyTitle: 'Aucune page Stage',
    emptyDescription: 'Construisez votre page tactile : les exécuteurs, faders, presets et masters dont vous avez besoin pendant le show, à la taille des doigts. Elle se joue aussi sur la fenêtre Stage et les tablettes.',
    emptyPlayer: 'Créez des pages Stage dans la vue Stage de la console.',
    addWidget: 'Ajouter un widget',
    paletteHint: 'Ou touchez une case vide de la page. Sélectionnez un widget pour le modifier.',
    addAt: 'Ajouter un widget colonne {x}, rangée {y}',
    widgetAria: '{kind} colonne {x}, rangée {y}, {w} × {h}',
    widgetLabel: 'le widget {kind}',
    pageFull: 'Plus de place sur cette page — agrandissez la grille ou réduisez un widget.',
    widgetsDropped: { one: '{count} widget ne tenait plus et a été retiré', other: '{count} widgets ne tenaient plus et ont été retirés' },
    inspectorAria: 'Réglages du widget'
  },

  inspector: {
    kind: 'Widget',
    choose: 'Choisir…',
    noObjects: 'Aucun dans ce show pour l’instant.',
    execPage: 'Page d’exécuteurs',
    currentPage: 'Page courante (suit)',
    execCell: 'Exécuteur',
    emptyCell: 'Vide — colonne {col}, rangée {row}',
    column: 'Colonne',
    faderTarget: 'Le fader pilote',
    faderTargets: {
      cuelist: 'Scène',
      chase: 'Chase',
      group: 'Master de groupe',
      column: 'Colonne d’exécuteurs',
      gm: 'Grand Master'
    },
    groupMaster: 'Fader de master',
    groupMasterHint: 'Il faut un widget de 2 cases de haut',
    sequence: 'Séquence',
    goTarget: 'La séquence sélectionnée (cible du GO)',
    masterFn: 'Fonction',
    masterFns: {
      gm: 'Fader de Grand Master',
      blackout: 'Blackout',
      blinder: 'Blinder (maintenu)',
      strobe: 'Strobe (maintenu)',
      release: 'Tout relâcher',
      clear: 'Vider le programmer'
    },
    seconds: 'Afficher les secondes',
    label: 'Libellé',
    labelAuto: 'Automatique (nom de l’objet)',
    text: 'Texte',
    width: 'Largeur (cases)',
    height: 'Hauteur (cases)',
    position: 'Colonne {x}, rangée {y} · {w} × {h}',
    moveHint: 'Déplacer : glissez-le, ou les flèches. Redimensionner : son coin, ou Maj + flèches.',
    deleteWidget: 'Supprimer le widget'
  }
}
