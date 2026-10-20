import { Kbd, Modal } from '@renderer/components/ui'
import { useUiStore } from '@renderer/stores/ui-store'
import { getShortcutGroups } from '@renderer/hooks/useKeyboardShortcuts'
import { useT } from '@renderer/i18n'

/** Keyboard cheat sheet (press ?) */
export function ShortcutsDialog() {
  const t = useT()
  const open = useUiStore((s) => s.shortcutsOpen)
  const close = () => useUiStore.getState().setShortcutsOpen(false)
  const pointer: [string, string][] = [
    [t('shortcuts.pointer.learn'), t('shortcuts.pointer.learnDoes')],
    [t('shortcuts.pointer.reset'), t('shortcuts.pointer.resetDoes')],
    [t('shortcuts.pointer.fine'), t('shortcuts.pointer.fineDoes')],
    [t('shortcuts.pointer.hold'), t('shortcuts.pointer.holdDoes')]
  ]
  return (
    <Modal open={open} onClose={close} title={t('shortcuts.title')} description={t('shortcuts.description')} size="lg">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {getShortcutGroups(t).map((group) => (
          <section key={group.title} className="flex flex-col gap-1">
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{group.title}</h3>
            {group.shortcuts.map((s) => (
              <div key={s.keys} className="flex min-h-control-sm items-center justify-between gap-4 border-b border-line-subtle text-sm last:border-b-0">
                <span className="text-fg-secondary">{s.label}</span>
                <Kbd keys={s.keys} className="shrink-0" />
              </div>
            ))}
          </section>
        ))}
        <section className="flex flex-col gap-1">
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{t('shortcuts.groups.pointer')}</h3>
          {pointer.map(([what, does]) => (
            <div key={what} className="flex min-h-control-sm items-center justify-between gap-4 border-b border-line-subtle text-sm last:border-b-0">
              <span className="text-fg-secondary">{what}</span>
              <span className="text-right text-fg-tertiary">{does}</span>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  )
}
