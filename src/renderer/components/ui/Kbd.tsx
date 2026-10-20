import { cn } from './cn'
import { t, useLocale } from '@renderer/i18n'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

/** Key cap labels; words come from the dictionary (fr: Maj, Entrée, Suppr, Échap, Espace) */
function keyLabel(key: string): string | undefined {
  switch (key) {
    case 'mod': case 'cmd': return IS_MAC ? '⌘' : 'Ctrl'
    case 'ctrl': return IS_MAC ? '⌃' : 'Ctrl'
    case 'shift': return IS_MAC ? '⇧' : t('shortcuts.keys.shift')
    case 'alt': case 'option': return IS_MAC ? '⌥' : 'Alt'
    case 'enter': return IS_MAC ? '↵' : t('shortcuts.keys.enter')
    case 'backspace': return IS_MAC ? '⌫' : t('shortcuts.keys.backspace')
    case 'delete': case 'del': return IS_MAC ? '⌦' : t('shortcuts.keys.delete')
    case 'escape': case 'esc': return t('shortcuts.keys.escape')
    case 'space': return t('shortcuts.keys.space')
    case 'up': return '↑'
    case 'down': return '↓'
    case 'left': return '←'
    case 'right': return '→'
    default: return undefined
  }
}

/** "Mod+Shift+S" → ['⌘', '⇧', 'S'] on macOS, ['Ctrl', 'Shift', 'S'] elsewhere (fr: 'Maj') */
export function shortcutParts(shortcut: string): string[] {
  return shortcut.split('+').map((k) => keyLabel(k.trim().toLowerCase()) ?? (k.length === 1 ? k.toUpperCase() : k))
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
  useLocale() // key names follow the UI language
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
