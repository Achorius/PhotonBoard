import { cn } from './cn'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

const KEY_LABELS: Record<string, string> = IS_MAC
  ? { mod: '⌘', cmd: '⌘', ctrl: '⌃', shift: '⇧', alt: '⌥', option: '⌥', enter: '↵', backspace: '⌫', escape: 'Esc', esc: 'Esc', space: 'Space', up: '↑', down: '↓', left: '←', right: '→' }
  : { mod: 'Ctrl', cmd: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', option: 'Alt', enter: 'Enter', backspace: 'Backspace', escape: 'Esc', esc: 'Esc', space: 'Space', up: '↑', down: '↓', left: '←', right: '→' }

/** "Mod+Shift+S" → ['⌘', '⇧', 'S'] on macOS, ['Ctrl', 'Shift', 'S'] elsewhere */
export function shortcutParts(shortcut: string): string[] {
  return shortcut.split('+').map((k) => KEY_LABELS[k.trim().toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k))
}

/** Human-readable shortcut for tooltips / menus: "⌘⇧S" or "Ctrl+Shift+S" */
export function formatShortcut(shortcut: string): string {
  return shortcutParts(shortcut).join(IS_MAC ? '' : '+')
}

export interface KbdProps {
  /** One key or a combo: "B", "Mod+S", "Shift+Space" */
  keys: string
  className?: string
}

/** Keyboard key cap(s) */
export function Kbd({ keys, className }: KbdProps) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {shortcutParts(keys).map((k, i) => (
        <kbd
          key={i}
          className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-sm border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] leading-none text-fg-secondary shadow-[inset_0_-1px_0_rgb(0_0_0/0.4)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
