import type { Translation } from '../types'

export const file: Translation['file'] = {
  defaultShowName: 'Nouveau show',
  busy: 'Occupé — une autre opération sur le show est en cours',
  ops: {
    save: 'Enregistrement',
    saveAs: 'Enregistrer sous',
    open: 'Ouverture',
    newShow: 'Nouveau show',
    autoLoad: 'Chargement automatique',
    upload: 'Envoi'
  },
  canceled: '{op} : annulé',
  failed: '{op} : échec — {error}',
  saving: 'Enregistrement…',
  savingAs: 'Enregistrer sous…',
  saved: '{name} enregistré',
  opening: 'Ouverture…',
  openingName: 'Ouverture de {name}…',
  uploading: 'Envoi du show…',
  loaded: '{name} chargé',
  loadedWithWarning: '{name} chargé — {warning}',
  loadedWithWarnings: { one: '{name} chargé — {warning} (+{count} autre)', other: '{name} chargé — {warning} (+{count} autres)' },
  newShowDone: 'Nouveau show',
  remoteShowLoaded: 'Show chargé : {name}',
  remoteShowRefused: 'Show envoyé à distance refusé : {error}',
  errors: {
    unknown: 'Erreur inconnue',
    notConnected: 'Non connecté',
    unreadable: 'Le fichier n’a pas pu être lu',
    exists: 'Un show porte déjà ce nom',
    notWritten: 'Le show n’a pas pu être écrit',
    remoteOpen: 'Choisissez un show dans la liste ou envoyez un fichier depuis la télécommande',
    remoteNew: 'Nouveau show n’est disponible que sur la console',
    consoleNoShow: 'La console n’a pas envoyé son show'
  },
  unsaved: {
    title: 'Enregistrer les modifications de « {name} » ?',
    newShow: 'Vos modifications seront perdues si vous créez un nouveau show sans enregistrer.',
    openShow: 'Vos modifications seront perdues si vous ouvrez un autre show sans enregistrer.',
    openNamed: 'Vos modifications seront perdues si vous ouvrez « {name} » sans enregistrer.',
    replaceConsole: 'Vos modifications seront perdues si vous remplacez le show de la console sans enregistrer.',
    quit: 'Vos modifications seront perdues si vous quittez sans enregistrer.',
    dontSave: 'Ne pas enregistrer',
    save: 'Enregistrer'
  },
  saveAsDialog: {
    title: 'Enregistrer le show sous',
    label: 'Nom du show',
    invalidName: 'Un nom de show ne peut pas contenir \\ / : * ? " < > |'
  },
  replace: {
    title: 'Remplacer « {name} » ?',
    message: 'Un show porte déjà ce nom sur la console. Le remplacement est définitif.',
    consoleTitle: 'Remplacer le show de la console ?',
    action: 'Remplacer'
  },
  usb: {
    title: 'Clé USB',
    detected: 'Clé USB détectée : {name}',
    detectedShows: { one: '{count} show dessus', other: '{count} shows dessus' },
    detectedNoShow: 'Aucun show dessus',
    none: 'Aucune clé USB branchée',
    noneHint: 'Branchez une clé USB (FAT32, exFAT ou NTFS). Elle apparaît ici en quelques secondes.',
    noShows: 'Aucun show (.pbshow) sur cette clé (racine et dossiers de premier niveau).',
    open: 'Ouvrir',
    openHint: 'Le show est copié dans le dossier des shows de la console puis ouvert : la clé peut ensuite être retirée.',
    browse: 'Parcourir la clé…',
    saveCopy: 'Enregistrer une copie sur la clé USB',
    eject: 'Éjecter',
    ejecting: 'Éjection de {name}…',
    ejected: '{name} peut être retirée en toute sécurité',
    ejectFailed: 'Impossible d’éjecter {name} : {error}',
    copied: 'Copie de {name} enregistrée sur {drive}',
    copyFailed: 'La copie n’a pas pu être enregistrée : {error}',
    replaceTitle: 'Remplacer le show « {name} » sur la console ?',
    replaceMessage: 'Un show de ce nom est déjà dans le dossier des shows. Celui de la clé le remplace (sa version précédente est gardée en sauvegarde).',
    replaceCopyTitle: 'Remplacer « {name} » sur la clé ?',
    replaceCopyMessage: 'Un show de ce nom est déjà sur {drive}.',
    modified: 'Modifié le {date}'
  }
}
