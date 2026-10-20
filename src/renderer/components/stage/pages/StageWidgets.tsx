// ============================================================
// Stage page widgets — one renderer per kind, prop-driven: they READ
// a SurfaceIndex (stores, or the console's surface data in the Stage
// window) and ACT through SurfaceActions. `interactive: false` (designer)
// draws them without handlers.
//
//   executor  any executor cell (fixed page, or the current page)
//   fader     scene / chase / group master / column fader / Grand Master
//   macro · preset (applies to the selection) · group (select; master bar)
//   master    GM fader, Blackout, Blinder / Strobe (hold), Release, Clear
//   speed     speed master BPM + TAP
//   go        GO / Back of a sequence with current and next cue
//   clock · label
// Holds (TRIG / FLASH executors, Blinder, Strobe) release on lift,
// cancel, blur and unmount (usePress).
// ============================================================

import { memo, useEffect, useState } from 'react'
import type React from 'react'
import {
  LuCrosshair, LuEraser, LuPlay, LuPower, LuSkipBack, LuSquare, LuSun, LuZap
} from 'react-icons/lu'
import type { PresetType, StageWidget } from '@shared/types'
import { PRESET_FAMILY_NUMBER } from '@shared/types'
import {
  Badge, Fader, SWATCH_COLORS, cn, formatBpm, formatCuePosition, formatPercent, palette, tint, usePress, withAlpha
} from '@renderer/components/ui'
import { t, useT } from '@renderer/i18n'
import type { SurfaceActions } from './surface-actions'
import { resolveCell, type ResolvedCell, type SurfaceIndex } from './surface-data'
import {
  columnFaderActive, columnFaderLevel, decodeColumnRef, decodeExecRef, isHoldFn, resolveExecPage, EXEC_ROWS
} from '../executor-surface'
import { KIND_ICON, cellName, fnBadge, fnBadgeTone } from '../cell-visuals'
import { LevelBar } from '../SceneGrid'
import { StageClock } from '../StageControls'

export interface WidgetContext {
  index: SurfaceIndex
  actions: SurfaceActions
  /** md: in-app / tablet · lg: Stage window */
  size: 'md' | 'lg'
  /** false in the designer: drawn, never fires */
  interactive: boolean
}

const FALLBACK: string = SWATCH_COLORS[11]

/** Colour of a preset family (tiles without their own colour) */
const FAMILY_COLOR: Record<PresetType, string> = {
  full: SWATCH_COLORS[11], intensity: SWATCH_COLORS[3], position: SWATCH_COLORS[7], gobo: SWATCH_COLORS[9],
  color: SWATCH_COLORS[10], beam: SWATCH_COLORS[4], focus: SWATCH_COLORS[6], control: SWATCH_COLORS[8]
}

export function presetLabel(type: PresetType, number: number): string {
  return `${PRESET_FAMILY_NUMBER[type]}.${number}`
}

/** A value the operator is moving wins over the incoming one for a moment (sync round-trip) */
function useHeldValue(remote: number, holdMs = 500): [number, (v: number) => void] {
  const [local, setLocal] = useState<{ v: number; t: number } | null>(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (!local) return
    const left = local.t + holdMs - performance.now()
    if (left <= 0) return
    const id = setTimeout(() => force((n) => n + 1), left + 10)
    return () => clearTimeout(id)
  }, [local, holdMs])
  const held = local && performance.now() - local.t < holdMs ? local.v : remote
  return [held, (v) => setLocal({ v, t: performance.now() })]
}

// ---------------------------------------------------------------
// Frame
// ---------------------------------------------------------------

function Frame({ color, active, className, children, title }: {
  color?: string
  active?: boolean
  className?: string
  children: React.ReactNode
  title?: string
}) {
  return (
    <div
      title={title}
      className={cn(
        'relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border transition-[background-color,box-shadow] duration-fast',
        !active && 'border-line-subtle bg-surface-2',
        className
      )}
      style={active && color ? {
        backgroundColor: tint(color, 0.3, palette.surface2),
        borderColor: color,
        boxShadow: `0 0 18px ${withAlpha(color, 0.3)}, inset 0 0 0 1px ${withAlpha(color, 0.5)}`
      } : undefined}
    >
      {children}
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-1/40 p-2 text-center text-xs text-fg-tertiary">
      {text}
    </div>
  )
}

/** Tap button: fires on release (click), pressed look while down */
function TapButton({ onTap, disabled, className, style, children, label, interactive }: {
  onTap: () => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
  label: string
  interactive: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled || !interactive}
      onClick={onTap}
      tabIndex={interactive ? 0 : -1}
      className={cn(
        'relative flex h-full w-full min-h-0 min-w-0 select-none flex-col overflow-hidden rounded-lg border text-left transition-[background-color,box-shadow,transform] duration-fast',
        interactive && !disabled && 'active:scale-[0.98] active:brightness-125',
        disabled && interactive && 'opacity-50',
        className
      )}
      style={style}
    >
      {children}
    </button>
  )
}

/** Hold button (Blinder, Strobe, TRIG / FLASH executors) */
function HoldButton({ onDown, onUp, className, style, children, label, interactive, holdKey }: {
  onDown: () => void
  onUp: () => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
  label: string
  interactive: boolean
  /** data-hold for swipe paging */
  holdKey?: boolean
}) {
  const [handlers, pressed] = usePress({ onPress: onDown, onRelease: onUp, disabled: !interactive })
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-hold={holdKey ? '1' : undefined}
      tabIndex={interactive ? 0 : -1}
      {...(interactive ? handlers : {})}
      className={cn(
        'relative flex h-full w-full min-h-0 min-w-0 touch-none select-none flex-col overflow-hidden rounded-lg border text-left transition-[background-color,box-shadow,transform] duration-fast',
        pressed && 'scale-[0.98] brightness-125',
        className
      )}
      style={style}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------
// Executor
// ---------------------------------------------------------------

function ExecutorWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const ref = decodeExecRef(widget.ref)
  if (!ref) return <Placeholder text={t('pro.stage.widget.notSet', { kind: t('pro.stage.widgetKinds.executor') })} />
  const data = ctx.index.data
  const pageIndex = resolveExecPage(ref, data.currentPage)
  const page = data.executorPages[pageIndex]
  const raw = page?.cells[ref.col]?.[ref.row] ?? null
  const cell = resolveCell(ctx.index, raw)
  const slot = `${pageIndex + 1}.${ref.col * EXEC_ROWS + ref.row + 1}`
  if (!cell) {
    return <Placeholder text={t('pro.stage.widget.emptyExecutor', { slot })} />
  }
  const color = widget.color || cell.color || page?.columns[ref.col]?.color || FALLBACK
  const selected = !!data.selectedExecutor && data.selectedExecutor.page === pageIndex && data.selectedExecutor.col === ref.col && data.selectedExecutor.row === ref.row
  return (
    <ExecutorTile
      cell={cell}
      label={widget.label || cellName(cell)}
      color={color}
      slot={slot}
      selected={selected}
      tall={widget.h >= 2}
      ctx={ctx}
      onPhase={(phase) => ctx.actions.executor({ page: pageIndex, col: ref.col, row: ref.row }, phase)}
    />
  )
}

function ExecutorTile({ cell, label, color, slot, selected, tall, ctx, onPhase }: {
  cell: ResolvedCell
  label: string
  color: string
  slot: string
  selected: boolean
  /** 2+ cells high: bigger name and the current cue */
  tall: boolean
  ctx: WidgetContext
  onPhase: (phase: 'down' | 'up') => void
}) {
  const big = ctx.size === 'lg' && tall
  const hold = cell.kind !== 'macro' && cell.kind !== 'group' && cell.kind !== 'speed' && isHoldFn(cell.fn)
  const badge = fnBadge(cell.fn, cell.kind)
  const Icon = KIND_ICON[cell.kind]
  const active = cell.active
  const className = cn(
    !active && 'border-line-subtle bg-surface-2',
    cell.missing && 'opacity-60',
    selected && 'outline outline-2 -outline-offset-2 outline-info-fg/80',
    big ? 'gap-1 px-3 py-2.5' : 'gap-0.5 px-2.5 py-2'
  )
  const style: React.CSSProperties | undefined = active ? {
    backgroundColor: tint(color, cell.flash ? 0.55 : 0.32, palette.surface2),
    borderColor: color,
    boxShadow: `0 0 18px ${withAlpha(color, 0.35)}, inset 0 0 0 1px ${withAlpha(color, 0.55)}`
  } : undefined
  const body = (
    <>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color, opacity: active ? 1 : 0.6 }} />
      <span className="flex min-w-0 items-center gap-1.5 pl-1">
        <Icon size={big ? 14 : 12} aria-hidden className={active ? 'text-fg-primary' : 'text-fg-tertiary'} />
        <span className="font-mono text-2xs tabular text-fg-tertiary">{slot}</span>
        <span className="flex-1" />
        {active && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-go-fg shadow-[0_0_8px_rgb(var(--pb-go)/0.8)]" />}
      </span>
      <span className={cn('min-w-0 break-words pl-1 font-semibold leading-tight text-fg-primary', tall || ctx.size === 'md' ? 'line-clamp-2' : 'line-clamp-1', big ? 'text-lg' : ctx.size === 'lg' ? 'text-base' : 'text-sm', cell.missing && 'italic text-fg-tertiary')}>
        {label}
      </span>
      {active && cell.cueName && (tall || ctx.size === 'md') && <span className={cn('truncate pl-1 text-fg-secondary', big ? 'text-sm' : 'text-xs')}>{cell.cueName}</span>}
      <span className="flex-1" />
      <span className="flex min-w-0 items-center gap-1 pl-1">
        {cell.position && (
          <span className={cn('font-mono tabular', big ? 'text-sm' : 'text-xs', active ? 'text-fg-primary' : 'text-fg-tertiary')}>
            {formatCuePosition(cell.position.index, cell.position.count)}
          </span>
        )}
        <span className="flex-1" />
        {selected && <span title={t('pro.stage.goTargetMark')} className="flex shrink-0 text-info-fg"><LuCrosshair size={12} aria-hidden /></span>}
        {badge && <Badge size="xs" tone={fnBadgeTone(cell.fn)} variant={active ? 'solid' : 'subtle'}>{badge}</Badge>}
      </span>
    </>
  )
  const aria = active && cell.position && cell.position.index >= 0
    ? t('stage.cellPlaying', { name: label, mode: badge ?? 'TOG', cue: cell.position.index + 1, count: cell.position.count })
    : t('stage.cellStopped', { name: label, mode: badge ?? 'TOG' })
  if (hold) {
    return (
      <HoldButton holdKey label={aria} interactive={ctx.interactive} onDown={() => onPhase('down')} onUp={() => onPhase('up')} className={className} style={style}>
        {body}
      </HoldButton>
    )
  }
  return (
    <TapButton label={aria} interactive={ctx.interactive} onTap={() => { onPhase('down'); onPhase('up') }} className={className} style={style}>
      {body}
    </TapButton>
  )
}

// ---------------------------------------------------------------
// Faders
// ---------------------------------------------------------------

function LevelControl({ value, onChange, color, label, vertical, disabled, big }: {
  value: number
  onChange: (v: number) => void
  color: string
  label: string
  vertical: boolean
  disabled?: boolean
  big: boolean
}) {
  const [held, setHeld] = useHeldValue(value)
  const change = (v: number) => { setHeld(v); onChange(v) }
  if (vertical) {
    return (
      <div className="flex min-h-0 w-full flex-1 justify-center" data-no-swipe="">
        <Fader value={held} onChange={change} defaultValue={255} color={color} ticks readout={false} disabled={disabled} aria-label={label} className={big ? 'w-full max-w-[112px]' : 'w-full max-w-[88px]'} />
      </div>
    )
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col justify-end" data-no-swipe="">
      <LevelBar value={held} color={color} label={label} onChange={disabled ? () => {} : change} />
    </div>
  )
}

function FaderWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const { index, actions } = ctx
  const target = String(widget.options?.target ?? 'cuelist')
  const vertical = widget.h >= widget.w && widget.h >= 2
  let name = ''
  let value: number | null = null
  let color = widget.color || FALLBACK
  let onChange: ((v: number) => void) | undefined
  switch (target) {
    case 'cuelist':
    case 'chase': {
      const obj = target === 'cuelist' ? index.cuelists.get(widget.ref ?? '') : index.chases.get(widget.ref ?? '')
      if (obj) {
        name = obj.name
        value = obj.faderLevel
        onChange = (v) => actions.level(target, obj.id, v)
      }
      break
    }
    case 'group': {
      const g = index.groups.get(widget.ref ?? '')
      if (g) {
        name = g.name
        value = g.master
        color = widget.color || g.color
        onChange = actions.groupMaster ? (v) => actions.groupMaster!(g.id, v) : undefined
      }
      break
    }
    case 'column': {
      const ref = decodeColumnRef(widget.ref)
      if (ref) {
        const p = ref.page === 'current' ? index.data.currentPage : ref.page
        const page = index.data.executorPages[p]
        const col = page?.columns[ref.col]
        name = col?.title || t('stage.columnN', { n: ref.col + 1 })
        color = widget.color || col?.color || color
        value = columnFaderActive(page, ref.col) ? columnFaderLevel(page, ref.col, {
          cuelist: (id) => index.cuelists.get(id)?.faderLevel,
          chase: (id) => index.chases.get(id)?.faderLevel,
          group: (id) => index.groups.get(id)?.master,
          grandMaster: index.data.grandMaster
        }) ?? 255 : null
        onChange = (v) => actions.columnFader(p, ref.col, v)
      }
      break
    }
    case 'gm':
      name = t('stage.grandMaster')
      value = index.data.grandMaster
      onChange = actions.grandMaster
      break
  }
  if (value === null) return <Placeholder text={t('pro.stage.widget.notSet', { kind: t('pro.stage.widgetKinds.fader') })} />
  const label = widget.label || name
  return (
    <Frame className="items-center gap-1 p-2">
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className={cn('min-w-0 flex-1 truncate font-semibold text-fg-secondary', ctx.size === 'lg' ? 'text-sm' : 'text-xs')}>{label}</span>
        {vertical && <span className="font-mono text-xs tabular text-fg-tertiary">{formatPercent(value)}</span>}
      </span>
      <LevelControl
        value={value}
        onChange={onChange ?? (() => {})}
        disabled={!onChange || !ctx.interactive}
        color={color}
        label={t('stage.sceneLevel', { name: label })}
        vertical={vertical}
        big={ctx.size === 'lg'}
      />
    </Frame>
  )
}

// ---------------------------------------------------------------
// Pool buttons: macro, preset, group
// ---------------------------------------------------------------

function PoolTile({ color, number, name, sub, active, icon: Icon, big }: {
  color: string
  number?: string
  name: string
  sub?: string
  active?: boolean
  icon?: React.ComponentType<{ size?: number; className?: string }>
  big: boolean
}) {
  return (
    <>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <span className="flex min-w-0 items-center gap-1.5">
        {Icon && <Icon size={big ? 14 : 12} className={active ? 'text-fg-primary' : 'text-fg-tertiary'} />}
        {number && <span className="font-mono text-2xs tabular text-fg-tertiary">{number}</span>}
      </span>
      <span className={cn('line-clamp-2 min-w-0 break-words font-semibold leading-tight text-fg-primary', big ? 'text-base' : 'text-sm')}>{name}</span>
      <span className="flex-1" />
      {sub && <span className="truncate text-2xs text-fg-tertiary">{sub}</span>}
    </>
  )
}

function MacroWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const m = ctx.index.macros.get(widget.ref ?? '')
  if (!m) return <Placeholder text={t('pro.stage.widget.notSet', { kind: t('pro.stage.widgetKinds.macro') })} />
  const color = widget.color || m.color || FALLBACK
  const name = widget.label || m.name || t('pro.defaults.macro', { n: m.number })
  return (
    <TapButton
      label={t('pro.stage.widget.runMacro', { name })}
      interactive={ctx.interactive}
      onTap={() => ctx.actions.macro(m.id)}
      className={cn('gap-0.5 border-line-subtle px-2.5 pb-2 pt-2.5', ctx.size === 'lg' && 'px-3')}
      style={{ backgroundColor: tint(color, 0.12, palette.surface2) }}
    >
      <PoolTile color={color} number={`M${m.number}`} name={name} icon={KIND_ICON.macro} big={ctx.size === 'lg'} />
    </TapButton>
  )
}

function PresetWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const p = ctx.index.presets.get(widget.ref ?? '')
  if (!p) return <Placeholder text={t('pro.stage.widget.notSet', { kind: t('pro.stage.widgetKinds.preset') })} />
  const color = widget.color || p.color || FAMILY_COLOR[p.type] || FALLBACK
  const name = widget.label || p.name || presetLabel(p.type, p.number)
  return (
    <TapButton
      label={t('pro.stage.widget.applyPreset', { name })}
      interactive={ctx.interactive}
      disabled={ctx.index.data.selectionCount === 0}
      onTap={() => ctx.actions.preset(p.id, p.type, p.number)}
      className="gap-0.5 border-line-subtle px-2.5 pb-2 pt-2.5"
      style={{ backgroundColor: tint(color, 0.14, palette.surface2) }}
    >
      <span aria-hidden className="absolute right-2 top-2.5 h-4 w-4 rounded-full ring-1 ring-inset ring-black/30" style={{ backgroundColor: color }} />
      <PoolTile color={color} number={presetLabel(p.type, p.number)} name={name} sub={t(`pro.stage.presetFamily.${p.type}`)} big={ctx.size === 'lg'} />
    </TapButton>
  )
}

function GroupWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const g = ctx.index.groups.get(widget.ref ?? '')
  if (!g) return <Placeholder text={t('pro.stage.widget.notSet', { kind: t('pro.stage.widgetKinds.group') })} />
  const active = ctx.index.data.activeGroupId === g.id
  const color = widget.color || g.color
  const name = widget.label || g.name
  const showMaster = widget.h >= 2 && !!widget.options?.master
  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-1">
      <TapButton
        label={t('pro.stage.widget.selectGroup', { name })}
        interactive={ctx.interactive}
        onTap={() => ctx.actions.group(g.id)}
        className={cn('min-h-0 flex-1 gap-0.5 px-2.5 pb-2 pt-2.5', active ? 'text-fg-primary' : 'border-line-subtle')}
        style={{
          backgroundColor: active ? tint(color, 0.4, palette.surface2) : tint(color, 0.12, palette.surface2),
          borderColor: active ? color : undefined,
          boxShadow: active ? `inset 0 0 0 1px ${withAlpha(color, 0.9)}` : undefined
        }}
      >
        <PoolTile color={color} number={g.number ? `G${g.number}` : undefined} name={name} sub={t('common.fixtureCount', { count: g.fixtureCount })} active={active} icon={KIND_ICON.group} big={ctx.size === 'lg'} />
      </TapButton>
      {showMaster && (
        <div className="shrink-0" data-no-swipe="">
          <LevelControl
            value={g.master}
            onChange={(v) => ctx.actions.groupMaster?.(g.id, v)}
            disabled={!ctx.actions.groupMaster || !ctx.interactive}
            color={color}
            label={t('pro.stage.widget.groupMaster', { name })}
            vertical={false}
            big={false}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// Masters
// ---------------------------------------------------------------

function MasterWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const fn = String(widget.options?.fn ?? 'gm')
  const d = ctx.index.data
  const big = ctx.size === 'lg'
  const text = big ? 'text-base' : 'text-sm'
  switch (fn) {
    case 'blackout':
      return (
        <TapButton
          label={t('common.blackout')}
          interactive={ctx.interactive}
          onTap={ctx.actions.blackout}
          className={cn('items-center justify-center gap-1 font-bold uppercase tracking-[0.08em]', text,
            d.blackout ? 'border-danger bg-danger text-on-danger shadow-glow-danger' : 'border-danger/60 bg-danger/10 text-danger-fg')}
        >
          <LuPower size={big ? 22 : 18} aria-hidden />
          <span className="inline-flex items-center gap-1.5">
            {widget.label || t('common.blackout')}
            {d.blackout && <span aria-hidden className="h-2 w-2 rounded-full bg-white animate-blink" />}
          </span>
        </TapButton>
      )
    case 'blinder':
    case 'strobe': {
      const on = fn === 'blinder' ? d.blinder : d.strobe
      const set = fn === 'blinder' ? ctx.actions.blinder : ctx.actions.strobe
      const Icon = fn === 'blinder' ? LuSun : LuZap
      const tone = fn === 'blinder' ? 'warning' : 'info'
      return (
        <HoldButton
          label={fn === 'blinder' ? t('stage.blinderHold') : t('stage.strobeHold')}
          interactive={ctx.interactive}
          onDown={() => set(true)}
          onUp={() => set(false)}
          className={cn('items-center justify-center gap-1 font-semibold', text,
            on ? (tone === 'warning' ? 'border-warning bg-warning text-on-warning' : 'border-info bg-info text-on-info') : 'border-line-subtle bg-surface-2 text-fg-primary')}
        >
          <Icon size={big ? 22 : 18} aria-hidden />
          {widget.label || (fn === 'blinder' ? t('common.blinder') : t('common.strobe'))}
        </HoldButton>
      )
    }
    case 'release': {
      const any = d.cuelists.some((c) => c.isPlaying) || d.chases.some((c) => c.isPlaying)
      return (
        <TapButton
          label={t('stage.releaseAll')}
          interactive={ctx.interactive}
          disabled={!any}
          onTap={ctx.actions.releaseAll}
          className={cn('items-center justify-center gap-1 font-semibold', text, any ? 'border-danger/60 bg-surface-2 text-danger-fg' : 'border-line-subtle bg-surface-2 text-fg-secondary')}
        >
          <LuSquare size={big ? 20 : 16} aria-hidden />
          {widget.label || t('stage.release')}
        </TapButton>
      )
    }
    case 'clear':
      return (
        <TapButton
          label={t('stage.clearProgrammer')}
          interactive={ctx.interactive}
          onTap={ctx.actions.clear}
          className={cn('items-center justify-center gap-1 border-line-subtle bg-surface-2 font-semibold text-fg-primary', text)}
        >
          <LuEraser size={big ? 20 : 16} aria-hidden />
          {widget.label || t('shell.clear.label')}
        </TapButton>
      )
    default: {
      // Grand Master
      const vertical = widget.h >= widget.w && widget.h >= 2
      const pct = Math.round((d.grandMaster / 255) * 100)
      const reduced = pct < 100
      return (
        <Frame className="items-center gap-1 p-2">
          <span className="flex w-full items-baseline justify-between gap-1">
            <span className="truncate text-2xs font-bold uppercase tracking-[0.08em] text-fg-tertiary">{widget.label || (widget.w < 2 ? 'GM' : t('stage.grandMaster'))}</span>
            <span className={cn('font-mono font-semibold tabular', big ? 'text-xl' : 'text-base', pct === 0 ? 'text-danger-fg' : reduced ? 'text-warning-fg' : 'text-fg-primary')}>
              {formatPercent(d.grandMaster)}
            </span>
          </span>
          <LevelControl
            value={d.grandMaster}
            onChange={ctx.actions.grandMaster}
            disabled={!ctx.interactive}
            color={reduced ? 'rgb(var(--pb-warning))' : 'rgb(var(--pb-fg-secondary))'}
            label={t('common.grandMaster')}
            vertical={vertical}
            big={big}
          />
        </Frame>
      )
    }
  }
}

// ---------------------------------------------------------------
// Speed master
// ---------------------------------------------------------------

function SpeedWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const s = ctx.index.speedMasters.get(widget.ref ?? '')
  const [beat, setBeat] = useState(false)
  useEffect(() => {
    if (!beat) return
    const id = setTimeout(() => setBeat(false), 120)
    return () => clearTimeout(id)
  }, [beat])
  if (!s) return <Placeholder text={t('pro.stage.widget.notSet', { kind: t('pro.stage.widgetKinds.speed') })} />
  const name = widget.label || s.name || t('pro.defaults.speedMaster', { n: s.number })
  const tap = ctx.actions.speedTap
  const big = ctx.size === 'lg'
  return (
    <Frame className="gap-1 p-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <LuZap size={12} aria-hidden className="text-fg-tertiary" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg-secondary">{name}</span>
      </span>
      <span className={cn('font-mono font-semibold tabular text-fg-primary', big ? 'text-2xl' : 'text-xl')}>{formatBpm(s.bpm)}</span>
      <span className="flex-1" />
      <button
        type="button"
        disabled={!tap || !ctx.interactive}
        tabIndex={ctx.interactive ? 0 : -1}
        title={tap ? undefined : t('pro.stage.widget.tapConsoleOnly')}
        onPointerDown={() => { if (tap && ctx.interactive) { tap(s.id); setBeat(true) } }}
        className={cn(
          'h-control w-full shrink-0 rounded-md text-sm font-bold uppercase tracking-[0.1em] transition-colors duration-fast',
          tap ? 'bg-surface-4 text-fg-primary active:bg-accent active:text-on-accent' : 'bg-surface-3 text-fg-disabled',
          beat && 'bg-accent text-on-accent'
        )}
      >
        {t('pro.stage.widget.tap')}
      </button>
    </Frame>
  )
}

// ---------------------------------------------------------------
// GO / Back
// ---------------------------------------------------------------

function GoWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const d = ctx.index.data
  const id = widget.ref || d.goTargetId
  const cl = id ? ctx.index.cuelists.get(id) : undefined
  if (!cl) return <Placeholder text={t('pro.stage.widget.noSequence')} />
  const big = ctx.size === 'lg'
  const compact = widget.h < 2
  const color = widget.color || palette.go
  const name = widget.label || cl.name
  return (
    <Frame color={color} className={cn('gap-1.5', compact ? 'flex-row items-center p-1.5' : 'p-2.5')}>
      <div className={cn('flex min-w-0 flex-col', compact ? 'flex-1 pl-1' : '')}>
        <span className="flex min-w-0 items-center gap-1.5">
          {cl.isPlaying && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-go-fg shadow-[0_0_8px_rgb(var(--pb-go)/0.8)]" />}
          <span className={cn('min-w-0 flex-1 truncate font-semibold text-fg-secondary', big ? 'text-sm' : 'text-xs')}>{name}</span>
          {!widget.ref && !compact && <Badge size="xs" tone="info">{t('pro.stage.widget.selectedSeq')}</Badge>}
        </span>
        <span className={cn('min-w-0 truncate font-semibold text-fg-primary', big ? 'text-xl' : compact ? 'text-sm' : 'text-lg')}>
          {cl.isPlaying && cl.cueName !== undefined
            ? <><span className="font-mono tabular text-fg-tertiary">{cl.cueNumber} </span>{cl.cueName || t('common.cue')}</>
            : <span className="text-fg-tertiary">{t('common.stopped')}</span>}
        </span>
        {!compact && (
          <span className={cn('min-w-0 truncate text-fg-tertiary', big ? 'text-sm' : 'text-xs')}>
            {cl.nextCueName !== undefined
              ? t('pro.stage.widget.nextCue', { n: cl.nextCueNumber ?? '', name: cl.nextCueName || t('common.cue') })
              : t('pro.stage.widget.endOfSequence')}
          </span>
        )}
      </div>
      {!compact && <span className="flex-1" />}
      {!compact && cl.isPlaying && (cl.cueFade ?? 0) > 0 && (
        <span aria-hidden className="relative h-1 w-full overflow-hidden rounded-full bg-surface-0/70">
          <span
            key={`${cl.currentCueIndex}:${cl.goGeneration}`}
            className="absolute inset-y-0 left-0 w-full origin-left bg-go-fg"
            style={{ animation: `pb-progress ${cl.cueFade}s linear forwards` }}
          />
        </span>
      )}
      <div className={cn('flex shrink-0 gap-1.5', compact ? 'h-full w-[58%]' : big ? 'h-16' : 'h-12')}>
        <button
          type="button"
          disabled={!ctx.interactive || !cl.isPlaying}
          tabIndex={ctx.interactive ? 0 : -1}
          onClick={() => ctx.actions.back(cl.id)}
          aria-label={t('pro.stage.widget.backAria', { name: cl.name })}
          className="flex w-[34%] items-center justify-center gap-1 rounded-md bg-surface-3 font-semibold text-fg-primary transition-colors duration-fast active:bg-surface-4 disabled:opacity-40"
        >
          <LuSkipBack size={big ? 18 : 16} aria-hidden />
          {!compact && <span className="hidden text-sm sm:inline">{t('shell.executors.back')}</span>}
        </button>
        <button
          type="button"
          disabled={!ctx.interactive || cl.cueCount === 0}
          tabIndex={ctx.interactive ? 0 : -1}
          onClick={() => ctx.actions.go(cl.id)}
          aria-label={t('pro.stage.widget.goAria', { name: cl.name })}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md bg-go font-bold uppercase tracking-[0.1em] text-on-go shadow-raised transition-[filter,transform] duration-fast active:scale-[0.98] active:brightness-110 disabled:opacity-40',
            big ? 'text-2xl' : 'text-lg'
          )}
        >
          <LuPlay size={big ? 22 : 18} aria-hidden />
          GO
        </button>
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------
// Clock, label
// ---------------------------------------------------------------

function ClockWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const seconds = widget.options?.seconds !== false
  return (
    <Frame className="items-center justify-center gap-0.5 p-2">
      {widget.label && <span className="truncate text-2xs font-semibold uppercase tracking-[0.08em] text-fg-tertiary">{widget.label}</span>}
      <StageClock size={ctx.size === 'lg' || widget.h >= 2 ? 'lg' : 'md'} seconds={seconds} />
    </Frame>
  )
}

function LabelWidget({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  const color = widget.color
  const text = widget.label || ''
  return (
    <div
      className={cn('flex h-full w-full min-h-0 items-center justify-center overflow-hidden rounded-lg px-3 text-center', color ? '' : 'bg-transparent')}
      style={color ? { backgroundColor: tint(color, 0.18, palette.surface1), boxShadow: `inset 0 0 0 1px ${withAlpha(color, 0.45)}` } : undefined}
    >
      <span className={cn('line-clamp-3 break-words font-bold uppercase tracking-[0.06em]', text ? 'text-fg-primary' : 'italic text-fg-disabled', ctx.size === 'lg' || widget.h >= 2 ? 'text-xl' : 'text-base')}>
        {text || t('pro.stage.widget.emptyLabel')}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------

export const StageWidgetView = memo(function StageWidgetView({ widget, ctx }: { widget: StageWidget; ctx: WidgetContext }) {
  useT() // labels follow the UI language
  switch (widget.kind) {
    case 'executor': return <ExecutorWidget widget={widget} ctx={ctx} />
    case 'fader': return <FaderWidget widget={widget} ctx={ctx} />
    case 'macro': return <MacroWidget widget={widget} ctx={ctx} />
    case 'preset': return <PresetWidget widget={widget} ctx={ctx} />
    case 'group': return <GroupWidget widget={widget} ctx={ctx} />
    case 'master': return <MasterWidget widget={widget} ctx={ctx} />
    case 'speed': return <SpeedWidget widget={widget} ctx={ctx} />
    case 'go': return <GoWidget widget={widget} ctx={ctx} />
    case 'clock': return <ClockWidget widget={widget} ctx={ctx} />
    case 'label': return <LabelWidget widget={widget} ctx={ctx} />
    default: return null
  }
})
