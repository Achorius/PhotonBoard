// ============================================================
// Dictionnaire français — même forme que en.ts (TypeScript refuse
// une clé manquante ou en trop). Un fichier par domaine dans ./fr/.
// Termes et typographie : ./GLOSSARY.md
// ============================================================

import type { Translation } from './types'
import { common } from './fr/common'
import { units } from './fr/units'
import { ui } from './fr/ui'
import { errors } from './fr/errors'
import { shell } from './fr/shell'
import { shortcuts } from './fr/shortcuts'
import { edit } from './fr/edit'
import { file } from './fr/file'
import { settings } from './fr/settings'
import { stage } from './fr/stage'
import { remote } from './fr/remote'
import { patch } from './fr/patch'
import { fixtures } from './fr/fixtures'
import { effects } from './fr/effects'
import { scenes } from './fr/scenes'
import { timeline } from './fr/timeline'
import { visualizer } from './fr/visualizer'
import { layout } from './fr/layout'
import { midi } from './fr/midi'
import { follow } from './fr/follow'
import { pro } from './fr/pro'
import { interchange } from './fr/interchange'

export const fr: Translation = {
  common,
  units,
  ui,
  errors,
  shell,
  shortcuts,
  edit,
  file,
  settings,
  stage,
  remote,
  patch,
  fixtures,
  effects,
  scenes,
  timeline,
  visualizer,
  layout,
  midi,
  follow,
  pro,
  interchange
}
