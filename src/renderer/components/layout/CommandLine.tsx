import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { LuChevronRight, LuChevronsDown, LuChevronsUp } from 'react-icons/lu'
import { IconButton, cn } from '@renderer/components/ui'
import { COMMAND_LINE_ID } from '@renderer/hooks/useKeyboardShortcuts'
import { useT } from '@renderer/i18n'
import type { CliResult } from '@renderer/lib/cli'
import {
  IMMEDIATE_ON_EMPTY, applyChip, backspace, chipsFor, insertKey, removeLastWord, stepHistory, type CliChip
} from '@renderer/components/cli/cli-model'
import { addToHistory, engineReady, getHistory, previewLine, runLine, safeParse } from '@renderer/components/cli/run'
import { CommandPanel } from '@renderer/components/cli/CommandPanel'

// ============================================================
// CommandLine — grandMA3-style command input in the status bar.
// Lines run through the command-line engine (lib/cli: full syntax,
// undo, log) — or the legacy commands while it is not wired.
// Parsed on each keystroke (never per frame) for the live preview and
// the autocomplete chips; ↑ / ↓ recall the history (200 lines, kept on
// this machine); Tab takes the first suggestion. The expand button
// opens the docked panel: log, suggestions, preview, touch keypad.
// The syntax stays in English in every language (console
// convention, like grandMA); feedback messages are translated.
// ============================================================

type Feedback = Pick<CliResult, 'ok' | 'message' | 'level'>

export function CommandLine() {
  const tr = useT()
  const [input, setInput] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [expanded, setExpanded] = useState(false)
  const historyIdx = useRef(-1)
  const draft = useRef('')
  const field = useRef<HTMLLabelElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Parsed on keystroke only (live feedback, chips, preview)
  const parsed = useMemo(() => safeParse(input), [input])
  const engine = useMemo(() => engineReady(), [input]) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (expanded && input.trim() ? previewLine(parsed) : ''), [expanded, input, parsed])

  // Feedback fades after a few seconds
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(null), feedback.ok ? 3000 : 5000)
    return () => clearTimeout(timer)
  }, [feedback])

  const edit = (text: string) => {
    setInput(text)
    historyIdx.current = -1
  }

  const run = (line: string) => {
    const cmd = line.trim()
    if (!cmd) return
    const result = runLine(cmd)
    if (result.message) setFeedback(result)
    result.pending?.then((final) => { if (final.message) setFeedback(final) }).catch(() => { /* reported by the engine */ })
    addToHistory(cmd)
    edit('')
  }

  const submit = () => run(input)

  const recall = (dir: 1 | -1) => {
    const step = stepHistory(getHistory(), historyIdx.current, dir, draft.current)
    if (!step) return
    if (historyIdx.current === -1) draft.current = input
    historyIdx.current = step.index
    setInput(step.index === -1 ? draft.current : step.text)
  }

  // ---- keypad / chips / log (expanded panel)
  const onKey = (key: string) => {
    if (input.trim() === '' && IMMEDIATE_ON_EMPTY.has(key)) { run(key); return }
    if (key === 'Clear') { edit(''); return }
    if (key === 'Oops') { edit(removeLastWord(input)); return }
    edit(insertKey(input, key))
  }
  const onChip = (chip: CliChip) => edit(applyChip(input, chip.value))
  const onRecall = (text: string) => { edit(text); inputRef.current?.focus() }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); recall(1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); recall(-1) }
    else if (e.key === 'Tab' && !e.shiftKey && input.trim() !== '') {
      const first = chipsFor(parsed, input, 1)[0]
      if (first) { e.preventDefault(); onChip(first) }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (input === '' && expanded) { setExpanded(false); return }
      edit('')
      e.currentTarget.blur()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <label
        ref={field}
        className={cn(
          'flex h-control-xs w-full max-w-[420px] min-w-[200px] items-center gap-1 rounded-sm border bg-surface-0 pl-1.5 pr-2 font-mono text-xs transition-colors duration-fast',
          'border-line focus-within:border-accent/70 focus-within:ring-1 focus-within:ring-accent/30'
        )}
      >
        <LuChevronRight size={14} aria-hidden className="shrink-0 text-accent-fg" />
        <input
          ref={inputRef}
          id={COMMAND_LINE_ID}
          className="h-full min-w-0 flex-1 bg-transparent text-fg-primary outline-none placeholder:text-fg-disabled"
          value={input}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tr('shell.commandLine.placeholder')}
          spellCheck={false}
          autoComplete="off"
          aria-label={tr('shell.commandLine.aria')}
        />
      </label>
      <IconButton
        icon={expanded ? LuChevronsDown : LuChevronsUp}
        size="xs"
        label={expanded ? tr('pro.cliUi.collapse') : tr('pro.cliUi.expand')}
        aria-expanded={expanded}
        data-cli-expand=""
        active={expanded}
        tone="neutral"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setExpanded((v) => !v)}
      />
      {feedback && (
        <span
          role="status"
          className={cn('ml-1 min-w-0 truncate text-xs', !feedback.ok || feedback.level === 'error' ? 'text-danger-fg' : feedback.level === 'warning' ? 'text-warning-fg' : 'text-go-fg')}
        >
          {feedback.message}
        </span>
      )}
      {expanded && (
        <CommandPanel
          text={input}
          parsed={parsed}
          preview={preview}
          engine={engine}
          anchor={field}
          onKey={onKey}
          onBackspace={() => edit(backspace(input))}
          onPlease={submit}
          onChip={onChip}
          onRecall={onRecall}
          onFocusLine={() => inputRef.current?.focus()}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  )
}
