/**
 * GamepadManager — Web Gamepad API polling for controllers (Xbox, Thrustmaster, etc.)
 * Provides a reactive gamepad state via a polling rAF loop.
 */

export interface GamepadButtonState {
  pressed: boolean
  value: number   // 0-1 for analog triggers
}

export interface GamepadState {
  connected: boolean
  id: string
  axes: number[]             // -1..+1 per axis
  buttons: GamepadButtonState[]
  timestamp: number
}

export type GamepadListener = (state: GamepadState) => void

const DEADZONE = 0.08   // ignore tiny axis noise

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0
  // Rescale so the usable range is still 0-1 after deadzone removal
  const sign = v > 0 ? 1 : -1
  return sign * (Math.abs(v) - DEADZONE) / (1 - DEADZONE)
}

class GamepadManagerSingleton {
  private rafId: number | null = null
  private listeners = new Set<GamepadListener>()
  private _lastState: GamepadState | null = null

  /** Start polling (idempotent) */
  start() {
    if (this.rafId !== null) return
    this.poll()
    // Listen for connect/disconnect
    window.addEventListener('gamepadconnected', this.onConnect)
    window.addEventListener('gamepaddisconnected', this.onDisconnect)
  }

  /** Stop polling */
  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    window.removeEventListener('gamepadconnected', this.onConnect)
    window.removeEventListener('gamepaddisconnected', this.onDisconnect)
  }

  /** Subscribe to state updates (called every frame when a gamepad is connected) */
  subscribe(listener: GamepadListener): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  get lastState(): GamepadState | null {
    return this._lastState
  }

  /** Get current raw gamepad if available */
  getRawGamepad(): Gamepad | null {
    const gamepads = navigator.getGamepads()
    for (const gp of gamepads) {
      if (gp && gp.connected) return gp
    }
    return null
  }

  private poll = () => {
    const gp = this.getRawGamepad()
    if (gp) {
      const state: GamepadState = {
        connected: true,
        id: gp.id,
        axes: gp.axes.map(applyDeadzone),
        buttons: gp.buttons.map(b => ({ pressed: b.pressed, value: b.value })),
        timestamp: gp.timestamp
      }
      this._lastState = state
      this.listeners.forEach(l => l(state))
    } else if (this._lastState?.connected) {
      const state: GamepadState = {
        connected: false, id: '', axes: [], buttons: [], timestamp: 0
      }
      this._lastState = state
      this.listeners.forEach(l => l(state))
    }
    this.rafId = requestAnimationFrame(this.poll)
  }

  private onConnect = (e: GamepadEvent) => {
    console.log('[GamepadManager] Connected:', e.gamepad.id)
  }

  private onDisconnect = (e: GamepadEvent) => {
    console.log('[GamepadManager] Disconnected:', e.gamepad.id)
  }
}

// Singleton
export const gamepadManager = new GamepadManagerSingleton()

/**
 * Standard Xbox-style button indices (may vary per controller)
 */
export const XBOX_BUTTONS = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5,
  LT: 6, RT: 7,
  BACK: 8, START: 9,
  L3: 10, R3: 11,      // stick clicks
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  HOME: 16
} as const

/**
 * Standard Xbox-style axis indices
 */
export const XBOX_AXES = {
  LEFT_X: 0,   // left stick horizontal
  LEFT_Y: 1,   // left stick vertical
  RIGHT_X: 2,  // right stick horizontal
  RIGHT_Y: 3   // right stick vertical
} as const
