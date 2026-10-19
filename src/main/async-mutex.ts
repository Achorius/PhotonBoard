// ============================================================
// PhotonBoard — Tiny promise-chain mutex
// Serialises async operations that must not interleave (e.g. two
// configure() calls opening/closing the same serial port).
// ============================================================

export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  /** Run `fn` after every previously queued task has settled. */
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(() => fn())
    // Keep the chain alive even when a task fails
    this.tail = result.catch(() => {})
    return result
  }
}
