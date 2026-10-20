// Vue Pools (pro.pools.*) : presets, groupes, macros, masters de vitesse.
// Les mots-clés de la ligne de commande dans les macros restent en anglais.

import type { Translation } from '../../types'

export const pools: Translation['pro']['pools'] = {
  nav: {
    pools: { label: 'Pools', title: 'Pools : presets, groupes, macros, masters de vitesse' },
    stage: { label: 'Stage', title: 'Pages Stage' }
  },
  title: 'Pools',
  tabsAria: 'Pools',
  tabs: {
    presets: 'Presets',
    groups: 'Groupes',
    macros: 'Macros',
    speed: 'Masters de vitesse'
  },
  families: {
    intensity: 'Dimmer',
    position: 'Position',
    gobo: 'Gobo',
    color: 'Couleur',
    beam: 'Faisceau',
    focus: 'Focus',
    control: 'Contrôle',
    full: 'Tout'
  },
  familyAria: 'Presets {family}',
  selection: { zero: 'Aucune sélection', one: '{count} projecteur sélectionné', other: '{count} projecteurs sélectionnés' },
  emptySlot: 'Emplacement {ref} vide',
  emptySlotHint: 'Touchez pour mémoriser ici',
  scope: {
    selective: 'Sélectif',
    selectiveHint: 'Valeurs de ces projecteurs uniquement',
    global: 'Global',
    globalHint: 'Valeurs par type de projecteur',
    universal: 'Universel',
    universalHint: 'Tout projecteur qui a ces attributs',
    short: { selective: 'SÉL', global: 'GLO', universal: 'UNI' }
  },
  hint: {
    presets: 'Touchez un preset pour l’appliquer à la sélection. Touchez + pour y mémoriser le programmer ; clic droit ou appui long sur une case pour plus d’actions.',
    groups: 'Touchez un groupe pour sélectionner ses projecteurs. Touchez + pour mémoriser la sélection comme groupe.',
    macros: 'Touchez une macro pour la lancer. Une macro est une liste de lignes de commande avec des attentes.',
    speed: 'Les chases, effets et scènes liés à un master de vitesse suivent son tempo. Tapez pour donner le temps.'
  },
  menu: {
    apply: 'Appliquer à la sélection',
    select: 'Sélectionner les projecteurs',
    store: 'Mémoriser ici',
    storeHint: 'Depuis le programmer',
    storeSelection: 'Mémoriser la sélection ici',
    merge: 'Fusionner',
    mergeHint: 'Ajouter à son contenu',
    overwrite: 'Remplacer',
    overwriteHint: 'Remplacer son contenu',
    update: 'Mettre à jour',
    updateHint: 'Ses valeurs depuis le programmer',
    label: 'Nommer…',
    colour: 'Couleur…',
    renumber: 'Renuméroter…',
    edit: 'Modifier…',
    run: 'Lancer',
    stop: 'Arrêter',
    assign: 'Affecter à un exécuteur…',
    delete: 'Supprimer'
  },
  ask: {
    storeTitle: 'Le preset {ref} contient déjà des valeurs',
    storeMessage: 'Fusionner le programmer avec son contenu, ou remplacer ses valeurs ?'
  },
  dialog: {
    labelTitle: 'Nommer {what}',
    labelField: 'Nom',
    renumberTitle: 'Renuméroter {what}',
    renumberField: 'Numéro',
    renumberMessage: 'Un objet qui a déjà ce numéro prend l’ancien.',
    renumberInvalid: 'Saisissez un nombre entier de 1 à {max}',
    colourTitle: 'Couleur de {what}',
    noColour: 'Sans couleur'
  },
  sel: {
    preset: 'le preset {ref} « {name} »',
    presetNoName: 'le preset {ref}',
    group: 'le groupe {n} « {name} »',
    macro: 'la macro {n} « {name} »',
    speed: 'le master de vitesse {n} « {name} »'
  },
  defaults: {
    group: 'Groupe {n}',
    macro: 'Macro {n}',
    speed: 'Vitesse {n}'
  },
  undo: {
    storePreset: 'Mémoriser le preset {ref}',
    updatePreset: 'Mettre à jour le preset {ref}',
    storeGroup: 'Mémoriser le groupe {n}',
    newMacro: 'Nouvelle macro {n}',
    editMacro: 'Modifier {what}',
    newSpeed: 'Nouveau master de vitesse {n}',
    label: 'Nommer {what}',
    colour: 'Colorer {what}',
    renumber: 'Renuméroter {what}',
    link: 'Lier à {what}',
    assign: 'Affecter {what}'
  },
  toast: {
    selectFirst: 'Sélectionnez d’abord des projecteurs',
    selectFirstHint: 'Les presets s’appliquent aux projecteurs sélectionnés.',
    storeGroupHint: 'Un groupe mémorise les projecteurs sélectionnés.',
    presetNothing: '{what} n’a rien pour les projecteurs sélectionnés',
    nothingToStore: 'Le programmer n’a rien pour ce preset',
    nothingToStoreHint: 'Réglez d’abord des valeurs {family} sur les projecteurs sélectionnés.',
    nothingToUpdate: 'Rien à mettre à jour',
    nothingToUpdateHint: 'Le programmer ne contient aucune des valeurs de ce preset.',
    stored: 'Mémorisé : {what}',
    updated: 'Mis à jour : {what}',
    groupEmpty: 'Ce groupe n’a aucun projecteur',
    macroEmpty: 'Cette macro n’a encore aucune commande'
  },
  groups: {
    emptyPatchTitle: 'Aucun projecteur patché',
    emptyPatchDescription: 'Les groupes contiennent des projecteurs : patchez-en d’abord.',
    openPatch: 'Ouvrir le patch',
    current: 'Sélectionné'
  },
  macros: {
    lines: { zero: 'Aucune ligne', one: '{count} ligne', other: '{count} lignes' },
    running: 'En cours'
  },
  macroEditor: {
    title: 'Macro {n}',
    name: 'Nom',
    namePlaceholder: 'Macro {n}',
    lines: 'Lignes',
    command: 'Ligne de commande {n}',
    commandPlaceholder: 'Fixture 1 Thru 4 At 50',
    wait: 'Attente',
    waitAria: 'Attente après la ligne {n} (secondes)',
    addLine: 'Ajouter une ligne',
    removeLine: 'Retirer la ligne {n}',
    moveUp: 'Monter la ligne {n}',
    moveDown: 'Descendre la ligne {n}',
    emptyTitle: 'Aucune ligne',
    emptyDescription: 'Chaque ligne est une ligne de commande (mots-clés anglais), exécutée dans l’ordre. Attente = secondes avant la ligne suivante.',
    saveAndRun: 'Enregistrer et lancer',
    stop: 'Arrêter'
  },
  speed: {
    bpm: 'Tempo',
    bpmAria: 'Tempo de {what}',
    tap: 'Tap',
    tapAria: 'Taper le tempo de {what}',
    linked: { zero: 'Rien ne le suit', one: '{count} objet le suit', other: '{count} objets le suivent' },
    link: 'Lier',
    linkAria: 'Objets qui suivent {what}',
    chases: 'Chases',
    effects: 'Effets',
    scenes: 'Scènes',
    noObjects: 'Aucune scène, aucun chase ni effet dans le show',
    unlink: 'Ne plus suivre',
    half: 'Moitié du tempo',
    double: 'Double tempo',
    halfShort: '/2',
    doubleShort: 'x2'
  },
  assign: {
    title: 'Affecter {what} à un exécuteur',
    page: 'Page',
    slot: 'Exécuteur {page}.{slot}',
    free: 'Libre',
    done: 'Affecté à l’exécuteur {page}.{slot}'
  }
}
