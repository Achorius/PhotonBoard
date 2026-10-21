import type { Translation } from '../types'

export const shell: Translation['shell'] = {
  loadingView: 'Chargement de la vue…',
  unsavedChanges: 'Modifications non enregistrées',
  remoteBadge: 'DISTANT',

  tabs: {
    patch: { label: 'Patch', title: 'Patch' },
    fixtures: { label: 'Projecteurs', title: 'Projecteurs et programmer' },
    effects: { label: 'Effets', title: 'Effets' },
    playback: { label: 'Scènes', title: 'Scènes et chases' },
    live: { label: 'Timeline', title: 'Timeline' },
    visualizer: { label: '3D', title: 'Visualiseur 3D' },
    'stage-layout': { label: 'Plan', title: 'Plan de feu' },
    midi: { label: 'MIDI', title: 'Périphériques et mappings MIDI' },
    follow: { label: 'Poursuite', title: 'Poursuite' },
    settings: { label: 'Réglages', title: 'Réglages' }
  },
  workspace: 'Espace de travail',

  fileMenu: {
    trigger: 'Fichier',
    newShow: 'Nouveau show',
    open: 'Ouvrir…',
    openDemo: 'Ouvrir une démo…',
    openDemoDescription: 'Des shows prêts à l’emploi pour essayer PhotonBoard',
    openOnConsole: 'Ouvrir un show sur la console',
    openRecent: 'Ouvrir un show récent',
    noRecent: 'Aucun show dans le dossier des shows',
    save: 'Enregistrer',
    saveAs: 'Enregistrer sous…',
    upload: 'Envoyer un fichier show…',
    uploadDescription: 'Envoie un .pbshow de cet appareil vers la console',
    reveal: 'Afficher le fichier du show',
    openUsb: 'Ouvrir depuis une clé USB…',
    saveCopyUsb: 'Enregistrer une copie sur la clé USB',
    ejectUsb: 'Éjecter la clé USB',
    usbNone: 'Aucune clé USB branchée',
    quit: 'Quitter PhotonBoard'
  },

  editMenu: {
    trigger: 'Édition',
    undo: 'Annuler',
    undoWhat: 'Annuler : {what}',
    redo: 'Rétablir',
    redoWhat: 'Rétablir : {what}',
    nothingToUndo: 'Rien à annuler',
    nothingToRedo: 'Rien à rétablir',
    deleteSelection: 'Supprimer la sélection',
    deleteWhat: 'Supprimer {what}',
    duplicateSelection: 'Dupliquer la sélection',
    duplicateWhat: 'Dupliquer {what}',
    renameSelection: 'Renommer…',
    noSelection: 'Rien n’est sélectionné dans cette vue',
    remoteHint: 'Annule les modifications faites sur cet appareil ; la console les applique comme toute modification à distance.'
  },

  follow: {
    label: 'Poursuite',
    tooltip: 'La poursuite suit une cible — ouvrir Poursuite'
  },
  timelineButton: {
    label: 'Live',
    play: 'Lancer la timeline · clic droit : MIDI learn',
    stop: 'Arrêter la timeline · clic droit : MIDI learn',
    playAria: 'Lancer la timeline',
    stopAria: 'Arrêter la timeline',
    midiLabel: 'Live / Timeline'
  },
  learn: {
    label: 'Learn',
    learning: 'Learn : {target}',
    learningEllipsis: 'Learn…',
    tooltipIdle: 'MIDI learn : clic droit (ou appui long) sur une commande, puis bougez un fader ou une touche MIDI. Cliquez ici pour apprendre le Grand Master.',
    tooltipLearning: 'Bougez une commande MIDI pour l’affecter — cliquez pour annuler',
    ariaIdle: 'MIDI learn',
    ariaLearning: 'MIDI learn en cours : {target} — annuler'
  },
  clear: {
    label: 'Clear',
    aria: 'Vider le programmer',
    tooltipActive: 'Vider le programmer (relâche les valeurs manuelles)',
    tooltipEmpty: 'Le programmer est vide'
  },
  stage: {
    label: 'Stage',
    tooltipRemote: 'Passer à la vue Stage',
    tooltipConsole: 'Ouvrir la fenêtre Stage (second écran)'
  },
  connection: {
    connected: 'Connecté à la console',
    pinRequired: 'PIN requis',
    reconnecting: 'Reconnexion à la console…',
    online: 'En ligne',
    offline: 'Hors ligne'
  },

  masters: {
    gm: 'GM',
    gmTooltip: 'Grand Master — double-clic : plein · clic droit : MIDI learn',
    strobeTooltip: 'Strobe — maintenir · clic droit : MIDI learn',
    strobeAria: 'Strobe (maintenir)',
    blinderTooltip: 'Blinder — maintenir pour plein blanc · clic droit : MIDI learn',
    blinderAria: 'Blinder (maintenir)',
    blackoutTooltip: 'Blackout · clic droit : MIDI learn',
    blackoutBanner: 'Blackout — toute l’intensité est à zéro',
    release: 'Relâcher (Échap)'
  },

  nav: {
    shortcuts: 'Raccourcis clavier',
    showSidebar: 'Afficher la liste des projecteurs',
    hideSidebar: 'Masquer la liste des projecteurs'
  },

  status: {
    noMidi: 'Pas de MIDI',
    midiInputs: 'Entrées MIDI : {names}',
    noMidiInput: 'Aucune entrée MIDI connectée',
    timecodeReceiving: 'Réception du timecode MIDI',
    timecodeNoSignal: 'Timecode activé — aucun signal',
    notSavedYet: 'Pas encore enregistré',
    revealPath: '{path} — cliquer pour afficher',
    showExecutors: 'Afficher les exécuteurs',
    hideExecutors: 'Masquer les exécuteurs'
  },

  outputs: {
    summaryOk: { one: '{count} sortie OK', other: '{count} sorties OK' },
    connecting: 'Sortie en connexion',
    error: 'Erreur de sortie',
    none: 'Aucune sortie DMX',
    checking: 'État des sorties…',
    popoverLabel: 'Sorties DMX',
    patchedUniverses: { one: '{count} univers patché', other: '{count} univers patchés' },
    emptyHelp: 'Aucune sortie Art-Net ou USB DMX n’est configurée. Le show tourne, mais rien n’atteint les projecteurs.',
    configure: 'Configurer les sorties',
    state: {
      ok: 'Émission',
      connecting: 'Connexion',
      error: 'Erreur',
      invalid: 'Config. invalide',
      disabled: 'Désactivée'
    }
  },

  sidebar: {
    title: 'Projecteurs',
    addFixtures: 'Ajouter des projecteurs (Patch)',
    hide: 'Masquer la liste des projecteurs',
    searchPlaceholder: 'Nom, type, adresse',
    searchAria: 'Rechercher des projecteurs',
    universeAria: 'Univers',
    listAria: 'Projecteurs patchés',
    groupTitle: { one: '{name} — {count} projecteur', other: '{name} — {count} projecteurs' },
    emptyTitle: 'Aucun projecteur patché',
    emptyDescription: 'Ajoutez des projecteurs depuis la bibliothèque pour commencer à programmer.',
    emptyAction: 'Ajouter des projecteurs',
    noMatchTitle: 'Aucun résultat',
    noMatchQuery: 'Aucun résultat pour « {query} ».',
    noMatchUniverse: 'Aucun projecteur dans cet univers.',
    showAll: 'Tout afficher',
    selectedCount: { one: '{count} sélectionné', other: '{count} sélectionnés' },
    selectShown: 'Sélectionner la liste',
    clearSelection: 'Effacer',
    unknownType: 'Type de projecteur inconnu',
    fadersHint: 'Double-cliquez sur un fader pour le réinitialiser'
  },

  executors: {
    aria: 'Exécuteurs',
    arrange: 'Organiser les exécuteurs',
    doneArranging: 'Organisation terminée',
    arrangeTooltip: 'Organiser : déplacer, renommer, couleurs, modes (rien ne se déclenche)',
    doneTooltip: 'Terminé — retour à la restitution',
    releaseAll: 'Relâcher toutes les scènes',
    releaseAllTooltip: 'Arrêter toutes les scènes et tous les chases',
    modeShort: { toggle: 'TOG', trigger: 'TRIG', flash: 'FLASH' },
    modeName: {
      toggle: 'Bascule — un appui GO / STOP',
      trigger: 'Trigger — joue tant que maintenu',
      flash: 'Flash — plein tant que maintenu'
    },
    buttonMode: 'Mode du bouton',
    back: 'Retour',
    cancelLearn: 'Annuler le MIDI learn',
    learn: 'MIDI learn…',
    learnDescription: 'Puis appuyez sur une touche ou un pad MIDI',
    rename: 'Renommer…',
    renameTitle: 'Renommer la scène',
    renameLabel: 'Nom de la scène',
    editInScenes: 'Modifier dans Scènes',
    deleteScene: 'Supprimer la scène…',
    sceneLabel: 'la scène « {name} »',
    columnN: 'Colonne {n}',
    columnTitle: 'Titre de la colonne',
    columnHeaderTooltip: 'Titre et couleur de la colonne',
    cellPlaying: '{name}, {mode}, cue {cue} sur {count} en lecture',
    cellStopped: '{name}, {mode}, arrêtée',
    midiMapped: 'Affectée en MIDI'
  },

  commandLine: {
    aria: 'Ligne de commande',
    placeholder: 'Fixture 1 thru 4 at 80   (touche /)',
    programmerCleared: 'Programmer vidé',
    blackoutToggled: 'Blackout basculé',
    goScene: 'GO scène {n}',
    stopScene: 'STOP scène {n}',
    sceneNotFound: 'Scène {n} introuvable',
    noScenes: 'Aucune scène',
    allStopped: 'Toutes les scènes sont arrêtées',
    groupNotFound: 'Groupe {n} introuvable',
    invalidValue: 'Valeur invalide',
    invalidValueAfterAt: 'Valeur invalide après At',
    groupAt: 'Groupe {n} « {name} » à {percent}',
    groupSelected: { one: 'Groupe « {name} » sélectionné ({count} projecteur)', other: 'Groupe « {name} » sélectionné ({count} projecteurs)' },
    noMatchingFixtures: 'Aucun projecteur correspondant',
    fixturesAt: { one: '{count} projecteur à {percent}', other: '{count} projecteurs à {percent}' },
    fixturesSelected: { one: '{count} projecteur sélectionné', other: '{count} projecteurs sélectionnés' },
    noSelection: 'Aucun projecteur sélectionné',
    fixturesFull: { one: '{count} projecteur à Full', other: '{count} projecteurs à Full' },
    fixturesZero: { one: '{count} projecteur à zéro', other: '{count} projecteurs à zéro' },
    channelUsage: '{channel} <0-255>',
    channelSet: { one: '{count} projecteur {channel} = {value}', other: '{count} projecteurs {channel} = {value}' },
    unknown: 'Commande inconnue : {command}'
  }
}
