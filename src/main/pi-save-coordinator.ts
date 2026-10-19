// ============================================================
// PhotonBoard — Remote save → Pi renderer save
//
// Single source of truth: the show running in the Pi's renderer.
// A remote browser holds a COPY of the show that is only partly kept
// in sync, so writing the browser's copy to disk would make the file
// and the running show diverge. Instead, a remote Save / Save As asks
// the Pi renderer (command 'save-show' with a requestId) to save its
// own state; main writes that to the path the remote client chose and
// hands the result back to the remote client.
// ============================================================

import type { ShowSaveResult } from '../shared/photonboard-api'

export const PI_SAVE_TIMEOUT_MS = 15_000

interface PendingSave {
  id: string
  path: string
  resolve: (result: ShowSaveResult) => void
  timer: ReturnType<typeof setTimeout>
}

export class PiSaveCoordinator {
  private pending: PendingSave | null = null
  private counter = 0

  /**
   * @param sendCommand delivers the 'save-show' command to the Pi renderer;
   *                    returns false when no renderer is available.
   */
  constructor(private sendCommand: (command: { type: 'save-show'; payload: { requestId: string } }) => boolean) {}

  /** Ask the Pi renderer to save its show to `path`; resolves with the save result. */
  request(path: string, timeoutMs = PI_SAVE_TIMEOUT_MS): Promise<ShowSaveResult> {
    if (this.pending) {
      return Promise.resolve({ success: false, error: 'Another save is already in progress — try again in a moment.' })
    }
    const id = `save-${Date.now().toString(36)}-${++this.counter}`
    return new Promise<ShowSaveResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return
        this.pending = null
        resolve({ success: false, error: 'The PhotonBoard console did not answer the save request (is the main window open?).' })
      }, timeoutMs)
      this.pending = { id, path, resolve, timer }
      if (!this.sendCommand({ type: 'save-show', payload: { requestId: id } })) {
        clearTimeout(timer)
        this.pending = null
        resolve({ success: false, error: 'The PhotonBoard console window is not running.' })
      }
    })
  }

  /**
   * Called by the renderer's show:save handler. Returns the target path when
   * this save answers a pending remote request (matched by requestId; a save
   * without requestId is NOT treated as an answer).
   */
  claim(requestId: unknown): { id: string; path: string } | null {
    if (!this.pending || typeof requestId !== 'string' || requestId !== this.pending.id) return null
    return { id: this.pending.id, path: this.pending.path }
  }

  complete(id: string, result: ShowSaveResult): void {
    if (!this.pending || this.pending.id !== id) return
    clearTimeout(this.pending.timer)
    const { resolve } = this.pending
    this.pending = null
    resolve(result)
  }

  dispose(): void {
    if (this.pending) this.complete(this.pending.id, { success: false, error: 'PhotonBoard is shutting down.' })
  }
}
