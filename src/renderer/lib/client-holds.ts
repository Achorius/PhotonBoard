// ============================================================
// PhotonBoard — Momentary holds per remote client
// A flash button, a TRIG executor, the blinder or the strobe stays on
// while a finger is on it. When the remote that holds it disconnects
// (Wi-Fi drop, page closed) the console must release it: the web
// server tags every command with the connection's clientId and sends
// 'client-disconnected' when the socket closes.
// Pure bookkeeping — the command handler performs the releases.
// ============================================================

interface Holds {
  flash: Set<string>
  trigger: Set<string>
  blinder: boolean
  strobe: boolean
}

export interface HoldRelease {
  /** Cuelists whose flash must be released */
  flash: string[]
  /** Cuelists started by a TRIG press that must stop */
  trigger: string[]
  blinder: boolean
  strobe: boolean
}

export class ClientHolds {
  private clients = new Map<string, Holds>()

  private get(clientId: string): Holds {
    let h = this.clients.get(clientId)
    if (!h) {
      h = { flash: new Set(), trigger: new Set(), blinder: false, strobe: false }
      this.clients.set(clientId, h)
    }
    return h
  }

  private prune(clientId: string): void {
    const h = this.clients.get(clientId)
    if (h && h.flash.size === 0 && h.trigger.size === 0 && !h.blinder && !h.strobe) this.clients.delete(clientId)
  }

  private heldByOther(clientId: string, test: (h: Holds) => boolean): boolean {
    for (const [id, h] of this.clients) if (id !== clientId && test(h)) return true
    return false
  }

  flash(clientId: string, cuelistId: string, on: boolean): void {
    if (on) this.get(clientId).flash.add(cuelistId)
    else {
      // Released by anyone: nobody holds it any more
      for (const [id, h] of this.clients) { h.flash.delete(cuelistId); this.prune(id) }
    }
  }

  trigger(clientId: string, cuelistId: string, on: boolean): void {
    if (on) this.get(clientId).trigger.add(cuelistId)
    else {
      for (const [id, h] of this.clients) { h.trigger.delete(cuelistId); this.prune(id) }
    }
  }

  blinder(clientId: string, on: boolean): void {
    if (on) this.get(clientId).blinder = true
    else for (const [id, h] of this.clients) { h.blinder = false; this.prune(id) }
  }

  strobe(clientId: string, on: boolean): void {
    if (on) this.get(clientId).strobe = true
    else for (const [id, h] of this.clients) { h.strobe = false; this.prune(id) }
  }

  /** The client went away: what to release (not what another client still holds). */
  release(clientId: string): HoldRelease {
    const h = this.clients.get(clientId)
    this.clients.delete(clientId)
    if (!h) return { flash: [], trigger: [], blinder: false, strobe: false }
    return {
      flash: [...h.flash].filter(id => !this.heldByOther(clientId, o => o.flash.has(id))),
      trigger: [...h.trigger].filter(id => !this.heldByOther(clientId, o => o.trigger.has(id))),
      blinder: h.blinder && !this.heldByOther(clientId, o => o.blinder),
      strobe: h.strobe && !this.heldByOther(clientId, o => o.strobe)
    }
  }

  /** Clients currently holding something (tests / diagnostics) */
  size(): number {
    return this.clients.size
  }
}
