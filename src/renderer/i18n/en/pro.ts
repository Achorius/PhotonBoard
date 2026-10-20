// ============================================================
// Pro programming (pro.*) — one file per work package in ./pro/
// (core = shared data layer, cli = command line…). A new work
// package adds its file and ONE line below (and the same in fr/pro.ts).
// Command keywords stay English everywhere (console convention).
// ============================================================

import { core } from './pro/core'
import { cli } from './pro/cli'
import { stage } from './pro/stage'

export const pro = {
  ...core,
  cli,
  stage
}
