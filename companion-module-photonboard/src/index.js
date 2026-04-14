import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import WebSocket from 'ws'

class PhotonBoardInstance extends InstanceBase {
  ws = null
  reconnectTimer = null
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
      }
    ]
  }

  // ---- WebSocket Connection ----

  connect() {
    const host = this.config?.host || '127.0.0.1'
    const port = this.config?.port || 9090

    this.updateStatus(InstanceStatus.Connecting)
    this.log('info', `Connecting to PhotonBoard at ${host}:${port}`)

    try {
      this.ws = new WebSocket(`ws://${host}:${port}`)

      this.ws.on('open', () => {
        this.updateStatus(InstanceStatus.Ok)
        this.log('info', 'Connected to PhotonBoard')
      })

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'state') {
            this.handleState(msg.data)
          } else if (msg.type === 'commands') {
            this.log('debug', `Available commands: ${msg.list.join(', ')}`)
          }
        } catch (e) {
          this.log('warn', `Invalid message: ${e.message}`)
        }
      })

      this.ws.on('close', () => {
        this.updateStatus(InstanceStatus.Disconnected)
        this.log('info', 'Disconnected from PhotonBoard')
        this.scheduleReconnect()
      })

      this.ws.on('error', (err) => {
        this.log('error', `WebSocket error: ${err.message}`)
        this.updateStatus(InstanceStatus.ConnectionFailure)
      })
    } catch (e) {
      this.log('error', `Connection failed: ${e.message}`)
      this.updateStatus(InstanceStatus.ConnectionFailure)
      this.scheduleReconnect()
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 5000)
  }

  sendCommand(type, payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'command',
        command: { type, payload }
      }))
    }
  }

  // ---- State Handling ----

  handleState(data) {
    const prevCuelistCount = this.state.cuelists.length
    this.state = data

    // Update variables
    this.setVariableValues({
      grand_master: Math.round((data.grandMaster / 255) * 100),
      blackout: data.blackout ? 'ON' : 'OFF',
      show_name: data.showName || 'PhotonBoard',
      fixture_count: data.fixtureCount || 0,
      scene_count: data.cuelists?.length || 0
    })

    // Update per-scene variables
    if (data.cuelists) {
      const sceneVars = {}
      for (let i = 0; i < data.cuelists.length; i++) {
        const cl = data.cuelists[i]
        sceneVars[`scene_${i + 1}_name`] = cl.name
        sceneVars[`scene_${i + 1}_active`] = cl.isPlaying ? 'ON' : 'OFF'
        sceneVars[`scene_${i + 1}_fader`] = Math.round((cl.faderLevel / 255) * 100)
      }
      this.setVariableValues(sceneVars)
    }

    // Re-check all feedbacks
    this.checkFeedbacks()

    // Rebuild presets if scene count changed
    if (data.cuelists?.length !== prevCuelistCount) {
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
          return this.state.blackout
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
          return this.state.timelinePlaying
        }
      }
    })
  }

  // ---- Variables ----

  setupVariables() {
    this.setVariableDefinitions([
      { variableId: 'grand_master', name: 'Grand Master (%)' },
      { variableId: 'blackout', name: 'Blackout State' },
      { variableId: 'show_name', name: 'Show Name' },
      { variableId: 'fixture_count', name: 'Fixture Count' },
      { variableId: 'scene_count', name: 'Scene Count' }
    ])
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
