// Macro editor: name and command lines (English keywords) with a wait
// after each line. Edits a draft; Save = one undo step.

import { useState } from 'react'
import { LuArrowDown, LuArrowUp, LuListPlus, LuPlay, LuX } from 'react-icons/lu'
import type { MacroLine } from '@shared/types'
import { Button, EmptyState, Field, IconButton, Modal, NumberField, TextInput } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'
import { usePoolStore } from '@renderer/stores/pool-store'
import { runMacro, updateMacro } from './pool-actions'

export function MacroEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT()
  const macro = usePoolStore((s) => s.macros.find((m) => m.id === id))
  const [name, setName] = useState(macro?.name ?? '')
  const [lines, setLines] = useState<MacroLine[]>(() => (macro?.lines.length ? macro.lines.map((l) => ({ ...l })) : [{ command: '' }]))
  if (!macro) return null

  const setLine = (i: number, patch: Partial<MacroLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const move = (i: number, d: -1 | 1) => setLines((ls) => {
    const j = i + d
    if (j < 0 || j >= ls.length) return ls
    const next = [...ls]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const save = () => {
    const clean = lines
      .map((l) => ({ command: l.command.trim(), ...(l.wait && l.wait > 0 ? { wait: l.wait } : {}) }))
      .filter((l) => l.command !== '')
    updateMacro(id, { name: name.trim(), lines: clean })
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('pro.pools.macroEditor.title', { n: macro.number })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button icon={LuPlay} onClick={() => { save(); runMacro(id); onClose() }}>{t('pro.pools.macroEditor.saveAndRun')}</Button>
          <Button variant="primary" onClick={() => { save(); onClose() }}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('pro.pools.macroEditor.name')}>
          {(fid) => <TextInput id={fid} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('pro.pools.macroEditor.namePlaceholder', { n: macro.number })} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.pools.macroEditor.lines')}</span>
            <span className="w-[112px] text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('pro.pools.macroEditor.wait')}</span>
            <span className="w-[96px]" />
          </div>
          {lines.length === 0 && (
            <EmptyState size="sm" title={t('pro.pools.macroEditor.emptyTitle')} description={t('pro.pools.macroEditor.emptyDescription')} />
          )}
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2" data-line={i + 1}>
              <span className="w-5 shrink-0 text-right font-mono text-2xs tabular text-fg-tertiary">{i + 1}</span>
              <TextInput
                className="min-w-0 flex-1"
                mono
                value={line.command}
                onChange={(e) => setLine(i, { command: e.target.value })}
                placeholder={t('pro.pools.macroEditor.commandPlaceholder')}
                aria-label={t('pro.pools.macroEditor.command', { n: i + 1 })}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <NumberField
                className="w-[112px]"
                value={line.wait ?? 0}
                onChange={(v) => setLine(i, { wait: v })}
                min={0}
                max={3600}
                step={0.1}
                unit="s"
                aria-label={t('pro.pools.macroEditor.waitAria', { n: i + 1 })}
              />
              <div className="flex w-[96px] shrink-0 items-center justify-end">
                <IconButton icon={LuArrowUp} size="sm" label={t('pro.pools.macroEditor.moveUp', { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon={LuArrowDown} size="sm" label={t('pro.pools.macroEditor.moveDown', { n: i + 1 })} disabled={i === lines.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon={LuX} size="sm" label={t('pro.pools.macroEditor.removeLine', { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
          <div>
            <Button size="sm" variant="ghost" icon={LuListPlus} onClick={() => setLines((ls) => [...ls, { command: '' }])}>{t('pro.pools.macroEditor.addLine')}</Button>
          </div>
          <p className="text-2xs text-fg-tertiary">{t('pro.pools.macroEditor.emptyDescription')}</p>
        </div>
      </div>
    </Modal>
  )
}
