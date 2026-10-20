// ============================================================
// PhotonBoard — Remote access settings (<userData>/config/remote.json)
// Machine configuration: optional access PIN for the web remote (9091)
// and the Companion API (9090). Disabled by default so existing
// setups keep working.
// ============================================================

import { loadJsonConfig, saveJsonConfig } from './config-store'
import { DEFAULT_REMOTE_SETTINGS, validateRemoteSettings } from './remote-auth'
import type { RemoteSettings, RemoteSettingsResult } from '../shared/photonboard-api'

export class RemoteSettingsStore {
  private settings: RemoteSettings
  private listeners = new Set<(settings: RemoteSettings, previous: RemoteSettings) => void>()

  constructor(private path: string) {
    this.settings = loadJsonConfig<RemoteSettings>(
      path,
      (raw) => {
        const res = validateRemoteSettings(raw)
        return res.ok ? { ok: true, value: res.settings } : res
      },
      () => ({ ...DEFAULT_REMOTE_SETTINGS })
    ).value
  }

  get(): RemoteSettings {
    return { ...this.settings }
  }

  set(input: unknown): RemoteSettingsResult {
    const res = validateRemoteSettings(input)
    if (!res.ok) return { success: false, error: res.error }
    try {
      saveJsonConfig(this.path, res.settings)
    } catch (e) {
      return { success: false, error: `Could not save remote settings: ${(e as Error).message}` }
    }
    const previous = this.settings
    this.settings = res.settings
    for (const cb of this.listeners) {
      try { cb(this.get(), previous) } catch (e) { console.error('[Remote] settings listener failed:', e) }
    }
    return { success: true, settings: this.get() }
  }

  onChange(cb: (settings: RemoteSettings, previous: RemoteSettings) => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }
}
