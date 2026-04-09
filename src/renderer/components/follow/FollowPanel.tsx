import React, { useEffect, useState } from 'react'
import { useFollowStore, startFollowGamepadLoop, stopFollowGamepadLoop } from '@renderer/stores/follow-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { XBOX_BUTTONS } from '@renderer/lib/gamepad-manager'

const BUTTON_NAMES: Record<number, string> = {
  [XBOX_BUTTONS.A]: 'A',
  [XBOX_BUTTONS.B]: 'B',
  [XBOX_BUTTONS.X]: 'X',
  [XBOX_BUTTONS.Y]: 'Y',
  [XBOX_BUTTONS.LB]: 'LB',
  [XBOX_BUTTONS.RB]: 'RB',
  [XBOX_BUTTONS.LT]: 'LT',
  [XBOX_BUTTONS.RT]: 'RT',
  [XBOX_BUTTONS.BACK]: 'Back',
  [XBOX_BUTTONS.START]: 'Start',
  [XBOX_BUTTONS.L3]: 'L3',
  [XBOX_BUTTONS.R3]: 'R3'
}

export function FollowPanel() {
  const {
    fixtureIds, activateButton, sensitivity, targetHeight, followDimmer,
    active, targetX, targetY, targetZ,
    gamepadConnected, gamepadName,
    invertX, invertZ, invertY,
    setConfig, addFixture, removeFixture, toggleActive
  } = useFollowStore()

  const { patch, fixtures } = usePatchStore()
  const [learningButton, setLearningButton] = useState(false)

  // Start/stop the gamepad loop when this panel mounts/unmounts
  useEffect(() => {
    startFollowGamepadLoop()
    return () => stopFollowGamepadLoop()
  }, [])

  // Button learn mode
  useEffect(() => {
    if (!learningButton) return
    const interval = setInterval(() => {
      const gp = navigator.getGamepads()[0]
      if (!gp) return
      for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i].pressed) {
          setConfig({ activateButton: i })
          setLearningButton(false)
          break
        }
      }
    }, 50)
    return () => clearInterval(interval)
  }, [learningButton])

  // Filter to moving-head fixtures only
  const movingHeads = patch.filter(entry => {
    const def = fixtures.find(f => f.id === entry.fixtureDefId)
    return def?.categories.includes('Moving Head')
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="panel-header flex items-center gap-3">
        <span className="font-semibold text-sm">Follow Subject</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          active ? 'bg-green-600/30 text-green-400' : 'bg-surface-3 text-gray-500'
        }`}>
          {active ? 'TRACKING' : 'STANDBY'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        {/* ── Gamepad Status ── */}
        <section>
          <h3 className="text-[10px] uppercase text-gray-500 mb-1.5 tracking-wider">Gamepad</h3>
          <div className={`p-2 rounded border ${
            gamepadConnected
              ? 'border-green-800/50 bg-green-950/20'
              : 'border-red-900/50 bg-red-950/10'
          }`}>
            {gamepadConnected ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-green-400 truncate">{gamepadName}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span className="text-red-400">No controller connected</span>
              </div>
            )}
          </div>
        </section>

        {/* ── Fixture Selection ── */}
        <section>
          <h3 className="text-[10px] uppercase text-gray-500 mb-1.5 tracking-wider">
            Follow Fixtures ({fixtureIds.length})
          </h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {movingHeads.length === 0 && (
              <p className="text-gray-600 italic">No moving head fixtures patched</p>
            )}
            {movingHeads.map(entry => {
              const isSelected = fixtureIds.includes(entry.id)
              const hasPosition = !!entry.position3D
              return (
                <button
                  key={entry.id}
                  onClick={() => isSelected ? removeFixture(entry.id) : addFixture(entry.id)}
                  className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors ${
                    isSelected
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-surface-2 text-gray-400 hover:bg-surface-3 border border-transparent'
                  }`}
                  title={hasPosition ? undefined : 'Position 3D non definie — placer dans Stage Layout'}
                >
                  <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${
                    isSelected ? 'border-accent bg-accent' : 'border-gray-600'
                  }`}>
                    {isSelected && <span className="text-white text-[8px]">&#10003;</span>}
                  </span>
                  <span className="flex-1 truncate">{entry.name}</span>
                  <span className="text-gray-600">U{entry.universe + 1}.{entry.address}</span>
                  {!hasPosition && <span className="text-yellow-600 text-[9px]">no pos</span>}
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Controls ── */}
        <section>
          <h3 className="text-[10px] uppercase text-gray-500 mb-1.5 tracking-wider">Controls</h3>
          <div className="space-y-2">
            {/* Activate button */}
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Trigger button</span>
              <button
                onClick={() => setLearningButton(!learningButton)}
                className={`px-2 py-1 rounded text-[10px] font-mono ${
                  learningButton
                    ? 'bg-purple-600/30 text-purple-400 animate-pulse'
                    : 'bg-surface-3 text-gray-300 hover:bg-surface-4'
                }`}
              >
                {learningButton ? 'Press a button...' : (BUTTON_NAMES[activateButton] ?? `Btn ${activateButton}`)}
              </button>
            </div>

            {/* Sensitivity */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Speed</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.5}
                  max={12}
                  step={0.5}
                  value={sensitivity}
                  onChange={e => setConfig({ sensitivity: parseFloat(e.target.value) })}
                  className="w-24 accent-accent"
                />
                <span className="text-gray-500 w-10 text-right">{sensitivity} m/s</span>
              </div>
            </div>

            {/* Target height */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Target height</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.1}
                  value={targetHeight}
                  onChange={e => setConfig({ targetHeight: parseFloat(e.target.value) })}
                  className="w-24 accent-accent"
                />
                <span className="text-gray-500 w-10 text-right">{targetHeight.toFixed(1)}m</span>
              </div>
            </div>

            {/* Follow dimmer */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Dimmer</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={255}
                  step={1}
                  value={followDimmer}
                  onChange={e => setConfig({ followDimmer: parseInt(e.target.value) })}
                  className="w-24 accent-accent"
                />
                <span className="text-gray-500 w-10 text-right">{Math.round(followDimmer / 2.55)}%</span>
              </div>
            </div>

            {/* Axis invert */}
            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
                <input type="checkbox" checked={invertX} onChange={e => setConfig({ invertX: e.target.checked })} className="accent-accent" />
                Invert X
              </label>
              <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
                <input type="checkbox" checked={invertZ} onChange={e => setConfig({ invertZ: e.target.checked })} className="accent-accent" />
                Invert Z
              </label>
              <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
                <input type="checkbox" checked={invertY} onChange={e => setConfig({ invertY: e.target.checked })} className="accent-accent" />
                Invert Y
              </label>
            </div>
          </div>
        </section>

        {/* ── Target Info (when active) ── */}
        {active && (
          <section>
            <h3 className="text-[10px] uppercase text-gray-500 mb-1.5 tracking-wider">Target Position</h3>
            <div className="grid grid-cols-3 gap-2 font-mono text-center">
              <div className="bg-surface-2 rounded p-1.5">
                <div className="text-[9px] text-gray-500">X</div>
                <div className="text-accent">{targetX.toFixed(2)}m</div>
              </div>
              <div className="bg-surface-2 rounded p-1.5">
                <div className="text-[9px] text-gray-500">Y</div>
                <div className="text-accent">{targetY.toFixed(2)}m</div>
              </div>
              <div className="bg-surface-2 rounded p-1.5">
                <div className="text-[9px] text-gray-500">Z</div>
                <div className="text-accent">{targetZ.toFixed(2)}m</div>
              </div>
            </div>
          </section>
        )}

        {/* ── Usage ── */}
        <section className="border-t border-surface-3 pt-3">
          <h3 className="text-[10px] uppercase text-gray-500 mb-1.5 tracking-wider">Usage</h3>
          <ul className="space-y-1 text-[10px] text-gray-500 leading-relaxed">
            <li>1. Select moving head fixtures above</li>
            <li>2. Place them in Stage Layout (positions required)</li>
            <li>3. Hold <b className="text-gray-300">{BUTTON_NAMES[activateButton] ?? `Button ${activateButton}`}</b> on the gamepad to activate</li>
            <li>4. <b className="text-gray-300">Left stick</b> = move target on stage (X/Z)</li>
            <li>5. <b className="text-gray-300">Right stick Y</b> = adjust height</li>
            <li>6. Release trigger to deactivate</li>
          </ul>
        </section>

        {/* Manual test button */}
        <button
          onClick={toggleActive}
          disabled={fixtureIds.length === 0}
          className={`w-full py-2 rounded font-medium transition-colors ${
            active
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : fixtureIds.length === 0
                ? 'bg-surface-3 text-gray-600 cursor-not-allowed'
                : 'bg-accent hover:bg-accent/80 text-white'
          }`}
        >
          {active ? 'Stop Follow' : 'Test Follow (manual)'}
        </button>
      </div>
    </div>
  )
}
