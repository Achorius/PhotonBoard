import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ShowFileManager } from './show-file'
import type { ShowFile } from '../shared/types'

let root: string
let userData: string
let shows: string

function makeShow(name: string, patchCount = 1): ShowFile {
  return {
    version: '1.0.0', name, createdAt: '', modifiedAt: '', artnetConfig: [],
    patch: Array.from({ length: patchCount }, (_, i) => ({ id: `p${i}` })) as any,
    groups: [], presets: [], cuelists: [], chases: [], effects: [], midiMappings: [],
    stageLayout: { width: 1, height: 1, fixtures: [] }
  }
}

function manager(): ShowFileManager {
  return new ShowFileManager(userData, { documentsShowsPath: shows })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pb-show-'))
  userData = join(root, 'userData')
  shows = join(root, 'Documents', 'PhotonBoard')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('ShowFileManager save/load', () => {
  it('saves atomically, keeps a .bak and records the current path', async () => {
    const m = manager()
    const path = join(shows, 'Gig.pbshow')
    expect((await m.saveAs(makeShow('v1'), path)).success).toBe(true)
    expect((await m.saveAs(makeShow('v2'), path)).success).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8')).name).toBe('v2')
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf-8')).name).toBe('v1')
    expect(m.getCurrentPath()).toBe(path)
    expect(m.getRecent()).toEqual([path])
    // recent.json survives a restart
    expect(manager().getRecent()).toEqual([path])
  })

  it('returns a readable error for invalid JSON and does not change the current file', async () => {
    const m = manager()
    const good = join(shows, 'Good.pbshow')
    await m.saveAs(makeShow('good'), good)
    const bad = join(shows, 'Bad.pbshow')
    writeFileSync(bad, '{ not json')
    const r = await m.load(bad)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/damaged/)
    expect(m.getCurrentPath()).toBe(good)
  })

  it('rejects a JSON file that is not a show', async () => {
    const m = manager()
    const f = join(shows, 'Other.pbshow')
    writeFileSync(f, '{"hello":"world"}')
    const r = await m.load(f)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not a PhotonBoard show/)
  })

  it('save without a current file asks for Save As', async () => {
    const r = await manager().save(makeShow('x'))
    expect(r).toMatchObject({ success: false, needsSaveAs: true })
  })

  it('refuses to save non-show data', async () => {
    const r = await manager().saveAs([] as any, join(shows, 'x.pbshow'))
    expect(r.success).toBe(false)
    expect(existsSync(join(shows, 'x.pbshow'))).toBe(false)
  })
})

describe('ShowFileManager.loadLastShow', () => {
  it('loads the most recent show', async () => {
    const m = manager()
    await m.saveAs(makeShow('old'), join(shows, 'Old.pbshow'))
    await m.saveAs(makeShow('new'), join(shows, 'New.pbshow'))
    const r = await manager().loadLastShow()
    expect(r.success).toBe(true)
    expect(r.show?.name).toBe('new')
  })

  it('reports a corrupt last show instead of silently opening an older one', async () => {
    const m = manager()
    await m.saveAs(makeShow('old'), join(shows, 'Old.pbshow'))
    const latest = join(shows, 'Latest.pbshow')
    await m.saveAs(makeShow('latest'), latest)
    writeFileSync(latest, '{"version":"1.0.0","patch":[') // truncated, no .bak for this file yet
    const fresh = manager()
    const r = await fresh.loadLastShow()
    expect(r.success).toBe(false)
    expect(r.path).toBe(latest)
    expect(r.error).toMatch(/Latest/)
    expect(fresh.getCurrentPath()).toBeNull()
  })

  it('recovers from the .bak with a warning', async () => {
    const m = manager()
    const path = join(shows, 'Gig.pbshow')
    await m.saveAs(makeShow('first'), path)
    await m.saveAs(makeShow('second'), path)
    writeFileSync(path, '') // power loss
    const fresh = manager()
    const r = await fresh.loadLastShow()
    expect(r.success).toBe(true)
    expect(r.show?.name).toBe('first')
    expect(r.warning).toMatch(/backup/)
    expect(fresh.getCurrentPath()).toBe(path)
  })

  it('a missing last show is reported too', async () => {
    const m = manager()
    const path = join(shows, 'Gone.pbshow')
    await m.saveAs(makeShow('gone'), path)
    rmSync(path)
    rmSync(`${path}.bak`, { force: true })
    const r = await manager().loadLastShow()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/no longer exists/)
  })

  it('first run: nothing to load is not an error', async () => {
    const r = await manager().loadLastShow()
    expect(r).toEqual({ success: false })
  })

  it('without history, picks the newest show in the folder', async () => {
    const m = manager()
    await m.saveAs(makeShow('a'), join(shows, 'A.pbshow'))
    await m.saveAs(makeShow('b'), join(shows, 'B.pbshow'))
    utimesSync(join(shows, 'A.pbshow'), new Date(), new Date(Date.now() + 60_000))
    rmSync(join(userData, 'config', 'recent.json'))
    const r = await manager().loadLastShow()
    expect(r.show?.name).toBe('a')
  })

  it('read-only mode (remote clients) never changes the current file or recent list', async () => {
    const m = manager()
    const a = join(shows, 'A.pbshow')
    const b = join(shows, 'B.pbshow')
    await m.saveAs(makeShow('a'), a)
    await m.saveAs(makeShow('b'), b)
    await m.load(a) // the Pi is running A
    const r = await m.loadLastShow({ readOnly: true })
    expect(r.show?.name).toBe('a')
    expect(m.getCurrentPath()).toBe(a)
    expect(m.getRecent()[0]).toBe(a)
  })
})

describe('ShowFileManager names', () => {
  it('lists shows by name and resolves names without building paths from input', async () => {
    const m = manager()
    await m.saveAs(makeShow('x'), join(shows, 'Zeta.pbshow'))
    await m.saveAs(makeShow('y'), join(shows, 'Alpha.pbshow'))
    writeFileSync(join(shows, '.hidden.pbshow'), '{}')
    expect(m.listShowNames()).toEqual(['Alpha', 'Zeta'])
    expect(m.findShowByName('Alpha')).toBe(join(shows, 'Alpha.pbshow'))
    expect(m.findShowByName('../Alpha')).toBeNull()
    expect(m.pathForName('../../evil')).toMatch(new RegExp(`^${shows.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  })
})

describe('ShowFileManager.newShow', () => {
  it('returns an empty show in the current format (no legacy output config, no migration warning)', async () => {
    const { normalizeShow, SHOW_FORMAT_VERSION } = await import('../shared/show-format')
    const show = manager().newShow()
    expect(show.version).toBe(String(SHOW_FORMAT_VERSION))
    expect(show.artnetConfig).toBeUndefined()
    expect(show.dmxOutputs).toBeUndefined()
    expect(normalizeShow(show).warnings).toEqual([])
  })
})
