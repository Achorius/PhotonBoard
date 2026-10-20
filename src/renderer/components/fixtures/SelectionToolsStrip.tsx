// Programmer selection tools (Pro view): Prev / Next / All / Set step
// through the selection · MAtricks (interleave, blocks, groups, wings,
// invert) · Align (fans) · Highlight · Blind · programmer time · Park.
// State lives in selection-store / pro-store / pool-store; the maths in
// lib/pro/selection-tools and the programmer engine.

import { useEffect, useMemo } from 'react'
import {
  LuChevronDown, LuChevronLeft, LuChevronRight, LuClock, LuEye, LuEyeOff, LuGrid3X3, LuListChecks, LuLock, LuLockOpen, LuSun, LuUndo2
} from 'react-icons/lu'
import type { CueChannelValue } from '@shared/types'
import {
  Badge, Button, Divider, DropdownMenu, NumberField, Popover, SegmentedControl, Switch, ToggleButton, cn, formatSeconds, prompt, toast,
  usePopover, type MenuEntry
} from '@renderer/components/ui'
import { t as translate, useT } from '@renderer/i18n'
import { useSelectionStore } from '@renderer/stores/selection-store'
import { useProStore } from '@renderer/stores/pro-store'
import { usePoolStore } from '@renderer/stores/pool-store'
import { usePatchStore } from '@renderer/stores/patch-store'
import { useDmxStore } from '@renderer/stores/dmx-store'
import { applyMatricks, type Matricks } from '@renderer/lib/pro/selection-tools'
import { park, setHighlight, setProgrammerTime, unpark } from '@renderer/lib/pro/programmer-engine'
import type { AlignMode } from '@renderer/lib/pro/contracts'

const ALIGNS: { value: AlignMode; key: 'left' | 'right' | 'outside' | 'inside' }[] = [
  { value: '<', key: 'left' },
  { value: '>', key: 'right' },
  { value: '<>', key: 'outside' },
  { value: '><', key: 'inside' }
]

/** Current output of every channel of these fixtures (what Park freezes) */
function outputValues(fixtureIds: readonly string[]): CueChannelValue[] {
  const { patch, fixtures } = usePatchStore.getState()
  const values = useDmxStore.getState().values
  const out: CueChannelValue[] = []
  for (const id of fixtureIds) {
    const entry = patch.find((p) => p.id === id)
    const mode = entry && fixtures.find((f) => f.id === entry.fixtureDefId)?.modes.find((m) => m.name === entry.modeName)
    if (!entry || !mode) continue
    mode.channels.forEach((name, i) => {
      if (!name) return
      const v = values[entry.universe]?.[entry.address - 1 + i]
      if (v !== undefined) out.push({ fixtureId: id, channelName: name, value: v })
    })
  }
  return out
}

export function SelectionToolsStrip({ selection }: { selection: string[] }) {
  const t = useT()
  const matricks = useSelectionStore((s) => s.matricks)
  const step = useSelectionStore((s) => s.step)
  const align = useSelectionStore((s) => s.align)
  const highlight = useProStore((s) => s.highlight)
  const blind = useProStore((s) => s.blind)

  // Fixtures MAtricks keeps (Next / Prev walk through them), and the active ones
  const pool = useMemo(() => applyMatricks(selection, matricks, null).active, [selection, matricks])
  const active = useMemo(() => applyMatricks(selection, matricks, step).active, [selection, matricks, step])
  const count = pool.length
  const activeKey = active.join('|')

  // Highlight follows the active fixtures
  useEffect(() => {
    if (highlight) setHighlight(activeKey ? activeKey.split('|') : null)
  }, [highlight, activeKey])

  const sel = useSelectionStore.getState
  const setStepPrompt = async () => {
    if (count === 0) return
    const text = await prompt({
      title: translate('pro.programmer.tools.setPrompt'),
      message: translate('pro.programmer.tools.setPromptMessage', { count }),
      defaultValue: step === null ? '1' : String((step % count) + 1),
      validate: (v) => {
        const n = Number(v.trim())
        return Number.isInteger(n) && n >= 1 && n <= count ? null : translate('pro.programmer.tools.setInvalid', { count })
      }
    })
    if (text !== null) sel().setStep(Number(text.trim()) - 1)
  }

  const index = step === null || count === 0 ? null : (((step % count) + count) % count) + 1

  return (
    <div
      role="toolbar"
      aria-label={t('pro.programmer.tools.aria')}
      data-strip="selection-tools"
      className="scrollbar-none flex h-control-lg shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line-subtle bg-surface-1/60 px-3"
    >
      <Button size="sm" variant="ghost" icon={LuChevronLeft} disabled={count === 0} onClick={() => sel().stepBy(-1, count)} tooltip={t('pro.programmer.tools.prevTitle')} data-tool="prev">
        {t('pro.programmer.tools.prev')}
      </Button>
      <Button size="sm" variant="ghost" iconRight={LuChevronRight} disabled={count === 0} onClick={() => sel().stepBy(1, count)} tooltip={t('pro.programmer.tools.nextTitle')} data-tool="next">
        {t('pro.programmer.tools.next')}
      </Button>
      <Button size="sm" variant="ghost" icon={LuListChecks} active={step === null} disabled={count === 0} onClick={() => sel().setStep(null)} tooltip={t('pro.programmer.tools.allTitle')} data-tool="all">
        {t('pro.programmer.tools.all')}
      </Button>
      <Button size="sm" variant="ghost" disabled={count === 0} onClick={() => { void setStepPrompt() }} tooltip={t('pro.programmer.tools.setTitle')} data-tool="set">
        {t('pro.programmer.tools.set')}
      </Button>
      <Badge
        tone={index !== null ? 'accent' : 'neutral'}
        mono
        className="shrink-0"
        aria-label={index !== null ? t('pro.programmer.tools.stepAria', { index, count }) : undefined}
      >
        {index !== null ? `${index}/${count}` : t('pro.programmer.tools.allCount', { count })}
      </Badge>

      <Divider />
      <MatricksButton matricks={matricks} activeCount={active.length} />
      <SegmentedControl<string>
        size="sm"
        aria-label={t('pro.programmer.tools.alignAria')}
        value={align ?? 'off'}
        onChange={(v) => sel().setAlign(v === 'off' ? null : (v as AlignMode))}
        items={[
          { value: 'off', label: t('pro.programmer.tools.alignOff'), title: t('pro.programmer.tools.align') },
          ...ALIGNS.map((a) => ({ value: a.value, label: <span className="font-mono">{a.value}</span>, title: t(`pro.programmer.tools.alignTitles.${a.key}`) }))
        ]}
      />

      <Divider />
      <ToggleButton
        size="sm"
        icon={LuSun}
        tone="warning"
        pressed={highlight}
        onPressedChange={(on) => setHighlight(on && active.length > 0 ? active : null)}
        tooltip={t('pro.programmer.tools.highlightTitle')}
        data-tool="highlight"
      >
        {t('pro.programmer.tools.highlight')}
      </ToggleButton>
      <ToggleButton
        size="sm"
        icon={blind ? LuEyeOff : LuEye}
        tone="info"
        pressed={blind}
        onPressedChange={(on) => useProStore.getState().setBlind(on)}
        tooltip={t('pro.programmer.tools.blindTitle')}
        data-tool="blind"
      >
        {t('pro.programmer.tools.blind')}
      </ToggleButton>

      <Divider />
      <ProgTimeButton />
      <ParkMenu active={active} />
    </div>
  )
}

function MatricksButton({ matricks, activeCount }: { matricks: Matricks; activeCount: number }) {
  const t = useT()
  const pop = usePopover()
  const set = (m: Matricks) => useSelectionStore.getState().setMatricks(m)
  const on = !!(matricks.interleave || matricks.blocks || matricks.groups || matricks.wings || matricks.invert)
  const num = (v: number) => (v > 1 ? Math.round(v) : undefined)
  return (
    <>
      <Button ref={pop.anchorRef} {...pop.triggerProps} size="sm" variant="ghost" icon={LuGrid3X3} iconRight={LuChevronDown} active={on} tone="accent" onClick={pop.toggle} tooltip={t('pro.programmer.tools.matricksTitle')} data-tool="matricks">
        {t('pro.programmer.tools.matricks')}
      </Button>
      <Popover {...pop.props} aria-label={t('pro.programmer.tools.matricks')} className="w-[300px] p-3">
        <div className="flex flex-col gap-3">
          <MatricksRow label={t('pro.programmer.tools.interleave')} hint={t('pro.programmer.tools.interleaveHint')}>
            <NumberField
              className="w-[96px]"
              label={t('pro.programmer.tools.interleaveWidth')}
              value={matricks.interleave?.width ?? 0}
              min={0}
              max={64}
              step={1}
              onChange={(w) => {
                const width = Math.round(w)
                const { interleave: _i, ...rest } = matricks
                set(width > 1 ? { ...rest, interleave: { width, index: Math.min(matricks.interleave?.index ?? 0, width - 1) } } : rest)
              }}
              aria-label={t('pro.programmer.tools.interleaveWidth')}
            />
            <NumberField
              className="w-[96px]"
              label={t('pro.programmer.tools.interleaveIndex')}
              value={(matricks.interleave?.index ?? 0) + 1}
              min={1}
              max={Math.max(1, matricks.interleave?.width ?? 1)}
              step={1}
              disabled={!matricks.interleave}
              onChange={(i) => matricks.interleave && set({ ...matricks, interleave: { ...matricks.interleave, index: Math.round(i) - 1 } })}
              aria-label={t('pro.programmer.tools.interleaveIndex')}
            />
          </MatricksRow>
          {(['blocks', 'groups', 'wings'] as const).map((k) => (
            <MatricksRow key={k} label={t(`pro.programmer.tools.${k}`)} hint={t(`pro.programmer.tools.${k}Hint`)}>
              <NumberField
                className="w-[96px]"
                value={matricks[k] ?? 0}
                min={0}
                max={64}
                step={1}
                onChange={(v) => {
                  const { [k]: _old, ...rest } = matricks
                  const n = num(v)
                  set(n ? { ...rest, [k]: n } : rest)
                }}
                aria-label={t(`pro.programmer.tools.${k}`)}
              />
            </MatricksRow>
          ))}
          <Switch
            checked={!!matricks.invert}
            onChange={(on) => { const { invert: _i, ...rest } = matricks; set(on ? { ...rest, invert: true } : rest) }}
            label={t('pro.programmer.tools.invert')}
            description={t('pro.programmer.tools.invertHint')}
          />
          <div className="flex items-center justify-between gap-2 border-t border-line-subtle pt-2">
            <span className="text-2xs text-fg-tertiary">{t('pro.programmer.tools.active', { count: activeCount })}</span>
            <Button size="sm" variant="ghost" icon={LuUndo2} disabled={!on} onClick={() => set({})}>{t('pro.programmer.tools.reset')}</Button>
          </div>
        </div>
      </Popover>
    </>
  )
}

function MatricksRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-primary">{label}</span>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
      <span className="text-2xs text-fg-tertiary">{hint}</span>
    </div>
  )
}

function ProgTimeButton() {
  const t = useT()
  const pop = usePopover()
  const time = useProStore((s) => s.progTime)
  const fade = time?.fade ?? 0
  const delay = time?.delay ?? 0
  return (
    <>
      <Button
        ref={pop.anchorRef}
        {...pop.triggerProps}
        size="sm"
        variant="ghost"
        icon={LuClock}
        active={!!time}
        tone="accent"
        onClick={pop.toggle}
        tooltip={t('pro.programmer.tools.timeTitle')}
        data-tool="time"
      >
        {time ? t('pro.programmer.tools.timeSet', { fade: formatSeconds(fade), delay: formatSeconds(delay) }) : t('pro.programmer.tools.time')}
      </Button>
      <Popover {...pop.props} aria-label={t('pro.programmer.tools.time')} className="w-[240px] p-3">
        <div className="flex flex-col gap-2">
          <NumberField label={t('pro.programmer.tools.fade')} value={fade} min={0} max={600} step={0.1} unit="s" onChange={(v) => setProgrammerTime({ fade: v, delay })} aria-label={t('pro.programmer.tools.fade')} />
          <NumberField label={t('pro.programmer.tools.delay')} value={delay} min={0} max={600} step={0.1} unit="s" onChange={(v) => setProgrammerTime({ fade, delay: v })} aria-label={t('pro.programmer.tools.delay')} />
          <Button size="sm" variant="ghost" disabled={!time} onClick={() => setProgrammerTime(null)}>{t('pro.programmer.tools.timeClear')}</Button>
        </div>
      </Popover>
    </>
  )
}

function ParkMenu({ active }: { active: string[] }) {
  const t = useT()
  const parked = usePoolStore((s) => s.parked.length)
  const items = (): MenuEntry[] => {
    const tr = translate
    const ids = active
    const parkedIds = new Set(usePoolStore.getState().parked.map((v) => v.fixtureId))
    return [
      {
        label: tr('pro.programmer.tools.parkSelection'),
        icon: LuLock,
        description: tr('pro.programmer.tools.parkSelectionHint'),
        disabled: ids.length === 0,
        onSelect: () => {
          const values = outputValues(ids)
          park(values)
          toast.info(tr('pro.programmer.tools.parkedToast', { count: values.length }))
        }
      },
      { label: tr('pro.programmer.tools.unparkSelection'), icon: LuLockOpen, disabled: !ids.some((id) => parkedIds.has(id)), onSelect: () => unpark(ids) },
      { label: tr('pro.programmer.tools.unparkAll'), disabled: parkedIds.size === 0, onSelect: () => unpark(usePoolStore.getState().parked.map((v) => v.fixtureId)) }
    ]
  }
  return (
    <DropdownMenu
      items={items}
      placement="bottom-end"
      trigger={(p) => (
        <Button {...p} size="sm" variant="ghost" icon={LuLock} iconRight={LuChevronDown} active={parked > 0} tone="warning" tooltip={t('pro.programmer.tools.parkTitle')} data-tool="park">
          <span className={cn('inline-flex items-center gap-1.5')}>
            {t('pro.programmer.tools.park')}
            {parked > 0 && <Badge size="xs" tone="warning" mono title={t('pro.programmer.tools.parked', { count: parked })}>{parked}</Badge>}
          </span>
        </Button>
      )}
    />
  )
}
