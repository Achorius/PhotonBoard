// Contrôleurs MIDI (pro.midi.*) : profils de contrôleurs dans la vue MIDI
// et retour LED des mappings. Les noms d'appareils ne se traduisent pas.

import type { Translation } from '../../types'

export const midi: Translation['pro']['midi'] = {
  controllers: {
    region: 'Contrôleurs MIDI',
    title: 'Contrôleurs',
    recognised: 'Reconnu : {name}',
    enable: 'Utiliser le profil',
    enableHint: 'Pads, faders et LED suivent les exécuteurs. Vos propres mappings sur un contrôle restent prioritaires.',
    handMapped: 'Désactivé car cet appareil a déjà vos propres mappings. Activez pour leur ajouter le profil.',
    layout: 'Disposition',
    layoutName: {
      'executors-2pages': 'Exécuteurs, 2 pages',
      'executors-busk': 'Exécuteurs + improvisation'
    },
    layoutHint: {
      'executors-2pages': 'Rangées 1 à 4 : page courante · rangées 5 à 8 : page suivante.',
      'executors-busk': 'Rangées 1 à 4 : page courante · puis groupes, presets couleur, presets position, macros.'
    },
    faders: 'Faders',
    pickup: 'Rattrapage',
    jump: 'Saut',
    pickupHint: 'Un fader ne reprend la main qu’en atteignant la valeur actuelle : rien ne saute sur scène.',
    jumpHint: 'Un fader applique sa position immédiatement.',
    rgb: 'Couleurs exactes',
    rgbHint: 'Envoie les couleurs des colonnes en RVB (SysEx) au lieu de la couleur de palette la plus proche.',
    testLeds: 'Tester les LED',
    testing: 'Test en cours…',
    map: 'Plan',
    mapTitle: '{name} : plan du contrôleur',
    noOutput: 'Aucun port de sortie pour les LED : elles restent éteintes.',
    disconnected: 'Déconnecté',
    nanoLedMode: 'Pour les LED, réglez « LED Mode » sur External dans Korg Kontrol Editor.'
  },
  map: {
    hint: 'Touchez un contrôle pour voir ce qu’il fait.',
    notUsed: 'Pas utilisé dans cette disposition',
    userMapping: 'Votre mapping « {name} » prend ce contrôle.',
    shiftThen: 'Avec Shift : {action}',
    control: {
      pad: 'Pad {col}.{row}',
      track: 'Bouton de piste {n}',
      scene: 'Bouton de scène {n}',
      fader: 'Fader {n}',
      encoder: 'Encodeur {n}',
      button: 'Bouton {id}'
    },
    action: {
      executor: 'Exécuteur {page}.{slot} : {name}',
      executorEmpty: 'Exécuteur {page}.{slot} (vide)',
      executorNoPage: 'Exécuteur de la page {page} (cette page n’existe pas encore)',
      selectExecutor: 'en faire la cible de GO / Retour',
      page: 'Page {n}',
      pagePrev: 'Page précédente',
      pageNext: 'Page suivante',
      goSelected: 'GO (exécuteur sélectionné)',
      backSelected: 'Retour (exécuteur sélectionné)',
      releaseAll: 'Release général',
      clear: 'Vider le programmer',
      blackout: 'Blackout',
      blinder: 'Blinder (maintenu)',
      strobe: 'Strobe (maintenu)',
      tap: 'Tap tempo',
      grandMaster: 'Grand Master',
      columnFader: 'Fader de la colonne {n}',
      group: 'Groupe {ref}',
      preset: 'Preset {ref}',
      macro: 'Macro {ref}'
    },
    short: {
      go: 'GO',
      back: 'Retour',
      release: 'Rel.',
      clear: 'Clear',
      blackout: 'B.O.',
      blinder: 'Blind.',
      strobe: 'Strobe',
      tap: 'Tap',
      gm: 'GM',
      prev: 'Pg −',
      next: 'Pg +'
    }
  },
  feedback: {
    label: 'Retour LED',
    off: 'Aucun',
    note: 'Note',
    cc: 'CC',
    hint: 'Renvoie l’état de la cible à l’appareil : LED de pad (note), fader motorisé ou couronne de LED (CC).',
    overridesProfile: 'Ce contrôle fait aussi partie du profil {name} : ce mapping est prioritaire.'
  }
}
