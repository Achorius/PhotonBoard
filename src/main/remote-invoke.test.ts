import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRemoteInvokeHandler, handleRemoteSend, RemoteInputError } from './remote-invoke'
import { DmxEngine } from './dmx-engine'
import { DmxOutputManager } from './dmx-output-manager'
import { ShowFileManager } from './show-file'
import { OFLService } from './ofl-service'
import { PiSaveCoordinator } from './pi-save-coordinator'
import { IPC } from '../shared/types'

let root: string
let shows: string
let sent: { channel: string; args: unknown[] }[]
let showManager: ShowFileManager
let outputManager: DmxOutputManager
let piCommands: any[]
let piSave: PiSaveCoordinator
let handle: ReturnType<typeof createRemoteInvokeHandler>
let engine: DmxEngine

const show = (name: string) => ({ version: '1.0.0', name, patch: [], cuelists: [] })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pb-remote-'))
  shows = join(root, 'shows')
  sent = []
  piCommands = []
  engine = new DmxEngine(3)
  showManager = new ShowFileManager(join(root, 'userData'), { documentsShowsPath: shows })
  outputManager = new DmxOutputManager({ universeCount: 3 })
  piSave = new PiSaveCoordinator((cmd) => { piCommands.push(cmd); return true })
  handle = createRemoteInvokeHandler({
    dmxEngine: engine,
    outputManager,
    showManager,
    oflService: new OFLService({ fetch: async () => { throw new Error('offline') } }),
    piSave,
    userDataPath: join(root, 'userData'),
    getVersion: () => '1.2.3',
    getRemoteStatus: () => ({ web: { port: 9091, listening: true, clients: 1 }, api: { port: 9090, listening: true, clients: 0 }, addresses: [] }),
    sendToRenderer: (channel, ...args) => { sent.push({ channel, args }) }
  })
})
afterEach(async () => {
  await outputManager.destroy()
  rmSync(root, { recursive: true, force: true })
})

/** Simulate the Pi renderer answering a 'save-show' command */
async function answerPiSave(name: string) {
  await vi.waitFor(() => expect(piCommands.length).toBeGreaterThan(0))
  const claim = piSave.claim(piCommands.at(-1).payload.requestId)!
  const result = await showManager.saveAs(show(name) as any, claim.path)
  piSave.complete(claim.id, result)
}

describe('remote invoke validation', () => {
  it('artnet:configure with a non-array is rejected and changes nothing', async () => {
    const before = outputManager.getConfig()
    await expect(handle(IPC.ARTNET_CONFIGURE, [{ host: 'x' }])).rejects.toBeInstanceOf(RemoteInputError)
    expect(outputManager.getConfig()).toEqual(before)
  })

  it('dmx-outputs:configure validates strictly', async () => {
    const r: any = await handle(IPC.DMX_OUTPUTS_CONFIGURE, [{ artnet: [{ host: 'bad host', universe: 0 }], usb: [] }])
    expect(r.success).toBe(false)
    const r2: any = await handle(IPC.DMX_OUTPUTS_CONFIGURE, [{ artnet: [], usb: [{ driver: 'enttec-pro', portPath: '/dev/nope', universe: 0 }] }])
    expect(r2.success).toBe(false)
    const ok: any = await handle(IPC.DMX_OUTPUTS_CONFIGURE, [{ artnet: [{ host: '127.0.0.1', universe: 1 }], usb: [] }])
    expect(ok.success).toBe(true)
    expect(outputManager.getConfig().artnet[0].host).toBe('127.0.0.1')
  })

  it('unknown and privileged channels are refused', async () => {
    await expect(handle('remote:set-settings', [{ pinEnabled: false }])).rejects.toThrow(/console itself/)
    await expect(handle('shell:exec', [])).rejects.toThrow(/forbidden/)
    await expect(handle(IPC.DMX_GET_VALUES, [99])).rejects.toThrow(/Universe/)
  })

  it('show:new and show:load-last never change the Pi current file', async () => {
    const a = join(shows, 'A.pbshow')
    await showManager.saveAs(show('A') as any, a)
    await handle(IPC.SHOW_NEW, [])
    await handle(IPC.SHOW_LOAD_LAST, [])
    expect(showManager.getCurrentPath()).toBe(a)
  })

  it('show:load returns the common result shape; list + load-by-name work read-only', async () => {
    await showManager.saveAs(show('B') as any, join(shows, 'B.pbshow'))
    await showManager.saveAs(show('A') as any, join(shows, 'A.pbshow'))
    expect(await handle(IPC.SHOW_LOAD, [])).toMatchObject({ success: false, error: expect.any(String) })
    expect(await handle(IPC.SHOW_LIST, [])).toEqual(['A', 'B'])
    const r: any = await handle(IPC.SHOW_LOAD_BY_NAME, ['B'])
    expect(r).toMatchObject({ success: true, path: join(shows, 'B.pbshow') })
    expect(showManager.getCurrentPath()).toBe(join(shows, 'A.pbshow'))
    expect(sent).toEqual([])
  })

  it('load-by-name with apply makes the Pi adopt the show', async () => {
    await showManager.saveAs(show('B') as any, join(shows, 'B.pbshow'))
    await showManager.saveAs(show('A') as any, join(shows, 'A.pbshow'))
    await handle(IPC.SHOW_LOAD_BY_NAME, ['B', { apply: true }])
    expect(showManager.getCurrentPath()).toBe(join(shows, 'B.pbshow'))
    expect(sent[0].args[0]).toMatchObject({ type: 'apply-show' })
  })
})

describe('remote saves go through the Pi renderer', () => {
  it('save writes the Pi state to the Pi current file', async () => {
    const path = join(shows, 'Gig.pbshow')
    await showManager.saveAs(show('Gig') as any, path)
    const p = handle(IPC.SHOW_SAVE, [show('browser copy')])
    await answerPiSave('pi state')
    expect(await p).toMatchObject({ success: true, path })
    expect(JSON.parse(readFileSync(path, 'utf-8')).name).toBe('pi state')
  })

  it('save as refuses to overwrite unless asked, and sanitises the name', async () => {
    writeFileSync(join(shows, 'Taken.pbshow'), JSON.stringify(show('t')))
    expect(await handle(IPC.SHOW_SAVE_AS, [show('x'), { name: 'Taken' }])).toMatchObject({ success: false, exists: true })
    expect(piCommands).toHaveLength(0)

    const p = handle(IPC.SHOW_SAVE_AS, [show('x'), { name: 'Taken', overwrite: true }])
    await answerPiSave('overwritten')
    expect(await p).toMatchObject({ success: true })

    piCommands = []
    const p2 = handle(IPC.SHOW_SAVE_AS, [show('x'), { name: '../.hidden' }])
    await answerPiSave('safe')
    const r: any = await p2
    expect(r.success).toBe(true)
    expect(r.path.startsWith(shows)).toBe(true)
    expect(r.path).not.toMatch(/\/\.[^/]*$/)
  })

  it('accepts the show as an object or as a JSON string', async () => {
    const p = handle(IPC.SHOW_SAVE_AS, [JSON.stringify(show('n')), { name: 'N' }])
    await answerPiSave('n')
    expect(await p).toMatchObject({ success: true, path: join(shows, 'N.pbshow') })
    await expect(handle(IPC.SHOW_SAVE_AS, ['{oops', {}])).rejects.toThrow(/JSON/)
  })

  it('upload refuses to overwrite an existing show without confirmation', async () => {
    writeFileSync(join(shows, 'Up.pbshow'), JSON.stringify(show('old')))
    const r: any = await handle('remote:upload-show', [JSON.stringify(show('new')), 'Up.pbshow'])
    expect(r.success).toBe(false)
    const r2: any = await handle('remote:upload-show', [JSON.stringify(show('new')), 'Up.pbshow', { overwrite: true }])
    expect(r2.success).toBe(true)
    expect(sent.at(-1)?.args[0]).toMatchObject({ type: 'apply-show' })
    const bad: any = await handle('remote:upload-show', ['not json', 'X.pbshow'])
    expect(bad).toMatchObject({ success: false, error: expect.stringMatching(/damaged/) })
  })
})

describe('handleRemoteSend', () => {
  it('relays only whitelisted commands, tagged with the client id', () => {
    const deps = { sendToRenderer: (channel: string, ...args: unknown[]) => { sent.push({ channel, args }) } }
    expect(handleRemoteSend(deps, IPC.STAGE_COMMAND, [{ type: 'go-cuelist', payload: 'c1', clientId: 'spoofed' }], 'web-1')).toBe(true)
    expect(sent[0].args[0]).toEqual({ type: 'go-cuelist', payload: 'c1', clientId: 'web-1' })
    // Web-remote-only commands are accepted, internal ones never
    expect(handleRemoteSend(deps, IPC.STAGE_COMMAND, [{ type: 'apply-show-content', payload: {} }], 'web-1')).toBe(true)
    expect(handleRemoteSend(deps, IPC.STAGE_COMMAND, [{ type: 'apply-show', payload: {} }])).toBe(false)
    expect(handleRemoteSend(deps, IPC.STAGE_COMMAND, [{ type: 'client-disconnected', payload: { clientId: 'web-2' } }])).toBe(false)
    expect(handleRemoteSend(deps, IPC.STAGE_COMMAND, ['go-cuelist'])).toBe(false)
    expect(sent).toHaveLength(2)
    expect(handleRemoteSend(deps, 'evil', [])).toBe(false)
  })

  it('refuses raw DMX writes (they would bypass the console mixer)', () => {
    const deps = { sendToRenderer: (channel: string, ...args: unknown[]) => { sent.push({ channel, args }) } }
    expect(handleRemoteSend(deps, IPC.DMX_SET_CHANNEL, [0, 10, 255])).toBe(false)
    expect(handleRemoteSend(deps, IPC.DMX_SET_CHANNELS, [0, { 10: 255 }])).toBe(false)
    expect(handleRemoteSend(deps, IPC.DMX_BLACKOUT, [])).toBe(false)
    expect(engine.getChannel(0, 10)).toBe(0)
    expect(sent).toHaveLength(0)
  })
})

describe('show:get-current', () => {
  it('asks the console renderer and never reads a file', async () => {
    const asked: unknown[] = []
    const h = createRemoteInvokeHandler({
      dmxEngine: engine, outputManager, showManager, piSave,
      oflService: new OFLService({ fetch: async () => { throw new Error('offline') } }),
      userDataPath: join(root, 'userData'),
      getVersion: () => '1',
      getRemoteStatus: () => ({ web: { port: 1, listening: true, clients: 0 }, api: { port: 2, listening: true, clients: 0 }, addresses: [] }),
      sendToRenderer: () => {},
      requestFromConsole: async (type, payload) => { asked.push({ type, payload }); return { success: true, show: { name: 'Live' } } }
    })
    await expect(h(IPC.SHOW_GET_CURRENT, [{ origin: 'abc', sections: ['cuelists', 42] }])).resolves.toEqual({ success: true, show: { name: 'Live' } })
    expect(asked).toEqual([{ type: 'collect-show-content', payload: { origin: 'abc', sections: ['cuelists'] } }])
    await expect(handle(IPC.SHOW_GET_CURRENT, [{}])).rejects.toThrow(RemoteInputError)
  })
})

describe('remote interchange (import / export of other formats)', () => {
  const withHost = async () => {
    const { createInterchangeHost } = await import('./interchange')
    return createRemoteInvokeHandler({
      dmxEngine: engine, outputManager, showManager,
      oflService: new OFLService({ fetch: async () => { throw new Error('offline') } }),
      piSave, userDataPath: join(root, 'userData'), getVersion: () => '1',
      getRemoteStatus: () => ({ web: { port: 1, listening: true, clients: 0 }, api: { port: 2, listening: true, clients: 0 }, addresses: [] }),
      sendToRenderer: () => {},
      interchange: createInterchangeHost({ getLibrary: () => showManager.getAllFixtures() })
    })
  }

  it('imports bytes sent as base64 and answers JSON text', async () => {
    const h = await withHost()
    const csv = Buffer.from('Fixture ID,Name,Patch,Channels\n1,Par,1.001,3\n').toString('base64')
    const res = JSON.parse(await h(IPC.INTERCHANGE_IMPORT_DATA, ['patch.csv', csv, {}]) as string)
    expect(res.success).toBe(true)
    expect(res.fragment.patch[0]).toMatchObject({ name: 'Par', address: 1 })
  })

  it('explains closed formats, refuses oversized uploads and console paths', async () => {
    const h = await withHost()
    const ma = JSON.parse(await h(IPC.INTERCHANGE_IMPORT_DATA, ['Gig.show', Buffer.from('x').toString('base64'), {}]) as string)
    expect(ma.guidance.app).toBe('grandMA3')
    const big = 'A'.repeat(20 * 1024 * 1024)
    expect(JSON.parse(await h(IPC.INTERCHANGE_IMPORT_DATA, ['big.mvr', big, {}]) as string).errorCode).toBe('tooLargeRemote')
    await expect(h(IPC.INTERCHANGE_IMPORT_DATA, [42, '', {}])).rejects.toBeInstanceOf(RemoteInputError)
    expect(JSON.parse(await h(IPC.INTERCHANGE_IMPORT, [{ path: '/etc/passwd' }]) as string).success).toBe(false)
  })

  it('exports as base64 for a browser download', async () => {
    const h = await withHost()
    const res: any = await h(IPC.INTERCHANGE_EXPORT_DATA, [JSON.stringify({ format: 'csv-patch', show: show('Gig'), fixtures: [] })])
    expect(res.success).toBe(true)
    expect(res.fileName).toBe('Gig.csv')
    expect(Buffer.from(res.data, 'base64').toString('utf8')).toMatch(/^Fixture ID,Name/)
    const formats: any = await h(IPC.INTERCHANGE_FORMATS, [])
    expect(formats.exporters.map((f: any) => f.id)).toContain('csv-patch-excel')
  })

  it('reports interchange as unavailable without a host', async () => {
    await expect(handle(IPC.INTERCHANGE_IMPORT_DATA, ['a.csv', '', {}])).rejects.toThrow(/not available/)
    expect(await handle(IPC.INTERCHANGE_FORMATS, [])).toEqual({ importers: [], exporters: [], recognised: [] })
  })
})
