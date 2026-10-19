import { describe, it, expect, afterEach } from 'vitest'
import dgram from 'dgram'
import { buildArtDmxPacket, artnetPortAddress, nextSequence } from './artnet-protocol'
import { ArtNetOutput } from './artnet-output'

describe('ArtDmx packet', () => {
  it('encodes header, port-address and data per the Art-Net 4 spec', () => {
    const data = new Uint8Array(512)
    data[0] = 255; data[511] = 7
    const p = buildArtDmxPacket(42, 1, 2, 3, data)
    expect(p.length).toBe(18 + 512)
    expect(p.subarray(0, 8).toString('latin1')).toBe('Art-Net\0')
    expect(p[8]).toBe(0x00); expect(p[9]).toBe(0x50) // OpDmx, little-endian
    expect(p[10]).toBe(0); expect(p[11]).toBe(14)    // protocol 14
    expect(p[12]).toBe(42)                            // sequence
    expect(p[14]).toBe(0x23)                          // SubUni: subnet 2, universe 3
    expect(p[15]).toBe(1)                             // Net
    expect(p.readUInt16BE(16)).toBe(512)
    expect(p[18]).toBe(255); expect(p[18 + 511]).toBe(7)
  })
  it('port-address and sequence helpers', () => {
    expect(artnetPortAddress(127, 15, 15)).toBe(0x7fff)
    expect(nextSequence(1)).toBe(2)
    expect(nextSequence(255)).toBe(1)
  })
})

describe('ArtNetOutput', () => {
  let receiver: dgram.Socket | null = null
  let output: ArtNetOutput | null = null
  afterEach(() => {
    output?.destroy(); output = null
    receiver?.close(); receiver = null
  })

  async function listen(): Promise<{ port: number; packets: Buffer[] }> {
    const packets: Buffer[] = []
    receiver = dgram.createSocket('udp4')
    receiver.on('message', (msg) => packets.push(msg))
    await new Promise<void>(r => receiver!.bind(0, '127.0.0.1', () => r()))
    return { port: receiver.address().port, packets }
  }

  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  const waitReady = async (o: ArtNetOutput) => {
    for (let i = 0; i < 50 && !o.getStatus().connected; i++) await wait(10)
  }

  it('sends changes, skips unchanged frames, keeps alive, and supports two targets on one universe', async () => {
    const { port, packets } = await listen()
    output = new ArtNetOutput(3)
    output.configure([
      { id: 'a', host: '127.0.0.1', port, universe: 0, subnet: 0, net: 0 },
      { id: 'b', host: '127.0.0.1', port, universe: 0, subnet: 0, net: 0, artnetUniverse: 5 }
    ])
    await waitReady(output)
    const universes = [new Uint8Array(512), new Uint8Array(512), new Uint8Array(512)]
    universes[0][0] = 100
    let now = 1_000_000
    output.send(universes, now)
    await wait(50)
    expect(packets.length).toBe(2)
    expect(new Set(packets.map(p => p[14]))).toEqual(new Set([0, 5]))

    output.send(universes, now += 25) // unchanged → nothing
    await wait(30)
    expect(packets.length).toBe(2)

    output.send(universes, now += 1000) // keep-alive
    await wait(30)
    expect(packets.length).toBe(4)

    const statuses = output.getStatuses(now)
    expect(statuses.map(s => s.id)).toEqual(['a', 'b'])
    expect(statuses.every(s => s.state === 'ok' && s.framesSent >= 2)).toBe(true)
  })

  it('reconfigure forces a full frame and drops old targets', async () => {
    const { port, packets } = await listen()
    output = new ArtNetOutput(3)
    output.configure([{ id: 'a', host: '127.0.0.1', port, universe: 0, subnet: 0, net: 0 }])
    await waitReady(output)
    const universes = [new Uint8Array(512), new Uint8Array(512), new Uint8Array(512)]
    output.send(universes, 1000)
    await wait(30)
    output.configure([{ id: 'c', host: '127.0.0.1', port, universe: 1, subnet: 0, net: 0 }])
    await waitReady(output)
    output.send(universes, 1010)
    await wait(30)
    expect(packets.length).toBe(2)
    expect(output.getStatuses().map(s => s.id)).toEqual(['c'])
  })

  it('reports a source universe the engine does not have as invalid', () => {
    output = new ArtNetOutput(3)
    output.configure([{ id: 'x', host: '127.0.0.1', port: 6454, universe: 5, subnet: 0, net: 0 }])
    const [s] = output.getStatuses()
    expect(s.state).toBe('invalid')
    expect(s.lastError).toMatch(/does not exist/)
  })
})
