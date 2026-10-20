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
  Button, Divider, EmptyState, IconButton, Popover, SegmentedControl, Slider, ToggleButton, ToolbarGroup, Tooltip, cn, formatPercent, usePopover
} from '@renderer/components/ui'
import { useVisualizerStore, type VisualizerQuality } from '@renderer/stores/visualizer-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useT, type TranslationKey } from '@renderer/i18n'
import { ThreeCanvas } from './ThreeCanvas'
import { FixturePropertiesPanel } from './editor/FixturePropertiesPanel'
import { RoomFields } from './editor/RigPanels'
import { RigSelectionActions } from './editor/RigSelectionActions'
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
      return <CrashState error={this.state.error} onRetry={() => this.setState({ error: null })} />
    }
    return this.props.children
  }
}

/** Error card of the boundary (a function component: re-renders on a language change) */
function CrashState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useT()
  return (
    <EmptyState
      icon={LuTriangleAlert}
      title={t('visualizer.crash.title')}
      description={error || t('visualizer.crash.fallback')}
      action={
        <>
          <Button variant="primary" onClick={onRetry}>{t('visualizer.crash.retry')}</Button>
          <Button onClick={() => useUiStore.getState().setActiveTab('stage-layout')}>{t('visualizer.crash.openLayout')}</Button>
        </>
      }
    />
  )
}

const CAMERAS: Array<{ id: CameraPreset; label: TranslationKey; icon: typeof LuBox; hint: TranslationKey }> = [
  { id: 'perspective', label: 'visualizer.camera.perspective', icon: LuBox, hint: 'visualizer.camera.perspectiveHint' },
  { id: 'front', label: 'visualizer.camera.front', icon: LuRectangleHorizontal, hint: 'visualizer.camera.frontHint' },
  { id: 'top', label: 'visualizer.camera.top', icon: LuSquareDashed, hint: 'visualizer.camera.topHint' },
  { id: 'side', label: 'visualizer.camera.side', icon: LuPanelLeft, hint: 'visualizer.camera.sideHint' }
]

const QUALITY_ITEMS: Array<{ value: VisualizerQuality; label: TranslationKey; title: TranslationKey }> = [
  { value: 'low', label: 'visualizer.quality.low', title: 'visualizer.quality.lowHint' },
  { value: 'medium', label: 'visualizer.quality.medium', title: 'visualizer.quality.mediumHint' },
  { value: 'high', label: 'visualizer.quality.high', title: 'visualizer.quality.highHint' }
]

export function VisualizerView() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<VisualizerEngine | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const selectedFixtureId = useVisualizerStore((s) => s.selectedFixtureId)
  const patchCount = usePatchStore((s) => s.patch.length)
  const touch = useUiStore((s) => s.density === 'touch')
  const t = useT()

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
      <RigSelectionActions scope={rootRef} bars={false} />
      <header className="flex h-control-lg shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface-1 px-3">
        <LuBox size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
        <h1 className="shrink-0 text-sm font-semibold text-fg-primary">{t('visualizer.title')}</h1>
        <Divider />
        <ToolbarGroup aria-label={t('visualizer.camera.group')}>
          {CAMERAS.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="ghost"
              icon={c.icon}
              tooltip={t(c.hint)}
              aria-label={t(c.hint)}
              labelClassName="hidden 2xl:inline"
              disabled={!engine}
              onClick={() => engine?.setCameraPreset(c.id)}
            >
              {t(c.label)}
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
          tooltip={t('visualizer.toolbar.inspectorHint')}
          aria-label={t('visualizer.toolbar.inspectorHint')}
          labelClassName="hidden 2xl:inline"
        >
          {t('visualizer.toolbar.inspector')}
        </ToggleButton>
        <RoomButton />
        <IconButton
          size="sm"
          icon={fullscreen ? LuMinimize : LuMaximize}
          label={t(fullscreen ? 'visualizer.toolbar.exitFullScreen' : 'visualizer.toolbar.fullScreen')}
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
                title={t('visualizer.empty.title')}
                description={t('visualizer.empty.description')}
                action={<Button size="sm" variant="primary" icon={LuPlus} onClick={() => useUiStore.getState().setActiveTab('patch')}>{t('visualizer.empty.action')}</Button>}
              />
            </div>
          </div>
        )}

        {/* Zoom buttons for fingers (pinch works too) */}
        {engine && (
          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-line bg-surface-1/90 shadow-raised backdrop-blur">
            <IconButton icon={LuPlus} label={t('visualizer.zoomIn')} size="sm" onClick={() => engine.zoomBy(0.75)} className="rounded-none" />
            <div className="h-px bg-line" />
            <IconButton icon={LuMinus} label={t('visualizer.zoomOut')} size="sm" onClick={() => engine.zoomBy(1.33)} className="rounded-none" />
          </div>
        )}

        <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface-1/80 px-2 py-1 text-2xs text-fg-tertiary backdrop-blur">
          {t(touch ? 'visualizer.hintTouch' : 'visualizer.hintMouse')}
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
  const t = useT()
  const items = [
    { id: 'beams', label: t('visualizer.show.beams'), icon: LuFlashlight, on: showBeams, set: v.setShowBeams, hint: t('visualizer.show.beamsHint') },
    { id: 'haze', label: t('visualizer.show.haze'), icon: LuCloudFog, on: hazeEnabled, set: v.setHazeEnabled, hint: t('visualizer.show.hazeHint') },
    { id: 'walls', label: t('visualizer.show.walls'), icon: LuWarehouse, on: showRoom, set: v.setShowRoom, hint: t('visualizer.show.wallsHint') },
    { id: 'grid', label: t('visualizer.show.grid'), icon: LuGrid3X3, on: showGrid, set: v.setShowGrid, hint: t('visualizer.show.gridHint') },
    { id: 'labels', label: t('visualizer.show.labels'), icon: LuHash, on: showLabels, set: v.setShowLabels, hint: t('visualizer.show.labelsHint') },
    { id: 'shadows', label: t('visualizer.show.shadows'), icon: LuSunMoon, on: shadows, set: v.setShadowsEnabled, hint: t(lowQuality ? 'visualizer.show.shadowsNeedQuality' : 'visualizer.show.shadowsHint'), disabled: lowQuality }
  ]
  return (
    <ToolbarGroup aria-label={t('visualizer.show.group')}>
      {items.map((it) => (
        <ToggleButton
          key={it.id}
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
  const t = useT()
  useEffect(() => {
    if (!engine) return
    const id = window.setInterval(() => setFps((prev) => (prev === engine.fps ? prev : engine.fps)), 500)
    return () => window.clearInterval(id)
  }, [engine])
  return (
    <ToolbarGroup aria-label={t('visualizer.quality.group')}>
      <SegmentedControl
        size="sm"
        aria-label={t('visualizer.quality.label')}
        value={quality}
        onChange={(q) => useVisualizerStore.getState().setQuality(q)}
        items={QUALITY_ITEMS.map((q) => ({ value: q.value, label: t(q.label), title: t(q.title) }))}
      />
      <Tooltip content={t('visualizer.quality.fpsHint')}>
        <span className={cn('flex w-14 items-center justify-end gap-1 font-mono text-2xs tabular', fps > 0 ? 'text-fg-secondary' : 'text-fg-tertiary')}>
          {fps > 0 ? t('units.fpsValue', { value: fps }) : t('visualizer.quality.idle')}
        </span>
      </Tooltip>
    </ToolbarGroup>
  )
}

function RoomButton() {
  const pop = usePopover()
  const ambient = useVisualizerStore((s) => s.ambientIntensity)
  const t = useT()
  return (
    <>
      <Button ref={pop.anchorRef} size="sm" variant="ghost" icon={LuRuler} active={pop.open} tone="neutral" onClick={pop.toggle} {...pop.triggerProps} labelClassName="hidden 2xl:inline">
        {t('visualizer.toolbar.room')}
      </Button>
      <Popover {...pop.props} placement="bottom-end" className="flex w-[300px] flex-col gap-3 p-3" aria-label={t('visualizer.toolbar.room')}>
        <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('visualizer.room.title')}</p>
        <RoomFields />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-fg-secondary">
            <LuEye size={14} aria-hidden className="text-fg-tertiary" />
            {t('visualizer.room.houseLights')}
          </div>
          <Slider value={Math.round(ambient * 100)} onChange={(v) => useVisualizerStore.getState().setAmbientIntensity(v / 100)} min={0} max={100} defaultValue={15} showValue={(v) => formatPercent(v, 100, t.locale)} aria-label={t('visualizer.room.houseLights')} />
        </div>
      </Popover>
    </>
  )
}
