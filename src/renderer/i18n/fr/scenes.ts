import type { Translation } from '../types'

// Traduction de en/scenes.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md
// Cue : féminin (« la cue 3 ») ; Chase : masculin ; Step → « pas » ; Record → « Mémoriser » ;
// Fade in / out / Delay / Follow → Montée / Descente / Délai / Enchaînement.

export const scenes: Translation['scenes'] = {
  effectCount: { one: '{count} effet', other: '{count} effets' },
  stepCount: { one: '{count} pas', other: '{count} pas' },
  liveCount: '{count} LIVE',
  liveBadge: 'LIVE',
  flashBadge: 'FLASH',
  learnBadge: 'LEARN',
  noCues: 'Aucune cue',
  loop: 'Boucle',
  level: 'Niveau',
  priority: 'Priorité',
  priorityShort: 'P{n}',
  cueN: 'Cue {number}',
  stepN: 'Pas {n}',
  slotShort: 'EX {slot}',
  slotShortMode: 'EX {slot} · {mode}',
  slotTitle: 'Exécuteur colonne {col}, rangée {row}',
  copyName: '{name} (copie)',
  modeHint: {
    toggle: 'Un appui = GO / Stop',
    trigger: 'Joue tant que maintenu',
    flash: 'Plein niveau tant que maintenu'
  },

  defaults: {
    sceneName: 'Scène {n}',
    chaseName: 'Chase {n}',
    cueName: 'Cue {n}'
  },

  selection: {
    scene: 'la scène « {name} »',
    cue: 'la cue {number}',
    cueNamed: 'la cue {number} « {name} »',
    chase: 'le chase « {name} »',
    step: 'le pas {n}',
    effect: 'l’effet « {name} »',
    midiMapping: 'l’affectation MIDI {source} de « {name} »'
  },

  delete: {
    sceneContents: 'Supprime {cues}, son bouton d’exécuteur et ses clips de timeline.',
    sceneContentsFx: 'Supprime {cues} et {effects}, son bouton d’exécuteur et ses clips de timeline.',
    sceneAction: 'Supprimer la scène',
    cueContents: {
      one: 'Sa valeur de canal est supprimée ; les cues suivantes peuvent changer sur le plateau (tracking).',
      other: 'Ses {count} valeurs de canaux sont supprimées ; les cues suivantes peuvent changer sur le plateau (tracking).'
    },
    cueAction: 'Supprimer la cue',
    chaseContents: 'Supprime {steps}.',
    chaseAction: 'Supprimer le chase',
    stepContents: { one: 'Sa valeur de canal est supprimée.', other: 'Ses {count} valeurs de canaux sont supprimées.' },
    stepAction: 'Supprimer le pas'
  },

  view: {
    paneAria: 'Scènes ou chases',
    record: 'Mémoriser…',
    recordSceneTooltip: 'Mémoriser le programmer dans une nouvelle scène, une nouvelle cue ou une cue existante',
    recordChaseTooltip: 'Mémoriser le programmer dans un nouveau chase, un nouveau pas ou un pas existant',
    noSceneTitle: 'Aucune scène sélectionnée',
    noSceneText: 'Mémorisez une ambiance en scène, ou choisissez-en une dans la liste pour modifier ses cues et ses temps.',
    noChaseTitle: 'Aucun chase sélectionné',
    noChaseText: 'Mémorisez un chase, ou choisissez-en un dans la liste pour modifier ses pas, son tempo et son sens.'
  },

  programmer: {
    counts: '{fixtures} proj. · {channels} can.',
    empty: 'Programmer vide',
    activeTooltip: 'Valeurs dans le programmer — Mémoriser enregistre celles-ci',
    emptyTooltip: 'Le programmer est vide — Mémoriser enregistre la sortie en cours'
  },

  list: {
    newEmpty: 'Nouvelle scène vide',
    searchPlaceholder: 'Chercher une scène (nom ou numéro)',
    searchAria: 'Chercher une scène',
    emptyTitle: 'Aucune scène',
    emptyText: 'Réglez une ambiance dans Projecteurs, puis mémorisez-la. Les scènes se jouent d’ici, de la barre d’exécuteurs et en MIDI.',
    recordScene: 'Mémoriser la scène',
    emptyScene: 'Scène vide',
    noMatchTitle: 'Aucune scène trouvée',
    clearSearch: 'Effacer la recherche',
    cuesLoop: '{cues} · boucle',
    stopNamed: 'Arrêter « {name} »',
    goNamed: 'GO « {name} »'
  },

  detail: {
    aria: 'Scène {name}',
    numberShort: 'S{n}',
    nameAria: 'Nom de la scène',
    namePlaceholder: 'Scène sans titre',
    stopped: 'Arrêtée',
    duplicate: 'Dupliquer la scène',
    delete: 'Supprimer la scène',
    deleteEllipsis: 'Supprimer la scène…',
    actions: 'Actions de la scène',
    backTooltip: 'Cue précédente',
    goTooltip: 'GO cue suivante',
    stopTooltip: 'Arrêter et relâcher la scène',
    flashTooltip: 'Maintenir : plein niveau (joue une scène arrêtée tant que maintenu)',
    levelAria: 'Niveau de la scène',
    tabsAria: 'Éditeur de scène'
  },

  onStage: {
    next: 'Suiv.',
    autoAfter: 'auto après {time}',
    delayPlusFade: '{delay} + {fade}',
    end: 'Fin de la scène'
  },

  midi: {
    learning: 'MIDI learn…',
    cancelLearn: 'Annuler le MIDI learn',
    learnTrigger: 'MIDI learn…',
    relearnTrigger: 'Réapprendre le déclencheur MIDI…',
    learnChase: 'MIDI learn départ/arrêt…',
    relearnChase: 'Réapprendre le départ/arrêt MIDI…',
    learnHint: 'Puis appuyez sur une touche ou un pad MIDI',
    waiting: 'En attente d’une touche ou d’un pad MIDI…',
    none: 'Aucun déclencheur MIDI',
    relearn: 'Réapprendre',
    removeAction: 'Retirer l’affectation'
  },

  midiSource: {
    note: 'Note',
    cc: 'CC',
    program: 'Program',
    describe: '{kind} {number} · canal {channel}',
    describeDevice: '{kind} {number} · canal {channel} · {device}'
  },

  table: {
    reorder: 'Réordonner',
    actions: 'Actions',
    dragTitle: 'Glisser pour réordonner',
    moveUp: 'Monter',
    moveDown: 'Descendre'
  },

  update: {
    fromProgrammer: 'Mettre à jour depuis le programmer',
    replaceWithProgrammer: 'Remplacer par le programmer',
    mergeDescription: 'Fusion : ajoute / remplace des canaux',
    replaceCueDescription: 'La cue ne garde que les nouvelles valeurs',
    replaceStepDescription: 'Le pas ne garde que les nouvelles valeurs',
    merge: 'Fusionner',
    mergeTitle: 'Ajoute / remplace des canaux, garde les autres',
    replace: 'Remplacer'
  },

  cues: {
    fadeIn: 'Montée',
    fadeInTitle: 'Montée : intensité qui monte et tous les autres attributs',
    fadeOut: 'Descente',
    fadeOutTitle: 'Descente : intensité qui descend',
    delay: 'Délai',
    delayTitle: 'Attente avant le début du fondu',
    follow: 'Enchaînement',
    followTitle: 'Enchaînement auto : la cue suivante part ce temps après la fin du fondu de celle-ci',
    channelsShort: 'Can.',
    channelsTitle: 'Canaux enregistrés dans cette cue',
    tracked: 'Total',
    trackedTitle: 'Canaux sur le plateau avec le tracking (cette cue et les cues précédentes)',
    dragAria: 'Glisser pour réordonner la cue {number}',
    onStage: 'Sur le plateau',
    nameAria: 'Nom de la cue {number}',
    fadeInAria: 'Montée de la cue {number}',
    fadeOutAria: 'Descente de la cue {number}',
    delayAria: 'Délai de la cue {number}',
    followAria: 'Temps d’enchaînement de la cue {number}',
    manual: 'Manuel',
    manualTooltip: 'Manuel : attend le GO. Cliquez pour l’enchaînement auto.',
    backToManual: 'Revenir au GO manuel',
    actionsAria: 'Actions de la cue {number}',
    menuTitleNamed: 'Cue {number} · {name}',
    goTo: 'GO sur cette cue',
    autoFollow: 'Enchaînement auto',
    moveUp: 'Monter la cue',
    moveDown: 'Descendre la cue',
    duplicate: 'Dupliquer la cue',
    delete: 'Supprimer la cue',
    deleteEllipsis: 'Supprimer la cue…',
    updateTooltip: 'Fusionner le programmer dans la cue sélectionnée',
    add: 'Ajouter une cue',
    addTooltip: 'Mémoriser le programmer comme nouvelle cue à la fin',
    emptyTitle: 'Aucune cue dans cette scène',
    emptyText: 'Réglez une ambiance dans Projecteurs, puis mémorisez-la comme cue 1. Chaque cue part de la précédente ; les canaux inchangés sont suivis (tracking).',
    recordFirst: 'Mémoriser la cue 1'
  },

  effects: {
    replaceTitle: 'Remplacer les effets de « {name} » ?',
    replaceMessage: {
      one: 'Son effet enregistré est remplacé par les {running} en cours.',
      other: 'Ses {count} effets enregistrés sont remplacés par les {running} en cours.'
    },
    replaceAction: 'Remplacer les effets',
    stored: { one: '{count} effet enregistré dans « {name} »', other: '{count} effets enregistrés dans « {name} »' },
    noneRunningTooltip: 'Aucun effet en cours — lancez des effets dans la vue Effets',
    storeTooltip: 'Enregistrer dans cette scène les effets en cours',
    storeRunning: 'Enregistrer les effets en cours',
    storeRunningCount: 'Enregistrer les effets en cours ({count})',
    replaceRunning: 'Remplacer par ceux en cours ({count})',
    emptyTitle: 'Aucun effet dans cette scène',
    emptyText: 'Les effets enregistrés dans une scène redémarrent à chaque GO et s’arrêtent avec elle.',
    summary: '{effects} · redémarrent au GO, s’arrêtent avec la scène',
    nameAria: 'Nom de l’effet',
    speed: 'Vitesse',
    size: 'Amplitude',
    spread: 'Décalage',
    removeNamed: 'Retirer « {name} »',
    removeTitle: 'Retirer « {name} » de cette scène ?',
    removeMessage: 'L’effet reste dans la vue Effets.',
    removeAction: 'Retirer l’effet'
  },

  settings: {
    colorHint: 'Colonne d’exécuteurs {col} — partagée par ses scènes',
    colorHintNamed: 'Colonne d’exécuteurs {col} « {title} » — partagée par ses scènes',
    colorHintNoSlot: 'Affichée quand la scène a un emplacement d’exécuteur',
    priorityHint: 'La plus haute l’emporte sur les canaux partagés avec d’autres scènes',
    loopDescription: 'Après la dernière cue, l’enchaînement auto reprend à la cue 1',
    autoFollowAll: 'Tout en enchaînement auto',
    manualAll: 'Tout en GO manuel',
    renumber: 'Renuméroter',
    renumberTooltip: 'Numéroter les cues 1, 2, 3… dans l’ordre de la liste',
    executor: 'Exécuteur',
    slot: 'Emplacement',
    slotPosition: 'colonne {col}, rangée {row}',
    button: 'Bouton',
    buttonModeAria: 'Mode du bouton d’exécuteur',
    noSlot: 'Absente de la barre d’exécuteurs — les 32 emplacements sont pris. Libérez-en un pour donner un bouton à cette scène.',
    midi: 'MIDI'
  },

  chaseList: {
    newEmpty: 'Nouveau chase vide',
    emptyTitle: 'Aucun chase',
    emptyText: 'Un chase enchaîne des ambiances en rythme. Mémorisez chaque ambiance comme un pas.',
    recordChase: 'Mémoriser le chase',
    emptyChase: 'Chase vide',
    playNamed: 'Lancer « {name} »'
  },

  chase: {
    aria: 'Chase {name}',
    numberShort: 'C{n}',
    nameAria: 'Nom du chase',
    namePlaceholder: 'Chase sans titre',
    stopped: 'Arrêté',
    duplicate: 'Dupliquer le chase',
    delete: 'Supprimer le chase',
    deleteEllipsis: 'Supprimer le chase…',
    actions: 'Actions du chase',
    play: 'Lecture',
    playTooltip: 'Lancer le chase',
    stopTooltip: 'Arrêter le chase',
    tap: 'Tap',
    tapTooltip: 'Tapez au moins 2 fois en rythme',
    perStep: '{time} / pas',
    stepTimeTitle: 'Durée d’un pas à ce tempo',
    levelAria: 'Niveau du chase',
    directionAria: 'Sens',
    direction: { forward: 'Avant', backward: 'Arrière', bounce: 'Aller-retour', random: 'Aléatoire' },
    directionTitle: {
      forward: 'Avant : 1 → n',
      backward: 'Arrière : n → 1',
      bounce: 'Aller-retour : 1 → n → 1',
      random: 'Pas dans un ordre aléatoire'
    },
    crossfade: 'Fondu'
  },

  steps: {
    moveUp: 'Monter le pas',
    moveDown: 'Descendre le pas',
    duplicate: 'Dupliquer le pas',
    delete: 'Supprimer le pas',
    deleteEllipsis: 'Supprimer le pas…',
    updateTooltip: 'Fusionner le programmer dans le pas sélectionné',
    add: 'Ajouter un pas',
    addTooltip: 'Mémoriser le programmer comme nouveau pas à la fin',
    emptyTitle: 'Aucun pas',
    emptyText: 'Réglez une ambiance dans Projecteurs et mémorisez-la comme pas 1, puis changez l’ambiance et ajoutez le pas suivant.',
    recordFirst: 'Mémoriser le pas 1',
    look: 'Aperçu',
    lookTitle: 'Couleur / niveau approximatif de chaque projecteur',
    noColour: 'Ni couleur ni niveau (position / faisceau seulement)',
    unpatched: 'Non patché',
    contents: 'Contenu',
    time: 'Durée',
    timeTitle: 'Durée du pas : un temps au tempo du chase, ou un maintien fixe',
    dragAria: 'Glisser pour réordonner le pas {n}',
    oneBeat: '1 temps · {time}',
    beatTooltip: 'Un temps au tempo du chase. Cliquez pour maintenir ce pas une durée fixe.',
    hold: 'Maintien',
    backToBeat: 'Revenir à un temps',
    actionsAria: 'Actions du pas {n}'
  },

  record: {
    titleScenes: 'Mémoriser une scène / une cue',
    titleChases: 'Mémoriser un chase / un pas',
    contents: 'Contenu',
    nothing: 'Rien à mémoriser',
    nothingHint: 'Réglez d’abord des niveaux dans Projecteurs (programmer).',
    nothingHintEffects: 'Réglez d’abord des niveaux dans Projecteurs ou lancez un effet.',
    sourceProgrammer: 'Valeurs du programmer',
    sourceProgrammerHint: 'Seuls les canaux que vous avez touchés sont enregistrés.',
    sourceOutput: 'Sortie en cours (programmer vide)',
    sourceOutputHint: 'Tous les canaux au-dessus de zéro sont enregistrés.',
    fixturesShort: '{count} proj.',
    selectedOnly: 'Projecteurs sélectionnés seulement ({count})',
    into: 'Mémoriser dans',
    newScene: 'Nouvelle scène',
    newSceneHint: 'Crée une scène avec cette ambiance en cue 1',
    newChase: 'Nouveau chase',
    newChaseHint: 'Crée un chase avec cette ambiance en pas 1',
    addCueTo: 'Ajouter une cue à {name}',
    addCueSelected: 'Ajouter une cue à la scène sélectionnée',
    addStepTo: 'Ajouter un pas à {name}',
    addStepSelected: 'Ajouter un pas au chase sélectionné',
    becomesCue: 'Devient la cue {number}, après la dernière',
    becomesStep: 'Devient le pas {n}',
    selectSceneFirst: 'Sélectionnez d’abord une scène',
    selectChaseFirst: 'Sélectionnez d’abord un chase',
    updateCueN: 'Mettre à jour la cue {number} {name}',
    updateACue: 'Mettre à jour une cue',
    updateStepN: 'Mettre à jour le pas {n}',
    updateAStep: 'Mettre à jour un pas',
    updateCueSelected: '{count} can. actuellement · cue sélectionnée',
    updateCueOnStage: '{count} can. actuellement · cue sur le plateau',
    channelsNow: '{count} can. actuellement',
    selectCueFirst: 'Sélectionnez une cue dans la liste des cues',
    selectStepFirst: 'Sélectionnez un pas dans la liste des pas',
    updateModeAria: 'Mode de mise à jour',
    sceneNamePlaceholder: 'Nom de la scène (facultatif)',
    chaseNamePlaceholder: 'Nom du chase (facultatif)',
    includeEffects: 'Inclure les effets en cours',
    runningEffects: '{count} en cours : {names}',
    noEffectRunning: 'Aucun effet en cours',
    clearAfter: 'Vider le programmer après la mémorisation',
    clearAfterHint: 'REC + Clear : relâche vos valeurs manuelles une fois enregistrées',
    recordCue: 'Mémoriser la cue',
    recordStep: 'Mémoriser le pas',
    emptyValues: 'Vide',
    describeValues: '{fixtures} · {count} can.'
  },

  toast: {
    captureSummary: '{fixtures} · {channels}',
    summaryCleared: '{summary} · programmer vidé',
    recorded: 'Mémorisé',
    sceneRecorded: 'Scène « {name} » mémorisée',
    chaseRecorded: 'Chase « {name} » mémorisé',
    cueAdded: 'Cue {number} ajoutée à « {name} »',
    cueUpdated: 'Cue {number} mise à jour',
    cueReplaced: 'Cue {number} remplacée',
    channelsMerged: { one: '{count} canal fusionné', other: '{count} canaux fusionnés' },
    stepAdded: 'Pas {n} ajouté à « {name} »',
    stepUpdated: 'Pas {n} mis à jour',
    stepReplaced: 'Pas {n} remplacé'
  }
}
