// Why no gamepad is visible: from what the operating system sees
// (main input-devices.ts, Linux) to one plain sentence per controller.

import { t as translate } from '@renderer/i18n'
import type { GameControllerDiagnostics } from '@shared/photonboard-api'

/** Text explaining why no gamepad is visible (pure: tested) */
export function gamepadHelpLines(diag: GameControllerDiagnostics | null): string[] {
  if (!diag?.supported) return [translate('follow.gamepad.wake')]
  if (diag.controllers.length === 0) return [translate('follow.gamepad.systemNone')]
  return diag.controllers.map((c) => {
    if (!c.js) return translate('follow.gamepad.systemNoJs', { name: c.name })
    if (!c.jsReadable) return translate('follow.gamepad.systemNoAccess', { name: c.name, node: c.js })
    return translate('follow.gamepad.systemSeen', { name: c.name })
  })
}

