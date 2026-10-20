import { describe, expect, it } from 'vitest'
import type { PatchEntry, TrussBar } from '@shared/types'
import { aimDirection, autoPosition, barForFixture, distributeOnBar, fixturePosition, rayToRoom } from './layout-math'

const room = { width: 16, depth: 12, height: 6 }
const entry = (p: Partial<PatchEntry>): PatchEntry => ({ id: 'a', fixtureDefId: 'x', modeName: 'm', universe: 0, address: 1, name: 'A', groupIds: [], ...p })
const close = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 5)
  expect(v.y).toBeCloseTo(y, 5)
  expect(v.z).toBeCloseTo(z, 5)
}

describe('aimDirection', () => {
  it('points straight down for an untilted ceiling fixture', () => {
    close(aimDirection({}), 0, -1, 0)
  })
  it('leans towards upstage (+Z) with a positive tilt', () => {
    const d = aimDirection({ mountingAngle: 30 })
    expect(d.z).toBeCloseTo(0.5, 5)
    expect(d.y).toBeCloseTo(-Math.cos(Math.PI / 6), 5)
  })
  it('turns the lean around the vertical axis with the direction', () => {
    const d = aimDirection({ mountingAngle: 90, mountingPan: 90 })
    close(d, 1, 0, 0)
    close(aimDirection({ mountingAngle: 90, mountingPan: 180 }), 0, 0, -1)
  })
  it('aims floor and wall mounts into the room', () => {
    close(aimDirection({ mountingLocation: 'floor' }), 0, 1, 0)
    close(aimDirection({ mountingLocation: 'wall-left' }), 1, 0, 0)
    close(aimDirection({ mountingLocation: 'wall-right' }), -1, 0, 0)
    close(aimDirection({ mountingLocation: 'wall-back' }), 0, 0, -1)
  })
})

describe('rayToRoom', () => {
  it('hits the floor below a ceiling fixture', () => {
    const hit = rayToRoom({ x: 0, y: 5.9, z: 0 }, { x: 0, y: -1, z: 0 }, room)
    expect(hit?.surface).toBe('floor')
    expect(hit?.t).toBeCloseTo(5.9, 5)
  })
  it('hits the nearest wall first', () => {
    const hit = rayToRoom({ x: 7, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, room)
    expect(hit?.surface).toBe('wall-right')
    expect(hit?.t).toBeCloseTo(1, 5)
  })
  it('returns null when the beam leaves through the open audience side', () => {
    expect(rayToRoom({ x: 0, y: 3, z: -5 }, { x: 0, y: 0, z: -1 }, room)).toBeNull()
  })
  it('only stops on the floor when walls are hidden', () => {
    expect(rayToRoom({ x: 7, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, room, false)).toBeNull()
  })
})

describe('placement', () => {
  it('auto-positions on a grid, ceiling height by default', () => {
    const p = autoPosition(0, 4, room)
    expect(p.y).toBeCloseTo(5.95, 5)
    expect(autoPosition(0, 1, room).x).toBe(0)
  })
  it('uses the explicit position when set', () => {
    close(fixturePosition(entry({ position3D: { x: 1, y: 2, z: 3 } }), 0, 1, room), 1, 2, 3)
  })
  it('finds the bar a fixture hangs on', () => {
    const bars: TrussBar[] = [{ id: 'b1', name: 'B1', z: 3, y: 5.95, width: 14 }]
    expect(barForFixture({ x: 1, y: 5.9, z: 3 }, undefined, bars)?.id).toBe('b1')
    expect(barForFixture({ x: 1, y: 5.9, z: 2 }, undefined, bars)).toBeNull()
    expect(barForFixture({ x: 1, y: 0.1, z: 3 }, 'floor', bars)).toBeNull()
  })
  it('spreads fixtures evenly along a bar', () => {
    const xs = distributeOnBar({ id: 'b', name: 'B', z: 0, y: 6, width: 11 }, 3)
    expect(xs).toEqual([-5, 0, 5])
    expect(distributeOnBar({ id: 'b', name: 'B', z: 0, y: 6, width: 11 }, 1)).toEqual([0])
  })
})
