// The published JSON Schema of the show format (docs/format) must accept
// every show PhotonBoard writes, and the demo show. A tiny validator
// (the JSON Schema subset the schema uses) keeps this dependency-free.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createEmptyShow, createExecutorPage, executorLayoutFromPages, normalizeShow } from './show-format'

type Schema = Record<string, any>

const ROOT = resolve(__dirname, '../..')
const schema: Schema = JSON.parse(readFileSync(resolve(ROOT, 'docs/format/photonboard-show.schema.json'), 'utf8'))

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function typeMatches(want: string, v: unknown): boolean {
  const t = typeOf(v)
  return want === t || (want === 'number' && t === 'integer')
}

/** Errors of `value` against `s` (subset: type, enum, const, properties, required, additionalProperties, items, min/max, minLength, $ref, anyOf, oneOf) */
function validate(s: Schema, value: unknown, path = '$', root: Schema = s): string[] {
  if (s.$ref) {
    const name = String(s.$ref).replace('#/$defs/', '')
    const target = root.$defs?.[name]
    if (!target) return [`${path}: unknown $ref ${s.$ref}`]
    return validate(target, value, path, root)
  }
  const errors: string[] = []
  if (s.type) {
    const types: string[] = Array.isArray(s.type) ? s.type : [s.type]
    if (!types.some((t) => typeMatches(t, value))) return [`${path}: expected ${types.join('|')}, got ${typeOf(value)}`]
  }
  if (s.enum && !s.enum.some((e: unknown) => e === value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`)
  if ('const' in s && s.const !== value) errors.push(`${path}: not ${JSON.stringify(s.const)}`)
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${path}: ${value} < ${s.minimum}`)
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${path}: ${value} > ${s.maximum}`)
  }
  if (typeof value === 'string' && typeof s.minLength === 'number' && value.length < s.minLength) errors.push(`${path}: too short`)
  if (Array.isArray(value) && s.items) value.forEach((v, i) => errors.push(...validate(s.items, v, `${path}[${i}]`, root)))
  if (typeOf(value) === 'object') {
    const o = value as Record<string, unknown>
    for (const r of s.required ?? []) if (!(r in o)) errors.push(`${path}: missing ${r}`)
    for (const [k, v] of Object.entries(o)) {
      if (s.properties?.[k]) errors.push(...validate(s.properties[k], v, `${path}.${k}`, root))
      else if (s.additionalProperties === false) errors.push(`${path}: unexpected ${k}`)
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') errors.push(...validate(s.additionalProperties, v, `${path}.${k}`, root))
    }
  }
  if (s.anyOf && !s.anyOf.some((sub: Schema) => validate(sub, value, path, root).length === 0)) errors.push(`${path}: matches none of anyOf`)
  if (s.oneOf) {
    const ok = s.oneOf.filter((sub: Schema) => validate(sub, value, path, root).length === 0).length
    if (ok !== 1) errors.push(`${path}: matches ${ok} of oneOf`)
  }
  return errors
}

const demoRaw = JSON.parse(readFileSync(resolve(ROOT, 'scripts/dev/demo-show.pbshow'), 'utf8'))

/** A v3 show with every pro feature */
function proShow() {
  const show = normalizeShow(demoRaw).show
  const page = createExecutorPage('page-2', 'Pro')
  page.cells[0][0] = { kind: 'chase', id: show.chases[0].id, mode: 'toggle', button: 'go' }
  page.columns[1] = { title: 'Speed', color: '#fff', fader: { kind: 'speed', id: 'sm1' } }
  show.executor = executorLayoutFromPages([...(show.executor?.pages ?? []), page])
  show.macros = [{ id: 'm1', number: 1, name: 'Reset', lines: [{ command: 'Clear' }, { command: 'Go Sequence 1', wait: 2 }] }]
  show.speedMasters = [{ id: 'sm1', number: 1, name: 'Speed 1', bpm: 120 }]
  show.stagePages = [{ id: 'sp1', name: 'Main', cols: 8, rows: 6, widgets: [{ id: 'w1', x: 0, y: 0, w: 2, h: 1, kind: 'macro', ref: 'm1', options: { big: true } }] }]
  show.parked = [{ fixtureId: show.patch[0].id, channelName: 'Dimmer', value: 0 }]
  show.groupMasters = { [show.groups[0].id]: 128 }
  const cue = show.cuelists[0].cues[0]
  cue.featureTiming = { position: { fade: 4, delay: 1 } }
  cue.parts = [{ index: 1, name: 'Late', fade: 3 }]
  cue.followMode = 'after-go'
  show.presets[0].scope = 'global'
  show.presets[0].typeValues = { [show.patch[0].fixtureDefId]: { Dimmer: 255 } }
  show.cuelists[0].mib = { enabled: true, delay: 1, fade: 2 }
  return normalizeShow(show).show
}

describe('show JSON Schema (docs/format/photonboard-show.schema.json)', () => {
  it('is a 2020-12 schema whose $refs all resolve', () => {
    expect(schema.$schema).toContain('2020-12')
    const refs = JSON.stringify(schema).match(/#\/\$defs\/\w+/g) ?? []
    for (const r of refs) expect(schema.$defs[r.replace('#/$defs/', '')], r).toBeTruthy()
  })

  it('accepts the demo show as shipped (v2)', () => {
    expect(validate(schema, demoRaw)).toEqual([])
  })

  it('accepts shows as PhotonBoard writes them (v3)', () => {
    expect(validate(schema, normalizeShow(demoRaw).show)).toEqual([])
    expect(validate(schema, createEmptyShow('Empty'))).toEqual([])
    expect(validate(schema, JSON.parse(JSON.stringify(proShow())))).toEqual([])
  })

  it('accepts the minimal example of docs/format/README.md, which PhotonBoard loads as is', () => {
    const readme = readFileSync(resolve(ROOT, 'docs/format/README.md'), 'utf8')
    const example = JSON.parse(/```json\n([\s\S]*?)```/.exec(readme)![1])
    expect(validate(schema, example)).toEqual([])
    const { show, warnings } = normalizeShow(example)
    expect(warnings).toEqual([])
    expect(show.cuelists[0].cues[0].values[0]).toEqual({ fixtureId: 'par-1', channelName: 'Dimmer', value: 255 })
  })

  it('rejects what PhotonBoard would not write', () => {
    expect(validate(schema, { name: 'x' })).not.toEqual([])
    expect(validate(schema, { patch: [{ id: 'a', fixtureDefId: 'x', modeName: 'm', universe: 99, address: 1 }] })[0]).toMatch(/universe/)
    expect(validate(schema, { patch: [], cuelists: [{ id: 'c', cues: [{ id: 'q', values: [{ fixtureId: 'a', channelName: 'Dimmer', value: 300 }] }] }] })).not.toEqual([])
    expect(validate(schema, { version: '3', executor: { pages: [{ cells: [[{ kind: 'nope', id: 'x' }]] }] } })).not.toEqual([])
  })
})
