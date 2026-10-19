import { Kbd, Modal } from '@renderer/components/ui'
import { useUiStore } from '@renderer/stores/ui-store'
import { SHORTCUT_GROUPS } from '@renderer/hooks/useKeyboardShortcuts'

/** Keyboard cheat sheet (press ?) */
export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen)
  const close = () => useUiStore.getState().setShortcutsOpen(false)
  return (
    <Modal open={open} onClose={close} title="Keyboard shortcuts" description="Single-key shortcuts work when no text field is focused." size="lg">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-1">
            <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">{group.title}</h3>
            {group.shortcuts.map((s) => (
              <div key={s.keys} className="flex min-h-control-sm items-center justify-between gap-4 border-b border-line-subtle text-sm last:border-b-0">
                <span className="text-fg-secondary">{s.label}</span>
                <Kbd keys={s.keys} />
              </div>
            ))}
          </section>
        ))}
        <section className="flex flex-col gap-1">
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-fg-tertiary">Mouse & touch</h3>
          {[
            ['Right-click / long-press a control', 'MIDI learn or options'],
            ['Double-click / double-tap a fader', 'Reset to default'],
            ['Shift-drag or two fingers', 'Fine adjustment'],
            ['Hold Strobe, Blinder, TRIG, FLASH', 'Active while held']
          ].map(([what, does]) => (
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
