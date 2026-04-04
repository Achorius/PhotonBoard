import React from 'react'
import { useVisualizerStore, type VisualizerSubTab } from '@renderer/stores/visualizer-store'
import { ThreeCanvas } from './ThreeCanvas'
import { LayoutEditor2D } from './editor/LayoutEditor2D'
import { SideView } from './editor/SideView'
import { FixturePropertiesPanel } from './editor/FixturePropertiesPanel'
import { exportStagePDF } from '@renderer/lib/pdf-export'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'

export function VisualizerView() {
  const {
    subTab, setSubTab,
    roomConfig, setRoomConfig,
    showBeams, setShowBeams,
    showRoom, setShowRoom,
    showGrid, setShowGrid,
    shadowsEnabled, setShadowsEnabled,
    snapToGrid, setSnapToGrid
  } = useVisualizerStore()

  const { patch, fixtures } = usePatchStore()
  const { showName } = useUiStore()

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-3 bg-surface-1 flex-wrap">
        {/* Sub-tabs */}
        <div className="flex gap-0.5 mr-2">
          {(['3d', 'layout'] as VisualizerSubTab[]).map(tab => (
            <button
              key={tab}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                subTab === tab ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400 hover:bg-surface-4'
              }`}
              onClick={() => setSubTab(tab)}
            >
              {tab === '3d' ? '3D View' : 'Stage Layout'}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-surface-3" />

        {/* Room dimensions */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500">Room:</span>
          {(['width', 'depth', 'height'] as const).map(dim => (
            <label key={dim} className="flex items-center gap-0.5">
              <span className="text-[10px] text-gray-600">{dim[0].toUpperCase()}</span>
              <input
                type="number"
                min={2} max={100} step={0.5}
                value={roomConfig[dim]}
                onChange={e => setRoomConfig({ [dim]: parseFloat(e.target.value) || 10 })}
                className="input w-12 text-[10px] py-0.5 text-center"
              />
              <span className="text-[10px] text-gray-600">m</span>
            </label>
          ))}
        </div>

        <div className="w-px h-4 bg-surface-3" />

        {/* Toggles */}
        <div className="flex items-center gap-2">
          {[
            { label: 'Beams', value: showBeams, set: setShowBeams },
            { label: 'Room',  value: showRoom,  set: setShowRoom  },
            { label: 'Grid',  value: showGrid,  set: setShowGrid  },
            { label: 'Snap',  value: snapToGrid, set: setSnapToGrid }
          ].map(({ label, value, set }) => (
            <button
              key={label}
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                value ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-surface-3 text-gray-500'
              }`}
              onClick={() => set(!value)}
            >
              {label}
            </button>
          ))}
          {subTab === '3d' && (
            <button
              className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                shadowsEnabled ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-600/30' : 'bg-surface-3 text-gray-500'
              }`}
              onClick={() => setShadowsEnabled(!shadowsEnabled)}
              title="Shadows are GPU-intensive"
            >
              Shadows
            </button>
          )}
        </div>

        <div className="flex-1" />

        {subTab === '3d' && (
          <span className="text-[10px] text-gray-600">
            Orbit: drag · Zoom: scroll · Pan: right-drag
          </span>
        )}
        {subTab === 'layout' && (
          <button
            className="px-2 py-0.5 rounded text-[10px] bg-surface-3 text-gray-400 hover:bg-surface-4 hover:text-gray-200"
            onClick={() => exportStagePDF(patch, fixtures, roomConfig, showName)}
          >
            Export PDF
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {subTab === '3d' ? (
          <ThreeCanvas />
        ) : (
          <div className="flex h-full">
            {/* Left: top-down + side view */}
            <div className="flex-1 flex flex-col min-w-0">
              <LayoutEditor2D />
              <div className="h-px bg-surface-3" />
              <SideView className="h-36 shrink-0" />
            </div>
            {/* Right: properties */}
            <div className="w-60 border-l border-surface-3 shrink-0">
              <div className="panel-header">Properties</div>
              <FixturePropertiesPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
