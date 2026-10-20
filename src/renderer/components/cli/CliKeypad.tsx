// ============================================================
// Touch keypad of the command line: console keys (English keywords,
// never translated), digits, ".", backspace and Please (= Enter).
// Keys never take the focus (the status-bar input keeps it on a
// desktop; nothing pops a virtual keyboard on the Pi).
// ============================================================

import { memo } from 'react'
import type React from 'react'
import { LuCornerDownLeft, LuDelete } from 'react-icons/lu'
import { cn } from '@renderer/components/ui'
import { useT } from '@renderer/i18n'

type KeyTone = 'neutral' | 'object' | 'function' | 'danger' | 'go' | 'warning'

interface KeyDef {
  key: string
  /** Shown instead of `key` ("−" for "-") */
  label?: string
  tone?: KeyTone
  span?: number
}

/** 6 columns × 5 rows */
const COMMAND_KEYS: KeyDef[] = [
  { key: 'Fixture', tone: 'object' }, { key: 'Group', tone: 'object' }, { key: 'Preset', tone: 'object' },
  { key: 'Cue', tone: 'object' }, { key: 'Seq', tone: 'object' }, { key: 'Exec', tone: 'object' },
  { key: 'Page', tone: 'object' }, { key: 'Thru' }, { key: '+' }, { key: '-', label: '−' }, { key: 'At' }, { key: 'Full' },
  { key: 'Store', tone: 'function' }, { key: 'Update', tone: 'function' }, { key: 'Delete', tone: 'danger' },
  { key: 'Copy', tone: 'function' }, { key: 'Move', tone: 'function' }, { key: 'Label', tone: 'function' },
  { key: 'Assign', tone: 'function' }, { key: 'Highlight' }, { key: 'Next' }, { key: 'Prev' }, { key: 'Clear', tone: 'warning' }, { key: 'Oops', tone: 'warning' },
  { key: 'Go', tone: 'go', span: 2 }, { key: 'Go-', tone: 'go', span: 2 }, { key: 'Off', span: 2 }
]

const DIGIT_KEYS: KeyDef[] = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.'].map((key) => ({ key }))

const TONE: Record<KeyTone, string> = {
  neutral: 'text-fg-primary',
  object: 'text-info-fg',
  function: 'text-accent-fg',
  danger: 'text-danger-fg',
  go: 'text-go-fg',
  warning: 'text-warning-fg'
}

/** Keeps the focus where it is (status-bar input) */
const keepFocus = (e: React.PointerEvent) => e.preventDefault()

const KEY_CLASS =
  'flex h-control min-w-0 select-none items-center justify-center rounded bg-surface-3 px-0.5 text-xs font-semibold shadow-raised ' +
  'transition-colors duration-fast hover:bg-surface-4 active:bg-surface-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-info-fg ' +
  '[[data-density=touch]_&]:text-sm'

export const CliKeypad = memo(function CliKeypad({ onKey, onBackspace, onPlease, className }: {
  onKey: (key: string) => void
  onBackspace: () => void
  onPlease: () => void
  className?: string
}) {
  const t = useT()
  return (
    <div role="group" aria-label={t('pro.cliUi.keypadAria')} data-cli-keypad="" className={cn('flex gap-2', className)}>
      <div className="grid min-w-0 flex-1 grid-cols-6 content-start gap-1">
        {COMMAND_KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            tabIndex={-1}
            data-cli-key={k.key}
            onPointerDown={keepFocus}
            onClick={() => onKey(k.key)}
            className={cn(KEY_CLASS, TONE[k.tone ?? 'neutral'], k.span === 2 && 'col-span-2')}
          >
            <span className="truncate">{k.label ?? k.key}</span>
          </button>
        ))}
      </div>
      <div className="grid w-[150px] shrink-0 grid-cols-3 content-start gap-1 [[data-density=touch]_&]:w-[204px]">
        {DIGIT_KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            tabIndex={-1}
            data-cli-key={k.key}
            onPointerDown={keepFocus}
            onClick={() => onKey(k.key)}
            className={cn(KEY_CLASS, 'font-mono text-sm text-fg-primary [[data-density=touch]_&]:text-base')}
          >
            {k.key}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('pro.cliUi.backspace')}
          title={t('pro.cliUi.backspace')}
          onPointerDown={keepFocus}
          onClick={onBackspace}
          className={cn(KEY_CLASS, 'text-fg-secondary')}
        >
          <LuDelete size={16} aria-hidden />
        </button>
        <button
          type="button"
          tabIndex={-1}
          data-cli-key="please"
          title={t('pro.cliUi.pleaseTitle')}
          onPointerDown={keepFocus}
          onClick={onPlease}
          className={cn(KEY_CLASS, 'col-span-3 gap-1.5 bg-accent font-sans text-sm text-on-accent hover:bg-accent-hover active:bg-accent-active')}
        >
          <LuCornerDownLeft size={14} aria-hidden />
          {t('pro.cliUi.please')}
        </button>
      </div>
    </div>
  )
})
