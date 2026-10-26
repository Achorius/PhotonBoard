import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  INSTALLED_TOUCH_HELPER,
  REMAP_TIMEOUT_MS,
  REPORT_TIMEOUT_MS,
  bundledTouchHelperPaths,
  resolveTouchHelper,
  touchRemap,
  touchReport,
  type ExecFileLike
} from './touch-diagnostics'
import { safeTextFileName } from './removable-drives'

const DIRS = { resourcesPath: '/opt/PhotonBoard/resources', appPath: '/repo', mainDir: '/repo/out/main' }
const BUNDLED = '/opt/PhotonBoard/resources/pi/photonboard-map-touch.sh'

type Call = { file: string; args: string[]; timeout: number; display: string | undefined }

/** execFile mock: answers by mode ('--report' or apply) */
function fakeExec(answers: { report?: Parameters<Parameters<ExecFileLike>[3]>; apply?: Parameters<Parameters<ExecFileLike>[3]> }) {
  const calls: Call[] = []
  const exec: ExecFileLike = (file, args, opts, cb) => {
    calls.push({ file, args, timeout: opts.timeout, display: opts.env.DISPLAY })
    const a = args.includes('--report') ? answers.report : answers.apply
    setTimeout(() => cb(...(a ?? [null, '', ''])), 0)
    return undefined
  }
  return { exec, calls }
}

describe('touch helper selection', () => {
  it('prefers the installed helper, run directly', () => {
    expect(resolveTouchHelper(DIRS, () => true)).toEqual({ file: INSTALLED_TOUCH_HELPER, args: [] })
  })

  it('falls back to the shipped copy through bash (packaged, then source tree)', () => {
    expect(bundledTouchHelperPaths(DIRS)).toEqual([
      BUNDLED,
      '/repo/scripts/photonboard-map-touch.sh',
      join('/repo/out/main', '..', '..', 'scripts', 'photonboard-map-touch.sh')
    ])
    expect(resolveTouchHelper(DIRS, (p) => p === BUNDLED)).toEqual({ file: 'bash', args: [BUNDLED] })
    expect(resolveTouchHelper({ appPath: '/repo' }, (p) => p === '/repo/scripts/photonboard-map-touch.sh'))
      .toEqual({ file: 'bash', args: ['/repo/scripts/photonboard-map-touch.sh'] })
    expect(resolveTouchHelper(DIRS, () => false)).toBeNull()
  })

  it('the helper ships with the Linux build as resources/pi/photonboard-map-touch.sh', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))
    const extra = pkg.build.linux.extraResources as { from: string; to: string }[]
    const entry = extra.find((e) => e.to === 'pi/photonboard-map-touch.sh')
    expect(entry?.from).toBe('scripts/photonboard-map-touch.sh')
    expect(existsSync(join(__dirname, '..', '..', entry!.from))).toBe(true)
  })
})

describe('touchReport', () => {
  it('is not supported off Linux (nothing run)', async () => {
    const { exec, calls } = fakeExec({})
    expect(await touchReport({ platform: 'darwin', execFile: exec, exists: () => true })).toEqual({ supported: false, ok: false, text: '' })
    expect(calls).toHaveLength(0)
  })

  it('runs the helper with --report, DISPLAY defaulting to :0, 15 s timeout', async () => {
    const { exec, calls } = fakeExec({ report: [null, 'PhotonBoard touchscreen report\nX running on :0\n', ''] })
    const r = await touchReport({ platform: 'linux', env: { PATH: '/usr/bin' }, dirs: DIRS, exists: (p) => p === BUNDLED, execFile: exec })
    expect(calls).toEqual([{ file: 'bash', args: [BUNDLED, '--report'], timeout: REPORT_TIMEOUT_MS, display: ':0' }])
    expect(r).toEqual({ supported: true, ok: true, text: 'PhotonBoard touchscreen report\nX running on :0' })
  })

  it('keeps the DISPLAY of the session', async () => {
    const { exec, calls } = fakeExec({ report: [null, 'ok', ''] })
    await touchReport({ platform: 'linux', env: { DISPLAY: ':1' }, exists: () => true, execFile: exec })
    expect(calls[0]).toMatchObject({ file: INSTALLED_TOUCH_HELPER, args: ['--report'], display: ':1' })
  })

  it('a failure or timeout is reported in the text, never thrown', async () => {
    const killed = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGKILL' })
    const { exec } = fakeExec({ report: [killed, 'partial output\n', 'xinput: unable to connect\n'] })
    const r = await touchReport({ platform: 'linux', env: {}, exists: () => true, execFile: exec })
    expect(r.supported).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('partial output')
    expect(r.text).toContain('xinput: unable to connect')
    expect(r.text).toMatch(/⚠ .*stopped after 15 s \(timeout\)/)
  })

  it('an execFile that throws synchronously is caught', async () => {
    const exec: ExecFileLike = () => { throw new Error('spawn EACCES') }
    const r = await touchReport({ platform: 'linux', env: {}, exists: () => true, execFile: exec })
    expect(r).toMatchObject({ supported: true, ok: false })
    expect(r.text).toContain('spawn EACCES')
  })

  it('no helper anywhere: a readable warning', async () => {
    const { exec, calls } = fakeExec({})
    const r = await touchReport({ platform: 'linux', env: {}, dirs: DIRS, exists: () => false, execFile: exec })
    expect(calls).toHaveLength(0)
    expect(r).toMatchObject({ supported: true, ok: false })
    expect(r.text).toContain('NONE')
    expect(r.text).toContain(INSTALLED_TOUCH_HELPER)
  })
})

describe('touchRemap', () => {
  it('applies the mapping (no argument, 60 s), waits, then reports', async () => {
    const { exec, calls } = fakeExec({ apply: [null, '', ''], report: [null, 'fresh report', ''] })
    const r = await touchRemap({ platform: 'linux', env: {}, exists: () => true, execFile: exec })
    expect(calls.map((c) => [c.args, c.timeout])).toEqual([[[], REMAP_TIMEOUT_MS], [['--report'], REPORT_TIMEOUT_MS]])
    expect(r).toEqual({ supported: true, ok: true, remapOk: true, text: 'fresh report' })
  })

  it('a failed re-mapping is flagged above the report', async () => {
    const { exec } = fakeExec({ apply: [new Error('exit 1'), '', 'boom'], report: [null, 'fresh report', ''] })
    const r = await touchRemap({ platform: 'linux', env: {}, exists: () => true, execFile: exec })
    expect(r.remapOk).toBe(false)
    expect(r.ok).toBe(true)
    expect(r.text).toMatch(/^⚠ Re-mapping failed: exit 1 — boom\n\nfresh report$/)
  })

  it('concurrent requests share one run; off Linux nothing runs', async () => {
    const { exec, calls } = fakeExec({ apply: [null, '', ''], report: [null, 'r', ''] })
    const deps = { platform: 'linux' as const, env: {}, exists: () => true, execFile: exec }
    const [a, b] = await Promise.all([touchRemap(deps), touchRemap(deps)])
    expect(a).toBe(b)
    expect(calls).toHaveLength(2)
    const spy = vi.fn()
    expect(await touchRemap({ platform: 'win32', execFile: spy })).toEqual({ supported: false, ok: false, text: '' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('safeTextFileName', () => {
  it('accepts plain .txt names only', () => {
    expect(safeTextFileName('PhotonBoard-diagnostic-tactile-2026-10-26-1432.txt')).toBe('PhotonBoard-diagnostic-tactile-2026-10-26-1432.txt')
    for (const bad of ['../x.txt', 'a/b.txt', '.hidden.txt', 'x.sh', 'x.txt/..', '', 42, null, `${'a'.repeat(130)}.txt`, 'a..b.txt']) {
      expect(safeTextFileName(bad)).toBeNull()
    }
  })
})
