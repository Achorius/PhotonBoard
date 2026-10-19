// Generates scripts/dev/demo-show.pbshow — a realistic show for screenshots
// and manual UI testing (23 fixtures, groups, scenes, chases, effects,
// executor layout, timeline, MIDI mappings, stage positions).
// Usage: node scripts/dev/make-demo-show.mjs
import { writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'demo-show.pbshow')
let seq = 0
const id = (p) => `${p}-${String(++seq).padStart(3, '0')}`

// ---------------------------------------------------------------- patch
const patch = []
const groups = []
function addFixtures({ def, mode, channels, count, name, universe, start, group, color, place }) {
  const ids = []
  for (let i = 0; i < count; i++) {
    const fid = id('fx')
    const pos = place(i, count)
    patch.push({
      id: fid,
      fixtureDefId: def,
      modeName: mode,
      universe,
      address: start + i * channels,
      name: count > 1 ? `${name} ${i + 1}` : name,
      groupIds: [],
      position3D: pos.p,
      mountingLocation: pos.m ?? 'ceiling',
      ...(pos.angle !== undefined ? { mountingAngle: pos.angle } : {}),
      stagePosition: { x: 600 + pos.p.x * 80, y: 300 + pos.p.z * 50, rotation: 0 }
    })
    ids.push(fid)
  }
  const gid = id('grp')
  groups.push({ id: gid, name: group, color, fixtureIds: ids })
  for (const f of patch) if (ids.includes(f.id)) f.groupIds.push(gid)
  return ids
}
const spread = (i, n, width) => (n === 1 ? 0 : -width / 2 + (width * i) / (n - 1))

const spots = addFixtures({ def: 'generic/moving-head-spot', mode: '13ch', channels: 13, count: 4, name: 'Spot', universe: 0, start: 1, group: 'Spots', color: '#3b82f6', place: (i, n) => ({ p: { x: spread(i, n, 9), y: 5.9, z: 0 } }) })
const washes = addFixtures({ def: 'generic/moving-head-wash', mode: '11ch', channels: 11, count: 4, name: 'Wash', universe: 0, start: 61, group: 'Washes', color: '#a855f7', place: (i, n) => ({ p: { x: spread(i, n, 11), y: 5.9, z: 3 } }) })
const pars = addFixtures({ def: 'eurolite/led-par-64-rgba', mode: '8ch', channels: 8, count: 6, name: 'Par', universe: 0, start: 121, group: 'Pars', color: '#ff7a1a', place: (i, n) => ({ p: { x: spread(i, n, 12), y: 5.9, z: -3 }, angle: 30 }) })
const front = addFixtures({ def: 'etc/source-four-par', mode: '1ch', channels: 1, count: 4, name: 'Front', universe: 0, start: 181, group: 'Front', color: '#eab308', place: (i, n) => ({ p: { x: spread(i, n, 8), y: 5.9, z: -4.5 }, angle: 40 }) })
const bars = addFixtures({ def: 'generic/led-bar-rgb-8', mode: '26ch', channels: 26, count: 2, name: 'Bar', universe: 1, start: 1, group: 'Bars', color: '#14b8a6', place: (i) => ({ p: { x: i === 0 ? -5 : 5, y: 0.1, z: 4 }, m: 'floor' }) })
const strobes = addFixtures({ def: 'generic/strobe', mode: '2ch', channels: 2, count: 2, name: 'Strobe', universe: 1, start: 61, group: 'Strobes', color: '#ec4899', place: (i) => ({ p: { x: i === 0 ? -3 : 3, y: 5.9, z: 3 } }) })
const hazer = addFixtures({ def: 'generic/hazer', mode: '2ch', channels: 2, count: 1, name: 'Hazer', universe: 1, start: 101, group: 'Atmosphere', color: '#94a3b8', place: () => ({ p: { x: 6, y: 0.1, z: 4.5 }, m: 'floor' }) })

// ---------------------------------------------------------------- helpers
const v = (ids, values) => ids.flatMap((fixtureId) => Object.entries(values).map(([channelName, value]) => ({ fixtureId, channelName, value })))
const barCells = (ids, rgbFor) => ids.flatMap((fixtureId) => [
  { fixtureId, channelName: 'Master Dimmer', value: 255 },
  ...Array.from({ length: 8 }, (_, c) => {
    const [r, g, b] = rgbFor(c)
    return [
      { fixtureId, channelName: `Red ${c + 1}`, value: r },
      { fixtureId, channelName: `Green ${c + 1}`, value: g },
      { fixtureId, channelName: `Blue ${c + 1}`, value: b }
    ]
  }).flat()
])
const spotOpen = { Dimmer: 255, Shutter: 22, Zoom: 90, Focus: 128 }
const cue = (name, values, opts = {}) => ({ id: id('cue'), name, number: 0, values, fadeIn: opts.fadeIn ?? 2, fadeOut: opts.fadeOut ?? 2, delay: opts.delay ?? 0, followTime: opts.follow ?? null, ...(opts.color ? { color: opts.color } : {}) })
const cuelist = (name, cues, opts = {}) => ({
  id: id('scene'),
  name,
  cues: cues.map((c, i) => ({ ...c, number: i + 1 })),
  currentCueIndex: -1,
  isPlaying: false,
  isLooping: opts.loop ?? false,
  priority: opts.priority ?? 50,
  faderLevel: 255,
  flash: false,
  ...(opts.effects ? { effectSnapshots: opts.effects } : {})
})

// ---------------------------------------------------------------- effects
const effects = [
  { id: id('fx-eff'), name: 'Par Dimmer Wave', waveform: 'sine', speed: 0.5, depth: 200, offset: 0, channelType: 'Dimmer', fixtureIds: pars, fan: 360, isRunning: false },
  { id: id('fx-eff'), name: 'Spot Circle', waveform: 'sine', speed: 0.25, depth: 70, offset: 0, channelType: 'Pan', fixtureIds: spots, fan: 90, isRunning: false,
    channels: [{ channelType: 'Pan', phaseOffset: 0, depth: 70 }, { channelType: 'Tilt', phaseOffset: 90, depth: 50 }] },
  { id: id('fx-eff'), name: 'Wash Tilt Nod', waveform: 'triangle', speed: 0.4, depth: 60, offset: 0, channelType: 'Tilt', fixtureIds: washes, fan: 180, isRunning: false },
  { id: id('fx-eff'), name: 'Strobe Random', waveform: 'random', speed: 4, depth: 255, offset: 0, channelType: 'Dimmer', fixtureIds: strobes, fan: 180, isRunning: false, oneShot: false }
]

// ---------------------------------------------------------------- scenes
const warm = cuelist('Warm Wash', [cue('Amber', [...v(pars, { Red: 255, Green: 110, Blue: 0, Amber: 255, Dimmer: 230 }), ...v(front, { Dimmer: 150 })], { fadeIn: 3 })])
const cool = cuelist('Cool Blue', [cue('Blue', [...v(pars, { Red: 0, Green: 40, Blue: 255, Amber: 0, Dimmer: 220 }), ...v(washes, { Dimmer: 200, Blue: 255, Green: 60, Pan: 128, Tilt: 100 })], { fadeIn: 4 })])
const frontLight = cuelist('Front Light', [cue('Full front', v(front, { Dimmer: 255 }), { fadeIn: 1.5 })])
const beams = cuelist('Spot Beams', [
  cue('Fan out', v(spots, { ...spotOpen, Gobo: 10, Pan: 100, Tilt: 70 }), { fadeIn: 2.5 }),
  cue('Cross', v(spots, { ...spotOpen, Gobo: 26, Pan: 160, Tilt: 90, Prism: 140 }), { fadeIn: 3 })
], { effects: [effects[1]] })
const intro = cuelist('Intro', [
  cue('Haze & dark', v(hazer, { 'Haze Output': 120, 'Fan Speed': 160 }), { fadeIn: 1 }),
  cue('Back light', v(washes, { Dimmer: 160, Red: 255, Blue: 120, Tilt: 60 }), { fadeIn: 6, follow: 8 }),
  cue('Reveal', [...v(washes, { Dimmer: 255, Red: 255, Blue: 160 }), ...v(front, { Dimmer: 200 })], { fadeIn: 5 })
])
const verse = cuelist('Verse', [
  cue('Verse A', [...v(pars, { Red: 255, Green: 30, Blue: 80, Amber: 0, Dimmer: 180 }), ...v(front, { Dimmer: 170 })], { fadeIn: 2 }),
  cue('Verse B', [...v(pars, { Red: 120, Green: 0, Blue: 255, Amber: 0, Dimmer: 200 }), ...v(front, { Dimmer: 170 })], { fadeIn: 2 })
])
const chorus = cuelist('Chorus Punch', [cue('All white', [...v(washes, { Dimmer: 255, Red: 255, Green: 255, Blue: 255, White: 255 }), ...v(spots, spotOpen), ...v(pars, { Red: 255, Green: 255, Blue: 255, Amber: 255, Dimmer: 255 })], { fadeIn: 0, fadeOut: 0.3 })], { priority: 80 })
const rainbow = cuelist('Bars Rainbow', [cue('Rainbow', barCells(bars, (c) => {
  const h = c / 8
  const f = (n) => Math.round(255 * Math.max(0, Math.min(1, Math.abs(((h * 6 + n) % 6) - 3) - 1)))
  return [f(0), f(4), f(2)]
}), { fadeIn: 1 })])
const hits = cuelist('Strobe Hits', [cue('Hit', v(strobes, { Dimmer: 255, Strobe: 200 }), { fadeIn: 0, fadeOut: 0 })], { priority: 90 })
const haze = cuelist('Haze', [cue('Haze 40%', v(hazer, { 'Haze Output': 100, 'Fan Speed': 140 }), { fadeIn: 5 })])
const ballad = cuelist('Ballad', [
  cue('Single spot', v([spots[1]], { ...spotOpen, Pan: 128, Tilt: 110, Zoom: 30 }), { fadeIn: 4 }),
  cue('Add wash', [...v([spots[1]], { ...spotOpen, Pan: 128, Tilt: 110, Zoom: 30 }), ...v(washes, { Dimmer: 120, Blue: 255, Red: 60 })], { fadeIn: 6 }),
  cue('Warm up', [...v(washes, { Dimmer: 180, Red: 255, Green: 80 }), ...v(pars, { Amber: 255, Red: 200, Dimmer: 120 })], { fadeIn: 8 }),
  cue('Fade', v(washes, { Dimmer: 40, Blue: 255 }), { fadeIn: 10 })
], { loop: false })
const finale = cuelist('Finale', [
  cue('Everything', [...v(washes, { Dimmer: 255, Red: 255, Green: 120 }), ...v(spots, { ...spotOpen, Gobo: 40 }), ...v(pars, { Red: 255, Amber: 255, Dimmer: 255 }), ...v(front, { Dimmer: 255 })], { fadeIn: 1 }),
  cue('Bow', v(front, { Dimmer: 255 }), { fadeIn: 3 })
])
const cuelists = [warm, cool, frontLight, beams, intro, verse, chorus, rainbow, hits, haze, ballad, finale]

// ---------------------------------------------------------------- chases
const chases = [
  {
    id: id('chase'), name: 'Par Chase', currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 128, fadePercent: 30, direction: 'bounce', faderLevel: 255, priority: 40,
    steps: pars.map((p) => ({ id: id('step'), values: v([p], { Red: 255, Green: 40, Dimmer: 255 }) }))
  },
  {
    id: id('chase'), name: 'Strobe Alternate', currentStepIndex: 0, isPlaying: false, isLooping: true, bpm: 240, fadePercent: 0, direction: 'forward', faderLevel: 255,
    steps: strobes.map((s) => ({ id: id('step'), values: v([s], { Dimmer: 255 }) }))
  }
]

// ---------------------------------------------------------------- executor
const empty = () => [null, null, null, null]
const grid = [
  [warm.id, cool.id, null, null],
  [frontLight.id, null, null, null],
  [beams.id, ballad.id, null, null],
  [intro.id, verse.id, chorus.id, finale.id],
  [hits.id, null, null, null],
  [rainbow.id, null, null, null],
  [haze.id, null, null, null],
  empty()
]
const executor = {
  grid,
  columns: [
    { title: 'Washes', color: '#ff7a1a' },
    { title: 'Front', color: '#eab308' },
    { title: 'Movers', color: '#3b82f6' },
    { title: 'Song', color: '#22c55e' },
    { title: 'FX', color: '#ec4899' },
    { title: 'Bars', color: '#14b8a6' },
    { title: 'Atmos', color: '#94a3b8' },
    { title: '', color: '#6366f1' }
  ],
  modes: grid.map((col) => col.map((sid) => (sid === chorus.id ? 'flash' : sid === hits.id ? 'trigger' : 'toggle')))
}

// ---------------------------------------------------------------- timeline
const clip = (cl, trackIndex, startTime, duration, color) => ({ id: id('clip'), cuelistId: cl.id, trackIndex, startTime, duration, color })
const timeline = {
  trackCount: 3,
  trackNames: ['Washes', 'Movers', 'Specials'],
  clips: [
    clip(intro, 0, 0, 24, '#22c55e'), clip(verse, 0, 24, 32, '#22c55e'), clip(warm, 0, 56, 30, '#ff7a1a'), clip(finale, 0, 86, 20, '#22c55e'),
    clip(beams, 1, 16, 40, '#3b82f6'), clip(ballad, 1, 60, 40, '#3b82f6'),
    clip(haze, 2, 0, 60, '#94a3b8'), clip(chorus, 2, 40, 4, '#ec4899'), clip(hits, 2, 52, 2, '#ec4899')
  ],
  markers: [
    { id: id('mk'), time: 0, name: 'Intro', color: '#22c55e' },
    { id: id('mk'), time: 24, name: 'Verse', color: '#3b82f6' },
    { id: id('mk'), time: 40, name: 'Chorus', color: '#ec4899' },
    { id: id('mk'), time: 86, name: 'Finale', color: '#ff7a1a' }
  ],
  zones: [
    { id: id('zone'), name: 'Opening', startTime: 0, endTime: 24, color: '#22c55e', order: 0 },
    { id: id('zone'), name: 'Song 1', startTime: 24, endTime: 86, color: '#3b82f6', order: 1 },
    { id: id('zone'), name: 'Ending', startTime: 86, endTime: 106, color: '#ff7a1a', order: 2 }
  ]
}

// ---------------------------------------------------------------- MIDI
const note = (name, n, target, behavior = 'toggle') => ({
  id: id('midi'), name, source: { type: 'note', channel: 1, number: n }, target,
  options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior }
})
const midiMappings = [
  { id: id('midi'), name: 'Grand Master', source: { type: 'cc', channel: 1, number: 7 }, target: { type: 'master' }, options: { min: 0, max: 255, inverted: false, encoding: 'absolute', behavior: 'direct' } },
  note('Warm Wash GO', 36, { type: 'cuelist_go', id: warm.id }),
  note('Cool Blue GO', 37, { type: 'cuelist_go', id: cool.id }),
  note('Chorus Punch', 38, { type: 'cuelist_go', id: chorus.id }, 'flash'),
  note('Strobe Hits', 39, { type: 'cuelist_go', id: hits.id }, 'trigger'),
  note('Blackout', 40, { type: 'blackout' }),
  note('Blinder', 41, { type: 'blinder' }, 'trigger'),
  note('Par Chase', 42, { type: 'chase_toggle', id: chases[0].id })
]

// ---------------------------------------------------------------- show
const now = '2026-10-01T20:00:00.000Z'
const show = {
  version: '2',
  name: 'Club Night Demo',
  createdAt: now,
  modifiedAt: now,
  patch,
  groups,
  presets: [
    { id: id('preset'), name: 'Pars Red', type: 'color', values: Object.fromEntries(pars.map((p) => [p, { Red: 255, Green: 0, Blue: 0, Amber: 0 }])) },
    { id: id('preset'), name: 'Spots Center', type: 'position', values: Object.fromEntries(spots.map((p) => [p, { Pan: 128, Tilt: 128 }])) }
  ],
  cuelists,
  chases,
  effects,
  midiMappings,
  stageLayout: {
    width: 1200,
    height: 600,
    fixtures: patch.map((p) => ({ patchId: p.id, x: p.stagePosition.x, y: p.stagePosition.y, rotation: 0, scale: 1 }))
  },
  roomConfig: {
    width: 16, depth: 12, height: 6, stageEdgeZ: -2,
    trussBars: [
      { id: 'truss-front', name: 'FOH', z: -4.5, y: 5.95, width: 12 },
      { id: 'truss-1', name: 'Truss 1', z: -3, y: 5.95, width: 14 },
      { id: 'truss-2', name: 'Truss 2', z: 0, y: 5.95, width: 14 },
      { id: 'truss-3', name: 'Truss 3', z: 3, y: 5.95, width: 14 }
    ]
  },
  timeline,
  executor
}

writeFileSync(out, JSON.stringify(show, null, 2) + '\n')
console.log(`wrote ${out}: ${patch.length} fixtures, ${cuelists.length} scenes, ${chases.length} chases, ${effects.length} effects`)
