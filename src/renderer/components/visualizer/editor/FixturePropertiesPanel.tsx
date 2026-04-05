import React from 'react'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useVisualizerStore } from '@renderer/stores/visualizer-store'
import type { Position3D } from '@shared/types'

export function FixturePropertiesPanel({ className = '' }: { className?: string }) {
  const { patch, fixtures, updateFixture } = usePatchStore()
  const { selectedFixtureId, roomConfig } = useVisualizerStore()

  const entry = patch.find(p => p.id === selectedFixtureId)
  const def   = entry ? fixtures.find(f => f.id === entry.fixtureDefId) : null

  if (!entry) {
    return (
      <div className={`flex items-center justify-center text-xs text-gray-600 ${className}`}>
        Click a fixture to edit its position
      </div>
    )
  }

  const pos: Position3D = entry.position3D ?? {
    x: 0,
    y: roomConfig.height - 0.05,
    z: 0
  }

  const update = (key: keyof Position3D, value: number) => {
    updateFixture(entry.id, { position3D: { ...pos, [key]: value } })
  }

  const mountingAngle = entry.mountingAngle ?? 0
  const mountingPan = entry.mountingPan ?? 0
  const beamAngle = entry.beamAngle ?? def?.physical?.lens?.degreesMinMax?.[1] ?? 25
  const isMovingHead = def?.categories.includes('Moving Head') ?? false

  return (
    <div className={`overflow-auto p-3 space-y-4 ${className}`}>
      {/* Header */}
      <div>
        <div className="text-sm font-semibold text-gray-200">{entry.name}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">
          {def?.name} — U{entry.universe + 1}.{entry.address}
        </div>
      </div>

      {/* Position */}
      <section>
        <h3 className="text-[10px] text-gray-500 uppercase mb-2">Position (metres)</h3>
        <div className="space-y-1.5">
          {([
            { label: 'X  (left ← → right)', key: 'x' as const, min: -50, max: 50, step: 0.1 },
            { label: 'Y  (height from floor)', key: 'y' as const, min: 0, max: 20, step: 0.1 },
            { label: 'Z  (↑ upstage / ↓ DS)', key: 'z' as const, min: -50, max: 50, step: 0.1 }
          ]).map(({ label, key, min, max, step }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-gray-500">{label}</label>
                <span className="text-[10px] font-mono text-accent">{pos[key].toFixed(2)}m</span>
              </div>
              <input
                type="range"
                min={min} max={max} step={step}
                value={pos[key]}
                onChange={e => update(key, parseFloat(e.target.value))}
                className="w-full"
              />
              <input
                type="number"
                min={min} max={max} step={step}
                value={pos[key]}
                onChange={e => update(key, parseFloat(e.target.value) || 0)}
                className="input w-full text-[10px] mt-0.5"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Mounting angle & direction (static fixtures only) */}
      {!isMovingHead && (
        <section>
          <h3 className="text-[10px] text-gray-500 uppercase mb-2">Aim / Tilt</h3>
          {/* Tilt (mounting angle) */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-gray-500">Tilt (0° = down · 90° = horiz)</span>
              <span className="text-[10px] font-mono text-accent">{mountingAngle}°</span>
            </div>
            <input
              type="range" min={-90} max={90} step={1}
              value={mountingAngle}
              onChange={e => updateFixture(entry.id, { mountingAngle: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
          {/* Pan (direction) */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-gray-500">Direction (0° = front)</span>
              <span className="text-[10px] font-mono text-accent">{mountingPan}°</span>
            </div>
            <input
              type="range" min={-180} max={180} step={1}
              value={mountingPan}
              onChange={e => updateFixture(entry.id, { mountingPan: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>
        </section>
      )}

      {/* Pan/Tilt Invert (moving heads only) */}
      {isMovingHead && (
        <section>
          <h3 className="text-[10px] text-gray-500 uppercase mb-2">Pan / Tilt Invert</h3>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={entry.panInvert ?? false}
                onChange={e => updateFixture(entry.id, { panInvert: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-[10px] text-gray-400">Pan Invert</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={entry.tiltInvert ?? false}
                onChange={e => updateFixture(entry.id, { tiltInvert: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-[10px] text-gray-400">Tilt Invert</span>
            </label>
          </div>
        </section>
      )}

      {/* Beam angle */}
      <section>
        <h3 className="text-[10px] text-gray-500 uppercase mb-2">Beam Angle</h3>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Cone spread</span>
          <span className="text-[10px] font-mono text-accent">{beamAngle}°</span>
        </div>
        <input
          type="range" min={2} max={90} step={1}
          value={beamAngle}
          onChange={e => updateFixture(entry.id, { beamAngle: parseInt(e.target.value) })}
          className="w-full"
        />
      </section>

      {/* Quick actions */}
      <section className="space-y-1">
        <h3 className="text-[10px] text-gray-500 uppercase mb-2">Quick Placement</h3>
        <button
          className="btn-secondary text-[10px] w-full"
          onClick={() => update('y', roomConfig.height - 0.05)}
        >
          Snap to ceiling ({(roomConfig.height - 0.05).toFixed(1)}m)
        </button>
        <button
          className="btn-secondary text-[10px] w-full"
          onClick={() => update('y', 4)}
        >
          Snap to 4m (low truss)
        </button>
        <button
          className="btn-ghost text-[10px] w-full text-red-400 hover:text-red-300"
          onClick={() => updateFixture(entry.id, { position3D: undefined, mountingAngle: undefined, mountingPan: undefined })}
        >
          Reset to auto-position
        </button>
      </section>
    </div>
  )
}
