// ============================================================
// Text of an import / export / merge remark in the UI language
// (no store access: unit-tested, used by the wizard and the toasts).
// ============================================================

import type { ImportWarning } from '@shared/interchange'
import { hasTranslation, t, type TranslationKey } from '@renderer/i18n'

/**
 * A warning in the UI language (`interchange.warnings.<code>` with its params),
 * else the importer's English text, else the code. A translation the params
 * do not fill (an importer that sends fewer params) gives way to the message.
 */
export function warningText(w: ImportWarning): string {
  const key = `interchange.warnings.${w.code}`
  if (hasTranslation(key)) {
    const text = t(key as TranslationKey, w.params)
    if (!/\{\w+\}/.test(text) || !w.message) return text
  }
  return w.message || w.code
}
