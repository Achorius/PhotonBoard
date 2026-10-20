import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import WebSocket from 'ws'
import { COMMANDS, isCommand } from './commands.js'

/** Close code PhotonBoard uses for a missing/wrong access PIN */
const CLOSE_AUTH_FAILED = 4401
const RECONNECT_MS = 5000
/** After a PIN refusal, retry slowly (PhotonBoard locks out repeated wrong PINs) */
const RECONNECT_AFTER_AUTH_FAIL_MS = 30000

class PhotonBoardInstance extends InstanceBase {
  ws = null
  reconnectTimer = null
  /** Signatures used to rebuild variables/presets only when scenes change */
  sceneVarCount = -1
  presetSignature = null
  state = {
    grandMaster: 255,
    blackout: false,
    blinder: false,
    strobe: false,
    timelinePlaying: false,
    showName: 'PhotonBoard',
    cuelists: [],
    groups: [],
    fixtureCount: 0
  }

  async init(config) {
    this.config = config
    this.setupActions()
    this.setupFeedbacks()
    this.setupVariables()
    this.setupPresets() // control presets are available before the first state arrives
    this.connect()
  }

  async destroy() {
    this.disconnect()
  }

  async configUpdated(config) {
    this.config = config
    this.disconnect()
    this.connect()
  }

  getConfigFields() {
    return [
      {
        type: 'static-text',
        id: 'info',
        width: 12,
        label: 'Info',
        value: 'Connect to PhotonBoard DMX lighting controller. Make sure PhotonBoard is running.'
      },
      {
        type: 'textinput',
        id: 'host',
        label: 'PhotonBoard IP Address',
        width: 8,
        default: '127.0.0.1'
      },
      {
        type: 'number',
        id: 'port',
        label: 'WebSocket Port',
        width: 4,
        default: 9090,
        min: 1,
        max: 65535
      },
      {
        type: 'textinput',
        id: 'pin',
        label: 'Access PIN (only if remote access PIN is enabled in PhotonBoard)',
        width: 6,
        default: ''
      }
    ]
  }

  // ---- WebSocket Connection ----

  connect() {
    const host = this.config?.host || '127.0.0.1'
    const port = this.config?.port || 9090
    const pin = (this.config?.pin || '').trim()

    this.updateStatus(InstanceStatus.Connecting)
    this.log('info', `Connecting to PhotonBoard at ${host}:${port}`)

    let ws
    try {
      ws = new WebSocket(`ws://${host}:${port}`)
    } catch (e) {
      this.log('error', `Connection failed: ${e.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure)
      this.scheduleReconnect(RECONNECT_MS)
      return
    }
    this.ws = ws

    ws.on('open', () => {
      // Authenticate first when a PIN is configured (ignored by PhotonBoard when no PIN is set)
      if (pin) ws.send(JSON.stringify({ type: 'auth', pin }))
    })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch (e) {
        this.log('warn', `Invalid message: ${e.message}`)
        return
      }
      if (msg.type === 'auth-ok') {
        this.updateStatus(InstanceStatus.Ok)
        this.log('info', 'Connected to PhotonBoard')
      } else if (msg.type === 'auth-required') {
        if (!pin) {
          this.updateStatus(InstanceStatus.BadConfig, 'PhotonBoard requires an access PIN')
          this.log('error', 'PhotonBoard requires an access PIN — enter it in the module configuration')
        }
      } else if (msg.type === 'state') {
        this.handleState(msg.data)
      } else if (msg.type === 'commands') {
        // Older PhotonBoard builds send no auth-ok: being told the commands means we are in
        this.updateStatus(InstanceStatus.Ok)
        const missing = COMMANDS.filter((c) => !msg.list?.includes(c))
        if (missing.length) this.log('debug', `PhotonBoard does not support: ${missing.join(', ')}`)
      }
    })

    ws.on('close', (code) => {
      if (this.ws !== ws) return
      this.ws = null
      if (code === CLOSE_AUTH_FAILED) {
        this.updateStatus(InstanceStatus.BadConfig, 'Wrong or missing access PIN')
        this.log('error', 'PhotonBoard refused the access PIN')
        this.scheduleReconnect(RECONNECT_AFTER_AUTH_FAIL_MS)
        return
      }
      this.updateStatus(InstanceStatus.Disconnected)
      this.log('info', 'Disconnected from PhotonBoard')
      this.scheduleReconnect(RECONNECT_MS)
    })

    ws.on('error', (err) => {
      this.log('error', `WebSocket error: ${err.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure)
    })
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.removeAllListeners()
      // Closing a socket that is still connecting emits 'error': without a
      // listener that would crash the module process.
      ws.on('error', () => {})
      try {
        ws.terminate()
      } catch (e) {
        // already closed
      }
    }
  }

  scheduleReconnect(delay = RECONNECT_MS) {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  sendCommand(type, payload) {
    if (!isCommand(type)) {
      this.log('warn', `Unknown PhotonBoard command: ${type}`)
      return
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'command',
        command: { type, payload }
      }))
    }
  }

  // ---- State Handling ----

  handleState(data) {
    if (!data || typeof data !== 'object') return
    const cuelists = Array.isArray(data.cuelists) ? data.cuelists : []
    this.state = { ...data, cuelists }

    // Scene variables must be declared before they are set
    if (cuelists.length !== this.sceneVarCount) {
      this.sceneVarCount = cuelists.length
      this.setupVariables()
    }

    // Update variables
    const vars = {
      grand_master: Math.round(((data.grandMaster ?? 255) / 255) * 100),
      blackout: data.blackout ? 'ON' : 'OFF',
      show_name: data.showName || 'PhotonBoard',
      fixture_count: data.fixtureCount || 0,
      scene_count: cuelists.length
    }

    // Per-scene variables
    for (let i = 0; i < cuelists.length; i++) {
      const cl = cuelists[i]
      const n = i + 1
      vars[`scene_${n}_name`] = cl.name
      vars[`scene_${n}_active`] = cl.isPlaying ? 'ON' : 'OFF'
      vars[`scene_${n}_fader`] = Math.round(((cl.faderLevel ?? 255) / 255) * 100)
      vars[`scene_${n}_cue`] = cl.currentCueName || (cl.cueCount ? `${(cl.currentCueIndex ?? 0) + 1}/${cl.cueCount}` : '')
    }
    this.setVariableValues(vars)

    // Re-check all feedbacks
    this.checkFeedbacks()

    // Rebuild presets when scenes are added, removed, reordered or renamed
    const signature = cuelists.map((cl) => `${cl.id}\u0000${cl.name}`).join('\u0001')
    if (signature !== this.presetSignature) {
      this.presetSignature = signature
      this.setupPresets()
    }
  }

  // ---- Actions ----

  setupActions() {
    this.setActionDefinitions({
      go_scene: {
        name: 'Go Scene',
        description: 'Start/advance a scene (cuelist)',
        options: [
          {
            id: 'scene_index',
            type: 'number',
            label: 'Scene Number',
            default: 1,
            min: 1,
            max: 999
          }
        ],
        callback: (action) => {
          const idx = action.options.scene_index - 1
          const cuelist = this.state.cuelists[idx]
          if (cuelist) this.sendCommand('go-cuelist', cuelist.id)
        }
      },

      stop_scene: {
        name: 'Stop Scene',
        description: 'Stop a scene (cuelist)',
        options: [
          {
            id: 'scene_index',
            type: 'number',
            label: 'Scene Number',
            default: 1,
            min: 1,
            max: 999
          }
        ],
        callback: (action) => {
          const idx = action.options.scene_index - 1
          const cuelist = this.state.cuelists[idx]
          if (cuelist) this.sendCommand('stop-cuelist', cuelist.id)
        }
      },

      toggle_scene: {
        name: 'Toggle Scene',
        description: 'GO if stopped, STOP if playing',
        options: [
          {
            id: 'scene_index',
            type: 'number',
            label: 'Scene Number',
            default: 1,
            min: 1,
            max: 999
          }
        ],
        callback: (action) => {
          const idx = action.options.scene_index - 1
          const cuelist = this.state.cuelists[idx]
          if (cuelist) {
            this.sendCommand(cuelist.isPlaying ? 'stop-cuelist' : 'go-cuelist', cuelist.id)
          }
        }
      },

      set_scene_fader: {
        name: 'Set Scene Fader',
        description: 'Set the fader level of a scene (0-100%)',
        options: [
          {
            id: 'scene_index',
            type: 'number',
            label: 'Scene Number',
            default: 1,
            min: 1,
            max: 999
          },
          {
            id: 'level',
            type: 'number',
            label: 'Level (%)',
            default: 100,
            min: 0,
            max: 100
          }
        ],
        callback: (action) => {
          const idx = action.options.scene_index - 1
          const cuelist = this.state.cuelists[idx]
          if (cuelist) {
            const dmxLevel = Math.round((action.options.level / 100) * 255)
            this.sendCommand('set-cuelist-fader', { id: cuelist.id, level: dmxLevel })
          }
        }
      },

      blackout: {
        name: 'Toggle Blackout',
        description: 'Toggle blackout on/off',
        options: [],
        callback: () => {
          this.sendCommand('toggle-blackout')
        }
      },

      set_grand_master: {
        name: 'Set Grand Master',
        description: 'Set the grand master level (0-100%)',
        options: [
          {
            id: 'level',
            type: 'number',
            label: 'Level (%)',
            default: 100,
            min: 0,
            max: 100
          }
        ],
        callback: (action) => {
          const dmxLevel = Math.round((action.options.level / 100) * 255)
          this.sendCommand('set-grand-master', dmxLevel)
        }
      },

      clear_programmer: {
        name: 'Clear Programmer',
        description: 'Release all manual fader overrides',
        options: [],
        callback: () => {
          this.sendCommand('clear-programmer')
        }
      },

      toggle_timeline: {
        name: 'Toggle Live/Timeline',
        description: 'Start or stop timeline playback',
        options: [],
        callback: () => {
          this.sendCommand('toggle-timeline')
        }
      },

      go_back_scene: {
        name: 'Go Back Scene',
        description: 'Step a scene (cuelist) back to its previous cue',
        options: [
          {
            id: 'scene_index',
            type: 'number',
            label: 'Scene Number',
            default: 1,
            min: 1,
            max: 999
          }
        ],
        callback: (action) => {
          const cuelist = this.state.cuelists[action.options.scene_index - 1]
          if (cuelist) this.sendCommand('go-back-cuelist', cuelist.id)
        }
      },

      release_all: {
        name: 'Release All',
        description: 'Stop every scene and chase',
        options: [],
        callback: () => {
          this.sendCommand('release-all')
        }
      },

      set_blackout: {
        name: 'Set Blackout',
        description: 'Force blackout on or off',
        options: [
          {
            id: 'state',
            type: 'dropdown',
            label: 'Blackout',
            default: 'on',
            choices: [
              { id: 'on', label: 'On' },
              { id: 'off', label: 'Off' }
            ]
          }
        ],
        callback: (action) => {
          this.sendCommand('set-blackout', action.options.state === 'on')
        }
      },

      toggle_blinder: {
        name: 'Toggle Blinder',
        description: 'Toggle the blinder (all intensities full)',
        options: [],
        callback: () => {
          this.sendCommand('toggle-blinder')
        }
      },

      toggle_strobe: {
        name: 'Toggle Strobe',
        description: 'Toggle the global strobe',
        options: [],
        callback: () => {
          this.sendCommand('toggle-strobe')
        }
      },

      tap_tempo: {
        name: 'Tap Tempo',
        description: 'Tap the tempo of the playing chases',
        options: [],
        callback: () => {
          this.sendCommand('tap-tempo')
        }
      },

      run_macro: {
        name: 'Run Macro',
        description: 'Run a macro by its number',
        options: [
          { id: 'number', type: 'number', label: 'Macro Number', default: 1, min: 1, max: 9999 }
        ],
        callback: (action) => {
          this.sendCommand('run-macro', { number: action.options.number })
        }
      },

      set_executor_page: {
        name: 'Set Executor Page',
        description: 'Show an executor page on the console',
        options: [
          { id: 'page', type: 'number', label: 'Page', default: 1, min: 1, max: 16 }
        ],
        callback: (action) => {
          this.sendCommand('set-executor-page', { page: action.options.page - 1 })
        }
      },

      executor: {
        name: 'Executor Button',
        description: 'Press or release an executor (use Press on key down and Release on key up)',
        options: [
          { id: 'page', type: 'number', label: 'Page (0 = current)', default: 0, min: 0, max: 16 },
          { id: 'col', type: 'number', label: 'Column', default: 1, min: 1, max: 8 },
          { id: 'row', type: 'number', label: 'Row (1 = top)', default: 1, min: 1, max: 4 },
          {
            id: 'phase',
            type: 'dropdown',
            label: 'Action',
            default: 'down',
            choices: [
              { id: 'down', label: 'Press' },
              { id: 'up', label: 'Release' }
            ]
          }
        ],
        callback: (action) => {
          const o = action.options
          this.sendCommand('executor', {
            page: o.page > 0 ? o.page - 1 : 'current',
            col: o.col - 1,
            row: o.row - 1,
            phase: o.phase === 'up' ? 'up' : 'down'
          })
        }
      }
    })
  }

  // ---- Feedbacks ----

  setupFeedbacks() {
    this.setFeedbackDefinitions({
      scene_active: {
        type: 'boolean',
        name: 'Scene Active',
        description: 'Changes button style when a scene is playing',
        defaultStyle: {
          bgcolor: 0x00cc00,
          color: 0xffffff
        },
        options: [
          {
            id: 'scene_index',
            type: 'number',
            label: 'Scene Number',
            default: 1,
            min: 1,
            max: 999
          }
        ],
        callback: (feedback) => {
          const idx = feedback.options.scene_index - 1
          const cuelist = this.state.cuelists[idx]
          return cuelist?.isPlaying ?? false
        }
      },

      blackout_active: {
        type: 'boolean',
        name: 'Blackout Active',
        description: 'Changes button style when blackout is on',
        defaultStyle: {
          bgcolor: 0xcc0000,
          color: 0xffffff
        },
        options: [],
        callback: () => {
          return !!this.state.blackout
        }
      },

      blinder_active: {
        type: 'boolean',
        name: 'Blinder Active',
        description: 'Changes button style while the blinder is on',
        defaultStyle: {
          bgcolor: 0xffffff,
          color: 0x000000
        },
        options: [],
        callback: () => {
          return !!this.state.blinder
        }
      },

      strobe_active: {
        type: 'boolean',
        name: 'Strobe Active',
        description: 'Changes button style while the strobe is on',
        defaultStyle: {
          bgcolor: 0xcccc00,
          color: 0x000000
        },
        options: [],
        callback: () => {
          return !!this.state.strobe
        }
      },

      timeline_playing: {
        type: 'boolean',
        name: 'Timeline Playing',
        description: 'Changes button style when timeline is playing',
        defaultStyle: {
          bgcolor: 0x00cc00,
          color: 0xffffff
        },
        options: [],
        callback: () => {
          return !!this.state.timelinePlaying
        }
      }
    })
  }

  // ---- Variables ----

  setupVariables() {
    const defs = [
      { variableId: 'grand_master', name: 'Grand Master (%)' },
      { variableId: 'blackout', name: 'Blackout State' },
      { variableId: 'show_name', name: 'Show Name' },
      { variableId: 'fixture_count', name: 'Fixture Count' },
      { variableId: 'scene_count', name: 'Scene Count' }
    ]
    const count = Math.max(0, this.sceneVarCount)
    for (let n = 1; n <= count; n++) {
      defs.push(
        { variableId: `scene_${n}_name`, name: `Scene ${n} Name` },
        { variableId: `scene_${n}_active`, name: `Scene ${n} Active (ON/OFF)` },
        { variableId: `scene_${n}_fader`, name: `Scene ${n} Fader (%)` },
        { variableId: `scene_${n}_cue`, name: `Scene ${n} Current Cue` }
      )
    }
    this.setVariableDefinitions(defs)
  }

  // ---- Presets ----

  setupPresets() {
    const presets = {}

    // Scene GO/STOP buttons
    if (this.state.cuelists) {
      for (let i = 0; i < this.state.cuelists.length; i++) {
        const cl = this.state.cuelists[i]
        const num = i + 1

        presets[`scene_${num}`] = {
          type: 'button',
          category: 'Scenes',
          name: cl.name || `Scene ${num}`,
          style: {
            text: cl.name || `Scene ${num}`,
            size: '14',
            color: 0xffffff,
            bgcolor: 0x333333
          },
          steps: [
            {
              down: [{ actionId: 'toggle_scene', options: { scene_index: num } }],
              up: []
            }
          ],
          feedbacks: [
            {
              feedbackId: 'scene_active',
              options: { scene_index: num },
              style: { bgcolor: 0x00cc00 }
            }
          ]
        }
      }
    }

    // Blackout button
    presets['blackout'] = {
      type: 'button',
      category: 'Controls',
      name: 'Blackout',
      style: {
        text: 'BLACKOUT',
        size: '14',
        color: 0xffffff,
        bgcolor: 0x333333
      },
      steps: [
        {
          down: [{ actionId: 'blackout', options: {} }],
          up: []
        }
      ],
      feedbacks: [
        {
          feedbackId: 'blackout_active',
          options: {},
          style: { bgcolor: 0xcc0000 }
        }
      ]
    }

    // Grand Master 100%
    presets['gm_full'] = {
      type: 'button',
      category: 'Controls',
      name: 'GM Full',
      style: {
        text: 'GM\\n100%',
        size: '18',
        color: 0xffffff,
        bgcolor: 0x994400
      },
      steps: [
        {
          down: [{ actionId: 'set_grand_master', options: { level: 100 } }],
          up: []
        }
      ],
      feedbacks: []
    }

    // Grand Master 0%
    presets['gm_zero'] = {
      type: 'button',
      category: 'Controls',
      name: 'GM Zero',
      style: {
        text: 'GM\\n0%',
        size: '18',
        color: 0xffffff,
        bgcolor: 0x333333
      },
      steps: [
        {
          down: [{ actionId: 'set_grand_master', options: { level: 0 } }],
          up: []
        }
      ],
      feedbacks: []
    }

    // Clear Programmer
    presets['clear'] = {
      type: 'button',
      category: 'Controls',
      name: 'Clear Programmer',
      style: {
        text: 'CLEAR',
        size: '14',
        color: 0xffffff,
        bgcolor: 0x664400
      },
      steps: [
        {
          down: [{ actionId: 'clear_programmer', options: {} }],
          up: []
        }
      ],
      feedbacks: []
    }

    // Timeline play/stop
    presets['timeline'] = {
      type: 'button',
      category: 'Controls',
      name: 'Live / Timeline',
      style: {
        text: 'LIVE',
        size: '18',
        color: 0xffffff,
        bgcolor: 0x333333
      },
      steps: [
        {
          down: [{ actionId: 'toggle_timeline', options: {} }],
          up: []
        }
      ],
      feedbacks: [
        {
          feedbackId: 'timeline_playing',
          options: {},
          style: { bgcolor: 0x00cc00 }
        }
      ]
    }

    this.setPresetDefinitions(presets)
  }
}

runEntrypoint(PhotonBoardInstance, [])
