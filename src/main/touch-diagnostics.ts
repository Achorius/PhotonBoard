// ============================================================
// PhotonBoard — Touchscreen diagnostic (Linux / Raspberry Pi kiosk)
//
// Settings › Display › Touchscreens runs the touch helper
// (scripts/photonboard-map-touch.sh) so an operator with no terminal
// can see — and photograph or save to a USB stick — what the system
// sees: kernel / udev touch devices, X input drivers, xinput, outputs,
// the mapping plan and recent USB errors.
//
//   report   photonboard-map-touch --report   (read-only, 15 s max)
//   remap    photonboard-map-touch            (re-applies the touch →
//            screen mapping, logs to /tmp/photonboard-touch-map.log,
//            60 s max), then a fresh report
//
// Helper: the installed one (/usr/local/bin, Pi image / .deb) first,
// else the copy shipped with the app (<resources>/pi, run through bash:
// extraResources may not keep the executable bit), else the source tree
// (dev). execFile only (no shell); nothing here ever throws.
// ============================================================

import { execFile as nodeExecFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { TouchReport } from '../shared/photonboard-api'

export const INSTALLED_TOUCH_HELPER = '/usr/local/bin/photonboard-map-touch'
const BUNDLED_NAME = 'photonboard-map-touch.sh'
export const REPORT_TIMEOUT_MS = 15_000
export const REMAP_TIMEOUT_MS = 60_000

export interface HelperDirs {
  /** process.resourcesPath when packaged */
  resourcesPath?: string
  /** app.getAppPath() */
  appPath?: string
  /** __dirname of the main bundle (out/main) */
  mainDir?: string
}

/** Where the shipped copy of the helper can be: packaged resources first, then the source tree */
export function bundledTouchHelperPaths(dirs: HelperDirs): string[] {
  const out: string[] = []
  if (dirs.resourcesPath) out.push(join(dirs.resourcesPath, 'pi', BUNDLED_NAME))
  if (dirs.appPath) out.push(join(dirs.appPath, 'scripts', BUNDLED_NAME))
  if (dirs.mainDir) out.push(join(dirs.mainDir, '..', '..', 'scripts', BUNDLED_NAME))
  return out
}

export interface HelperCommand {
  file: string
  args: string[]
}

/** The command that runs the helper (without its mode argument), or null when there is none */
export function resolveTouchHelper(dirs: HelperDirs, exists: (path: string) => boolean = existsSync): HelperCommand | null {
  if (exists(INSTALLED_TOUCH_HELPER)) return { file: INSTALLED_TOUCH_HELPER, args: [] }
  const bundled = bundledTouchHelperPaths(dirs).find((p) => exists(p))
  return bundled ? { file: 'bash', args: [bundled] } : null
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number; killSignal?: NodeJS.Signals },
  callback: (error: (Error & { code?: unknown; killed?: boolean; signal?: string | null }) | null, stdout: string | Buffer, stderr: string | Buffer) => void
) => unknown

export interface TouchDeps {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  dirs?: HelperDirs
  exists?: (path: string) => boolean
  execFile?: ExecFileLike
}

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  error: string | null
}

function run(cmd: HelperCommand, extra: string[], timeout: number, deps: TouchDeps): Promise<RunResult> {
  const env = deps.env ?? process.env
  const exec = deps.execFile ?? (nodeExecFile as unknown as ExecFileLike)
  return new Promise((done) => {
    try {
      exec(cmd.file, [...cmd.args, ...extra], {
        timeout,
        env: { ...env, DISPLAY: env.DISPLAY || ':0' },
        maxBuffer: 4 * 1024 * 1024,
        killSignal: 'SIGKILL'
      }, (err, stdout, stderr) => {
        const out = String(stdout ?? '')
        const errText = String(stderr ?? '')
        if (!err) { done({ ok: true, stdout: out, stderr: errText, error: null }); return }
        const timedOut = err.killed === true || err.signal === 'SIGKILL' || err.signal === 'SIGTERM'
        done({
          ok: false,
          stdout: out,
          stderr: errText,
          error: timedOut ? `stopped after ${Math.round(timeout / 1000)} s (timeout)` : err.message || String(err)
        })
      })
    } catch (e) {
      done({ ok: false, stdout: '', stderr: '', error: e instanceof Error ? e.message : String(e) })
    }
  })
}

/** The report text: the helper's output, then its errors (if any) */
export function shapeReport(r: RunResult, cmd: HelperCommand): TouchReport {
  const parts = [r.stdout.trimEnd()]
  if (r.stderr.trim()) parts.push(`--- stderr ---\n${r.stderr.trimEnd()}`)
  if (r.error) parts.push(`⚠ ${[cmd.file, ...cmd.args].join(' ')} --report: ${r.error}`)
  return { supported: true, ok: r.ok, text: parts.filter(Boolean).join('\n\n') }
}

function missingHelper(dirs: HelperDirs): TouchReport {
  return {
    supported: true,
    ok: false,
    text: `⚠ Touch helper NONE found: neither ${INSTALLED_TOUCH_HELPER} nor ${bundledTouchHelperPaths(dirs).join(', ') || BUNDLED_NAME}.`
  }
}

/** Full touchscreen diagnostic (read-only) */
export async function touchReport(deps: TouchDeps = {}): Promise<TouchReport> {
  if ((deps.platform ?? process.platform) !== 'linux') return { supported: false, ok: false, text: '' }
  const dirs = deps.dirs ?? {}
  const cmd = resolveTouchHelper(dirs, deps.exists)
  if (!cmd) return missingHelper(dirs)
  return shapeReport(await run(cmd, ['--report'], REPORT_TIMEOUT_MS, deps), cmd)
}

let remapping: Promise<TouchReport> | null = null

/** Re-apply the touch → screen mapping (waits for it), then a fresh report */
export function touchRemap(deps: TouchDeps = {}): Promise<TouchReport> {
  if ((deps.platform ?? process.platform) !== 'linux') return Promise.resolve({ supported: false, ok: false, text: '' })
  if (remapping) return remapping
  remapping = (async () => {
    try {
      const dirs = deps.dirs ?? {}
      const cmd = resolveTouchHelper(dirs, deps.exists)
      if (!cmd) return { ...missingHelper(dirs), remapOk: false }
      const applied = await run(cmd, [], REMAP_TIMEOUT_MS, deps)
      const report = shapeReport(await run(cmd, ['--report'], REPORT_TIMEOUT_MS, deps), cmd)
      if (applied.ok) return { ...report, remapOk: true }
      const why = [applied.error, applied.stderr.trim()].filter(Boolean).join(' — ')
      return { ...report, remapOk: false, text: `⚠ Re-mapping failed: ${why}\n\n${report.text}` }
    } catch (e) {
      return { supported: true, ok: false, remapOk: false, text: `⚠ ${e instanceof Error ? e.message : String(e)}` }
    } finally {
      remapping = null
    }
  })()
  return remapping
}
