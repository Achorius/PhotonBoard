import type { Translation } from '../types'

// Traduction de en/timeline.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md
// Timeline (la), piste, clip, repère, section, tête de lecture, magnétisme.

export const timeline: Translation['timeline'] = {
  openScenes: 'Ouvrir les scènes',
  clipCount: { one: '{count} clip', other: '{count} clips' },

  selection: {
    clip: 'le clip « {name} »',
    marker: 'le repère « {name} »',
    section: 'la section « {name} »',
    track: 'la piste « {name} »'
  },

  confirm: {
    clipTitle: 'Retirer « {name} » de la timeline ?',
    clipMessage: 'La scène elle-même est conservée. Annuler ({keys}) remet le clip en place.',
    clipAction: 'Retirer le clip',
    sectionMessage: 'Les clips et repères qu’elle contient sont conservés. Annuler ({keys}) la rétablit.',
    trackMessage: {
      one: 'Son clip sera retiré de la timeline. Annuler ({keys}) le rétablit.',
      other: 'Ses {count} clips seront retirés de la timeline. Annuler ({keys}) les rétablit.'
    },
    trackEmptyMessage: 'La piste est vide. Annuler ({keys}) la rétablit.'
  },

  defaults: {
    trackName: 'Piste {n}',
    markerName: 'Repère {n}',
    sectionName: 'Section {n}'
  },

  transport: {
    aria: 'Transport',
    rewind: 'Revenir au début (Début) · clic droit : MIDI learn',
    previousMarker: 'Repère précédent',
    nextMarker: 'Repère suivant',
    playTooltip: 'Lecture (Espace) · clic droit : MIDI learn',
    pauseTooltip: 'Pause (Espace) · clic droit : MIDI learn',
    playAria: 'Lancer la timeline',
    pauseAria: 'Mettre la timeline en pause',
    stop: 'Stop (appuyer encore : retour au début) · clic droit : MIDI learn',
    loopOn: 'Boucle activée — reprend au début à la fin',
    loopOff: 'Boucle désactivée'
  },

  readout: {
    time: 'Temps',
    timecode: 'Timecode',
    bars: 'Mesures · {bpm}',
    tooltip: 'Touchez pour passer du temps au timecode et aux mesures'
  },

  snap: {
    aria: 'Magnétisme',
    tooltip: 'Caler les clips, repères et sections sur cette grille',
    off: 'Libre',
    quarterSecond: '¼ s',
    halfSecond: '½ s',
    oneSecond: '1 s',
    beat: 'Beat',
    bar: 'Mesure'
  },

  zoom: {
    aria: 'Zoom',
    out: 'Zoom arrière (Ctrl+molette, pincement)',
    in: 'Zoom avant',
    fit: 'Tout afficher'
  },

  options: {
    title: 'Options de la timeline',
    timeDisplay: 'Affichage du temps',
    displayTime: 'Temps',
    displayTimecode: 'TC',
    displayBars: 'Mesures',
    gridTempo: 'Tempo',
    gridTempoHint: 'Tempo de la grille : magnétisme sur les beats / mesures et règle en mesures',
    length: 'Durée',
    lengthAria: 'Durée de la timeline',
    lengthHint: 'La lecture s’arrête (ou boucle) ici, sauf si des clips durent plus longtemps',
    followPlayhead: 'Suivre la tête de lecture',
    followPlayheadDescription: 'Fait défiler la vue pour garder la tête de lecture visible pendant la lecture'
  },

  timecode: {
    title: 'Timecode',
    buttonTooltip: 'Source du timecode et suivi',
    badgeInternal: 'INT',
    badgeLocked: 'MTC LOCK',
    badgeChase: 'SUIVI',
    dropFrame: '{fps} df',
    clockSource: 'Source d’horloge',
    internal: 'Interne',
    mtc: 'Timecode MIDI',
    statusInternal: 'Horloge interne — la timeline avance seule',
    statusLocked: 'Calé sur le MTC entrant · {fps}',
    statusWaiting: 'En attente du timecode MIDI...',
    frameRate: 'Cadence',
    frameRateHint: 'Suit le timecode entrant une fois calé',
    chase: 'Suivre le timecode',
    chaseDescription: 'Lance, suit et arrête la timeline avec le timecode entrant',
    dropout: 'Perte de signal',
    dropoutAria: 'Délai de perte de signal',
    dropoutHint: 'Arrête la timeline suivie après ce temps sans signal',
    offset: 'Décalage',
    offsetAria: 'Décalage du timecode',
    offsetHint: 'Ajouté au timecode entrant (négatif = plus tôt)'
  },

  canvas: {
    timeCorner: 'Temps',
    barsCorner: 'Mesures · {bpm} BPM',
    markers: 'Repères',
    sections: 'Sections',
    rulerAria: 'Règle temporelle — touchez ou glissez pour déplacer la tête de lecture, double-touchez pour ajouter un repère',
    zoneLaneHint: 'Glissez sur une partie vide de cette ligne pour créer une section',
    emptyTitle: 'La timeline est vide',
    emptyDescription: 'Glissez une scène de la bibliothèque sur une piste, ou sélectionnez une scène et appuyez sur + pour la poser à la tête de lecture.',
    noScenesTitle: 'Aucune scène à placer',
    noScenesDescription: 'Les clips de la timeline jouent des scènes. Mémorisez d’abord une scène, puis placez-la ici.'
  },

  menu: {
    addSceneHere: 'Ajouter une scène ici',
    addMarkerHere: 'Ajouter un repère ici',
    addMarkerAt: 'Ajouter un repère à {time}',
    movePlayheadHere: 'Placer la tête de lecture ici',
    renameEdit: 'Renommer / modifier...'
  },

  ghost: {
    dropAt: '{track} à {time}',
    dropHint: 'Déposez sur une piste'
  },

  clip: {
    missingScene: 'Scène introuvable',
    aria: '{name}, de {start} à {end}',
    effectCount: { one: '{count} effet', other: '{count} effets' },
    editScene: 'Modifier la scène',
    goToStart: 'Aller au début du clip',
    goToStartShort: 'Aller au début',
    splitAtPlayhead: 'Couper à la tête de lecture',
    splitHint: 'Placez la tête de lecture dans le clip',
    remove: 'Retirer le clip',
    removeFromTimeline: 'Retirer de la timeline'
  },

  marker: {
    short: 'Repère',
    addAtPlayhead: 'Ajouter un repère à la tête de lecture',
    addAtPlayheadTooltip: 'Ajouter un repère à la tête de lecture',
    goTo: 'Aller au repère',
    moveToPlayhead: 'Placer à la tête de lecture',
    midiLearnMenu: 'MIDI learn : aller au repère',
    delete: 'Supprimer le repère'
  },

  section: {
    addAtPlayhead: 'Ajouter une section à la tête de lecture',
    goTo: 'Aller à la section',
    midiLearnMenu: 'MIDI learn : aller à la section',
    moveEarlier: 'Plus tôt',
    moveLater: 'Plus tard',
    delete: 'Supprimer la section'
  },

  track: {
    add: 'Ajouter une piste',
    empty: 'Vide',
    rename: 'Renommer la piste',
    insertBelow: 'Insérer une piste dessous',
    moveUp: 'Monter',
    moveDown: 'Descendre',
    remove: 'Supprimer la piste',
    removeEllipsis: 'Supprimer la piste...',
    lastTrack: 'La timeline doit garder au moins une piste',
    nameAria: 'Nom de la piste {n}',
    optionsAria: 'Options de la piste {n}'
  },

  midi: {
    playTarget: 'Timeline lecture / pause',
    stopTarget: 'Timeline stop',
    rewindTarget: 'Timeline retour au début',
    goTo: 'Aller à {name}',
    learning: 'Apprentissage... (touchez pour annuler)',
    relearn: 'MIDI affecté — réapprendre'
  },

  inspector: {
    aria: 'Propriétés',
    close: 'Fermer les propriétés (Échap)',
    actions: 'Actions',
    clipSection: 'Clip',
    clipSubtitle: 'Clip de scène · {track}',
    label: 'Libellé',
    clipLabelAria: 'Libellé du clip',
    sceneNamePlaceholder: 'Nom de la scène',
    track: 'Piste',
    timing: 'Temps',
    start: 'Début',
    end: 'Fin',
    length: 'Durée',
    endsAt: 'Se termine à {time}',
    fadeIn: 'Montée',
    fadeOut: 'Descente',
    fadeHint: 'Les fondus agissent sur le niveau de la scène ; vous pouvez aussi tirer les points du clip',
    markerSection: 'Repère',
    markerSubtitle: 'Repère · {time}',
    markerNameAria: 'Nom du repère',
    markerTimeAria: 'Position du repère',
    time: 'Position',
    sectionSection: 'Section',
    sectionSubtitle: 'Section {n} sur {count}',
    sectionNameAria: 'Nom de la section',
    sectionStartAria: 'Début de la section',
    sectionEndAria: 'Fin de la section',
    arrange: 'Organiser',
    arrangeHint: 'clips et repères suivent',
    trackSection: 'Piste',
    trackSubtitle: 'Piste {n} · {clips}',
    trackNameAria: 'Nom de la piste',
    trackNameHint: 'Enregistré avec le show'
  },

  library: {
    aria: 'Bibliothèque de la timeline',
    tabsAria: 'Bibliothèque',
    show: 'Afficher la bibliothèque',
    hide: 'Masquer la bibliothèque',
    noScenesTitle: 'Aucune scène',
    noScenesDescription: 'Mémorisez des scènes dans la vue Scènes, puis placez-les sur la timeline.',
    searchScenes: 'Rechercher une scène',
    noMatch: 'Aucune scène trouvée',
    clearSearch: 'Effacer la recherche',
    scenesHint: 'Glissez une scène par sa poignée sur une piste, ou appuyez sur + pour la poser à la tête de lecture.',
    dragScene: 'Glisser {name} sur la timeline',
    addSceneAtPlayhead: 'Ajouter {name} à la tête de lecture',
    placedCount: { one: 'Placée une fois sur la timeline', other: 'Placée {count} fois sur la timeline' },
    noMarkersTitle: 'Aucun repère',
    noMarkersDescription: 'Les repères nomment les moments où sauter (aussi depuis le MIDI). Double-touchez la règle ou appuyez sur M.',
    noSectionsTitle: 'Aucune section',
    noSectionsDescription: 'Les sections (couplet, refrain…) regroupent un passage du show. Glissez sur la ligne Sections pour en créer une ; réordonnez-les ici pour réorganiser le show.',
    sectionsHint: 'Glissez une section par sa poignée pour la déplacer — ses clips et repères suivent.',
    moveSection: 'Déplacer la section {name}'
  }
}
