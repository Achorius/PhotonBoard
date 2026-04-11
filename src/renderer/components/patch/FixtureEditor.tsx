import React, { useState } from 'react'
import type { FixtureDefinition, FixtureChannel, FixtureMode } from '@shared/types'

interface FixtureEditorProps {
  fixture?: FixtureDefinition
  onSave: () => void
  onClose: () => void
}

const CHANNEL_TYPES: FixtureChannel['type'][] = [
  'intensity', 'color', 'pan', 'tilt', 'gobo', 'prism', 'shutter', 'strobe', 'speed', 'effect', 'maintenance', 'fog', 'generic'
]

const TYPE_COLORS: Record<string, string> = {
  intensity: '#e85d04', color: '#22c55e', pan: '#6366f1', tilt: '#6366f1',
  gobo: '#f59e0b', prism: '#ec4899', shutter: '#ef4444', strobe: '#ef4444',
  speed: '#06b6d4', effect: '#8b5cf6', maintenance: '#64748b', fog: '#94a3b8', generic: '#6b7280'
}

function autoPrecedence(type: string): 'HTP' | 'LTP' {
  return type === 'intensity' ? 'HTP' : 'LTP'
}

function autoDefault(type: string): number {
  return (type === 'pan' || type === 'tilt') ? 128 : 0
}

interface ChannelRow {
  id: string
  name: string
  type: FixtureChannel['type']
  defaultValue: number
  precedence: 'HTP' | 'LTP'
}

interface ModeRow {
  id: string
  name: string
  channelIds: string[]
}

export function FixtureEditor({ fixture, onSave, onClose }: FixtureEditorProps) {
  const isEdit = !!fixture

  const [name, setName] = useState(fixture?.name || '')
  const [manufacturer, setManufacturer] = useState(fixture?.manufacturer || '')
  const [categories, setCategories] = useState(fixture?.categories?.join(', ') || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPhysical, setShowPhysical] = useState(false)

  // Physical
  const [beamAngleMin, setBeamAngleMin] = useState(fixture?.physical?.lens?.degreesMinMax?.[0] ?? '')
  const [beamAngleMax, setBeamAngleMax] = useState(fixture?.physical?.lens?.degreesMinMax?.[1] ?? '')
  const [panRange, setPanRange] = useState((fixture?.physical as any)?.panRange ?? '')
  const [tiltRange, setTiltRange] = useState((fixture?.physical as any)?.tiltRange ?? '')
  const [weight, setWeight] = useState(fixture?.physical?.weight ?? '')
  const [power, setPower] = useState(fixture?.physical?.power ?? '')

  // ID counter ref
  const nextIdRef = React.useRef(Date.now())
  const genId = () => `ch-${nextIdRef.current++}`
  const genModeId = () => `mode-${nextIdRef.current++}`

  // Initialize channels from fixture
  const buildInitialChannels = (): ChannelRow[] => {
    if (!fixture) return []
    return Object.values(fixture.channels).map((ch, i) => ({
      id: `ch-init-${i}`,
      name: ch.name,
      type: ch.type,
      defaultValue: ch.defaultValue ?? 0,
      precedence: ch.precedence || autoPrecedence(ch.type)
    }))
  }

  const buildInitialModes = (initChannels: ChannelRow[]): ModeRow[] => {
    if (!fixture) return []
    return fixture.modes.map((m, i) => ({
      id: `mode-init-${i}`,
      name: m.name,
      channelIds: m.channels
        .map(chName => {
          const found = initChannels.find(c => c.name === chName)
          return found ? found.id : ''
        })
        .filter(Boolean)
    }))
  }

  const [initialChannels] = useState<ChannelRow[]>(() => buildInitialChannels())
  const [channels, setChannels] = useState<ChannelRow[]>(initialChannels)
  const [modes, setModes] = useState<ModeRow[]>(() => buildInitialModes(initialChannels))

  // Channel operations
  const addChannel = (ch: Partial<ChannelRow>): string => {
    const id = genId()
    setChannels(prev => [...prev, {
      id,
      name: ch.name || 'New Channel',
      type: ch.type || 'generic',
      defaultValue: ch.defaultValue ?? 0,
      precedence: ch.precedence || 'LTP'
    }])
    return id
  }

  const removeChannel = (id: string) => {
    setChannels(prev => prev.filter(c => c.id !== id))
    setModes(prev => prev.map(m => ({ ...m, channelIds: m.channelIds.filter(cid => cid !== id) })))
  }

  const updateChannel = (id: string, updates: Partial<ChannelRow>) => {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  // Quick presets
  const addPreset = (preset: string) => {
    const newIds: string[] = []
    const add = (name: string, type: FixtureChannel['type'], defaultValue = 0, precedence?: 'HTP' | 'LTP') => {
      newIds.push(addChannel({ name, type, defaultValue, precedence: precedence || autoPrecedence(type) }))
    }

    switch (preset) {
      case 'dimmer':
        add('Dimmer', 'intensity', 0, 'HTP')
        break
      case 'rgb':
        add('Red', 'color')
        add('Green', 'color')
        add('Blue', 'color')
        break
      case 'rgbw':
        add('Red', 'color')
        add('Green', 'color')
        add('Blue', 'color')
        add('White', 'color')
        break
      case 'pan-tilt':
        add('Pan', 'pan', 128)
        add('Pan Fine', 'pan', 0)
        add('Tilt', 'tilt', 128)
        add('Tilt Fine', 'tilt', 0)
        break
      case 'gobo':
        add('Gobo', 'gobo')
        add('Gobo Rotation', 'gobo')
        break
      case 'shutter':
        add('Shutter', 'shutter')
        break
    }

    // Auto-add to first mode if only one mode exists
    if (modes.length === 1) {
      setModes(prev => [{ ...prev[0], channelIds: [...prev[0].channelIds, ...newIds] }])
    }
  }

  // Mode operations
  const addMode = () => {
    setModes(prev => [...prev, {
      id: genModeId(),
      name: `Mode ${prev.length + 1}`,
      channelIds: channels.map(c => c.id)
    }])
  }

  const removeMode = (id: string) => {
    setModes(prev => prev.filter(m => m.id !== id))
  }

  const toggleChannelInMode = (modeId: string, channelId: string) => {
    setModes(prev => prev.map(m => {
      if (m.id !== modeId) return m
      const has = m.channelIds.includes(channelId)
      return {
        ...m,
        channelIds: has
          ? m.channelIds.filter(id => id !== channelId)
          : [...m.channelIds, channelId]
      }
    }))
  }

  // Validation
  const validate = (): string[] => {
    const errors: string[] = []
    if (!name.trim()) errors.push('Fixture name is required')
    if (!manufacturer.trim()) errors.push('Manufacturer is required')
    if (channels.length === 0) errors.push('At least one channel is required')
    if (modes.length === 0) errors.push('At least one mode is required')
    const chNames = channels.map(c => c.name)
    const dupes = chNames.filter((n, i) => chNames.indexOf(n) !== i)
    if (dupes.length > 0) errors.push(`Duplicate channel names: ${[...new Set(dupes)].join(', ')}`)
    for (const mode of modes) {
      if (!mode.name.trim()) errors.push('All modes must have a name')
      if (mode.channelIds.length === 0) errors.push(`Mode "${mode.name}" has no channels`)
    }
    return errors
  }

  // Build FixtureDefinition
  const build = (): FixtureDefinition => {
    const mfr = manufacturer.trim() || 'User'
    const fixtureId = fixture?.id || `${mfr.toLowerCase().replace(/\s+/g, '-')}/${name.trim().toLowerCase().replace(/\s+/g, '-')}`

    const channelDefs: Record<string, FixtureChannel> = {}
    for (const ch of channels) {
      channelDefs[ch.name] = {
        name: ch.name,
        type: ch.type,
        defaultValue: ch.defaultValue,
        precedence: ch.precedence,
        highlightValue: ch.type === 'intensity' ? 255 : undefined,
        capabilities: [{
          dmxRange: [0, 255] as [number, number],
          type: ch.type === 'intensity' ? 'Intensity' : 'Generic',
          label: `${ch.name} 0-100%`
        }]
      }
    }

    const modeDefs: FixtureMode[] = modes.map(m => {
      const modeChannels = m.channelIds
        .map(id => channels.find(c => c.id === id)?.name)
        .filter(Boolean) as string[]
      return { name: m.name, channels: modeChannels, channelCount: modeChannels.length }
    })

    const physical: any = {}
    if (beamAngleMin || beamAngleMax) {
      physical.lens = { degreesMinMax: [Number(beamAngleMin) || 0, Number(beamAngleMax) || 0] }
    }
    if (panRange) physical.panRange = Number(panRange)
    if (tiltRange) physical.tiltRange = Number(tiltRange)
    if (weight) physical.weight = Number(weight)
    if (power) physical.power = Number(power)

    return {
      id: fixtureId,
      name: name.trim(),
      manufacturer: mfr,
      categories: categories.split(',').map(c => c.trim()).filter(Boolean),
      channels: channelDefs,
      modes: modeDefs,
      physical: Object.keys(physical).length > 0 ? physical : undefined,
      source: 'user' as const,
      lastModified: new Date().toISOString()
    }
  }

  const handleSave = async () => {
    const errors = validate()
    if (errors.length > 0) {
      setError(errors.join('. '))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const def = build()
      const result = await window.photonboard.fixtures.save(def)
      if (result?.success === false) {
        setError(result.error || 'Save failed')
        return
      }
      onSave()
      onClose()
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface-1 border border-surface-3 rounded-lg w-[700px] max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{isEdit ? 'Edit Fixture' : 'Create Fixture'}</h2>
          <button className="text-gray-500 hover:text-gray-300" onClick={onClose}>×</button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Manufacturer</label>
              <input
                className="input w-full mt-0.5"
                value={manufacturer}
                onChange={e => setManufacturer(e.target.value)}
                placeholder="e.g. Generic"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Name</label>
              <input
                className="input w-full mt-0.5"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. LED Par 36"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase">Categories</label>
              <input
                className="input w-full mt-0.5"
                value={categories}
                onChange={e => setCategories(e.target.value)}
                placeholder="PAR, Color Changer"
              />
            </div>
          </div>

          {/* Channels */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-gray-500 uppercase">Channels ({channels.length})</label>
              <div className="flex gap-1">
                {['dimmer', 'rgb', 'rgbw', 'pan-tilt', 'gobo', 'shutter'].map(preset => (
                  <button
                    key={preset}
                    className="px-1.5 py-0.5 rounded text-[9px] bg-surface-3 text-gray-400 hover:text-gray-200 hover:bg-surface-4"
                    onClick={() => addPreset(preset)}
                  >
                    +{preset.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-surface-0 rounded border border-surface-3 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-[10px] uppercase">
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="px-2 py-1 text-left font-medium">Name</th>
                    <th className="px-2 py-1 text-left font-medium">Type</th>
                    <th className="px-2 py-1 text-left font-medium">Default</th>
                    <th className="px-2 py-1 text-left font-medium">Prec.</th>
                    <th className="px-2 py-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch, i) => (
                    <tr key={ch.id} className="border-t border-surface-3/50 hover:bg-surface-2/30">
                      <td className="px-2 py-0.5 text-gray-600">{i + 1}</td>
                      <td className="px-2 py-0.5">
                        <input
                          className="bg-transparent border-none outline-none text-gray-200 w-full text-xs"
                          value={ch.name}
                          onChange={e => updateChannel(ch.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-0.5">
                        <select
                          className="bg-transparent border-none outline-none text-xs cursor-pointer"
                          style={{ color: TYPE_COLORS[ch.type] || '#6b7280' }}
                          value={ch.type}
                          onChange={e => {
                            const type = e.target.value as FixtureChannel['type']
                            updateChannel(ch.id, {
                              type,
                              precedence: autoPrecedence(type),
                              defaultValue: autoDefault(type)
                            })
                          }}
                        >
                          {CHANNEL_TYPES.map(t => (
                            <option key={t} value={t} className="bg-surface-2">{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-0.5">
                        <input
                          className="bg-transparent border-none outline-none text-gray-400 w-12 text-xs"
                          type="number"
                          min={0}
                          max={255}
                          value={ch.defaultValue}
                          onChange={e => updateChannel(ch.id, { defaultValue: parseInt(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="px-2 py-0.5">
                        <select
                          className="bg-transparent border-none outline-none text-gray-400 text-xs cursor-pointer"
                          value={ch.precedence}
                          onChange={e => updateChannel(ch.id, { precedence: e.target.value as 'HTP' | 'LTP' })}
                        >
                          <option value="HTP" className="bg-surface-2">HTP</option>
                          <option value="LTP" className="bg-surface-2">LTP</option>
                        </select>
                      </td>
                      <td className="px-2 py-0.5">
                        <button
                          className="text-red-400 hover:text-red-300 text-[10px]"
                          onClick={() => removeChannel(ch.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="w-full px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-surface-2 border-t border-surface-3/50"
                onClick={() => addChannel({})}
              >
                + Add Channel
              </button>
            </div>
          </div>

          {/* Modes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-gray-500 uppercase">Modes ({modes.length})</label>
              <button className="text-[10px] text-accent hover:text-accent-light" onClick={addMode}>
                + Add Mode
              </button>
            </div>
            {modes.length === 0 && (
              <div className="text-center py-3 text-gray-600 text-[10px] bg-surface-0 rounded border border-surface-3">
                No modes defined. Add at least one mode.
              </div>
            )}
            {modes.map(mode => (
              <div key={mode.id} className="bg-surface-0 rounded border border-surface-3 p-2 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <input
                    className="bg-transparent border-none outline-none text-gray-200 text-xs flex-1"
                    value={mode.name}
                    onChange={e => setModes(prev =>
                      prev.map(m => m.id === mode.id ? { ...m, name: e.target.value } : m)
                    )}
                    placeholder="Mode name"
                  />
                  <span className="text-[10px] text-gray-500">{mode.channelIds.length} ch</span>
                  <button
                    className="text-[9px] text-gray-500 hover:text-gray-300"
                    onClick={() => setModes(prev =>
                      prev.map(m => m.id === mode.id ? { ...m, channelIds: channels.map(c => c.id) } : m)
                    )}
                  >
                    All
                  </button>
                  <button
                    className="text-[9px] text-gray-500 hover:text-gray-300"
                    onClick={() => setModes(prev =>
                      prev.map(m => m.id === mode.id ? { ...m, channelIds: [] } : m)
                    )}
                  >
                    None
                  </button>
                  <button
                    className="text-red-400 hover:text-red-300 text-[10px]"
                    onClick={() => removeMode(mode.id)}
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {channels.map(ch => {
                    const included = mode.channelIds.includes(ch.id)
                    return (
                      <button
                        key={ch.id}
                        className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                          included
                            ? 'bg-accent/20 text-accent border border-accent/30'
                            : 'bg-surface-3 text-gray-600 hover:text-gray-400'
                        }`}
                        onClick={() => toggleChannelInMode(mode.id, ch.id)}
                      >
                        {ch.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Physical (collapsible) */}
          <div>
            <button
              className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1"
              onClick={() => setShowPhysical(!showPhysical)}
            >
              <span>{showPhysical ? '\u25BE' : '\u25B8'}</span>
              Physical Properties
            </button>
            {showPhysical && (
              <div className="grid grid-cols-3 gap-2 mt-2 bg-surface-0 rounded border border-surface-3 p-3">
                <div>
                  <label className="text-[10px] text-gray-500">Beam Angle Min (°)</label>
                  <input
                    className="input w-full mt-0.5"
                    type="number"
                    value={beamAngleMin}
                    onChange={e => setBeamAngleMin(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Beam Angle Max (°)</label>
                  <input
                    className="input w-full mt-0.5"
                    type="number"
                    value={beamAngleMax}
                    onChange={e => setBeamAngleMax(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Weight (kg)</label>
                  <input
                    className="input w-full mt-0.5"
                    type="number"
                    value={weight}
                    onChange={e => setWeight(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Pan Range (°)</label>
                  <input
                    className="input w-full mt-0.5"
                    type="number"
                    value={panRange}
                    onChange={e => setPanRange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Tilt Range (°)</label>
                  <input
                    className="input w-full mt-0.5"
                    type="number"
                    value={tiltRange}
                    onChange={e => setTiltRange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Power (W)</label>
                  <input
                    className="input w-full mt-0.5"
                    type="number"
                    value={power}
                    onChange={e => setPower(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-surface-3 flex items-center gap-2">
          {error && (
            <div className="flex-1 text-[10px] text-red-400 truncate">{error}</div>
          )}
          <div className="flex-1" />
          <button className="btn-secondary text-xs px-3 py-1" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary text-xs px-4 py-1"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : isEdit ? 'Update Fixture' : 'Create Fixture'}
          </button>
        </div>
      </div>
    </div>
  )
}
