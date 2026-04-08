import React, { useState, useEffect } from 'react'
import { useUiStore } from '../../stores/ui-store'
import type { ArtNetConfig, UsbDmxConfig, UsbDmxDriver, SerialPortInfo } from '@shared/types'

const USB_DRIVERS: { value: UsbDmxDriver; label: string; description: string }[] = [
  { value: 'enttec-open-dmx', label: 'ENTTEC Open DMX USB', description: 'FTDI-based, budget option' },
  { value: 'enttec-pro', label: 'ENTTEC DMX USB Pro', description: 'Pro protocol, reliable' },
  { value: 'udmx', label: 'uDMX / Clone', description: 'Cheap USB-DMX clones' },
]

export function SettingsView() {
  const { showName, setShowName } = useUiStore()
  const [artnetConfigs, setArtnetConfigs] = useState<ArtNetConfig[]>([
    { host: '255.255.255.255', port: 6454, universe: 0, subnet: 0, net: 0 },
    { host: '255.255.255.255', port: 6454, universe: 1, subnet: 0, net: 0 },
    { host: '255.255.255.255', port: 6454, universe: 2, subnet: 0, net: 0 }
  ])
  const [artnetStatus, setArtnetStatus] = useState<{ connected: boolean; senders: any[] }>({ connected: false, senders: [] })
  const [saved, setSaved] = useState(false)

  // USB DMX state
  const [usbConfigs, setUsbConfigs] = useState<UsbDmxConfig[]>([])
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([])
  const [usbStatus, setUsbStatus] = useState<{ available: boolean; outputs: any[] }>({ available: false, outputs: [] })
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    window.photonboard.artnet.getStatus().then(setArtnetStatus).catch(() => {})
    refreshUsbStatus()
  }, [])

  const refreshUsbStatus = async () => {
    try {
      const status = await window.photonboard.dmxOutputs.getStatus()
      setUsbStatus(status.usbDmx)
    } catch (e) { /* ignore */ }
  }

  const scanUsb = async () => {
    setScanning(true)
    try {
      const ports = await window.photonboard.dmxOutputs.scanUsb()
      setSerialPorts(ports)
    } catch (e) {
      console.error('Failed to scan USB ports:', e)
    }
    setScanning(false)
  }

  const applyArtnet = async () => {
    await window.photonboard.artnet.configure(artnetConfigs)
    const status = await window.photonboard.artnet.getStatus()
    setArtnetStatus(status)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const addUsbOutput = () => {
    setUsbConfigs([...usbConfigs, {
      driver: 'enttec-open-dmx',
      portPath: serialPorts[0]?.path || '',
      universe: 0,
      label: `USB DMX ${usbConfigs.length + 1}`
    }])
  }

  const removeUsbOutput = (index: number) => {
    setUsbConfigs(usbConfigs.filter((_, i) => i !== index))
  }

  const applyUsb = async () => {
    // Build DmxOutputConfig array for USB entries
    const configs = usbConfigs.map((uc, i) => ({
      id: `usb-${i}`,
      type: 'usb-dmx' as const,
      enabled: true,
      usbDmx: uc
    }))
    await window.photonboard.dmxOutputs.configure(configs)
    await refreshUsbStatus()
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
    <div className="max-w-2xl mx-auto p-6 space-y-6 h-full overflow-y-auto">
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

      {/* USB DMX Configuration */}
      <section className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-300">USB DMX Output</h2>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${usbStatus.available ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-[10px] text-gray-500">
              {usbStatus.available ? `${usbStatus.outputs.length} connected` : 'serialport not found'}
            </span>
          </div>
        </div>

        <p className="text-[10px] text-gray-500">
          Supports ENTTEC Open DMX USB, ENTTEC DMX USB Pro, uDMX and compatible clones.
        </p>

        {/* Scan button */}
        <div className="flex gap-2 items-center">
          <button className="btn-secondary text-xs" onClick={scanUsb} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan USB Ports'}
          </button>
          {serialPorts.length > 0 && (
            <span className="text-[10px] text-gray-500">{serialPorts.length} port(s) found</span>
          )}
        </div>

        {/* Detected ports info */}
        {serialPorts.length > 0 && (
          <div className="bg-surface-2 rounded p-2 space-y-1">
            <span className="text-[9px] text-gray-500 uppercase">Detected Ports</span>
            {serialPorts.map((port, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] text-gray-400">
                <span className="font-mono text-blue-400">{port.path}</span>
                {port.manufacturer && <span className="text-gray-600">{port.manufacturer}</span>}
                {port.vendorId && <span className="text-gray-600">VID:{port.vendorId}</span>}
                {port.productId && <span className="text-gray-600">PID:{port.productId}</span>}
              </div>
            ))}
          </div>
        )}

        {/* USB DMX outputs */}
        {usbConfigs.map((config, i) => (
          <div key={i} className="bg-surface-2 rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-300">{config.label || `USB DMX ${i + 1}`}</span>
              <button
                className="text-[10px] text-red-400 hover:text-red-300"
                onClick={() => removeUsbOutput(i)}
              >
                Remove
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {/* Driver */}
              <div>
                <label className="text-[9px] text-gray-600">Adapter Type</label>
                <select
                  className="input w-full text-xs"
                  value={config.driver}
                  onChange={e => {
                    const updated = [...usbConfigs]
                    updated[i] = { ...config, driver: e.target.value as UsbDmxDriver }
                    setUsbConfigs(updated)
                  }}
                >
                  {USB_DRIVERS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* Port */}
              <div>
                <label className="text-[9px] text-gray-600">Serial Port</label>
                {serialPorts.length > 0 ? (
                  <select
                    className="input w-full text-xs"
                    value={config.portPath}
                    onChange={e => {
                      const updated = [...usbConfigs]
                      updated[i] = { ...config, portPath: e.target.value }
                      setUsbConfigs(updated)
                    }}
                  >
                    <option value="">Select port...</option>
                    {serialPorts.map((p, pi) => (
                      <option key={pi} value={p.path}>
                        {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input w-full text-xs"
                    value={config.portPath}
                    onChange={e => {
                      const updated = [...usbConfigs]
                      updated[i] = { ...config, portPath: e.target.value }
                      setUsbConfigs(updated)
                    }}
                    placeholder="/dev/tty.usbserial-XXX"
                  />
                )}
              </div>

              {/* Universe */}
              <div>
                <label className="text-[9px] text-gray-600">Universe</label>
                <input
                  className="input w-full text-xs"
                  type="number"
                  min={0}
                  max={15}
                  value={config.universe}
                  onChange={e => {
                    const updated = [...usbConfigs]
                    updated[i] = { ...config, universe: parseInt(e.target.value) || 0 }
                    setUsbConfigs(updated)
                  }}
                />
              </div>
            </div>

            {/* Driver info */}
            <p className="text-[9px] text-gray-600">
              {USB_DRIVERS.find(d => d.value === config.driver)?.description}
            </p>
          </div>
        ))}

        <div className="flex gap-2">
          <button className="btn-secondary text-xs" onClick={addUsbOutput}>
            + Add USB DMX Output
          </button>
          {usbConfigs.length > 0 && (
            <button className="btn-primary text-xs" onClick={applyUsb}>
              Apply USB Config
            </button>
          )}
        </div>

        {/* Connected USB outputs status */}
        {usbStatus.outputs.length > 0 && (
          <div className="space-y-1">
            <span className="text-[9px] text-gray-500 uppercase">Active USB Outputs</span>
            {usbStatus.outputs.map((out, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <div className={`w-1.5 h-1.5 rounded-full ${out.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-gray-400">
                  Universe {out.universe + 1} — {out.driver} on {out.port}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  )
}
