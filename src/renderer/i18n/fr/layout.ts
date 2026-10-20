import type { Translation } from '../types'

// Traduction de en/layout.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md
// Vocabulaire de plateau : jardin (stage right) / cour (stage left), lointain (upstage),
// nez de scène (stage edge), axe (centre line), pont (truss bar), accroche (rigging).

export const layout: Translation['layout'] = {
  title: 'Plan de feu',
  metres: '{value} m',
  centimetres: '{value} cm',

  toolbar: {
    addBar: 'Ajouter un pont',
    gridGroup: 'Grille',
    grid: 'Grille',
    gridHint: 'Afficher la grille',
    snap: 'Aimanter',
    snapHint: 'Aimanter à la grille',
    gridSize: 'Pas de la grille',
    zoomGroup: 'Zoom',
    zoomIn: 'Zoom avant',
    zoomOut: 'Zoom arrière',
    fit: 'Ajuster',
    fitHint: 'Afficher toute la salle',
    section: 'Coupe',
    sectionHint: 'Vue en coupe (hauteurs)',
    exportPdf: 'Exporter en PDF',
    exportPdfHint: 'Plan de feu avec la liste du patch (A4)',
    exported: 'Plan de feu exporté',
    exportFailed: 'Échec de l’export PDF'
  },

  empty: {
    title: 'Aucun projecteur patché',
    description: 'Patchez des projecteurs pour les placer sur le plan. Vous pouvez déjà régler la salle et les ponts.',
    action: 'Ajouter des projecteurs'
  },

  inspector: 'Inspecteur',

  multi: {
    title: { one: '{count} projecteur sélectionné', other: '{count} projecteurs sélectionnés' },
    clearSelection: 'Effacer la sélection',
    hangOnBar: 'Accrocher au pont',
    noBars: 'Aucun pont pour l’instant.',
    spreadHint: 'Les répartit régulièrement sur le pont, de gauche à droite.',
    mount: 'Accroche',
    mountAll: 'Accroche de tous les projecteurs sélectionnés',
    setMount: 'Choisir l’accroche...'
  },

  mounts: {
    ceiling: 'Plafond / pont',
    floor: 'Sol',
    wallLeft: 'Mur gauche',
    wallRight: 'Mur droit',
    wallBack: 'Mur du fond'
  },

  actions: {
    flip: 'Pivoter de 180°',
    resetPlacement: 'Réinitialiser le placement',
    resetPlacementEllipsis: 'Réinitialiser le placement...',
    resetTitleOne: 'Réinitialiser le placement de « {name} » ?',
    resetTitleMany: { one: 'Réinitialiser le placement de {count} projecteur ?', other: 'Réinitialiser le placement de {count} projecteurs ?' },
    resetMessage: {
      one: 'Position, accroche et pointage reviennent à la disposition automatique. Le projecteur reste patché.',
      other: 'Position, accroche et pointage reviennent à la disposition automatique. Les projecteurs restent patchés.'
    },
    resetHint: 'Retour à la disposition automatique — le projecteur reste patché'
  },

  fixture: {
    unknownType: 'Type inconnu',
    closeInspector: 'Fermer l’inspecteur',
    position: 'Position',
    xAria: 'Position X (mètres)',
    yAria: 'Hauteur (mètres)',
    zAria: 'Profondeur (mètres)',
    positionHint: 'Mètres depuis le centre du plateau · X + côté jardin · Y hauteur · Z + vers le lointain',
    rigging: 'Accroche',
    mount: 'Accroche',
    trussBar: 'Pont',
    addBarHint: 'Ajoutez un pont dans le plan de feu.',
    notOnBar: 'Hors pont',
    barOption: '{name} · {height}',
    mountingRotation: 'Rotation à l’accroche',
    aim: 'Pointage',
    tilt: 'Tilt',
    tiltAria: 'Tilt (degrés)',
    tiltHintWall: '0° horizontal, + vers le bas',
    tiltHintFloor: '0° vertical vers le haut, + vers le lointain',
    tiltHintCeiling: '0° vertical vers le bas, + vers le lointain',
    direction: 'Orientation',
    directionAria: 'Orientation (degrés)',
    directionHint: 'Rotation autour de l’axe vertical',
    invertPan: 'Inverser le pan',
    invertTilt: 'Inverser le tilt',
    optics: 'Optique',
    beamAngle: 'Ouverture',
    beamAngleAria: 'Angle d’ouverture (degrés)',
    beamAngleHint: 'Celui du type de projecteur',
    useDefinitionBeam: 'Reprendre l’ouverture du type de projecteur',
    reversePixels: 'Inverser l’ordre des pixels',
    renameTitle: 'Renommer le projecteur'
  },

  room: {
    title: 'Salle (mètres)',
    widthShort: 'L',
    depthShort: 'P',
    heightShort: 'H',
    widthAria: 'Largeur de la salle (mètres)',
    depthAria: 'Profondeur de la salle (mètres)',
    heightAria: 'Hauteur de la salle (mètres)',
    stageEdge: 'Nez de scène',
    stageEdgeHint: 'Profondeur du nez de scène (0 = centre)',
    stageEdgeAria: 'Profondeur du nez de scène (mètres)',
    bars: 'Ponts · {count}',
    barsList: 'Ponts',
    noBars: 'Aucun pont pour l’instant. Ajoutez-en un, puis accrochez-y des projecteurs depuis leur inspecteur ou par un appui long.',
    barSubtitle: { one: '{count} projecteur · {length}', other: '{count} projecteurs · {length}' },
    barDepth: 'Z {value}',
    help: 'Sélectionnez un projecteur ou un pont sur le plan pour le modifier. Glissez dans le vide pour déplacer la vue, pincez ou utilisez la molette pour zoomer.'
  },

  /** Default names (show data, written when created) */
  defaults: {
    barName: 'Pont {n}'
  },

  bar: {
    deselect: 'Désélectionner le pont',
    section: 'Pont',
    name: 'Nom',
    depth: 'Profondeur (Z)',
    depthAria: 'Profondeur du pont (mètres)',
    height: 'Hauteur',
    heightAria: 'Hauteur du pont (mètres)',
    length: 'Longueur',
    lengthAria: 'Longueur du pont (mètres)',
    colour: 'Couleur',
    fixturesOnBar: 'Projecteurs sur ce pont · {count}',
    select: 'Sélectionner',
    spread: 'Répartir',
    longPressHint: 'Appui long sur un projecteur du plan pour l’accrocher ici.',
    delete: 'Supprimer le pont',
    deleteEllipsis: 'Supprimer le pont...',
    deleteMessage: 'Les projecteurs accrochés gardent leur position. Vous pouvez annuler avec Annuler ({keys}).',
    duplicate: 'Dupliquer le pont',
    rename: 'Renommer le pont',
    copyName: '{name} (copie)'
  },

  menu: {
    fixtureFallback: 'Projecteur',
    hangOnBar: 'Accrocher au pont',
    hangOnBarSpread: 'Accrocher au pont (répartis)',
    mount: 'Accroche',
    selectOnBar: 'Sélectionner les projecteurs du pont',
    spreadEvenly: 'Répartir les projecteurs régulièrement',
    addBarAt: 'Ajouter un pont à Z {z}',
    fit: 'Afficher tout',
    snap: 'Aimanter à la grille'
  },

  plan: {
    stage: 'PLATEAU',
    audience: 'SALLE',
    centreLine: 'AXE',
    stageEdge: 'NEZ DE SCÈNE',
    floorTag: 'SOL',
    wallTag: 'MUR',
    metreUnit: 'm',
    aria: 'Plan de feu. Glissez les projecteurs pour les déplacer, glissez dans le vide pour déplacer la vue, pincez ou utilisez la molette pour zoomer, appui long pour les actions. Les flèches déplacent la sélection.'
  },

  section: {
    title: 'COUPE · vue depuis cour',
    audience: 'SALLE',
    upstage: 'LOINTAIN',
    aria: 'Vue en coupe : glissez un projecteur vers le haut ou le bas pour changer sa hauteur'
  },

  selection: {
    bar: 'le pont « {name} »',
    placementOne: 'le placement de « {name} »',
    placementMany: { one: 'le placement de {count} projecteur', other: 'le placement de {count} projecteurs' }
  },

  pdf: {
    title: 'Plan de feu',
    summary: 'Salle : {width} × {depth} × {height} m  |  {fixtures}  |  {date}',
    fixtureCount: { one: '{count} projecteur', other: '{count} projecteurs' },
    upstage: 'LOINTAIN',
    audience: 'SALLE',
    legend: {
      par: 'PAR / Wash',
      movingHead: 'Moving head (lyre)',
      fresnel: 'Fresnel',
      strip: 'Barre LED / Rampe',
      profile: 'Découpe'
    },
    scale: 'Échelle : 1 m = {mm} mm',
    patchList: 'Liste du patch',
    columns: {
      number: 'N°',
      name: 'Nom',
      manufacturer: 'Fabricant',
      type: 'Type',
      mode: 'Mode',
      address: 'Adresse',
      channels: 'Can.',
      group: 'Groupe'
    },
    footer: 'Généré par PhotonBoard',
    fileName: 'PlanDeFeu'
  }
}
