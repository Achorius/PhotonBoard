// ============================================================
// Stage page designer — inspector of the selected widget: kind,
// target object, label, colour, size, delete. Every change is a
// pool-store edit (undoable; typing merges into one step).
// ============================================================

import type React from 'react'
import { LuCopy, LuTrash2 } from 'react-icons/lu'
import type { StagePage, StageWidget, StageWidgetKind } from '@shared/types'
import { PRESET_TYPES } from '@shared/types'
import {
  Button, Field, IconButton, NumberField, SWATCH_COLORS, Select, SwatchPicker, Switch, TextInput, cn
} from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { historyStep } from '@renderer/lib/history'
import { usePoolStore } from '@renderer/stores/pool-store'
import type { SurfaceIndex } from './surface-data'
import { resolveCell } from './surface-data'
import { WIDGET_KINDS, clampRect, rectFits } from './page-layout'
import { presetLabel } from './StageWidgets'
import {
  EXEC_COLUMNS, EXEC_ROWS, decodeColumnRef, decodeExecRef, encodeColumnRef, encodeExecRef
} from '../executor-surface'
import { cellName } from '../cell-visuals'
import { pageName } from '../PageSelector'
import { WIDGET_ICON } from './widget-icons'

export interface WidgetInspectorProps {
  page: StagePage
  widget: StageWidget
  index: SurfaceIndex
  onDelete: () => void
  onDuplicate: () => void
}

export function WidgetInspector({ page, widget, index, onDelete, onDuplicate }: WidgetInspectorProps) {
  const t = useT()
  const update = (updates: Partial<Omit<StageWidget, 'id'>>, label?: string) => {
    const run = () => usePoolStore.getState().updateStageWidget(page.id, widget.id, updates)
    if (label) historyStep(label, run)
    else run()
  }
  const editLabel = t('pro.stage.undo.editWidget')
  const setOption = (key: string, value: string | number | boolean) => update({ options: { ...(widget.options ?? {}), [key]: value } }, editLabel)
  const Icon = WIDGET_ICON[widget.kind]
  const data = index.data

  const resize = (w: number, h: number) => {
    const r = clampRect(page, { x: widget.x, y: widget.y, w, h })
    if (rectFits(page, r, widget.id)) update(r, t('pro.stage.undo.resizeWidget'))
  }

  const objectOptions = (list: { id: string; label: string }[]) => [
    { value: '', label: t('pro.stage.inspector.choose') },
    ...list.map((o) => ({ value: o.id, label: o.label }))
  ]
  const named = (n: number | undefined, name: string) => (n ? `${n} · ${name || t('common.untitled')}` : name || t('common.untitled'))

  let target: React.ReactNode = null
  switch (widget.kind) {
    case 'executor': {
      const ref = decodeExecRef(widget.ref) ?? { page: 'current' as const, col: 0, row: 0 }
      const pIndex = ref.page === 'current' ? data.currentPage : ref.page
      const ePage = data.executorPages[pIndex]
      target = (
        <>
          <Field label={t('pro.stage.inspector.execPage')} layout="stacked">
            {(id) => (
              <Select
                id={id}
                size="sm"
                value={ref.page === 'current' ? 'current' : String(ref.page)}
                onChange={(v) => update({ ref: encodeExecRef({ ...ref, page: v === 'current' ? 'current' : Number(v) }) }, editLabel)}
                options={[
                  { value: 'current', label: t('pro.stage.inspector.currentPage') },
                  ...data.executorPages.map((p, i) => ({ value: String(i), label: pageName(p, i) }))
                ]}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-fg-secondary">{t('pro.stage.inspector.execCell')}</span>
            <div className="grid grid-cols-8 gap-1" role="group" aria-label={t('pro.stage.inspector.execCell')}>
              {Array.from({ length: EXEC_ROWS * EXEC_COLUMNS }, (_, i) => {
                const row = Math.floor(i / EXEC_COLUMNS)
                const col = i % EXEC_COLUMNS
                const c = resolveCell(index, ePage?.cells[col]?.[row])
                const on = ref.col === col && ref.row === row
                const color = c?.color ?? ePage?.columns[col]?.color
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    title={c ? cellName(c) : t('pro.stage.inspector.emptyCell', { col: col + 1, row: row + 1 })}
                    onClick={() => update({ ref: encodeExecRef({ page: ref.page, col, row }) }, editLabel)}
                    className={cn(
                      'h-7 min-w-0 overflow-hidden rounded-sm border px-0.5 text-[10px] leading-none [[data-density=touch]_&]:h-9',
                      on ? 'border-info-fg bg-info/25 text-fg-primary' : c ? 'border-line bg-surface-3 text-fg-secondary' : 'border-dashed border-line-subtle text-fg-disabled'
                    )}
                    style={c && !on && color ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
                  >
                    <span className="block truncate">{c ? cellName(c) : '·'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )
      break
    }
    case 'fader': {
      const kind = String(widget.options?.target ?? 'cuelist')
      const col = decodeColumnRef(widget.ref)
      target = (
        <>
          <Field label={t('pro.stage.inspector.faderTarget')} layout="stacked">
            {(id) => (
              <Select
                id={id}
                size="sm"
                value={kind}
                onChange={(v) => update({ options: { ...(widget.options ?? {}), target: v }, ref: v === 'column' ? encodeColumnRef('current', 0) : undefined }, editLabel)}
                options={(['cuelist', 'chase', 'group', 'column', 'gm'] as const).map((k) => ({ value: k, label: t(`pro.stage.inspector.faderTargets.${k}`) }))}
              />
            )}
          </Field>
          {(kind === 'cuelist' || kind === 'chase' || kind === 'group') && (
            <Field label={t(`pro.stage.inspector.faderTargets.${kind}`)} layout="stacked">
              {(id) => (
                <Select
                  id={id}
                  size="sm"
                  value={widget.ref ?? ''}
                  onChange={(v) => update({ ref: v || undefined }, editLabel)}
                  options={objectOptions(kind === 'cuelist'
                    ? data.cuelists.map((c) => ({ id: c.id, label: named(c.number, c.name) }))
                    : kind === 'chase' ? data.chases.map((c) => ({ id: c.id, label: c.name }))
                    : data.groups.map((g) => ({ id: g.id, label: named(g.number, g.name) })))}
                />
              )}
            </Field>
          )}
          {kind === 'column' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('pro.stage.inspector.execPage')} layout="stacked">
                {(id) => (
                  <Select
                    id={id}
                    size="sm"
                    value={col && col.page !== 'current' ? String(col.page) : 'current'}
                    onChange={(v) => update({ ref: encodeColumnRef(v === 'current' ? 'current' : Number(v), col?.col ?? 0) }, editLabel)}
                    options={[{ value: 'current', label: t('pro.stage.inspector.currentPage') }, ...data.executorPages.map((p, i) => ({ value: String(i), label: pageName(p, i) }))]}
                  />
                )}
              </Field>
              <Field label={t('pro.stage.inspector.column')} layout="stacked">
                {(id) => (
                  <Select
                    id={id}
                    size="sm"
                    value={String(col?.col ?? 0)}
                    onChange={(v) => update({ ref: encodeColumnRef(col?.page ?? 'current', Number(v)) }, editLabel)}
                    options={Array.from({ length: EXEC_COLUMNS }, (_, c) => ({ value: String(c), label: String(c + 1) }))}
                  />
                )}
              </Field>
            </div>
          )}
        </>
      )
      break
    }
    case 'macro':
    case 'group':
    case 'speed':
    case 'preset': {
      const list = widget.kind === 'macro' ? data.macros.map((m) => ({ id: m.id, label: named(m.number, m.name) }))
        : widget.kind === 'group' ? data.groups.map((g) => ({ id: g.id, label: named(g.number, g.name) }))
        : widget.kind === 'speed' ? data.speedMasters.map((m) => ({ id: m.id, label: named(m.number, m.name) }))
        : [...data.presets]
            .sort((a, b) => PRESET_TYPES.indexOf(a.type) - PRESET_TYPES.indexOf(b.type) || a.number - b.number)
            .map((p) => ({ id: p.id, label: `${presetLabel(p.type, p.number)} · ${p.name || t(`pro.stage.presetFamily.${p.type}`)}` }))
      target = (
        <>
          <Field label={t(`pro.stage.widgetKinds.${widget.kind}`)} layout="stacked">
            {(id) => (
              list.length === 0
                ? <p id={id} className="text-xs text-fg-tertiary">{t('pro.stage.inspector.noObjects')}</p>
                : <Select id={id} size="sm" value={widget.ref ?? ''} onChange={(v) => update({ ref: v || undefined }, editLabel)} options={objectOptions(list)} />
            )}
          </Field>
          {widget.kind === 'group' && (
            <Switch
              checked={!!widget.options?.master}
              onChange={(on) => setOption('master', on)}
              label={t('pro.stage.inspector.groupMaster')}
              description={t('pro.stage.inspector.groupMasterHint')}
            />
          )}
        </>
      )
      break
    }
    case 'go':
      target = (
        <Field label={t('pro.stage.inspector.sequence')} layout="stacked">
          {(id) => (
            <Select
              id={id}
              size="sm"
              value={widget.ref ?? ''}
              onChange={(v) => update({ ref: v || undefined }, editLabel)}
              options={[{ value: '', label: t('pro.stage.inspector.goTarget') }, ...data.cuelists.map((c) => ({ value: c.id, label: named(c.number, c.name) }))]}
            />
          )}
        </Field>
      )
      break
    case 'master':
      target = (
        <Field label={t('pro.stage.inspector.masterFn')} layout="stacked">
          {(id) => (
            <Select
              id={id}
              size="sm"
              value={String(widget.options?.fn ?? 'gm')}
              onChange={(v) => setOption('fn', v)}
              options={(['gm', 'blackout', 'blinder', 'strobe', 'release', 'clear'] as const).map((f) => ({ value: f, label: t(`pro.stage.inspector.masterFns.${f}`) }))}
            />
          )}
        </Field>
      )
      break
    case 'clock':
      target = <Switch checked={widget.options?.seconds !== false} onChange={(on) => setOption('seconds', on)} label={t('pro.stage.inspector.seconds')} />
      break
    default:
      break
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-secondary">
          <Icon size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg-primary">{t(`pro.stage.widgetKinds.${widget.kind}`)}</p>
          <p className="truncate text-2xs tabular text-fg-tertiary">{t('pro.stage.inspector.position', { x: widget.x + 1, y: widget.y + 1, w: widget.w, h: widget.h })}</p>
        </div>
        <IconButton icon={LuCopy} label={t('common.duplicate')} size="sm" onClick={onDuplicate} />
        <IconButton icon={LuTrash2} label={t('pro.stage.inspector.deleteWidget')} size="sm" className="text-danger-fg" onClick={onDelete} />
      </div>

      <Field label={t('pro.stage.inspector.kind')} layout="stacked">
        {(id) => (
          <Select<StageWidgetKind>
            id={id}
            size="sm"
            value={widget.kind}
            onChange={(k) => update({ kind: k, ref: k === 'executor' ? encodeExecRef({ page: 'current', col: 0, row: 0 }) : undefined, options: k === 'master' ? { fn: 'gm' } : undefined }, editLabel)}
            options={WIDGET_KINDS.map((k) => ({ value: k, label: t(`pro.stage.widgetKinds.${k}`) }))}
          />
        )}
      </Field>

      {target}

      <Field label={widget.kind === 'label' ? t('pro.stage.inspector.text') : t('pro.stage.inspector.label')} layout="stacked">
        {(id) => (
          <TextInput
            id={id}
            size="sm"
            value={widget.label ?? ''}
            placeholder={widget.kind === 'label' ? t('pro.stage.widget.emptyLabel') : t('pro.stage.inspector.labelAuto')}
            onChange={(e) => update({ label: e.target.value || undefined })}
            onClear={widget.label ? () => update({ label: undefined }, editLabel) : undefined}
          />
        )}
      </Field>

      {widget.kind !== 'clock' && widget.kind !== 'master' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-fg-secondary">{t('common.color')}</span>
          <div className="flex items-start gap-2">
            <SwatchPicker colors={SWATCH_COLORS} value={widget.color} size="sm" columns={6} onChange={(c) => update({ color: c }, editLabel)} />
            <Button size="sm" variant={widget.color ? 'secondary' : 'ghost'} disabled={!widget.color} onClick={() => update({ color: undefined }, editLabel)}>
              {t('common.auto')}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={t('pro.stage.inspector.width')} layout="stacked">
          {(id) => <NumberField id={id} size="sm" value={widget.w} min={1} max={page.cols} step={1} onChange={(w) => resize(w, widget.h)} />}
        </Field>
        <Field label={t('pro.stage.inspector.height')} layout="stacked">
          {(id) => <NumberField id={id} size="sm" value={widget.h} min={1} max={page.rows} step={1} onChange={(h) => resize(widget.w, h)} />}
        </Field>
      </div>
      <p className="text-xs text-fg-tertiary">{t('pro.stage.inspector.moveHint')}</p>
    </div>
  )
}
