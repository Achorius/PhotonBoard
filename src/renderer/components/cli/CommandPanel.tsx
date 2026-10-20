// ============================================================
// Expanded command line: a panel docked above the status bar with
// the command log (origin, coloured results), the line being typed
// (syntax error underlined), a live preview, autocomplete chips from
// the parser's `expected`, and the touch keypad.
// Not a modal: the console stays usable (Space = GO…) while it is
// open; the status-bar input keeps the focus. In touch density the
// keypad is open by default.
// ============================================================

import { useLayoutEffect, useState } from 'react'
import type React from 'react'
import { LuArrowRight, LuBookOpen, LuChevronRight, LuEraser, LuGrid3X3, LuTerminal, LuTriangleAlert, LuX } from 'react-icons/lu'
import { IconButton, ToggleButton, cn } from '@renderer/components/ui'
import { Portal } from '@renderer/components/ui/Portal'
import { hasTranslation, useT, type TranslationKey } from '@renderer/i18n'
import { CLI_CHEATSHEET, type CliParseResult } from '@renderer/lib/cli'
import { useProStore } from '@renderer/stores/pro-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { chipsFor, expectationHints, type CliChip } from './cli-model'
import { CliKeypad } from './CliKeypad'
import { CliLog } from './CliLog'

const KEYPAD_PREF = 'photonboard.cli.keypad'

/** Compact density: the keypad as the operator left it (closed the first time); touch: always open at first */
export function initialKeypadOpen(density: 'compact' | 'touch'): boolean {
  if (density === 'touch') return true
  try { return window.localStorage.getItem(KEYPAD_PREF) === '1' } catch { return false }
}

function rememberKeypad(open: boolean): void {
  try { window.localStorage.setItem(KEYPAD_PREF, open ? '1' : '0') } catch { /* ignore */ }
}

export interface CommandPanelProps {
  /** The line being typed (shared with the status-bar input) */
  text: string
  parsed: CliParseResult
  preview: string
  /** lib/cli is wired (else the legacy commands run the lines) */
  engine: boolean
  /** Status-bar input (the panel docks above it) */
  anchor: React.RefObject<HTMLElement | null>
  onKey: (key: string) => void
  onBackspace: () => void
  onPlease: () => void
  onChip: (chip: CliChip) => void
  onRecall: (text: string) => void
  onFocusLine: () => void
  onClose: () => void
}

interface Placement {
  left: number
  width: number
}

function usePlacement(anchor: React.RefObject<HTMLElement | null>, wide: boolean, touch: boolean): Placement {
  const compute = (): Placement => {
    const vw = window.innerWidth
    const want = touch ? (wide ? 1180 : 760) : (wide ? 1000 : 640)
    const width = Math.min(want, vw - 16)
    const left0 = anchor.current?.getBoundingClientRect().left ?? 8
    return { width, left: Math.max(8, Math.min(left0, vw - width - 8)) }
  }
  const [p, setP] = useState<Placement>(compute)
  useLayoutEffect(() => {
    const update = () => setP((cur) => {
      const next = compute()
      return cur.left === next.left && cur.width === next.width ? cur : next
    })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, touch])
  return p
}

export function CommandPanel(props: CommandPanelProps) {
  const t = useT()
  const density = useUiStore((s) => s.density)
  const touch = density === 'touch'
  const [keypad, setKeypad] = useState(() => initialKeypadOpen(density))
  const [syntax, setSyntax] = useState(false)
  const { left, width } = usePlacement(props.anchor, keypad, touch)
  const logCount = useProStore((s) => s.cliLog.length)
  // Keypad beside the log when there is room, else below
  const side = keypad && width >= 900

  const toggleKeypad = (open: boolean) => {
    setKeypad(open)
    if (!touch) rememberKeypad(open)
  }

  return (
    <Portal>
      <section
        aria-label={t('pro.cliUi.panelAria')}
        data-cli-panel=""
        style={{ left, width, bottom: 'calc(var(--pb-statusbar-h) + 6px)' }}
        className="fixed z-popover flex max-h-[calc(100vh-var(--pb-statusbar-h)-24px)] animate-pop-in flex-col gap-2 overflow-hidden rounded-lg bg-surface-overlay p-2 shadow-popover ring-1 ring-line"
      >
        <header className="flex shrink-0 items-center gap-1.5 pl-1">
          <LuTerminal size={14} aria-hidden className="text-accent-fg" />
          <h2 className="flex-1 truncate text-xs font-semibold text-fg-primary">{t('pro.cliUi.panelTitle')}</h2>
          <ToggleButton
            size="xs"
            tone="neutral"
            pressed={keypad}
            onPressedChange={toggleKeypad}
            icon={LuGrid3X3}
            tooltip={keypad ? t('pro.cliUi.keypadHide') : t('pro.cliUi.keypadShow')}
            data-cli-keypad-toggle=""
          >
            {t('pro.cliUi.keypad')}
          </ToggleButton>
          <ToggleButton
            size="xs"
            tone="neutral"
            pressed={syntax}
            onPressedChange={setSyntax}
            icon={LuBookOpen}
            tooltip={syntax ? t('pro.cliUi.syntaxHide') : t('pro.cliUi.syntaxShow')}
            data-cli-syntax-toggle=""
          >
            {t('pro.cliUi.syntax')}
          </ToggleButton>
          <IconButton
            icon={LuEraser}
            size="xs"
            label={t('pro.cliUi.clearLog')}
            disabled={logCount === 0}
            onClick={() => useProStore.getState().clearCliLog()}
          />
          <IconButton icon={LuX} size="xs" label={t('pro.cliUi.collapse')} onClick={props.onClose} />
        </header>

        {syntax && <CheatSheet onPick={props.onRecall} />}
        <div className={cn('flex min-h-0 gap-2', side ? 'flex-row' : 'flex-col')}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
            <CliLog
              onRecall={props.onRecall}
              className={cn(
                'h-[168px] [[data-density=touch]_&]:h-[208px]',
                side && 'h-auto min-h-[168px] flex-1 [[data-density=touch]_&]:h-auto'
              )}
            />
            <LineDisplay text={props.text} parsed={props.parsed} engine={props.engine} onFocus={props.onFocusLine} />
            <Feedback text={props.text} parsed={props.parsed} preview={props.preview} engine={props.engine} />
            <Chips text={props.text} parsed={props.parsed} onChip={props.onChip} />
          </div>
          {keypad && (
            <CliKeypad
              className={cn('shrink-0', side ? 'w-[58%]' : 'w-full')}
              onKey={props.onKey}
              onBackspace={props.onBackspace}
              onPlease={props.onPlease}
            />
          )}
        </div>
      </section>
    </Portal>
  )
}

/** The line, large (readable from a touchscreen): the part after a syntax error is underlined */
function LineDisplay({ text, parsed, engine, onFocus }: { text: string; parsed: CliParseResult; engine: boolean; onFocus: () => void }) {
  const t = useT()
  const err = engine && parsed.error && parsed.error.code !== 'notImplemented' ? Math.max(0, Math.min(parsed.error.at, text.length)) : -1
  return (
    <div
      role="presentation"
      onPointerDown={(e) => { e.preventDefault(); onFocus() }}
      data-cli-line=""
      className="flex h-control shrink-0 cursor-text items-center gap-1 overflow-hidden rounded bg-surface-0 px-2 font-mono text-sm ring-1 ring-inset ring-line-strong [[data-density=touch]_&]:text-base"
    >
      <LuChevronRight size={14} aria-hidden className="shrink-0 text-accent-fg" />
      <span className="min-w-0 truncate whitespace-pre text-fg-primary">
        {text === ''
          ? <span className="text-fg-disabled">{t('shell.commandLine.placeholder')}</span>
          : err >= 0 && err < text.length
            ? <>{text.slice(0, err)}<span className="text-danger-fg underline decoration-danger-fg decoration-wavy underline-offset-4">{text.slice(err)}</span></>
            : text}
      </span>
      <span aria-hidden className="h-4 w-px shrink-0 animate-pulse bg-accent-fg" />
    </div>
  )
}

/** Preview of what the line does, the syntax error, or what may come next */
function Feedback({ text, parsed, preview, engine }: { text: string; parsed: CliParseResult; preview: string; engine: boolean }) {
  const t = useT()
  let content: React.ReactNode = null
  if (!engine) {
    content = <span className="truncate text-fg-tertiary">{t('pro.cliUi.legacyNote')}</span>
  } else if (preview) {
    content = (
      <>
        <LuArrowRight size={12} aria-hidden className="shrink-0 text-accent-fg" />
        <span className="truncate text-fg-secondary" data-cli-preview="">{preview}</span>
      </>
    )
  } else if (text.trim() !== '' && parsed.error) {
    const key = `pro.cli.errors.${parsed.error.code}`
    const message = hasTranslation(key)
      ? t(key)
      : parsed.error.token
        ? t('pro.cliUi.syntaxError', { token: parsed.error.token })
        : t('pro.cliUi.syntaxErrorEnd')
    content = (
      <>
        <LuTriangleAlert size={12} aria-hidden className="shrink-0 text-warning-fg" />
        <span className="truncate text-warning-fg">{message}</span>
      </>
    )
  } else {
    const hints = expectationHints(parsed)
    if (hints.length > 0) {
      content = (
        <span className="truncate text-fg-tertiary">
          <span className="font-semibold uppercase tracking-[0.06em]">{t('pro.cliUi.expect.title')}</span>{' '}
          {hints.map((k) => t(`pro.cliUi.expect.${k}`)).join(' · ')}
        </span>
      )
    }
  }
  return <div className="flex min-h-[18px] shrink-0 items-center gap-1.5 px-1 text-xs">{content}</div>
}

function Chips({ text, parsed, onChip }: { text: string; parsed: CliParseResult; onChip: (chip: CliChip) => void }) {
  const t = useT()
  const chips = chipsFor(parsed, text)
  if (chips.length === 0) return null
  return (
    <div role="group" aria-label={t('pro.cliUi.chipsAria')} className="flex shrink-0 flex-wrap gap-1">
      {chips.map((chip) => {
        const helpKey = chip.helpKey ? `pro.cli.help.${chip.helpKey}` : ''
        return (
          <button
            key={chip.value}
            type="button"
            tabIndex={-1}
            data-cli-chip={chip.value}
            title={helpKey && hasTranslation(helpKey) ? t(helpKey) : undefined}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onChip(chip)}
            className={cn(
              'h-control-xs rounded-full px-2.5 font-mono text-xs transition-colors duration-fast',
              chip.kind === 'option' ? 'bg-surface-2 text-fg-secondary ring-1 ring-inset ring-line' : 'bg-surface-3 text-fg-primary hover:bg-surface-4 active:bg-surface-5'
            )}
          >
            {chip.value}
          </button>
        )
      })}
    </div>
  )
}

/** Syntax card (lib/cli CLI_CHEATSHEET): the syntax stays English, the explanations are translated; a line can be put on the command line */
function CheatSheet({ onPick }: { onPick: (text: string) => void }) {
  const t = useT()
  return (
    <div data-cli-cheatsheet="" className="max-h-[240px] shrink-0 overflow-y-auto rounded bg-surface-1 p-2 ring-1 ring-inset ring-line-subtle">
      <p className="mb-2 text-xs text-fg-tertiary">{t('pro.cli.cheatsheet.intro')}</p>
      <div className="grid gap-x-4 gap-y-2 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {CLI_CHEATSHEET.map((section) => (
          <section key={section.id} className="min-w-0">
            <h3 className="mb-0.5 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t(`pro.cli.cheatsheet.sections.${section.id}` as TranslationKey)}</h3>
            <ul className="flex flex-col">
              {section.lines.map((line) => (
                <li key={line.key} className="flex min-w-0 items-baseline gap-2 text-xs">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="shrink-0 rounded-sm px-1 font-mono text-fg-primary hover:bg-surface-3"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => onPick(line.syntax.split(' · ')[0])}
                  >
                    {line.syntax}
                  </button>
                  <span className="min-w-0 truncate text-fg-tertiary" title={t(`pro.cli.cheatsheet.lines.${line.key}` as TranslationKey)}>{t(`pro.cli.cheatsheet.lines.${line.key}` as TranslationKey)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
