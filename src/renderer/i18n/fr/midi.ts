import type { Translation } from '../types'

// Traduction de en/midi.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md

export const midi: Translation['midi'] = {
  view: {
    mappings: 'Mappings',
    mappingCount: { one: '{count} mapping', other: '{count} mappings' },
    connecting: 'Connexion',
    inputsConnected: { one: '{count} entrée connectée', other: '{count} entrées connectées' },
    noController: 'Aucun contrôleur connecté'
  },
  api: {
    title: 'Le MIDI n’est pas disponible sur ce système',
    unsupported: 'Web MIDI n’est pas pris en charge ici.',
    failed: 'Impossible d’ouvrir les ports MIDI.',
    kept: 'Les mappings sont conservés et refonctionnent dès que le MIDI revient.'
  },
  learn: {
    button: 'Learn',
    learnControl: 'Affecter un contrôle',
    cancel: 'Annuler le learn',
    learning: 'Learn de « {label} »',
    hint: 'Bougez un fader, tournez un bouton ou frappez un pad sur votre contrôleur.',
    mapped: 'Mapping créé : « {name} »'
  },
  learnMenu: {
    masters: 'Masters',
    playback: 'Scènes et chases',
    nothingToMap: 'Rien à affecter pour l’instant',
    fixtureChannel: 'Canal de projecteur…',
    fixtureChannelHint: 'Clic droit (appui long) sur un fader dans Projecteurs'
  },
  devices: {
    region: 'Appareils MIDI',
    title: 'Appareils',
    count: '{inputs} in · {outputs} out',
    rescan: 'Rechercher les appareils MIDI',
    emptyTitle: 'Aucun appareil MIDI',
    emptyText: 'Branchez un contrôleur en USB : il apparaît ici automatiquement (ou cliquez sur Rechercher).',
    unavailableTitle: 'MIDI indisponible',
    unavailableText: 'Ce système ne donne pas accès aux ports MIDI pour le moment.',
    inputs: 'Entrées',
    outputs: 'Sorties',
    noInputs: 'Aucun port d’entrée',
    noOutputs: 'Aucun port de sortie',
    connected: 'Connecté',
    disconnected: 'Déconnecté',
    activity: 'Activité MIDI',
    receiving: 'Réception',
    idle: 'Inactif'
  },
  monitor: {
    region: 'Moniteur MIDI',
    title: 'Moniteur',
    paused: 'en pause',
    last: '{count} derniers',
    resume: 'Reprendre le moniteur',
    pause: 'Mettre le moniteur en pause',
    clear: 'Effacer le moniteur',
    emptyTitle: 'En attente de MIDI',
    emptyText: 'Bougez un fader, tournez un bouton ou frappez un pad : les messages s’affichent ici avec le mapping qu’ils pilotent.'
  },
  table: {
    emptyTitle: 'Aucun mapping MIDI',
    emptyText: 'Cliquez sur Learn, choisissez ce qu’il faut piloter, puis bougez un contrôle de votre appareil. Vous pouvez aussi faire un clic droit (ou un appui long) sur les faders et boutons partout dans PhotonBoard.',
    searchPlaceholder: 'Rechercher nom, cible, CC / note',
    searchLabel: 'Rechercher dans les mappings',
    filterLabel: 'Filtrer par cible',
    noMatch: 'Aucun mapping ne correspond',
    clearFilters: 'Effacer les filtres',
    activity: 'Activité',
    source: 'Source',
    target: 'Cible',
    range: 'Plage',
    actions: 'Actions',
    anyDevice: 'Tout appareil · {type}',
    deleteMapping: 'Supprimer le mapping {name}',
    relative: 'REL',
    absolute: 'ABS',
    inverted: 'INV'
  },
  editor: {
    region: 'Modifier le mapping',
    deleteMapping: 'Supprimer le mapping',
    mapping: 'Mapping',
    nameLabel: 'Nom du mapping',
    source: 'Source',
    relearn: 'Réapprendre',
    moveControl: 'Bougez un contrôle…',
    device: 'Appareil',
    anyDevice: 'Tout appareil',
    message: 'Message',
    messageType: 'Type de message',
    programChange: 'Program change',
    midiChannel: 'Canal MIDI',
    note: 'Note',
    program: 'Program',
    controller: 'Contrôleur',
    number: 'Numéro',
    target: 'Cible',
    control: 'Commande',
    ref: {
      cuelist: 'Scène',
      chase: 'Chase',
      effect: 'Effet',
      fixture: 'Projecteur',
      marker: 'Repère',
      zone: 'Section'
    },
    pickTarget: 'Choisissez ce que ce contrôle pilote',
    choose: 'Choisir…',
    behaviour: 'Comportement',
    encoding: 'Encodage',
    encodingRelative: 'Encodeur sans fin : chaque cran ajuste la valeur',
    encodingAbsolute: 'Fader / bouton : position = valeur',
    absolute: 'Absolu',
    relative: 'Relatif',
    range: 'Plage',
    minimum: 'Minimum',
    min: 'Min',
    maximum: 'Maximum',
    max: 'Max',
    inverted: 'Inversé',
    invertedHint: 'Contrôle vers le haut = valeur vers le bas',
    dangerZone: 'Zone dangereuse',
    channelGone: 'Ce canal n’existe plus'
  },
  source: {
    cc: 'CC',
    note: 'Note',
    program: 'Program',
    channelShort: 'can. {channel}'
  },
  target: {
    playingChases: 'Chases en cours',
    notSet: 'Non défini',
    missing: 'Introuvable'
  },
  categories: {
    masters: 'Masters',
    playback: 'Restitution',
    fixtures: 'Projecteurs',
    timeline: 'Timeline'
  },
  targets: {
    master: { label: 'Grand Master', description: 'Niveau général de sortie' },
    blackout: { label: 'Blackout', description: 'Active ou coupe le blackout à chaque appui' },
    blinder: { label: 'Blinder', description: 'Blanc à fond tant que maintenu' },
    strobe: { label: 'Strobe', description: 'Strobe tant que maintenu' },
    reset: { label: 'Tout réinitialiser', description: 'Vide le programmer et relâche la restitution' },
    tap_tempo: { label: 'Tap tempo', description: 'Tapez pour régler le tempo (du chase, ou de tous les chases en cours)' },
    cuelist_go: { label: 'GO de scène', description: 'Lance, arrête ou avance une scène' },
    cuelist_fader: { label: 'Fader de scène', description: 'Niveau de restitution de la scène' },
    flash: { label: 'Flash de scène', description: 'Scène à fond tant que maintenu' },
    chase_toggle: { label: 'Chase marche / arrêt', description: 'Lance ou arrête un chase' },
    chase_bpm: { label: 'Tempo du chase', description: 'Vitesse du chase (30–300 BPM)' },
    effect_toggle: { label: 'Effet marche / arrêt', description: 'Lance ou arrête un effet (trigger / flash : tant que maintenu)' },
    channel: { label: 'Canal de projecteur', description: 'Un canal d’un projecteur, dans le programmer' },
    timeline_play: { label: 'Timeline lecture / pause', description: 'Lance ou met en pause la timeline' },
    timeline_stop: { label: 'Timeline stop', description: 'Arrête la timeline' },
    timeline_rewind: { label: 'Timeline retour au début', description: 'Revient au début' },
    timeline_goto_marker: { label: 'Aller au repère', description: 'Place la timeline sur un repère' },
    timeline_goto_zone: { label: 'Aller à la section', description: 'Place la timeline au début d’une section' }
  },
  behaviors: {
    direct: { label: 'Direct', description: 'Suit le contrôle (faders, boutons rotatifs) ; GO à l’appui pour les scènes' },
    toggle: { label: 'Bascule', description: 'Un appui = on, nouvel appui = off' },
    trigger: { label: 'Trigger', description: 'Actif tant que maintenu, coupé au relâchement' },
    flash: { label: 'Flash', description: 'À fond tant que maintenu' }
  },
  delete: {
    message: 'Le contrôle de votre appareil MIDI n’aura plus d’effet ici. Vous pourrez revenir en arrière avec Annuler ({keys}).',
    confirm: 'Supprimer le mapping'
  },
  selection: {
    mapping: 'le mapping « {name} »',
    copyName: '{name} (copie)'
  }
}
