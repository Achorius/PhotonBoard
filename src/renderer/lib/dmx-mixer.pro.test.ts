import { describe, it, expect } from 'vitest'
import {
  applyMasters,
  buildChannelInfo,
  mixLayers,
  HIGHLIGHT_LAYER_ID,
  LAYER_SUPER,
  LAYER_SWAP,
  PROGRAMMER_LAYER_ID,
  type LayerChannels,
  type MasterState,
  type MixerLayer
} from './dmx-mixer'
import { MOVING_HEAD, RGB_PAR, DIMMER, DIMMER_16, ALL_FIXTURES, patchEntry, addr } from './testing/test-fixtures'

const U = 512

const mh = patchEntry('mh', MOVING_HEAD, 0, 1)
const par = patchEntry('par', RGB_PAR, 0, 101)
const dim = patchEntry('dim', DIMMER, 0, 201)
const dim16 = patchEntry('dim16', DIMMER_16, 1, 1)
const info = buildChannelInfo([mh, par, dim, dim16], ALL_FIXTURES, 2)

function layer(id: string, values: [number, number, number][], priority = 50, master = 255, activatedAt = 0, flags?: number): MixerLayer {
  const channels: LayerChannels = new Map()
  for (const [u, ch, v] of values) {
    if (!channels.has(u)) channels.set(u, new Map())
    channels.get(u)!.set(ch, v)
  }
  return { id, priority, master, activatedAt, channels, ...(flags ? { flags } : {}) }
}

const masters = (m: Partial<MasterState> = {}): MasterState => ({ grandMaster: 255, blackout: false, blinder: false, strobe: false, strobeOn: true, ...m })

const PAN = addr(mh, MOVING_HEAD, 'Pan')
const MH_DIM = addr(mh, MOVING_HEAD, 'Dimmer')
const MH_RED = addr(mh, MOVING_HEAD, 'Red')
const DIM = addr(dim, DIMMER, 'Intensity')

function mix(layers: MixerLayer[], opts?: Parameters<typeof mixLayers>[3]): Uint8Array {
  const out = new Uint8Array(info.universeCount * U)
  mixLayers(layers, info, out, opts)
  return out
}

describe('mixer pro: layer flags', () => {
  it('a swap layer claims its intensity against lower layers, HTP against higher ones', () => {
    const low = layer('low', [[0, DIM, 200], [0, MH_DIM, 250]], 40)
    const swap = layer('swap', [[0, DIM, 50], [0, MH_DIM, 10]], 50, 255, 0, LAYER_SWAP)
    const high = layer('high', [[0, MH_DIM, 100]], 60)
    const out = mix([low, swap, high])
    expect(out[DIM]).toBe(50) // swap wins over the lower 200 (HTP would give 200)
    expect(out[MH_DIM]).toBe(100) // higher layer 100 vs swap 10: HTP max; the lower 250 is shut out
    // Without the flag: plain HTP
    expect(mix([low, { ...swap, flags: 0 }, high])[DIM]).toBe(200)
  })

  it('a super layer wins over the programmer; the highlight comes last', () => {
    const prog = layer(PROGRAMMER_LAYER_ID, [[0, PAN, 10], [0, MH_DIM, 30]])
    const sup = layer('sup', [[0, PAN, 99], [0, DIM, 128]], 10, 128, 0, LAYER_SUPER)
    const hl = layer(HIGHLIGHT_LAYER_ID, [[0, MH_DIM, 255]])
    const out = mix([sup, prog, hl])
    expect(out[PAN]).toBe(99)
    expect(out[DIM]).toBe(64) // super master scales intensity
    expect(out[MH_DIM]).toBe(255)
    // Two supers: the higher priority wins LTP, HTP takes the max
    const sup2 = layer('sup2', [[0, PAN, 7], [0, DIM, 255]], 90, 255, 0, LAYER_SUPER)
    const out2 = mix([sup, sup2, prog])
    expect(out2[PAN]).toBe(7)
    expect(out2[DIM]).toBe(255)
  })

  it('blind: programmer and highlight leave the output, the preview has them', () => {
    const play = layer('play', [[0, DIM, 100], [0, PAN, 40]])
    const prog = layer(PROGRAMMER_LAYER_ID, [[0, PAN, 200], [0, MH_RED, 255]])
    const hl = layer(HIGHLIGHT_LAYER_ID, [[0, MH_DIM, 255]])
    const preview = new Uint8Array(info.universeCount * U)
    const out = mix([play, prog, hl], { excludeProgrammer: true, preview })
    expect(out[PAN]).toBe(40)
    expect(out[MH_RED]).toBe(0)
    expect(out[MH_DIM]).toBe(0)
    expect(preview[PAN]).toBe(200)
    expect(preview[MH_RED]).toBe(255)
    expect(preview[MH_DIM]).toBe(255)
    expect(preview[DIM]).toBe(100)
  })
})

describe('mixer pro: output stage', () => {
  it('group masters scale intensity before the GM (also 16-bit), nothing else', () => {
    const m = new Uint8Array(info.universeCount * U)
    m[DIM] = 200
    m[PAN] = 200
    const d16 = U + addr(dim16, DIMMER_16, 'Dimmer')
    m[d16] = 255
    m[d16 + 1] = 255
    const scale = new Float32Array(info.universeCount * U).fill(1)
    scale[DIM] = 0.5
    scale[PAN] = 0.5
    scale[d16] = 0.5
    const out = new Uint8Array(m.length)
    applyMasters(m, info, masters({ grandMaster: 128 }), out, { groupScale: scale })
    expect(out[DIM]).toBe(Math.round(200 * (128 / 255) * 0.5))
    expect(out[PAN]).toBe(200)
    const v16 = out[d16] * 256 + out[d16 + 1]
    expect(v16).toBe(Math.round(65535 * (128 / 255) * 0.5))
  })

  it('parked channels are written last: GM and blackout do not touch them', () => {
    const m = new Uint8Array(info.universeCount * U)
    m[DIM] = 200
    m[PAN] = 10
    const parked = new Int16Array(U).fill(-1) // shorter than the frame: other universes unparked
    parked[DIM] = 180
    parked[PAN] = 77
    const out = new Uint8Array(m.length)
    applyMasters(m, info, masters({ grandMaster: 0, blackout: true }), out, { parked })
    expect(out[DIM]).toBe(180)
    expect(out[PAN]).toBe(77)
    expect(out[MH_DIM]).toBe(0)
  })
})

// Timing-sensitive: runs only on demand (PB_PERF=1 npm test) so a busy
// machine running the whole suite in parallel can't make CI flaky.
describe.runIf(process.env.PB_PERF === '1')('mixer perf guard', () => {
  it('16 universes, 40 layers + programmer, park and group masters: < 4 ms per frame', () => {
    // 16 universes fully patched with 12-channel moving heads (42 per universe)
    const patch = []
    for (let u = 0; u < 16; u++) {
      for (let i = 0; i < 42; i++) patch.push(patchEntry(`mh${u}-${i}`, MOVING_HEAD, u, 1 + i * 12))
    }
    const big = buildChannelInfo(patch, ALL_FIXTURES, 16)
    const size = 16 * U
    const layers: MixerLayer[] = []
    for (let l = 0; l < 40; l++) {
      const channels: LayerChannels = new Map()
      // each layer drives 4 universes completely (2048 channels)
      for (let k = 0; k < 4; k++) {
        const u = (l + k * 4) % 16
        const m = new Map<number, number>()
        for (let ch = 0; ch < 504; ch++) m.set(ch, (ch * 7 + l) & 0xff)
        channels.set(u, m)
      }
      layers.push({ id: `l${l}`, priority: l % 3 === 0 ? 60 : 50, master: 200, activatedAt: l, channels, flags: l === 5 ? LAYER_SWAP : l === 7 ? LAYER_SUPER : 0 })
    }
    const prog = new Map<number, Map<number, number>>()
    for (let u = 0; u < 16; u++) prog.set(u, new Map(Array.from({ length: 64 }, (_, i) => [i * 3, 128] as [number, number])))
    layers.push({ id: PROGRAMMER_LAYER_ID, priority: 100, master: 255, activatedAt: 0, channels: prog })
    const parked = new Int16Array(size).fill(-1)
    for (let i = 0; i < size; i += 97) parked[i] = 50
    const groupScale = new Float32Array(size).fill(0.8)
    const mixBuf = new Uint8Array(size)
    const preview = new Uint8Array(size)
    const out = new Uint8Array(size)
    const frame = (blind: boolean) => {
      mixLayers(layers, big, mixBuf, blind ? { excludeProgrammer: true, preview } : undefined)
      applyMasters(mixBuf, big, masters({ grandMaster: 230 }), out, { parked, groupScale })
    }
    for (let i = 0; i < 20; i++) frame(i % 2 === 0) // warm-up (JIT)
    // Best of 3 batches (a GC pause or a busy CI core must not fail the guard)
    let perFrame = Infinity
    for (let batch = 0; batch < 3; batch++) {
      const frames = 40
      const t0 = performance.now()
      for (let i = 0; i < frames; i++) frame(i % 4 === 0)
      perFrame = Math.min(perFrame, (performance.now() - t0) / frames)
    }
    expect(perFrame).toBeLessThan(4)
  })
})
