// ============================================================
// Imperative dialogs: `await confirm({...})`, `await ask({...})`,
// `await prompt({...})` from anywhere (event handlers, lib code).
// Rendered by <DialogHost/>, mounted once in App.
// ============================================================

import { useEffect, useState } from 'react'
import type React from 'react'
import { create } from 'zustand'
import { Modal } from './Modal'
import { Button, type ButtonVariant } from './Button'
import { TextInput } from './TextInput'
import { t } from '@renderer/i18n'

export interface DialogAction<T extends string = string> {
  id: T
  label: string
  variant?: ButtonVariant
}

export interface AskOptions<T extends string = string> {
  title: string
  message?: React.ReactNode
  /** Left to right; the last one is the default (Enter). */
  actions: DialogAction<T>[]
  /** Esc / backdrop allowed → resolves null (default true) */
  dismissible?: boolean
  /**
   * Keypad-friendly (command line questions): numbered, large buttons;
   * the digit keys 1-9 answer, Enter takes the default (last).
   */
  numbered?: boolean
}

export interface ConfirmOptions {
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger → red confirm button (destructive actions) */
  tone?: 'default' | 'danger'
}

export interface PromptOptions {
  title: string
  message?: React.ReactNode
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  /** Return an error message to refuse the value */
  validate?: (value: string) => string | null
}

type Pending =
  | { kind: 'ask'; opts: AskOptions; resolve: (id: string | null) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void }

const useDialogStore = create<{ queue: Pending[] }>(() => ({ queue: [] }))

function enqueue(p: Pending) {
  useDialogStore.setState((s) => ({ queue: [...s.queue, p] }))
}

function settle() {
  useDialogStore.setState((s) => ({ queue: s.queue.slice(1) }))
}

/** Several choices (e.g. Save / Don't save / Cancel). Resolves the chosen id, or null if dismissed. */
export function ask<T extends string>(opts: AskOptions<T>): Promise<T | null> {
  return new Promise((resolve) => enqueue({ kind: 'ask', opts: opts as AskOptions, resolve: resolve as (id: string | null) => void }))
}

/** Yes / no. Use tone 'danger' and an explicit verb for destructive actions ("Delete scene"). */
export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  const result = await ask({
    title: opts.title,
    message: opts.message,
    actions: [
      { id: 'cancel', label: opts.cancelLabel ?? t('ui.cancel'), variant: 'secondary' },
      { id: 'ok', label: opts.confirmLabel ?? t('ui.ok'), variant: opts.tone === 'danger' ? 'danger' : 'primary' }
    ]
  })
  return result === 'ok'
}

/** Ask for a short text (show name, scene name). Resolves the trimmed value, or null. */
export function prompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: 'prompt', opts, resolve }))
}

/** Renders queued confirm / ask / prompt dialogs (one at a time). Mount once. */
export function DialogHost() {
  const current = useDialogStore((s) => s.queue[0])
  if (!current) return null
  return current.kind === 'ask'
    ? <AskDialog key={queueKey(current)} pending={current} />
    : <PromptDialog key={queueKey(current)} pending={current} />
}

const keys = new WeakMap<Pending, number>()
let keySeq = 0
function queueKey(p: Pending): number {
  let k = keys.get(p)
  if (k === undefined) { k = ++keySeq; keys.set(p, k) }
  return k
}

function AskDialog({ pending }: { pending: Extract<Pending, { kind: 'ask' }> }) {
  const { opts, resolve } = pending
  const done = (id: string | null) => { settle(); resolve(id) }
  const dismissible = opts.dismissible !== false
  const numbered = !!opts.numbered
  // Keypad answers: 1-9 pick a choice (digit row or numpad)
  useEffect(() => {
    if (!numbered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0
      const a = n > 0 ? opts.actions[n - 1] : undefined
      if (!a) return
      e.preventDefault()
      e.stopPropagation()
      done(a.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbered])
  return (
    <Modal
      open
      size="sm"
      title={opts.title}
      dismissible={dismissible}
      onClose={() => done(null)}
      footer={opts.actions.map((a, i) => (
        <Button
          key={a.id}
          size={numbered ? 'lg' : undefined}
          variant={a.variant ?? (i === opts.actions.length - 1 ? 'primary' : 'secondary')}
          data-autofocus={i === opts.actions.length - 1 ? '' : undefined}
          data-ask-choice={a.id}
          onClick={() => done(a.id)}
        >
          {numbered && <span className="mr-1.5 font-mono text-xs opacity-70" aria-hidden>{i + 1}</span>}
          {a.label}
        </Button>
      ))}
    >
      {opts.message && <div className="text-sm text-fg-secondary">{opts.message}</div>}
    </Modal>
  )
}

function PromptDialog({ pending }: { pending: Extract<Pending, { kind: 'prompt' }> }) {
  const { opts, resolve } = pending
  const [value, setValue] = useState(opts.defaultValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const done = (v: string | null) => { settle(); resolve(v) }
  useEffect(() => setError(null), [value])

  const submit = () => {
    const v = value.trim()
    if (!v) { setError(t('ui.required')); return }
    const err = opts.validate?.(v) ?? null
    if (err) { setError(err); return }
    done(v)
  }

  return (
    <Modal
      open
      size="sm"
      title={opts.title}
      onClose={() => done(null)}
      footer={(
        <>
          <Button variant="secondary" onClick={() => done(null)}>{t('ui.cancel')}</Button>
          <Button variant="primary" onClick={submit}>{opts.confirmLabel ?? t('ui.ok')}</Button>
        </>
      )}
    >
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        {opts.message && <div className="text-sm text-fg-secondary">{opts.message}</div>}
        <TextInput
          data-autofocus=""
          aria-label={opts.label ?? opts.title}
          value={value}
          placeholder={opts.placeholder}
          invalid={!!error}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}
      </form>
    </Modal>
  )
}
