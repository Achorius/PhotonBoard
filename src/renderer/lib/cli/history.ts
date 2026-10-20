// ============================================================
// PhotonBoard — Command line: typed-line history
//
// Last CLI_HISTORY_LIMIT lines, newest first, kept per machine in
// localStorage (every access in try/catch: private windows, kiosk with
// storage off, tests). Consecutive duplicates are stored once.
// Arrow-key recall keeps the line being typed as a draft.
// ============================================================

export const CLI_HISTORY_KEY = 'photonboard.cli.history'
export const CLI_HISTORY_LIMIT = 200

/** The part of Storage the history uses */
export interface HistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CliHistory {
  /** Newest first */
  lines(): readonly string[]
  /** Add a typed line (trimmed; empty lines ignored); resets recall */
  push(line: string): void
  /**
   * Arrow keys: dir 1 = older (Up), -1 = newer (Down). `draft` is the
   * line being typed (given back when coming down past the newest).
   * Returns the text to show, or null when there is nothing further.
   */
  recall(dir: 1 | -1, draft: string): string | null
  /** Forget the recall position (the user typed) */
  resetRecall(): void
  clear(): void
}

function defaultStorage(): HistoryStorage | null {
  try {
    const g = globalThis as { localStorage?: HistoryStorage }
    return g.localStorage ?? null
  } catch {
    return null
  }
}

export function createCliHistory(opts: { storage?: HistoryStorage | null; key?: string; limit?: number } = {}): CliHistory {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const storageKey = opts.key ?? CLI_HISTORY_KEY
  const limit = Math.max(1, opts.limit ?? CLI_HISTORY_LIMIT)
  let items: string[] = []
  let cursor = -1
  let draft = ''

  try {
    const raw = storage?.getItem(storageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) items = parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, limit)
  } catch {
    items = []
  }

  const save = () => {
    try {
      storage?.setItem(storageKey, JSON.stringify(items))
    } catch {
      /* storage full / disabled: history stays in memory */
    }
  }

  return {
    lines: () => items,
    push(line) {
      const text = line.trim()
      cursor = -1
      if (!text) return
      if (items[0] !== text) items = [text, ...items].slice(0, limit)
      save()
    },
    recall(dir, current) {
      const next = cursor + dir
      if (next < -1 || next >= items.length) return null
      if (cursor === -1) draft = current
      cursor = next
      return next === -1 ? draft : items[next]
    },
    resetRecall() {
      cursor = -1
    },
    clear() {
      items = []
      cursor = -1
      save()
    }
  }
}
