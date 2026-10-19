import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge only knows Tailwind's default scale. Teach it the custom
// utilities from tailwind.config.js, otherwise it misreads them: `shadow-raised`
// would be a shadow *colour*, `h-control` and `z-toast` would not conflict with
// `h-8` / `z-50`, and so on. Keep in sync with tailwind.config.js.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // h-control-xs, min-h-row, w-fader, p-control, gap-…, inset-…
      spacing: ['control-xs', 'control-sm', 'control', 'control-lg', 'row', 'topbar', 'statusbar', 'fader']
    },
    classGroups: {
      'font-size': [{ text: ['2xs'] }],
      shadow: [{ shadow: ['raised', 'popover', 'modal', 'glow-danger'] }],
      z: [{ z: ['popover', 'modal', 'toast', 'tooltip'] }],
      duration: [{ duration: ['', 'fast', 'slow'] }],
      ease: ['ease'],
      animate: [{ animate: ['blink', 'fade-in', 'pop-in', 'toast-in'] }],
      'fvn-spacing': ['tabular']
    }
  },
  override: {
    conflictingClassGroups: {
      // Our font sizes carry a line height, but Tailwind emits `leading-*` after
      // `text-*`, so `leading-none text-xs` keeps leading-none in CSS. Don't drop it.
      'font-size': []
    }
  }
})

type ClassValue = string | false | null | undefined | 0

/**
 * Join class names, skipping falsy values, and resolve Tailwind conflicts so the
 * last one wins: cn('h-control px-3', 'h-8') → 'px-3 h-8'. Components put the
 * caller's `className` last, so overrides just work (no `!` needed).
 */
export function cn(...parts: ClassValue[]): string {
  let out = ''
  for (const p of parts) {
    if (p) out = out ? `${out} ${p}` : p
  }
  return twMerge(out)
}
