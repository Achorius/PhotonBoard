// ============================================================
// English dictionary — the SOURCE OF TRUTH for keys.
// One file per area in ./en/ (owned by that area's translator);
// fr.ts must mirror this shape exactly (TypeScript checks it).
// Rules: ../components/ui/README.md §7 · terms: ./GLOSSARY.md
// ============================================================

import { common } from './en/common'
import { units } from './en/units'
import { ui } from './en/ui'
import { errors } from './en/errors'
import { shell } from './en/shell'
import { shortcuts } from './en/shortcuts'
import { edit } from './en/edit'
import { file } from './en/file'
import { settings } from './en/settings'
import { stage } from './en/stage'
import { remote } from './en/remote'
import { patch } from './en/patch'
import { fixtures } from './en/fixtures'
import { effects } from './en/effects'
import { scenes } from './en/scenes'
import { timeline } from './en/timeline'
import { visualizer } from './en/visualizer'
import { layout } from './en/layout'
import { midi } from './en/midi'
import { follow } from './en/follow'
import { pro } from './en/pro'

export const en = {
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
  pro
}
