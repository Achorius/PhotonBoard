import type React from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { t } from '@renderer/i18n'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  /** Confirm button shows a spinner (async action running) */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Declarative yes / no dialog. For one-off questions inside handlers prefer
 * `if (await confirm({...}))` from './dialogs'.
 */
export function ConfirmDialog({ open, title, message, confirmLabel = t('ui.ok'), cancelLabel = t('ui.cancel'), tone = 'default', busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      onClose={onCancel}
      dismissible={!busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={onConfirm} data-autofocus="">{confirmLabel}</Button>
        </>
      )}
    >
      {message && <div className="text-sm text-fg-secondary">{message}</div>}
    </Modal>
  )
}
