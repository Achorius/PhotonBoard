/** Join class names, skipping falsy values: cn('a', cond && 'b', undefined) → 'a b'. */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  let out = ''
  for (const p of parts) {
    if (p) out = out ? `${out} ${p}` : p
  }
  return out
}
