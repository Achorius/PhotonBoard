import type { Translation } from '../types'

// Traduction de en/visualizer.ts — mêmes clés (TypeScript vérifie). Termes : ../GLOSSARY.md

export const visualizer: Translation['visualizer'] = {
  title: 'Visualiseur 3D',

  crash: {
    title: 'La vue 3D a planté',
    fallback: 'Le moteur 3D s’est arrêté de façon inattendue.',
    retry: 'Réessayer',
    openLayout: 'Ouvrir le plan de feu'
  },

  canvas: {
    unsupportedTitle: 'La 3D n’est pas disponible ici',
    unsupportedText: 'Cet appareil n’a pas pu démarrer WebGL. Le plan de feu montre la même implantation en 2D.',
    unsupportedTextError: 'Cet appareil n’a pas pu démarrer WebGL ({error}). Le plan de feu montre la même implantation en 2D.',
    lostTitle: 'La vue 3D a été interrompue',
    lostText: 'Le contexte graphique a été perdu (réinitialisation du GPU ou mémoire saturée). Redémarrez la vue 3D pour continuer.',
    restart: 'Redémarrer la 3D'
  },

  camera: {
    group: 'Caméra',
    perspective: 'Persp.',
    perspectiveHint: 'Vue en perspective',
    front: 'Face',
    frontHint: 'Depuis la salle',
    top: 'Dessus',
    topHint: 'Vue en plan, de dessus',
    side: 'Côté',
    sideHint: 'Depuis cour'
  },

  show: {
    group: 'Afficher',
    beams: 'Faisceaux',
    beamsHint: 'Afficher les cônes de faisceau',
    haze: 'Brume',
    hazeHint: 'Air brumé : faisceaux lumineux (désactivé : air pur)',
    walls: 'Murs',
    wallsHint: 'Murs et plafond',
    grid: 'Grille',
    gridHint: 'Grille au sol (1 m)',
    labels: 'Numéros',
    labelsHint: 'Numéros des projecteurs',
    shadows: 'Ombres',
    shadowsHint: 'Ombres en temps réel (gourmand pour le GPU)',
    shadowsNeedQuality: 'Les ombres demandent la qualité Moyenne ou Haute'
  },

  quality: {
    group: 'Qualité',
    label: 'Qualité du rendu',
    low: 'Basse',
    lowHint: 'Basse — 20 fps, résolution réduite, pas de vraies sources',
    medium: 'Moy.',
    mediumHint: 'Moyenne — 30 fps, 4 vraies sources',
    high: 'Haute',
    highHint: 'Haute — jusqu’à 60 fps, pleine résolution, 10 vraies sources',
    fpsHint: 'Images rendues par seconde — la vue ne se redessine que lorsque quelque chose change',
    idle: 'repos'
  },

  toolbar: {
    inspector: 'Inspecteur',
    inspectorHint: 'Inspecteur du projecteur',
    room: 'Salle',
    fullScreen: 'Plein écran',
    exitFullScreen: 'Quitter le plein écran'
  },

  room: {
    title: 'Salle (mètres)',
    houseLights: 'Lumière salle'
  },

  empty: {
    title: 'Aucun projecteur patché',
    description: 'Les projecteurs patchés apparaissent ici avec leurs faisceaux en direct.',
    action: 'Ajouter des projecteurs'
  },

  zoomIn: 'Zoom avant',
  zoomOut: 'Zoom arrière',
  hintTouch: 'Glisser pour tourner · pincer pour zoomer · deux doigts pour déplacer · toucher un projecteur pour le sélectionner, deux fois pour le cadrer',
  hintMouse: 'Glisser pour tourner · molette pour zoomer · clic droit glissé pour déplacer · cliquer un projecteur pour le sélectionner, double-clic pour le cadrer',

  quick: {
    region: 'Projecteurs sélectionnés',
    colourPresets: 'Couleurs rapides',
    colours: {
      red: 'Rouge',
      amber: 'Ambre',
      yellow: 'Jaune',
      green: 'Vert',
      cyan: 'Cyan',
      blue: 'Bleu',
      magenta: 'Magenta',
      warmWhite: 'Blanc chaud',
      white: 'Blanc'
    },
    selectGroup: 'Sélectionner {name} ({count})',
    clearSelection: 'Effacer la sélection',
    hide: 'Masquer les commandes rapides',
    show: 'Afficher les commandes rapides',
    noChannels: 'Aucun canal dimmer, pan, tilt ou zoom sur {name}.',
    sliders: {
      dim: 'Dim',
      pan: 'Pan',
      tilt: 'Tilt',
      zoom: 'Zoom'
    },
    sliderAria: '{label} des projecteurs sélectionnés'
  }
}
