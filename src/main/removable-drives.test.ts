import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  RemovableWatcher, copyFileName, driveOf, isInsideDrive, listMountPoints, listRemovableDrives, removableRoots, scanDriveShows
} from './removable-drives'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pb-usb-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function stick(name: string, files: string[]): string {
  const d = join(root, name)
  for (const f of files) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), '{}')
  }
  mkdirSync(d, { recursive: true })
  return d
}

describe('removable drive roots', () => {
  it('Pi image, desktop Linux, macOS', () => {
    expect(removableRoots('linux', 'photonboard')).toEqual(['/media/photonboard', '/run/media/photonboard'])
    expect(removableRoots('linux', 'frank')).toEqual(['/media/photonboard', '/media/frank', '/run/media/frank'])
    expect(removableRoots('darwin', 'frank')).toEqual(['/Volumes'])
    expect(removableRoots('win32', 'x')).toEqual([])
  })
})

describe('shows on a stick', () => {
  it('top level and one folder deep, never deeper, never hidden / system files', async () => {
    const d = stick('KEY', [
      'Concert.pbshow', 'notes.txt', '._Concert.pbshow', 'Shows/Festival.PBSHOW', 'Shows/Old/Deep.pbshow',
      'System Volume Information/x.pbshow', '.Trashes/y.pbshow'
    ])
    utimesSync(join(d, 'Shows/Festival.PBSHOW'), new Date(2030, 0, 1), new Date(2030, 0, 1))
    const shows = await scanDriveShows(d)
    expect(shows.map((s) => s.relPath)).toEqual(['Shows/Festival.PBSHOW', 'Concert.pbshow']) // newest first
    expect(shows[1]).toMatchObject({ name: 'Concert', path: join(d, 'Concert.pbshow') })
  })

  it('lists drives (folders on another device only, unless told otherwise), skipping symlinks', async () => {
    stick('KEY', ['A.pbshow'])
    stick('EMPTY', [])
    symlinkSync('/', join(root, 'Macintosh HD'))
    expect(await listMountPoints([root])).toEqual([]) // same device: not mounted
    expect(await listMountPoints([root], undefined, false)).toEqual([join(root, 'EMPTY'), join(root, 'KEY')])
    const drives = await listRemovableDrives([root, join(root, 'missing')], undefined, false)
    expect(drives.map((d) => [d.name, d.shows.length])).toEqual([['EMPTY', 0], ['KEY', 1]])
  })

  it('paths are checked against the drives (no file outside a stick is touched)', () => {
    const drives = [{ name: 'KEY', path: '/media/photonboard/KEY', shows: [], canEject: true }]
    expect(isInsideDrive('/media/photonboard/KEY/a.pbshow', drives)).toBe(true)
    expect(isInsideDrive('/media/photonboard/KEY/../../../etc/passwd', drives)).toBe(false)
    expect(isInsideDrive('/media/photonboard/KEY', drives)).toBe(false)
    expect(isInsideDrive('/media/photonboard/KEYX/a', drives)).toBe(false)
    expect(driveOf('/media/photonboard/KEY', drives)?.name).toBe('KEY')
    expect(driveOf('/media/photonboard/KEY/Shows', drives)?.name).toBe('KEY')
    expect(driveOf('/tmp', drives)).toBeNull()
  })

  it('copy file names are safe on FAT', () => {
    expect(copyFileName('Concert 2026')).toBe('Concert 2026.pbshow')
    expect(copyFileName('a/b:c*?')).toBe('a_b_c_.pbshow')
    expect(copyFileName('..')).toBe('Show.pbshow')
  })
})

describe('watcher', () => {
  it('reports a stick plugged and removed', async () => {
    const seen: string[][] = []
    const w = new RemovableWatcher([root], (d) => seen.push(d.map((x) => `${x.name}:${x.shows.length}`)), { requireMount: false })
    await w.tick()
    stick('KEY', ['A.pbshow', 'B.pbshow'])
    await w.tick()
    await w.tick() // no change: no event
    rmSync(join(root, 'KEY'), { recursive: true })
    await w.tick()
    expect(seen).toEqual([['KEY:2'], []])
  })
})
