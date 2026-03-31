import React, { useEffect, useState } from 'react'
import { useDmxStore } from '../../stores/dmx-store'
import { usePatchStore } from '../../stores/patch-store'
import { useMidiStore } from '../../stores/midi-store'

export function StatusBar() {
  const { blackout, grandMaster } = useDmxStore()
  const { patch } = usePatchStore()
  const { devices, lastMessage } = useMidiStore()
  const [artnetStatus, setArtnetStatus] = useState<{ connected: boolean; senders: any[] }>({ connected: false, senders: [] })

  useEffect(() => {
    const check = async () => {
      try {
        const status = await window.photonboard.artnet.getStatus()
        setArtnetStatus(status)
      } catch { /* not ready */ }
    }
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [])

  const midiInputs = devices.filter(d => d.type === 'input' && d.connected)

  return (
    <div className="h-6 bg-surface-1 border-t border-surface-3 flex items-center px-3 gap-4 text-[10px] text-gray-500">
      {/* ArtNet status */}
      <div className="flex items-center gap-1">
        <div className={`w-1.5 h-1.5 rounded-full ${artnetStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span>ArtNet {artnetStatus.connected ? 'OK' : 'Offline'}</span>
        {artnetStatus.senders.length > 0 && (
          <span className="text-gray-600">({artnetStatus.senders.length} univ)</span>
        )}
      </div>

      {/* Patch count */}
      <span>{patch.length} fixtures patched</span>

      {/* MIDI */}
      <div className="flex items-center gap-1">
        <div className={`w-1.5 h-1.5 rounded-full ${midiInputs.length > 0 ? 'bg-green-500' : 'bg-gray-600'}`} />
        <span>MIDI {midiInputs.length > 0 ? midiInputs.map(d => d.name).join(', ') : 'No device'}</span>
      </div>

      {/* Last MIDI message */}
      {lastMessage && (
        <span className="text-gray-600 font-mono">
          [{lastMessage.type.toUpperCase()} ch{lastMessage.channel} #{lastMessage.number} v{lastMessage.value}]
        </span>
      )}

      <div className="flex-1" />

      {/* GM & BO indicator */}
      {grandMaster < 255 && (
        <span className="text-yellow-500">GM {Math.round((grandMaster / 255) * 100)}%</span>
      )}
      {blackout && (
        <span className="text-red-500 font-bold animate-pulse">BLACKOUT</span>
      )}
    </div>
  )
}
