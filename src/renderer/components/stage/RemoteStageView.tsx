// ============================================================
// PhotonBoard — Remote Stage View
// Full-screen stage control UI for browser/mobile/tablet.
// Same layout as the Electron Stage window but reads from
// Zustand stores (populated by useRemoteSync) instead of IPC.
// ============================================================

import React, { useCallback, useRef } from 'react'
import { usePlaybackStore } from '@renderer/stores/playback-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { isRemote } from '@renderer/hooks/useRemoteSync'

const pb = () => (window as any).photonboard

function sendCommand(type: string, payload?: any) {
  if (isRemote()) {
    pb()?.remote?.sendCommand(type, payload)
  } else {
    // Local Electron: dispatch via stage command IPC
    pb()?.stage?.sendCommand?.({ type, payload })
  }
}

// ── Grand Master Fader ──────────────────────────────────────

function GrandMaster() {
  const grandMaster = useDmxStore(s => s.grandMaster)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const compute = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = 1 - (e.clientY - rect.top) / rect.height
    const val = Math.max(0, Math.min(255, Math.round(ratio * 255)))
    sendCommand('set-grand-master', val)
  }, [])

  const pct = Math.round((grandMaster / 255) * 100)

  return (
    <div className="flex flex-col items-center gap-1 p-2 flex-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Grand Master</span>
      <span className="text-lg font-bold tabular-nums text-white">{pct}%</span>
      <div
        ref={trackRef}
        className="relative flex-1 rounded-lg cursor-pointer"
        style={{ width: 40, backgroundColor: '#0f0f18', border: '1px solid #333', touchAction: 'none' }}
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); compute(e) }}
        onPointerMove={(e) => { if (dragging.current) compute(e) }}
        onPointerUp={() => { dragging.current = false }}
      >
        <div className="absolute bottom-0 left-0 right-0 rounded-b-lg" style={{
          height: `${pct}%`,
          background: 'linear-gradient(to top, #e85d04, #f59e0b)',
          opacity: 0.7,
        }} />
        <div className="absolute left-0 right-0" style={{
          bottom: `calc(${pct}% - 4px)`,
          height: 8,
          backgroundColor: '#e85d04',
          borderRadius: 3,
          border: '1px solid rgba(255,255,255,0.3)',
          boxShadow: '0 0 6px #e85d0488',
        }} />
      </div>
    </div>
  )
}

// ── Master Buttons ──────────────────────────────────────────

function MasterButtons() {
  const blackout = useDmxStore(s => s.blackout)

  return (
    <div className="flex flex-col gap-1.5 p-2 border-t border-surface-3">
      <button
        className="py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors"
        style={{
          backgroundColor: blackout ? '#dc2626' : '#1a1a2e',
          color: blackout ? '#fff' : '#888',
          border: `1px solid ${blackout ? '#dc2626' : '#333'}`,
          boxShadow: blackout ? '0 0 12px #dc262688' : 'none',
        }}
        onClick={() => sendCommand('toggle-blackout')}
      >
        Blackout
      </button>
      <button
        className="py-2 rounded-md text-xs font-bold uppercase tracking-wider"
        style={{ backgroundColor: '#1a1a2e', color: '#888', border: '1px solid #333' }}
        onClick={() => sendCommand('clear-programmer')}
      >
        Clear
      </button>
    </div>
  )
}

// ── Scene Cell (cuelist fader + GO/STOP) ────────────────────

function SceneCell({ cuelist }: { cuelist: { id: string; name: string; isPlaying: boolean; faderLevel: number } }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const compute = useCallback((e: React.PointerEvent) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = 1 - (e.clientY - rect.top) / rect.height
    const val = Math.max(0, Math.min(255, Math.round(ratio * 255)))
    sendCommand('set-cuelist-fader', { id: cuelist.id, level: val })
  }, [cuelist.id])

  const pct = Math.round((cuelist.faderLevel / 255) * 100)
  const active = cuelist.isPlaying

  return (
    <div className="flex flex-col items-center gap-1" style={{ minWidth: 56 }}>
      {/* Fader */}
      <div
        ref={trackRef}
        className="relative flex-1 w-full rounded-lg cursor-pointer"
        style={{
          backgroundColor: '#0f0f18',
          border: `1px solid ${active ? '#22c55e44' : '#333'}`,
          minHeight: 80,
          touchAction: 'none',
        }}
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); compute(e) }}
        onPointerMove={(e) => { if (dragging.current) compute(e) }}
        onPointerUp={() => { dragging.current = false }}
      >
        <div className="absolute bottom-0 left-0 right-0 rounded-b-lg" style={{
          height: `${pct}%`,
          background: active
            ? 'linear-gradient(to top, #22c55e, #4ade80)'
            : 'linear-gradient(to top, #555, #777)',
          opacity: 0.5,
        }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] font-mono tabular-nums text-white/70">{pct}%</span>
        </div>
      </div>

      {/* GO / STOP button */}
      <button
        className="w-full py-1.5 rounded text-[11px] font-bold uppercase transition-colors"
        style={{
          backgroundColor: active ? '#dc2626' : '#166534',
          color: '#fff',
          border: 'none',
          boxShadow: active ? '0 0 8px #dc262666' : '0 0 8px #22c55e44',
        }}
        onClick={() => sendCommand(active ? 'stop-cuelist' : 'go-cuelist', cuelist.id)}
      >
        {active ? 'STOP' : 'GO'}
      </button>

      {/* Name */}
      <span className="text-[9px] text-gray-500 text-center truncate w-full px-0.5">
        {cuelist.name}
      </span>
    </div>
  )
}

// ── Group Buttons ───────────────────────────────────────────

function GroupBar() {
  const groups = usePatchStore(s => s.groups).filter(g => !g.parentGroupId)

  if (groups.length === 0) return null

  return (
    <div className="flex gap-1 p-1.5 overflow-x-auto border-b border-surface-3 shrink-0">
      {groups.map(g => (
        <button
          key={g.id}
          className="px-2.5 py-1 rounded text-[10px] font-medium whitespace-nowrap"
          style={{ backgroundColor: g.color || '#333', color: '#fff', border: 'none', opacity: 0.8 }}
          onClick={() => sendCommand('select-group', g.id)}
        >
          {g.name}
        </button>
      ))}
      <button
        className="px-2.5 py-1 rounded text-[10px] text-gray-400"
        style={{ backgroundColor: '#1a1a2e', border: '1px solid #333' }}
        onClick={() => sendCommand('clear-selection')}
      >
        Clear
      </button>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────

export function RemoteStageView() {
  const cuelists = usePlaybackStore(s => s.cuelists)
  const showName = useUiStore(s => s.showName)

  return (
    <div className="flex h-full w-full bg-surface-0 overflow-hidden">
      {/* Left: Grand Master + Buttons */}
      <div className="w-20 shrink-0 flex flex-col border-r border-surface-3 bg-surface-1">
        <div className="p-1.5 text-center border-b border-surface-3">
          <div className="text-[9px] text-gray-500 truncate">{showName}</div>
        </div>
        <GrandMaster />
        <MasterButtons />
      </div>

      {/* Center: Groups + Executor Grid */}
      <div className="flex-1 flex flex-col min-w-0">
        <GroupBar />
        <div className="flex-1 grid gap-2 p-2 overflow-auto" style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(60px, 1fr))`,
          alignContent: 'start',
        }}>
          {cuelists.map(cl => (
            <SceneCell key={cl.id} cuelist={cl} />
          ))}
          {cuelists.length === 0 && (
            <div className="col-span-full flex items-center justify-center text-gray-600 text-sm h-40">
              Aucune scene
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
