import React, { useState, useEffect } from 'react'
import { useUiStore } from '../../stores/ui-store'
import type { ArtNetConfig } from '@shared/types'

export function SettingsView() {
  const { showName, setShowName } = useUiStore()
  const [artnetConfigs, setArtnetConfigs] = useState<ArtNetConfig[]>([
    { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
    { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
    { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
  ])
  const [artnetStatus, setArtnetStatus] = useState<{ connected: boolean; senders: any[] }>({ connected: false, senders: [] })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.photonboard.artnet.getStatus().then(setArtnetStatus).catch(() => {})
  }, [])

  const applyArtnet = async () => {
    await window.photonboard.artnet.configure(artnetConfigs)
    const status = await window.photonboard.artnet.getStatus()
    setArtnetStatus(status)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveShow = async () => {
    const show = await window.photonboard.show.new()
    show.name = showName
    show.artnetConfig = artnetConfigs
    await window.photonboard.show.save(show)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>

      {/* Show */}
      <section className="panel p-4 space-y-3">
        <h2 className="text-sm font-medium text-gray-300">Show</h2>
        <div>
          <label className="text-[10px] text-gray-500 uppercase">Show Name</label>
          <input
            className="input w-full mt-0.5"
            value={showName}
            onChange={e => setShowName(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={handleSaveShow}>Save Show</button>
          <button className="btn-secondary" onClick={() => window.photonboard.show.load()}>Load Show</button>
          <button className="btn-secondary" onClick={() => window.photonboard.show.new()}>New Show</button>
        </div>
      </section>

      {/* ArtNet Configuration */}
      <section className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-300">ArtNet Output</h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${artnetStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-[10px] text-gray-500">{artnetStatus.connected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>

        {artnetConfigs.map((config, i) => (
          <div key={i} className="flex items-center gap-2 bg-surface-2 rounded p-2">
            <span className="text-xs text-gray-500 w-20">Universe {i + 1}</span>
            <div className="flex-1">
              <label className="text-[9px] text-gray-600">IP Address</label>
              <input
                className="input w-full"
                value={config.host}
                onChange={e => {
                  const newConfigs = [...artnetConfigs]
                  newConfigs[i] = { ...config, host: e.target.value }
                  setArtnetConfigs(newConfigs)
                }}
                placeholder="255.255.255.255"
              />
            </div>
            <div className="w-20">
              <label className="text-[9px] text-gray-600">Port</label>
              <input
                className="input w-full"
                type="number"
                value={config.port}
                onChange={e => {
                  const newConfigs = [...artnetConfigs]
                  newConfigs[i] = { ...config, port: parseInt(e.target.value) || 6454 }
                  setArtnetConfigs(newConfigs)
                }}
              />
            </div>
            <div className="w-16">
              <label className="text-[9px] text-gray-600">Subnet</label>
              <input
                className="input w-full"
                type="number"
                min={0}
                max={15}
                value={config.subnet}
                onChange={e => {
                  const newConfigs = [...artnetConfigs]
                  newConfigs[i] = { ...config, subnet: parseInt(e.target.value) || 0 }
                  setArtnetConfigs(newConfigs)
                }}
              />
            </div>
            <div className="w-16">
              <label className="text-[9px] text-gray-600">Net</label>
              <input
                className="input w-full"
                type="number"
                min={0}
                max={127}
                value={config.net}
                onChange={e => {
                  const newConfigs = [...artnetConfigs]
                  newConfigs[i] = { ...config, net: parseInt(e.target.value) || 0 }
                  setArtnetConfigs(newConfigs)
                }}
              />
            </div>
          </div>
        ))}

        <button className="btn-primary" onClick={applyArtnet}>
          Apply ArtNet Config
        </button>
        {saved && <span className="text-xs text-green-400 ml-2">Saved!</span>}
      </section>

      {/* About */}
      <section className="panel p-4 space-y-2">
        <h2 className="text-sm font-medium text-gray-300">About</h2>
        <p className="text-xs text-gray-500">
          PhotonBoard v0.1.0 — Professional DMX Lighting Control
        </p>
        <p className="text-xs text-gray-600">
          ArtNet output | 3 DMX universes | MIDI controller support | Open Fixture Library
        </p>
      </section>
    </div>
  )
}
