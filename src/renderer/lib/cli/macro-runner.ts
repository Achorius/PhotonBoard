// ============================================================
// PhotonBoard — Command line: macro runner
//
// A macro = command lines run one after the other; `wait` seconds after
// a line delay the next one (a wait on the last line keeps the macro
// "running" until it elapses). A failing line is logged and the macro
// goes on (a show must not stop on a typo).
//
//   - cancellable: stop(id) ("Off Macro 3"), also from inside itself
//   - no self-recursion: a running macro never starts again (a line
//     "Macro 3" inside macro 3 is refused) and nested macros stop at
//     MAX_MACRO_DEPTH
//   - the clock is injectable (tests drive waits by hand)
//
// Lines are read when the macro starts: editing a running macro does
// not change the run in progress.
// ============================================================

import type { Macro } from '@shared/types'

export interface MacroClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realClock: MacroClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>)
}

/** Nested macros (a macro line starting another macro) stop here */
export const MAX_MACRO_DEPTH = 8

export type MacroLineRunner = (command: string, macroId: string) => unknown

export interface MacroRunnerDeps {
  getMacros(): readonly Macro[]
  runLine: MacroLineRunner
  clock?: MacroClock
}

export interface MacroRunner {
  /**
   * Start a macro (id or number; looked up in `macros`, default deps.getMacros()).
   * False when missing, already running or nested too deep.
   */
  run(idOrNumber: string | number, runLine?: MacroLineRunner, macros?: readonly Macro[]): boolean
  stop(id: string): void
  stopAll(): void
  isRunning(id: string): boolean
  /** Ids of the running macros */
  running(): string[]
  setClock(clock: MacroClock): void
}

export function findMacro(macros: readonly Macro[], idOrNumber: string | number): Macro | undefined {
  return typeof idOrNumber === 'number' ? macros.find(m => m.number === idOrNumber) : macros.find(m => m.id === idOrNumber)
}

export function createMacroRunner(deps: MacroRunnerDeps): MacroRunner {
  let clock = deps.clock ?? realClock
  const running = new Map<string, { cancel: () => void }>()
  let depth = 0

  const run = (idOrNumber: string | number, runLine: MacroLineRunner = deps.runLine, macros?: readonly Macro[]): boolean => {
    const macro = findMacro(macros ?? deps.getMacros(), idOrNumber)
    if (!macro || running.has(macro.id) || depth >= MAX_MACRO_DEPTH) return false
    const lines = macro.lines.map(l => ({ command: l.command, wait: l.wait }))
    const runClock = clock
    let cancelled = false
    let timer: unknown = null
    const entry = {
      cancel: () => {
        cancelled = true
        if (timer !== null) runClock.clearTimeout(timer)
        timer = null
      }
    }
    running.set(macro.id, entry)
    const finish = () => {
      if (running.get(macro.id) === entry) running.delete(macro.id)
    }
    const step = (start: number) => {
      timer = null
      for (let i = start; i < lines.length; i++) {
        if (cancelled) return finish()
        depth++
        try {
          runLine(lines[i].command, macro.id)
        } catch (e) {
          console.error('[CLI] macro line failed:', e)
        } finally {
          depth--
        }
        if (cancelled) return finish()
        const wait = Math.max(0, Number.isFinite(lines[i].wait) ? (lines[i].wait as number) : 0) * 1000
        if (wait > 0) {
          timer = runClock.setTimeout(() => step(i + 1), wait)
          return
        }
      }
      finish()
    }
    step(0)
    return true
  }

  return {
    run,
    stop(id) {
      running.get(id)?.cancel()
      running.delete(id)
    },
    stopAll() {
      for (const [id, r] of [...running]) { r.cancel(); running.delete(id) }
    },
    isRunning: id => running.has(id),
    running: () => [...running.keys()],
    setClock(c) { clock = c }
  }
}
