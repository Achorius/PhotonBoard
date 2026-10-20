// ============================================================
// Stage surface controls shared by the Stage window and the remote
// stage views: Grand Master (vertical fader / phone bar), master
// buttons (Strobe & Blinder hold, Blackout latch), group strip and
// a clock. Prop-driven — no store access.
// Hold buttons go through the design-system Button (usePress):
// released on pointer up, cancel, lost capture, blur and unmount.
// ============================================================

import { memo, useEffect, useRef, useState } from 'react'
import { LuEraser, LuPlay, LuPower, LuSquare, LuSun, LuUsers, LuX, LuZap } from 'react-icons/lu'
import { Button, Fader, cn, formatPercent, tint, usePointerDrag, withAlpha } from '@renderer/components/ui'
import { getLocale, useT } from '@renderer/i18n'

const pctOf = (v: number) => Math.round((v / 255) * 100)
const pctUnit = () => (getLocale() === 'fr' ? '\u202F%' : '%')

// ---------------------------------------------------------------
// Grand Master
// ---------------------------------------------------------------

/** Vertical Grand Master with a big readout (Stage window, tablet) */
export const GrandMasterFader = memo(function GrandMasterFader({ value, onChange, size = 'md' }: {
  value: number
  onChange: (v: number) => void
  size?: 'md' | 'lg'
}) {
  const t = useT()
  const pct = pctOf(value)
  const reduced = pct < 100
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-2">
      <div className="flex w-full items-baseline justify-between gap-2 px-1">
        <span className="text-2xs font-bold uppercase tracking-[0.08em] text-fg-tertiary">{t('stage.grandMaster')}</span>
      </div>
      <span
        className={cn(
          'font-mono font-semibold tabular leading-none',
          size === 'lg' ? 'text-4xl' : 'text-2xl',
          pct === 0 ? 'text-danger-fg' : reduced ? 'text-warning-fg' : 'text-fg-primary'
        )}
      >
        {pct}<span className="text-base text-fg-tertiary">{pctUnit()}</span>
      </span>
      <div className="flex min-h-0 w-full flex-1 justify-center">
        <Fader
          value={value}
          onChange={onChange}
          defaultValue={255}
          readout={false}
          color={reduced ? 'rgb(var(--pb-warning))' : 'rgb(var(--pb-fg-secondary))'}
          aria-label={t('common.grandMaster')}
          className={size === 'lg' ? 'w-24' : 'w-16'}
        />
      </div>
    </div>
  )
})

/**
 * Horizontal Grand Master for phones: a wide bar dragged RELATIVELY (a touch
 * never jumps the level), double-tap = full.
 */
export function GrandMasterBar({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef(0)
  const lastTap = useRef(0)
  const [dragging, setDragging] = useState(false)
  const drag = usePointerDrag({
    onStart: (s) => {
      const now = s.event.timeStamp
      if (now - lastTap.current < 300) { lastTap.current = 0; onChange(255); return false }
      lastTap.current = now
      start.current = value
      setDragging(true)
    },
    onMove: (s) => {
      const w = ref.current?.getBoundingClientRect().width || 1
      const next = Math.max(0, Math.min(255, Math.round(start.current + (s.dx / w) * 255 * (s.fine ? 0.2 : 1))))
      if (next !== value) onChange(next)
    },
    onEnd: () => setDragging(false)
  })
  const pct = pctOf(value)
  const reduced = pct < 100
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 shrink-0 text-2xs font-bold uppercase tracking-[0.08em] text-fg-tertiary">GM</span>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t('common.grandMaster')}
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={value}
        aria-valuetext={formatPercent(value)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 25 : 5
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(255, value + step)) }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(0, value - step)) }
        }}
        {...drag}
        className={cn(
          'relative h-12 min-w-0 flex-1 cursor-ew-resize touch-none overflow-hidden rounded-md bg-surface-0 ring-1 ring-inset',
          dragging ? 'ring-line-strong' : 'ring-line'
        )}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, backgroundColor: reduced ? 'rgb(var(--pb-warning) / 0.5)' : 'rgb(var(--pb-surface-5))' }}
        />
        <div className="absolute inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-fg-primary shadow-raised" style={{ left: `max(6px, min(calc(100% - 6px), ${pct}%))` }} />
      </div>
      <span className={cn('w-14 shrink-0 text-right font-mono text-xl font-semibold tabular', pct === 0 ? 'text-danger-fg' : reduced ? 'text-warning-fg' : 'text-fg-primary')}>
        {formatPercent(value)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------
// Master buttons
// ---------------------------------------------------------------

export interface MasterButtonsProps {
  blackout: boolean
  blinder: boolean
  strobe: boolean
  onBlackout: () => void
  onBlinder: (on: boolean) => void
  onStrobe: (on: boolean) => void
  layout: 'column' | 'row'
  size?: 'md' | 'lg'
}

/** Strobe & Blinder (hold) and Blackout (latching) */
export function MasterButtons({ blackout, blinder, strobe, onBlackout, onBlinder, onStrobe, layout, size = 'md' }: MasterButtonsProps) {
  const t = useT()
  const tall = size === 'lg' ? 'h-16 text-base' : 'h-14'
  return (
    <div className={cn('grid gap-2', layout === 'column' ? 'grid-cols-2' : 'grid-cols-3')}>
      <Button
        icon={LuZap}
        tone="info"
        active={strobe}
        onPress={() => onStrobe(true)}
        onRelease={() => onStrobe(false)}
        aria-label={t('stage.strobeHold')}
        className={cn(tall, 'flex-col gap-0.5 font-semibold')}
      >
        {t('common.strobe')}
      </Button>
      <Button
        icon={LuSun}
        tone="warning"
        active={blinder}
        onPress={() => onBlinder(true)}
        onRelease={() => onBlinder(false)}
        aria-label={t('stage.blinderHold')}
        className={cn(tall, 'flex-col gap-0.5 font-semibold')}
      >
        {t('common.blinder')}
      </Button>
      <Button
        icon={LuPower}
        variant="danger-outline"
        tone="danger"
        active={blackout}
        onClick={onBlackout}
        aria-label={t('common.blackout')}
        className={cn(
          tall,
          'font-bold uppercase tracking-[0.08em]',
          layout === 'column' ? 'col-span-2' : 'flex-col gap-0.5',
          blackout && 'shadow-glow-danger'
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          {t('common.blackout')}
          {blackout && <span aria-hidden className="h-2 w-2 rounded-full bg-white animate-blink" />}
        </span>
      </Button>
    </div>
  )
}

/** Secondary playback actions: timeline, clear programmer, release all */
export function PlaybackButtons({ timelinePlaying, onTimeline, onClear, onReleaseAll, anyPlaying }: {
  timelinePlaying?: boolean
  onTimeline?: () => void
  onClear: () => void
  onReleaseAll: () => void
  anyPlaying: boolean
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-2 gap-2">
      {onTimeline && (
        <Button
          icon={timelinePlaying ? LuSquare : LuPlay}
          tone="go"
          active={!!timelinePlaying}
          onClick={onTimeline}
          className="col-span-2 font-semibold"
          aria-label={timelinePlaying ? t('stage.stopTimeline') : t('stage.playTimeline')}
        >
          {timelinePlaying ? t('stage.timelineLive') : t('common.timeline')}
        </Button>
      )}
      <Button icon={LuEraser} onClick={onClear} aria-label={t('stage.clearProgrammer')}>{t('shell.clear.label')}</Button>
      <Button
        icon={LuSquare}
        variant={anyPlaying ? 'danger-outline' : 'secondary'}
        disabled={!anyPlaying}
        onClick={onReleaseAll}
        aria-label={t('stage.releaseAll')}
      >
        {t('stage.release')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------
// Groups
// ---------------------------------------------------------------

export interface StageGroup {
  id: string
  name: string
  color: string
  fixtureCount: number
}

export function GroupStrip({ groups, activeGroupId, selectionCount, onSelectGroup, onSelectAll, onClear, size = 'md' }: {
  groups: StageGroup[]
  /** Highlighted group (its fixtures are exactly the selection) */
  activeGroupId: string | null
  selectionCount: number
  onSelectGroup: (id: string) => void
  onSelectAll: () => void
  onClear: () => void
  size?: 'md' | 'lg'
}) {
  const t = useT()
  const visible = groups.filter((g) => g.fixtureCount > 0)
  const h = size === 'lg' ? 'h-control-lg text-base' : 'h-control text-sm'
  return (
    <div className="flex min-w-0 items-center gap-2">
      <LuUsers size={16} aria-hidden className="shrink-0 text-fg-tertiary" />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        {visible.length === 0 ? (
          <span className="whitespace-nowrap text-sm text-fg-tertiary">{t('stage.noGroups')}</span>
        ) : visible.map((g) => {
          const active = g.id === activeGroupId
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectGroup(g.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-3 font-medium transition-[background-color,box-shadow] duration-fast active:brightness-125',
                h,
                active ? 'text-fg-primary' : 'text-fg-secondary'
              )}
              style={{
                backgroundColor: active ? tint(g.color, 0.4) : tint(g.color, 0.14),
                boxShadow: `inset 0 0 0 1px ${withAlpha(g.color, active ? 0.9 : 0.4)}`
              }}
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
              <span className="whitespace-nowrap">{g.name}</span>
              <span className="font-mono text-xs tabular text-fg-tertiary">{g.fixtureCount}</span>
            </button>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {selectionCount > 0 && (
          <span className="whitespace-nowrap text-xs text-fg-tertiary">
            {t.rich('stage.selectedCount', { count: <span className="font-mono tabular text-info-fg">{selectionCount}</span> }, selectionCount)}
          </span>
        )}
        <Button size={size === 'lg' ? 'lg' : 'md'} variant="secondary" onClick={onSelectAll}>{t('stage.selectAll')}</Button>
        <Button size={size === 'lg' ? 'lg' : 'md'} variant="ghost" icon={LuX} disabled={selectionCount === 0 && !activeGroupId} onClick={onClear}>{t('stage.selectNone')}</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Clock (own 1 s timer: only this leaf re-renders)
// ---------------------------------------------------------------

export function StageClock({ size = 'md', seconds = true }: { size?: 'sm' | 'md' | 'lg'; seconds?: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return (
    <time
      dateTime={now.toISOString()}
      className={cn('font-mono font-semibold tabular text-fg-primary', size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-xl' : 'text-base')}
    >
      {hh}:{mm}
      {seconds && <span className="text-fg-tertiary">:{ss}</span>}
    </time>
  )
}
