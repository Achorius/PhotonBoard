// ============================================================
// PhotonBoard — Pro programming layer start-up (App.tsx, once)
//
//   - programmer engine loaded (park, group masters, Blind preview,
//     Highlight, programmer fades only apply once it is imported)
//   - command line context: the real ProApi, the UI's t(), Date.now.
//     A remote browser gets it too (preview, autocomplete, the read
//     model of its synced show); the lines it RUNS go to the console
//     ('cli' command, components/cli/run.ts).
//   - console: column fader values published (pro-store.columnFaders)
//     and stable object numbers for objects created at runtime
//     (patch / groups / scenes…), so `Fixture 12` works on a fixture
//     patched a second ago.
// Nothing here changes how a show plays: Pro mode is a UI preference.
// ============================================================

import { t } from '@renderer/i18n'
import { setCliContext } from '@renderer/lib/cli'
import { isRemoteMode } from '@renderer/lib/runtime'
import { usePatchStore } from '@renderer/stores/patch-store'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useEffectsStore } from '@renderer/stores/effects-store'
import { ensureObjectNumbers, usePoolStore } from '@renderer/stores/pool-store'
import '@renderer/lib/pro/programmer-engine'
import { getProApi } from './api'
import { startColumnFaderSync } from './column-fader-sync'

const needsNumber = (list: readonly { number?: number }[]) => list.some((x) => !x.number)

/** Number objects created at runtime (synchronously, inside the same undo step as their creation) */
export function startObjectNumbering(): () => void {
  let busy = false
  const check = (missing: boolean) => {
    if (!missing || busy) return
    busy = true
    try { ensureObjectNumbers() } finally { busy = false }
  }
  const unsubs = [
    usePatchStore.subscribe((s, p) => {
      if (s.patch !== p.patch || s.groups !== p.groups) check(s.patch.some((e) => !e.fid) || needsNumber(s.groups))
    }),
    usePlaybackStore.subscribe((s, p) => {
      if (s.presets !== p.presets || s.cuelists !== p.cuelists || s.chases !== p.chases) {
        check(needsNumber(s.presets) || needsNumber(s.cuelists) || needsNumber(s.chases))
      }
    }),
    useEffectsStore.subscribe((s, p) => { if (s.effects !== p.effects) check(needsNumber(s.effects)) }),
    usePoolStore.subscribe((s, p) => {
      if (s.macros !== p.macros || s.speedMasters !== p.speedMasters) check(needsNumber(s.macros) || needsNumber(s.speedMasters))
    })
  ]
  return () => { for (const u of unsubs) u() }
}

let stop: (() => void) | null = null

/** Wire the pro layer (idempotent). Returns a stop function. */
export function installPro(): () => void {
  if (stop) return stop
  setCliContext({ api: getProApi(), t, now: Date.now })
  const offs: (() => void)[] = []
  if (!isRemoteMode()) {
    offs.push(startColumnFaderSync())
    offs.push(startObjectNumbering())
  }
  stop = () => {
    for (const off of offs) off()
    setCliContext(null)
    stop = null
  }
  return stop
}
