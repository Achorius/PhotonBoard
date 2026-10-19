// ============================================================
// PhotonBoard — main → console renderer requests
//
// Same pattern as PiSaveCoordinator: main sends a command with a
// requestId to the console renderer (the single source of truth) and
// waits for the renderer to answer over IPC.CONSOLE_REPLY. Used by
// web remotes to read the show the console is running RIGHT NOW
// (show:get-current), unsaved edits included.
// Kept free of electron imports so it can be unit-tested.
// ============================================================

export const CONSOLE_REQUEST_TIMEOUT_MS = 10_000
const MAX_PENDING = 32

interface Pending {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class ConsoleRequestCoordinator {
  private pending = new Map<string, Pending>()
  private counter = 0

  /**
   * @param sendCommand delivers `{ type, payload: { requestId, ...payload } }` to the
   *                    console renderer; returns false when no renderer is available.
   */
  constructor(private sendCommand: (command: { type: string; payload: Record<string, unknown> }) => boolean) {}

  request(type: string, payload: Record<string, unknown> = {}, timeoutMs = CONSOLE_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new Error('The PhotonBoard console is busy — try again in a moment.'))
    const requestId = `req-${Date.now().toString(36)}-${++this.counter}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return
        reject(new Error('The PhotonBoard console did not answer (is the main window open?).'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      if (!this.sendCommand({ type, payload: { ...payload, requestId } })) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('The PhotonBoard console window is not running.'))
      }
    })
  }

  /** True when `requestId` is one of ours (still waiting). */
  has(requestId: unknown): boolean {
    return typeof requestId === 'string' && this.pending.has(requestId)
  }

  /** Answer from the renderer (JSON text or a value). Unknown / late ids are ignored. */
  answer(requestId: unknown, data: unknown): boolean {
    if (typeof requestId !== 'string') return false
    const p = this.pending.get(requestId)
    if (!p) return false
    this.pending.delete(requestId)
    clearTimeout(p.timer)
    let value = data
    if (typeof data === 'string') {
      try { value = JSON.parse(data) } catch { value = null }
    }
    p.resolve(value)
    return true
  }

  dispose(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('PhotonBoard is shutting down.'))
      this.pending.delete(id)
    }
  }
}
