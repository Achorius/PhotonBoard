// ============================================================
// PhotonBoard — Main-process messages shown to the operator (native
// dialogs, show file errors, remote save / upload answers), in the
// console UI language: the renderer sends it with app:set-language
// (also used for the native menus). Default English. No electron
// imports: unit-testable.
// ============================================================

export type MainLanguage = 'en' | 'fr'

type Params = Record<string, string | number>

const EN = {
  showFileFilter: 'PhotonBoard show',
  stageWindowTitle: 'PhotonBoard — Stage',
  showExists: 'A show named “{name}” already exists. Choose another name or confirm overwriting it.',
  showExistsUpload: 'A show named “{name}” already exists. Confirm overwriting it, or rename the file.',
  showNotFound: 'No show named “{name}” was found.',
  noFileDialogRemote: 'There is no file dialog in the remote UI — pick a show from the list.',
  saveInProgress: 'Another save is already in progress — try again in a moment.',
  consoleNoAnswer: 'The PhotonBoard console did not answer the save request (is the main window open?).',
  consoleNotRunning: 'The PhotonBoard console window is not running.',
  shuttingDown: 'PhotonBoard is shutting down.',
  notAShowNoData: 'This file is not a PhotonBoard show (no show data inside).',
  notAShowUnknown: 'This file is not a PhotonBoard show (unknown format).',
  damagedKey: 'This show file is damaged: “{key}” has the wrong type.',
  tooLarge: 'This show file is too large ({size} MB, max {max} MB).',
  emptyFile: 'This show file is empty (it may have been cut off by a crash or power loss).',
  invalidJson: 'This show file is damaged and cannot be read (invalid JSON: {detail}).',
  fixtureFilterAll: 'All fixture formats',
  fixtureFilterGdtf: 'GDTF files',
  fixtureFilterQlc: 'QLC+ files',
  fixtureFilterAvo: 'Avolites personalities',
  fixtureFilterXml: 'XML fixtures (grandMA, etc.)',
  fixtureFilterJson: 'JSON (OFL / PhotonBoard)',
  fixtureFilterCsv: 'CSV / TSV',
  allFiles: 'All files',
  usbNotOnStick: 'This file is not on a connected USB stick.',
  usbFull: 'The USB stick is full.',
  usbReadOnly: 'The USB stick is read-only (or write-protected).',
  interchangeFilterAll: 'All supported formats',
  interchangeImportTitle: 'Import a show, patch or fixture file',
  interchangeExportTitle: 'Export the show',
  interchangeExportFixtureTitle: 'Export the fixture type',
  demoNotFound: 'This demo is not available in this installation.'
} as const

export type MainMessageKey = keyof typeof EN

const FR: Record<MainMessageKey, string> = {
  showFileFilter: 'Show PhotonBoard',
  stageWindowTitle: 'PhotonBoard — Stage',
  showExists: 'Un show nommé « {name} » existe déjà. Choisissez un autre nom ou confirmez son remplacement.',
  showExistsUpload: 'Un show nommé « {name} » existe déjà. Confirmez son remplacement ou renommez le fichier.',
  showNotFound: 'Aucun show nommé « {name} » n’a été trouvé.',
  noFileDialogRemote: 'La télécommande n’a pas de fenêtre de fichiers — choisissez un show dans la liste.',
  saveInProgress: 'Un enregistrement est déjà en cours — réessayez dans un instant.',
  consoleNoAnswer: 'La console PhotonBoard n’a pas répondu à la demande d’enregistrement (la fenêtre principale est-elle ouverte ?).',
  consoleNotRunning: 'La fenêtre de la console PhotonBoard n’est pas lancée.',
  shuttingDown: 'PhotonBoard est en train de se fermer.',
  notAShowNoData: 'Ce fichier n’est pas un show PhotonBoard (aucune donnée de show).',
  notAShowUnknown: 'Ce fichier n’est pas un show PhotonBoard (format inconnu).',
  damagedKey: 'Ce fichier de show est endommagé : « {key} » n’a pas le bon type.',
  tooLarge: 'Ce fichier de show est trop gros ({size} Mo, maximum {max} Mo).',
  emptyFile: 'Ce fichier de show est vide (il a peut-être été coupé par un plantage ou une coupure de courant).',
  invalidJson: 'Ce fichier de show est endommagé et illisible (JSON invalide : {detail}).',
  fixtureFilterAll: 'Tous les formats de projecteurs',
  fixtureFilterGdtf: 'Fichiers GDTF',
  fixtureFilterQlc: 'Fichiers QLC+',
  fixtureFilterAvo: 'Personnalités Avolites',
  fixtureFilterXml: 'Projecteurs XML (grandMA, etc.)',
  fixtureFilterJson: 'JSON (OFL / PhotonBoard)',
  fixtureFilterCsv: 'CSV / TSV',
  allFiles: 'Tous les fichiers',
  usbNotOnStick: 'Ce fichier n’est pas sur une clé USB branchée.',
  usbFull: 'La clé USB est pleine.',
  usbReadOnly: 'La clé USB est en lecture seule (ou protégée en écriture).',
  interchangeFilterAll: 'Tous les formats pris en charge',
  interchangeImportTitle: 'Importer un show, un patch ou un projecteur',
  interchangeExportTitle: 'Exporter le show',
  interchangeExportFixtureTitle: 'Exporter le type de projecteur',
  demoNotFound: 'Cette démo n’est pas disponible dans cette installation.'
}

const MESSAGES: Record<MainLanguage, Record<MainMessageKey, string>> = { en: EN, fr: FR }

let language: MainLanguage = 'en'

export function setMainLanguage(lang: unknown): void {
  language = lang === 'fr' ? 'fr' : 'en'
}

export function getMainLanguage(): MainLanguage {
  return language
}

/** A message in the console UI language, `{param}` replaced */
export function mt(key: MainMessageKey, params: Params = {}): string {
  const template = MESSAGES[language][key] ?? EN[key]
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}
