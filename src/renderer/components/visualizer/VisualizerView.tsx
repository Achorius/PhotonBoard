// ============================================================
// 3D visualiser view: toolbar (camera presets, view toggles, quality,
// room, fullscreen), the WebGL canvas with a floating fixture inspector,
// and the quick programmer strip for the selection.
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import {
  LuBox, LuCable, LuCloudFog, LuEye, LuFlashlight, LuGrid3X3, LuHash, LuMaximize, LuMinimize, LuMinus, LuPanelLeft,
  LuPanelRight, LuPlus, LuRectangleHorizontal, LuRuler, LuSquareDashed, LuSunMoon, LuTriangleAlert, LuWarehouse
} from 'react-icons/lu'
import {
  Button, Divider, EmptyState, IconButton, Popover, SegmentedControl, Slider, ToggleButton, ToolbarGroup, Tooltip, cn, usePopover
} from '@renderer/components/ui'
import { useVisualizerStore, type VisualizerQuality } from '@renderer/stores/visualizer-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { ThreeCanvas } from './ThreeCanvas'
import { FixturePropertiesPanel } from './editor/FixturePropertiesPanel'
import { RoomFields } from './editor/RigPanels'
import { SelectionControls } from './SelectionControls'
import type { CameraPreset, VisualizerEngine } from './scene/VisualizerEngine'

/** Catch WebGL / three.js crashes and offer a way out instead of a blank view */
class WebGLErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    if (this.state.error !== null) {
      return (
        <EmptyState
          icon={LuTriangleAlert}
          title="3D view crashed"
          description={this.state.error || 'The 3D renderer stopped unexpectedly.'}
          action={
            <>
              <Button variant="primary" onClick={() => this.setState({ error: null })}>Try again</Button>
              <Button onClick={() => useUiStore.getState().setActiveTab('stage-layout')}>Open stage layout</Button>
            </>
          }
        />
      )
    }
    return this.props.children
  }
}

const CAMERAS: Array<{ id: CameraPreset; label: string; icon: typeof LuBox; hint: string }> = [
  { id: 'perspective', label: 'Persp', icon: LuBox, hint: 'Perspective view' },
  { id: 'front', label: 'Front', icon: LuRectangleHorizontal, hint: 'From the audience' },
  { id: 'top', label: 'Top', icon: LuSquareDashed, hint: 'Plan view from above' },
  { id: 'side', label: 'Side', icon: LuPanelLeft, hint: 'From stage left' }
]

const QUALITY_ITEMS: Array<{ value: VisualizerQuality; label: string; title: string }> = [
  { value: 'low', label: 'Low', title: 'Low — 20 fps, reduced resolution, no real lights' },
  { value: 'medium', label: 'Med', title: 'Medium — 30 fps, 4 real lights' },
  { value: 'high', label: 'High', title: 'High — up to 60 fps, full resolution, 10 real lights' }
]

export function VisualizerView() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<VisualizerEngine | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const selectedFixtureId = useVisualizerStore((s) => s.selectedFixtureId)
  const patchCount = usePatchStore((s) => s.patch.length)
  const touch = useUiStore((s) => s.density === 'touch')

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-surface-0">
      <header className="flex h-control-lg shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface-1 px-3">
        <LuBox size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <h1 className="shrink-0 text-sm font-semibold text-fg-primary">Visualiser</h1>
        <Divider />
        <ToolbarGroup aria-label="Camera">
          {CAMERAS.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="ghost"
              icon={c.icon}
              tooltip={c.hint}
              aria-label={c.hint}
              labelClassName="hidden xl:inline"
              disabled={!engine}
              onClick={() => engine?.setCameraPreset(c.id)}
            >
              {c.label}
            </Button>
          ))}
        </ToolbarGroup>
        <Divider />
        <ViewToggles />
        <Divider />
        <QualityControl engine={engine} />
        <div className="flex-1" />
        <ToggleButton
          size="sm"
          variant="ghost"
          tone="neutral"
          icon={LuPanelRight}
          pressed={inspectorOpen}
          onPressedChange={setInspectorOpen}
          tooltip="Fixture inspector"
          aria-label="Fixture inspector"
          labelClassName="hidden xl:inline"
        >
          Inspector
        </ToggleButton>
        <RoomButton />
        <IconButton
          size="sm"
          icon={fullscreen ? LuMinimize : LuMaximize}
          label={fullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={toggleFullscreen}
        />
      </header>

      <div className="relative min-h-0 flex-1">
        <WebGLErrorBoundary>
          <ThreeCanvas onEngine={setEngine} />
        </WebGLErrorBoundary>

        {patchCount === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
            <div className="pointer-events-auto rounded-lg border border-line bg-surface-overlay shadow-popover">
              <EmptyState
                size="sm"
                icon={LuCable}
                title="No fixtures patched"
                description="Patched fixtures appear here with live beams."
                action={<Button size="sm" variant="primary" icon={LuPlus} onClick={() => useUiStore.getState().setActiveTab('patch')}>Add fixtures</Button>}
              />
            </div>
          </div>
        )}

        {/* Zoom buttons for fingers (pinch works too) */}
        {engine && (
          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-line bg-surface-1/90 shadow-raised backdrop-blur">
            <IconButton icon={LuPlus} label="Zoom in" size="sm" onClick={() => engine.zoomBy(0.75)} className="rounded-none" />
            <div className="h-px bg-line" />
            <IconButton icon={LuMinus} label="Zoom out" size="sm" onClick={() => engine.zoomBy(1.33)} className="rounded-none" />
          </div>
        )}

        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface-1/80 px-2 py-1 text-2xs text-fg-tertiary backdrop-blur">
          {touch
            ? 'Drag to orbit · pinch to zoom · two fingers to pan · tap a fixture to select, double-tap to focus'
            : 'Drag to orbit · scroll to zoom · right-drag to pan · click a fixture to select, double-click to focus'}
        </p>

        {selectedFixtureId && inspectorOpen && (
          <div className="absolute right-3 top-3 flex max-h-[calc(100%-24px)] w-72 flex-col overflow-y-auto rounded-lg border border-line bg-surface-overlay/95 shadow-popover backdrop-blur [[data-density=touch]_&]:w-80">
            <FixturePropertiesPanel onClose={() => setInspectorOpen(false)} />
          </div>
        )}
      </div>

      <SelectionControls />
    </div>
  )
}

function ViewToggles() {
  const showBeams = useVisualizerStore((s) => s.showBeams)
  const hazeEnabled = useVisualizerStore((s) => s.hazeEnabled)
  const showRoom = useVisualizerStore((s) => s.showRoom)
  const showGrid = useVisualizerStore((s) => s.showGrid)
  const showLabels = useVisualizerStore((s) => s.showLabels)
  const shadows = useVisualizerStore((s) => s.shadowsEnabled)
  const lowQuality = useVisualizerStore((s) => s.quality === 'low')
  const v = useVisualizerStore.getState()
  const items = [
    { label: 'Beams', icon: LuFlashlight, on: showBeams, set: v.setShowBeams, hint: 'Show beam cones' },
    { label: 'Haze', icon: LuCloudFog, on: hazeEnabled, set: v.setHazeEnabled, hint: 'Hazed air: bright beams (off: clean air)' },
    { label: 'Walls', icon: LuWarehouse, on: showRoom, set: v.setShowRoom, hint: 'Walls and ceiling' },
    { label: 'Grid', icon: LuGrid3X3, on: showGrid, set: v.setShowGrid, hint: 'Floor grid (1 m)' },
    { label: 'Labels', icon: LuHash, on: showLabels, set: v.setShowLabels, hint: 'Fixture numbers' },
    { label: 'Shadows', icon: LuSunMoon, on: shadows, set: v.setShadowsEnabled, hint: lowQuality ? 'Shadows need Medium or High quality' : 'Real-time shadows (GPU heavy)', disabled: lowQuality }
  ]
  return (
    <ToolbarGroup aria-label="Show">
      {items.map((it) => (
        <ToggleButton
          key={it.label}
          size="sm"
          variant="ghost"
          tone="neutral"
          icon={it.icon}
          pressed={it.on}
          onPressedChange={it.set}
          disabled={'disabled' in it ? it.disabled : false}
          tooltip={it.hint}
          aria-label={it.label}
          labelClassName="hidden min-[1800px]:inline"
        >
          {it.label}
        </ToggleButton>
      ))}
    </ToolbarGroup>
  )
}

/** Quality selector + live frame rate (polled at 2 Hz, set only on change) */
function QualityControl({ engine }: { engine: VisualizerEngine | null }) {
  const quality = useVisualizerStore((s) => s.quality)
  const [fps, setFps] = useState(0)
  useEffect(() => {
    if (!engine) return
    const id = window.setInterval(() => setFps((prev) => (prev === engine.fps ? prev : engine.fps)), 500)
    return () => window.clearInterval(id)
  }, [engine])
  return (
    <ToolbarGroup aria-label="Quality">
      <SegmentedControl
        size="sm"
        aria-label="Render quality"
        value={quality}
        onChange={(q) => useVisualizerStore.getState().setQuality(q)}
        items={QUALITY_ITEMS}
      />
      <Tooltip content="Frames rendered per second — the view only redraws when something changes">
        <span className={cn('flex w-14 items-center justify-end gap-1 font-mono text-2xs tabular', fps > 0 ? 'text-fg-secondary' : 'text-fg-tertiary')}>
          {fps > 0 ? `${fps} fps` : 'idle'}
        </span>
      </Tooltip>
    </ToolbarGroup>
  )
}

function RoomButton() {
  const pop = usePopover()
  const ambient = useVisualizerStore((s) => s.ambientIntensity)
  return (
    <>
      <Button ref={pop.anchorRef} size="sm" variant="ghost" icon={LuRuler} active={pop.open} tone="neutral" onClick={pop.toggle} {...pop.triggerProps} labelClassName="hidden xl:inline">
        Room
      </Button>
      <Popover {...pop.props} placement="bottom-end" className="flex w-[300px] flex-col gap-3 p-3" aria-label="Room">
        <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Room (metres)</p>
        <RoomFields />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-fg-secondary">
            <LuEye size={14} aria-hidden className="text-fg-tertiary" />
            House lights
          </div>
          <Slider value={Math.round(ambient * 100)} onChange={(v) => useVisualizerStore.getState().setAmbientIntensity(v / 100)} min={0} max={100} defaultValue={15} showValue={(v) => `${v}%`} aria-label="House lights" />
        </div>
      </Popover>
    </>
  )
}
