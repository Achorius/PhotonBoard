// ============================================================
// Pro programming (pro.*) — one file per work package in ./pro/
// (core = shared data layer, cli = command line…). A new work
// package adds its file and ONE line below (and the same in fr/pro.ts).
// Command keywords stay English everywhere (console convention).
// ============================================================

import { core } from './pro/core'
import { cli } from './pro/cli'
import { programmer } from './pro/programmer'
import { programmerUi } from './pro/programmer-ui'
import { cliUi } from './pro/cli-ui'
import { scenes } from './pro/scenes'
import { pools } from './pro/pools'
import { midi } from './pro/midi'

export const pro = {
  ...core,
  cli,
  // pro.programmer.* = engine undo/default names (programmer.ts) + Pro UI strings (programmer-ui.ts)
  programmer: { ...programmer, ...programmerUi },
  cliUi,
  scenes,
  pools,
  midi
}
